import path from "node:path";
import { db } from "../db/index.js";
import {
  parseXmlFile,
  readMessageNo,
  asArray,
  childElements,
  str,
  intOrNull,
  toDate,
  type XmlNode,
} from "../xml/parseXmlFile.js";
import type { FileImportResult } from "./eventsFileImporter.js";

/**
 * Импорт book.xml - справочники выгрузки 1С:
 * учебные года, схемы аттестации + периоды обучения, учителя, предметы,
 * ученики (+ учётные записи и связь родитель-ребёнок), смены и звонки.
 *
 * Структура восстановлена по legacy-модулю old/e_diary_import.module
 * (функция e_diary_import_load_book). Живого примера заполненного book.xml нет -
 * секции terms/calls помечены TODO: проверить на боевой выгрузке.
 *
 * Файл разбирается целиком и импортируется за один проход (done: true).
 */
export async function importBookFile(
  xmlFolder: string,
  filename: string,
  messageno: string,
): Promise<FileImportResult | false> {
  const doc = await parseXmlFile(path.join(xmlFolder, filename));
  if (!doc) return false;
  if (readMessageNo(doc) !== messageno) return false;

  const book = (doc.book ?? doc.file ?? doc) as XmlNode;
  const ctx: Ctx = { errorLog: [], success: 0, fail: 0 };

  await importSchoolyears(book, ctx);
  await importTermTypes(book, ctx);
  await importSimpleRef(book, ctx, "teachers", "teacher", "ediary_teachers");
  await importSimpleRef(book, ctx, "subjects", "subject", "ediary_subjects");
  await importPupils(book, ctx);
  await importCalls(book, ctx);

  return { success: ctx.success, fail: ctx.fail, errorLog: ctx.errorLog, done: true };
}

interface Ctx {
  errorLog: string[];
  success: number;
  fail: number;
}

// --- учебные года -----------------------------------------------------------

async function importSchoolyears(book: XmlNode, ctx: Ctx): Promise<void> {
  const container = book.schoolyears as XmlNode | undefined;
  for (const sy of asArray(container?.schoolyear) as XmlNode[]) {
    const extId = str(sy.id);
    const name = str(sy.name);
    const start = toDate(sy.start);
    const end = toDate(sy.end);
    if (!extId || !name || !start || !end) {
      ctx.errorLog.push(`Учебный год ${extId || "(без id)"}: пустые обязательные поля (name/start/end)`);
      ctx.fail++;
      continue;
    }
    await db
      .insertInto("ediary_schoolyears")
      .values({ ext_id: extId, name, start, end })
      .onConflict((oc) => oc.column("ext_id").doUpdateSet({ name, start, end }))
      .execute();
    ctx.success++;
  }
}

// --- схемы аттестации + периоды обучения -----------------------------------
// TODO: имя тега-обёртки схемы аттестации внутри <terms> в legacy бралось через
// key() (без привязки к имени) - здесь обходим любые дочерние элементы <terms>.

async function importTermTypes(book: XmlNode, ctx: Ctx): Promise<void> {
  const container = book.terms as XmlNode | undefined;
  if (!container) return;

  for (const tt of childElements(container)) {
    const extId = str(tt.id);
    const name = str(tt.name);
    if (!extId || !name) {
      ctx.errorLog.push(`Схема аттестации ${extId || "(без id)"}: пустое имя`);
      ctx.fail++;
      continue;
    }
    const { id: typeId } = await db
      .insertInto("ediary_term_types")
      .values({ ext_id: extId, name })
      .onConflict((oc) => oc.column("ext_id").doUpdateSet({ name }))
      .returning("id")
      .executeTakeFirstOrThrow();
    ctx.success++;

    // Периоды обучения полностью перезаписываются для своей схемы (clear_sub)
    await db.deleteFrom("ediary_terms").where("type_id", "=", typeId).execute();

    for (const term of asArray(tt.term) as XmlNode[]) {
      const termExtId = str(term.id);
      const termName = str(term.name);
      if (!termExtId || !termName) {
        ctx.errorLog.push(`Период обучения в схеме ${extId}: пустые поля (id/name)`);
        ctx.fail++;
        continue;
      }
      await db
        .insertInto("ediary_terms")
        .values({ ext_id: termExtId, name: termName, type_id: typeId })
        .onConflict((oc) => oc.columns(["ext_id", "type_id"]).doUpdateSet({ name: termName }))
        .execute();
      ctx.success++;
    }
  }
}

// --- плоские справочники (teachers, subjects) ------------------------------

async function importSimpleRef(
  book: XmlNode,
  ctx: Ctx,
  containerTag: "teachers" | "subjects",
  itemTag: "teacher" | "subject",
  table: "ediary_teachers" | "ediary_subjects",
): Promise<void> {
  const container = book[containerTag] as XmlNode | undefined;
  for (const item of asArray(container?.[itemTag]) as XmlNode[]) {
    const extId = str(item.id);
    const name = str(item.name);
    if (!extId || !name) {
      ctx.errorLog.push(`${table} ${extId || "(без id)"}: пустое имя`);
      ctx.fail++;
      continue;
    }
    await db
      .insertInto(table)
      .values({ ext_id: extId, name })
      .onConflict((oc) => oc.column("ext_id").doUpdateSet({ name }))
      .execute();
    ctx.success++;
  }
}

// --- ученики + учётные записи + связь родитель-ребёнок --------------------

