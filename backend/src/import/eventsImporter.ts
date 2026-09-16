import type { Kysely } from "kysely";
import type { DB } from "../db/types.js";
import type { RawEvent } from "../xml/eventsTypes.js";
import { asArray } from "../xml/eventsTypes.js";
import { findSchoolyearIdForDate, type HelperCaches } from "./helperTables.js";

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
  // Keep event row locks until all child rows have been replaced.
  return db.transaction().execute((trx) => importEventsBatchInTransaction(trx, caches, batch, errorLog));
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

  const upserted = await db
    .insertInto("ediary_events")
    .values(toUpsert.map(({ raw, ...row }) => row))
    .onConflict((oc) =>
      oc.column("ext_id").doUpdateSet((eb) => ({
        date: eb.ref("excluded.date"),
        lesson: eb.ref("excluded.lesson"),
        subject: eb.ref("excluded.subject"),
        teacher: eb.ref("excluded.teacher"),
        group_id: eb.ref("excluded.group_id"),
        cabinet: eb.ref("excluded.cabinet"),
        homework: eb.ref("excluded.homework"),
      })),
    )
    .returning(["id", "ext_id"])
    .execute();

  const idByExtId = new Map(upserted.map((r) => [r.ext_id, r.id]));
  const eventIds = upserted.map((r) => r.id);

  // Полная замена дочерних данных - 1С каждый раз шлёт событие с полным набором
  // оценок/комментариев/пропусков, а не diff (аналог clear_sub в PHP-версии).
  if (eventIds.length > 0) {
    await db.deleteFrom("ediary_comments").where("event", "in", eventIds).execute();
    await db.deleteFrom("ediary_marks").where("event", "in", eventIds).execute();
    await db.deleteFrom("ediary_missings").where("event", "in", eventIds).execute();
  }

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

  if (commentRows.length) await db.insertInto("ediary_comments").values(commentRows).execute();

  // Полностью одинаковые оценки (тот же event+pupil+value+comment) в выгрузке 1С -
  // дубль, а не две разные оценки за урок. Разные value или разные comment - сохраняем
  // оба (у ediary_marks намеренно нет UNIQUE(event, pupil) - оценок может быть несколько).
  if (markRows.length) {
    const seenMarks = new Set<string>();
    const uniqueMarks = markRows.filter((r) => {
      const key = `${r.event}:${r.pupil}:${r.value}:${r.comment ?? ""}`;
      if (seenMarks.has(key)) return false;
      seenMarks.add(key);
      return true;
    });
    await db.insertInto("ediary_marks").values(uniqueMarks).execute();
  }

  // В выгрузке 1С один и тот же ученик может встретиться в <missing> одного события
  // несколько раз - на ediary_missings есть UNIQUE(event, pupil), поэтому дедуплицируем.
  if (missingRows.length) {
    const seen = new Set<string>();
    const uniqueMissings = missingRows.filter((r) => {
      const key = `${r.event}:${r.pupil}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    await db
      .insertInto("ediary_missings")
      .values(uniqueMissings)
      .onConflict((oc) => oc.columns(["event", "pupil"]).doNothing())
      .execute();
  }

  return stats;
}
