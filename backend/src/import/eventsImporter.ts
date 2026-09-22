import { sql, type Kysely } from "kysely";
import type { DB } from "../db/types.js";
import type { RawEvent } from "../xml/eventsTypes.js";
import { asArray } from "../xml/eventsTypes.js";
import { findSchoolyearIdForDate, type HelperCaches } from "./helperTables.js";
import { syncChildren, upsertChanged } from "./syncRows.js";

export interface ImportStats {
  success: number;
  fail: number;
}

export async function importEventsBatch(
  db: Kysely<DB>,
  caches: HelperCaches,
  batch: RawEvent[],
  errorLog: string[],
): Promise<ImportStats> {
  return db.transaction().execute(async (trx) => {
    // Serialize event import batches without locking/writing every unchanged tuple.
    // Include the schema so isolated test imports never lock the live importer.
    await sql`select pg_advisory_xact_lock(746120, hashtext(current_schema()))`.execute(trx);
    return importEventsBatchInTransaction(trx, caches, batch, errorLog);
  });
}

async function importEventsBatchInTransaction(
  db: Kysely<DB>,
  caches: HelperCaches,
  batch: RawEvent[],
  errorLog: string[],
): Promise<ImportStats> {
  const stats: ImportStats = { success: 0, fail: 0 };

  const toDelete: string[] = [];
  const toUpsert: {
    ext_id: string;
    date: string;
    lesson: number;
    subject: number;
    teacher: number;
    group_id: number;
    cabinet: string | null;
    homework: string | null;
    raw: RawEvent;
  }[] = [];

  for (const ev of batch) {
    if (ev.delete === "1") {
      toDelete.push(ev.id);
      continue;
    }

    const subjectId = caches.subjectsByExtId.get(ev.subject);
    const teacherId = caches.teachersByExtId.get(ev.teacher);
    const schoolyearId = findSchoolyearIdForDate(caches, ev.date);
    const groupId = schoolyearId != null ? caches.groupsByExtId.get(ev.group)?.get(schoolyearId) : undefined;

    const missing: string[] = [];
    if (!ev.lesson) missing.push("lesson");
    if (!ev.date) missing.push("date");
    if (!subjectId) missing.push("subject");
    if (!teacherId) missing.push("teacher");
    if (!groupId) missing.push("group_id");

    if (missing.length > 0) {
      errorLog.push(
        `Событие ${ev.id}: не удалось определить обязательные поля (${missing.join(", ")}). Дата: ${ev.date}`,
      );
      stats.fail++;
      continue;
    }

    toUpsert.push({
      ext_id: ev.id,
      date: ev.date,
      lesson: Number(ev.lesson),
      subject: subjectId!,
      teacher: teacherId!,
      group_id: groupId!,
      cabinet: ev.cabinet || null,
      homework: ev.homework || null,
      raw: ev,
    });
  }

  // Удаление событий, помеченных delete=1.
  // Дочерние comments/marks/missings удалятся автоматически через ON DELETE CASCADE.
  if (toDelete.length > 0) {
    const deleted = await db
      .deleteFrom("ediary_events")
      .where("ext_id", "in", toDelete)
      .returning("ext_id")
      .execute();
    stats.success += deleted.length;
    stats.fail += toDelete.length - deleted.length;
  }

  if (toUpsert.length === 0) return stats;

  const upserted = await upsertChanged(db, "ediary_events", ["ext_id"],
    toUpsert.map(({ raw, ...row }) => row));

  const idByExtId = new Map(upserted.map((r) => [r.ext_id, r.id]));
  const eventIds = upserted.map((r) => r.id);

  const commentRows: { event: number; pupil: number; text: string }[] = [];
  const markRows: { event: number; pupil: number; value: string; comment: string | null }[] = [];
  const missingRows: { event: number; pupil: number }[] = [];

  for (const { ext_id, raw } of toUpsert) {
    const eventId = idByExtId.get(ext_id);
    if (!eventId) continue;

    const commentsNode = typeof raw.comments === "object" ? raw.comments : undefined;
    for (const c of asArray(commentsNode?.comment)) {
      const pupilId = caches.pupilsByExtId.get(c.pupil);
      if (!pupilId) {
        errorLog.push(`Комментарий к событию ${ext_id}: неизвестный ученик ${c.pupil}`);
        stats.fail++;
        continue;
      }
      commentRows.push({ event: eventId, pupil: pupilId, text: c.text ?? "" });
    }

    const marksNode = typeof raw.marks === "object" ? raw.marks : undefined;
    for (const m of asArray(marksNode?.mark)) {
      const pupilId = caches.pupilsByExtId.get(m.pupil);
      if (!pupilId) {
        errorLog.push(`Оценка к событию ${ext_id}: неизвестный ученик ${m.pupil}`);
        stats.fail++;
        continue;
      }
      markRows.push({ event: eventId, pupil: pupilId, value: m.value, comment: m.comment ?? null });
    }

    const missingNode = typeof raw.missing === "object" ? raw.missing : undefined;
    for (const pupilExtId of asArray(missingNode?.pupil)) {
      const pupilId = caches.pupilsByExtId.get(pupilExtId);
      if (!pupilId) {
        errorLog.push(`Пропуск к событию ${ext_id}: неизвестный ученик ${pupilExtId}`);
        stats.fail++;
        continue;
      }
      missingRows.push({ event: eventId, pupil: pupilId });
    }

    stats.success++;
  }

  await syncChildren(db, "ediary_comments", "event", eventIds, commentRows);

  // Полностью одинаковые оценки (тот же event+pupil+value+comment) в выгрузке 1С -
  // дубль, а не две разные оценки за урок. Разные value или разные comment - сохраняем
  // оба (у ediary_marks намеренно нет UNIQUE(event, pupil) - оценок может быть несколько).
  {
    const seenMarks = new Set<string>();
    const uniqueMarks = markRows.filter((r) => {
      const key = `${r.event}:${r.pupil}:${r.value}:${r.comment ?? ""}`;
      if (seenMarks.has(key)) return false;
      seenMarks.add(key);
      return true;
    });
    await syncChildren(db, "ediary_marks", "event", eventIds, uniqueMarks);
  }

  // В выгрузке 1С один и тот же ученик может встретиться в <missing> одного события
  // несколько раз - на ediary_missings есть UNIQUE(event, pupil), поэтому дедуплицируем.
  {
    const seen = new Set<string>();
    const uniqueMissings = missingRows.filter((r) => {
      const key = `${r.event}:${r.pupil}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    await syncChildren(db, "ediary_missings", "event", eventIds, uniqueMissings);
  }

  return stats;
}