async function importPupils(book: XmlNode, ctx: Ctx): Promise<void> {
  const container = book.pupils as XmlNode | undefined;
  for (const pupil of asArray(container?.pupil) as XmlNode[]) {
    const extId = str(pupil.id);
    if (!extId) {
      ctx.errorLog.push("Ученик без ext_id - пропущен");
      ctx.fail++;
      continue;
    }
    const { id: pupilId } = await db
      .insertInto("ediary_pupils")
      .values({ ext_id: extId })
      .onConflict((oc) => oc.column("ext_id").doUpdateSet({ ext_id: extId }))
      .returning("id")
      .executeTakeFirstOrThrow();
    ctx.success++;

    const usersNode = pupil.users as XmlNode | undefined;
    const uidByType = new Map<string, number>();

    for (const user of asArray(usersNode?.user) as XmlNode[]) {
      const username = str(user.username);
      const type = str(user.type); // 'pupil' | 'parent'
      const password = str(user.password);
      if (!username || !type) {
        ctx.errorLog.push(`Учётная запись ученика ${extId}: нет username/type`);
        ctx.fail++;
        continue;
      }
      // TODO: полноценный слой авторизации (хэш пароля) проектируется отдельно.
      // Пока кладём пароль как есть с префиксом, чтобы каркас работал end-to-end.
      const passwordHash = password ? `plain:${password}` : "plain:";
      const { id: uid } = await db
        .insertInto("app_users")
        .values({ username, password_hash: passwordHash, status: 1 })
        .onConflict((oc) => oc.column("username").doUpdateSet({ password_hash: passwordHash }))
        .returning("id")
        .executeTakeFirstOrThrow();

      await db
        .insertInto("ediary_pupils_accounts")
        .values({ pupil: pupilId, type, uid })
        .onConflict((oc) => oc.column("uid").doUpdateSet({ pupil: pupilId, type }))
        .execute();

      uidByType.set(type, uid);
      ctx.success++;
    }

    // связь родитель -> ребёнок
    const parentUid = uidByType.get("parent");
    const pupilUid = uidByType.get("pupil");
    if (parentUid != null && pupilUid != null) {
      await db
        .insertInto("ediary_parent")
        .values({ pid: parentUid, cid: pupilUid })
        .onConflict((oc) => oc.columns(["pid", "cid"]).doNothing())
        .execute();
    }
  }
}

// --- смены и звонки -------------------------------------------------------
// TODO: структура <calls> восстановлена по legacy-конфигу, без живого примера.
// Ожидается: <calls><schoolyear><id>ext_id</id>
//              <shift><name/><parallelstart/><parallelend/>
//                <lesson><lessonnumber/><weekday/>...<timebegin/><timeend/></lesson>
//              </shift>
//            </schoolyear></calls>

async function importCalls(book: XmlNode, ctx: Ctx): Promise<void> {
  const container = book.calls as XmlNode | undefined;
  if (!container) return;

  const schoolyears = await db.selectFrom("ediary_schoolyears").select(["id", "ext_id"]).execute();
  const schoolyearByExtId = new Map(schoolyears.map((s) => [s.ext_id, s.id]));

  for (const syNode of asArray(container.schoolyear) as XmlNode[]) {
    const syExtId = str(syNode.id);
    const schoolyearId = schoolyearByExtId.get(syExtId);
    if (!schoolyearId) {
      ctx.errorLog.push(`Звонки: неизвестный учебный год ${syExtId}`);
      ctx.fail++;
      continue;
    }

    // Смены учебного года перезаписываются целиком; звонки уйдут по ON DELETE CASCADE
    await db.deleteFrom("ediary_shifts").where("schoolyear", "=", schoolyearId).execute();

    for (const shiftNode of asArray(syNode.shift) as XmlNode[]) {
      const name = intOrNull(shiftNode.name);
      const parallelstart = intOrNull(shiftNode.parallelstart);
      const parallelend = intOrNull(shiftNode.parallelend);
      if (name == null || parallelstart == null || parallelend == null) {
        ctx.errorLog.push(`Смена в учебном году ${syExtId}: пустые поля (name/parallelstart/parallelend)`);
        ctx.fail++;
        continue;
      }
      const { id: shiftId } = await db
        .insertInto("ediary_shifts")
        .values({ name, schoolyear: schoolyearId, parallelstart, parallelend })
        .returning("id")
        .executeTakeFirstOrThrow();
      ctx.success++;

      for (const lessonNode of asArray(shiftNode.lesson) as XmlNode[]) {
        const lessonnumber = intOrNull(lessonNode.lessonnumber);
        const timebegin = str(lessonNode.timebegin);
        const timeend = str(lessonNode.timeend);
        const weekdays = (asArray(lessonNode.weekday) as unknown[])
          .map((w) => intOrNull(w))
          .filter((w): w is number => w != null);

        if (lessonnumber == null || !timebegin || !timeend || weekdays.length === 0) {
          ctx.errorLog.push(`Звонок в смене ${name} (год ${syExtId}): пустые поля`);
          ctx.fail++;
          continue;
        }
        // legacy: один <weekday> = одна строка ediary_lessons
        await db
          .insertInto("ediary_lessons")
          .values(
            weekdays.map((weekday) => ({
              shift: shiftId,
              lessonnumber,
              weekday,
              timebegin,
              timeend,
            })),
          )
          .execute();
        ctx.success += weekdays.length;
      }
    }
  }
}
