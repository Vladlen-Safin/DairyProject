import path from "node:path";
import { db } from "../db/index.js";
import { syncChildren, upsertOne } from "./syncRows.js";
import {
  parseXmlFile,
  readMessageNo,
  asArray,
  str,
  intOrNull,
  toDate,
  type XmlNode,
} from "../xml/parseXmlFile.js";
import type { FileImportResult } from "./eventsFileImporter.js";

/**
 * Импорт groups.xml - классы/группы и их состав.
 *
 * Структура (см. legacy old/e_diary_import.module, e_diary_import_load_groups):
 *   <file><MessageNo/>
 *     <groups>
 *       <group>
 *         <id>ext_id</id>
 *         <schoolyear>ext_id</schoolyear>
 *         <groupdata>
 *           <parallel>5</parallel>
 *           <shift>1</shift>
 *           <termscheme>
 *             <id>ext_id схемы аттестации</id>
 *             <term><id>ext_id периода</id><date_start/><date_end/></term>
 *             ...
 *           </termscheme>
 *         </groupdata>
 *         <pupils>
 *           <pupil><id>ext_id</id><date_start/><date_end/></pupil>
 *           ...
 *         </pupils>
 *       </group>
 *     </groups>
 *   </file>
 *
 * Требует, чтобы book.xml уже был импортирован (учебные года, схемы аттестации,
 * периоды, ученики). Файл разбирается целиком, один проход (done: true).
 */
export async function importGroupsFile(
  xmlFolder: string,
  filename: string,
  messageno: string,
): Promise<FileImportResult | false> {
  const doc = await parseXmlFile(path.join(xmlFolder, filename));
  if (!doc) return false;
  if (readMessageNo(doc) !== messageno) return false;

  const root = (doc.file ?? doc) as XmlNode;
  const groupsNode = root.groups as XmlNode | undefined;
  const groups = asArray(groupsNode?.group) as XmlNode[];

  const errorLog: string[] = [];
  let success = 0;
  let fail = 0;

  if (groups.length === 0) return { success, fail, errorLog, done: true };

  const [schoolyearRows, termTypeRows, termRows, pupilRows] = await Promise.all([
    db.selectFrom("ediary_schoolyears").select(["id", "ext_id"]).execute(),
    db.selectFrom("ediary_term_types").select(["id", "ext_id"]).execute(),
    db.selectFrom("ediary_terms").select(["id", "ext_id"]).execute(),
    db.selectFrom("ediary_pupils").select(["id", "ext_id"]).execute(),
  ]);
  const schoolyearByExtId = new Map(schoolyearRows.map((r) => [r.ext_id, r.id]));
  const termTypeByExtId = new Map(termTypeRows.map((r) => [r.ext_id, r.id]));
  // ediary_terms уникален по (ext_id, type_id); в legacy справочник строился по ext_id (последний выигрывает)
  const termByExtId = new Map(termRows.map((r) => [r.ext_id, r.id]));
  const pupilByExtId = new Map(pupilRows.map((r) => [r.ext_id, r.id]));

  for (const group of groups) {
    const extId = str(group.id);
    const schoolyearId = schoolyearByExtId.get(str(group.schoolyear));
    if (!extId || !schoolyearId) {
      errorLog.push(
        `Группа ${extId || "(без id)"}: не удалось определить обязательные поля (ext_id/schoolyear)`,
      );
      fail++;
      continue;
    }

    const groupdata = group.groupdata as XmlNode | undefined;
    const parallel = intOrNull(groupdata?.parallel);
    const shift = intOrNull(groupdata?.shift);
    const termscheme = groupdata?.termscheme as XmlNode | undefined;
    const termtype = termscheme ? (termTypeByExtId.get(str(termscheme.id)) ?? null) : null;

    const { id: groupId } = await upsertOne(db, "ediary_groups", ["ext_id", "schoolyear"],
      { ext_id: extId, schoolyear: schoolyearId, parallel, shift, termtype });
    success++;

    // периоды обучения группы
    const termRowsToInsert: {
      group_id: number;
      term: number;
      date_start: string;
      date_end: string;
    }[] = [];
    for (const term of asArray(termscheme?.term) as XmlNode[]) {
      const termId = termByExtId.get(str(term.id));
      const dateStart = toDate(term.date_start);
      const dateEnd = toDate(term.date_end);
      if (!termId || !dateStart || !dateEnd) {
        errorLog.push(`Период группы ${extId}: неизвестный период ${str(term.id)} или пустые даты`);
        fail++;
        continue;
      }
      termRowsToInsert.push({ group_id: groupId, term: termId, date_start: dateStart, date_end: dateEnd });
    }
    await syncChildren(db, "ediary_groups_terms", "group_id", [groupId], termRowsToInsert);
    success += termRowsToInsert.length;

    // ученики группы; пустой date_end -> конец учебного года
    const schoolyearEnd = await db
      .selectFrom("ediary_schoolyears")
      .select("end")
      .where("id", "=", schoolyearId)
      .executeTakeFirst();

    const pupilRowsToInsert: {
      group_id: number;
      pupil: number;
      date_start: string;
      date_end: string;
    }[] = [];
    const pupilsNode = group.pupils as XmlNode | undefined;
    for (const p of asArray(pupilsNode?.pupil) as XmlNode[]) {
      const pupilId = pupilByExtId.get(str(p.id));
      const dateStart = toDate(p.date_start);
      const dateEnd = toDate(p.date_end) ?? schoolyearEnd?.end ?? null;
      if (!pupilId || !dateStart || !dateEnd) {
        errorLog.push(`Ученик группы ${extId}: неизвестный ученик ${str(p.id)} или пустая date_start`);
        fail++;
        continue;
      }
      pupilRowsToInsert.push({ group_id: groupId, pupil: pupilId, date_start: dateStart, date_end: dateEnd });
    }
    await syncChildren(db, "ediary_groups_pupils", "group_id", [groupId], pupilRowsToInsert);
    success += pupilRowsToInsert.length;
  }

  return { success, fail, errorLog, done: true };
}
