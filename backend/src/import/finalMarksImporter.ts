import path from "node:path";
import { db } from "../db/index.js";
import { parseXmlFile, readMessageNo, asArray, str } from "../xml/parseXmlFile.js";
import type { FileImportResult } from "./eventsFileImporter.js";

/**
 * Импорт final_marks.xml - итоговые оценки (год/итог/период/экзамен).
 *
 * Структура (см. пример в xml-cache/final_marks.xml и legacy old/e_diary_import.module):
 *   <file><MessageNo/>
 *     <final_marks>
 *       <final_event>
 *         <id>ext_id</id>
 *         <schoolyear>ext_id</schoolyear>
 *         <subject>ext_id</subject>
 *         <type>year|final|term|exam</type>
 *         <term/>                 (ext_id термина либо пусто)
 *         <group>ext_id</group>
 *         <pupil><id>ext_id</id><value>4</value></pupil>
 *         ...
 *       </final_event>
 *     </final_marks>
 *   </file>
 *
 * Файл небольшой - разбираем целиком и импортируем за один проход (done: true).
 */
export async function importFinalMarksFile(
  xmlFolder: string,
  filename: string,
  messageno: string,
): Promise<FileImportResult | false> {
  const doc = await parseXmlFile(path.join(xmlFolder, filename));
  if (!doc) return false;
  if (readMessageNo(doc) !== messageno) return false;

  const root = (doc.file ?? doc) as Record<string, unknown>;
  const finalMarks = root.final_marks as Record<string, unknown> | undefined;
  const events = asArray(finalMarks?.final_event) as Record<string, unknown>[];

  const errorLog: string[] = [];
  let success = 0;
  let fail = 0;

  if (events.length === 0) return { success, fail, errorLog, done: true };

  const [subjects, schoolyears, groups, pupils] = await Promise.all([
    db.selectFrom("ediary_subjects").select(["id", "ext_id"]).execute(),
    db.selectFrom("ediary_schoolyears").select(["id", "ext_id"]).execute(),
    db.selectFrom("ediary_groups").select(["id", "ext_id", "schoolyear"]).execute(),
    db.selectFrom("ediary_pupils").select(["id", "ext_id"]).execute(),
  ]);

  const subjectByExtId = new Map(subjects.map((s) => [s.ext_id, s.id]));
  const schoolyearByExtId = new Map(schoolyears.map((s) => [s.ext_id, s.id]));
  const pupilByExtId = new Map(pupils.map((p) => [p.ext_id, p.id]));
  // ext_id группы -> (id учебного года -> внутренний id группы): группа переиздаётся каждый год
  const groupByExtId = new Map<string, Map<number, number>>();
  for (const g of groups) {
    if (!groupByExtId.has(g.ext_id)) groupByExtId.set(g.ext_id, new Map());
    groupByExtId.get(g.ext_id)!.set(g.schoolyear, g.id);
  }

  for (const ev of events) {
    const extId = str(ev.id);
    const type = str(ev.type);
    const termExtId = str(ev.term) || null;
    const subjectId = subjectByExtId.get(str(ev.subject));
    const schoolyearId = schoolyearByExtId.get(str(ev.schoolyear));
    const groupId =
      schoolyearId != null ? groupByExtId.get(str(ev.group))?.get(schoolyearId) : undefined;

    const missing: string[] = [];
    if (!extId) missing.push("ext_id");
    if (!type) missing.push("type");
    if (!subjectId) missing.push("subject");
    if (!schoolyearId) missing.push("schoolyear");
    if (!groupId) missing.push("group_id");
    if (missing.length > 0) {
      errorLog.push(
        `Итоговое событие ${extId || "(без id)"}: не удалось определить поля (${missing.join(", ")})`,
      );
      fail++;
      continue;
    }

    const { id: eventId } = await db
      .insertInto("ediary_final_events")
      .values({
        ext_id: extId,
        type,
        term_ext_id: termExtId,
        subject: subjectId!,
        schoolyear: schoolyearId!,
        group_id: groupId!,
      })
      .onConflict((oc) =>
        oc.column("ext_id").doUpdateSet({
          type,
          term_ext_id: termExtId,
          subject: subjectId!,
          schoolyear: schoolyearId!,
          group_id: groupId!,
        }),
      )
      .returning("id")
      .executeTakeFirstOrThrow();

    // 1С шлёт событие с полным набором оценок - заменяем целиком (аналог clear_sub)
    await db.deleteFrom("ediary_final_marks").where("event", "=", eventId).execute();

    const markRows: { event: number; pupil: number; value: string }[] = [];
    for (const p of asArray(ev.pupil) as Record<string, unknown>[]) {
      const pupilId = pupilByExtId.get(str(p.id));
      const value = str(p.value);
      if (!pupilId) {
        errorLog.push(`Итоговая оценка ${extId}: неизвестный ученик ${str(p.id)}`);
        fail++;
        continue;
      }
      if (!value) {
        errorLog.push(`Итоговая оценка ${extId}: пустое значение у ученика ${str(p.id)}`);
        fail++;
        continue;
      }
      markRows.push({ event: eventId, pupil: pupilId, value });
    }
    if (markRows.length > 0) {
      await db.insertInto("ediary_final_marks").values(markRows).execute();
    }
    success++;
  }

  return { success, fail, errorLog, done: true };
}
