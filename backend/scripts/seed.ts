/**
 * Наполняет БД синтетическим, но связным набором данных для демо всего стека
 * без выгрузки из 1С / FTP.
 *
 *   npm run seed
 *
 * Полностью очищает таблицы (TRUNCATE ... RESTART IDENTITY CASCADE) и создаёт:
 *   - учебный год 2025-2026 + 4 четверти;
 *   - предметы, учителей;
 *   - 8 учеников с учётками (логин/пароль), родителя и учителя;
 *   - один класс 9-А с составом и периодами;
 *   - смену + звонки (расписание);
 *   - ~8 недель занятий (пн-пт) с оценками, ДЗ, пропусками и комментариями;
 *   - итоговые (годовые) оценки по предметам.
 *
 * Демо-входы (после сида печатаются в консоль):
 *   student / student   - ученик 9-А (роль student)
 *   parent  / parent    - родитель того же ученика (роль student)
 *   teacher / teacher    - учитель (роль teacher)
 */
import "dotenv/config";
import { sql } from "kysely";
import { db } from "../src/db/index.js";
import { hashPassword } from "../src/auth/password.js";

// --- детерминированный ГПСЧ, чтобы сид был воспроизводимым --------------------
function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20250901);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)]!;
const chance = (p: number): boolean => rnd() < p;

// --- даты -------------------------------------------------------------------
const YEAR_START = "2025-09-01"; // понедельник
const YEAR_END = "2026-05-31";
const WEEKS = 8;

function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function weekdayOf(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay(); // 0=вс..6=сб
}

// --- справочные данные ----------------------------------------------------
const SUBJECTS = [
  "Алгебра",
  "Геометрия",
  "Русский язык",
  "Литература",
  "Физика",
  "Информатика",
  "История",
  "Английский язык",
] as const;

const TEACHERS = [
  "Иванова А.П.",
  "Петров С.М.",
  "Сидорова Е.В.",
  "Кузнецов Д.А.",
  "Смирнова О.И.",
  "Волков Н.Н.",
  "Морозова Т.С.",
  "Фёдоров И.К.",
] as const;

// предмет -> учитель (по индексу)
const SUBJECT_TEACHER: Record<string, string> = Object.fromEntries(
  SUBJECTS.map((s, i) => [s, TEACHERS[i % TEACHERS.length]!]),
);

// фиксированное расписание: день недели (1..5) -> список предметов по урокам
const TIMETABLE: Record<number, string[]> = {
  1: ["Алгебра", "Русский язык", "Физика", "История", "Английский язык"],
  2: ["Геометрия", "Литература", "Информатика", "Физика", "Алгебра"],
  3: ["Русский язык", "Алгебра", "История", "Английский язык", "Литература"],
  4: ["Физика", "Информатика", "Геометрия", "Алгебра", "Русский язык"],
  5: ["История", "Английский язык", "Литература", "Информатика", "Геометрия"],
};

const LESSON_BEGIN = ["08:30", "09:25", "10:30", "11:25", "12:30", "13:35", "14:30"];
const LESSON_END = ["09:15", "10:10", "11:15", "12:10", "13:15", "14:20", "15:15"];

const HOMEWORK = [
  "стр. 45, упр. 12-15",
  "конспект §7",
  "подготовиться к контрольной",
  "задачи 3-8",
  "читать главу 4, ответить на вопросы",
  "эссе 150 слов",
  "повторить формулы",
  "выучить правило",
  "—",
];
const MARK_COMMENTS = [
  "Ответ у доски",
  "Практическая работа",
  "Контрольная работа",
  "Домашнее задание",
  "Проверочная работа",
  "Активная работа на уроке",
];
const TEACHER_NOTES = [
  "Отлично подготовлен",
  "Нужно доработать тему",
  "Молодец, так держать",
  "Пропущена прошлая тема",
];

const PUPIL_COUNT = 8;

async function main() {
  console.log("Очистка таблиц…");
  await sql`
    TRUNCATE
      app_users, ediary_parent,
      ediary_schoolyears, ediary_term_types, ediary_terms,
      ediary_teachers, ediary_subjects,
      ediary_pupils, ediary_pupils_accounts,
      ediary_shifts, ediary_lessons,
      ediary_groups, ediary_groups_terms, ediary_groups_pupils,
      ediary_events, ediary_comments, ediary_marks, ediary_missings,
      ediary_final_events, ediary_final_marks,
      ediary_import_results, ediary_import_checkpoint
    RESTART IDENTITY CASCADE
  `.execute(db);

  // --- учебный год + четверти ---------------------------------------------
  const { id: schoolyearId } = await db
    .insertInto("ediary_schoolyears")
    .values({ ext_id: "sy-2025-2026", name: "2025-2026", start: YEAR_START, end: YEAR_END })
    .returning("id")
    .executeTakeFirstOrThrow();

  const { id: termTypeId } = await db
    .insertInto("ediary_term_types")
    .values({ ext_id: "tt-quarters", name: "Четверти" })
    .returning("id")
    .executeTakeFirstOrThrow();

  const termRanges = [
    { name: "I четверть", date_start: "2025-09-01", date_end: "2025-10-26" },
    { name: "II четверть", date_start: "2025-11-05", date_end: "2025-12-28" },
    { name: "III четверть", date_start: "2026-01-12", date_end: "2026-03-22" },
    { name: "IV четверть", date_start: "2026-04-01", date_end: "2026-05-31" },
  ];
  const terms = await db
    .insertInto("ediary_terms")
    .values(
      termRanges.map((t, i) => ({
        ext_id: `term-${i + 1}`,
        name: t.name,
        type_id: termTypeId,
      })),
    )
    .returning(["id", "ext_id"])
    .execute();

  // --- предметы и учителя -------------------------------------------------
  const subjectRows = await db
    .insertInto("ediary_subjects")
    .values(SUBJECTS.map((name, i) => ({ ext_id: `subj-${i + 1}`, name })))
    .returning(["id", "name"])
    .execute();
  const subjectId = new Map(subjectRows.map((s) => [s.name, s.id]));

  const teacherRows = await db
    .insertInto("ediary_teachers")
    .values(TEACHERS.map((name, i) => ({ ext_id: `teacher-${i + 1}`, name })))
    .returning(["id", "name"])
    .execute();
  const teacherId = new Map(teacherRows.map((t) => [t.name, t.id]));

  // --- ученики + учётки --------------------------------------------------
  const pupilRows = await db
    .insertInto("ediary_pupils")
    .values(Array.from({ length: PUPIL_COUNT }, (_, i) => ({ ext_id: `pupil-${i + 1}` })))
    .returning(["id", "ext_id"])
    .execute();

  // логины: первый ученик - демо "student", остальные student2..student8
  const pupilUsers = await db
    .insertInto("app_users")
    .values(
      pupilRows.map((p, i) => ({
        username: i === 0 ? "student" : `student${i + 1}`,
        password_hash: hashPassword(i === 0 ? "student" : `student${i + 1}`),
        status: 1,
      })),
    )
    .returning(["id", "username"])
    .execute();

  await db
    .insertInto("ediary_pupils_accounts")
    .values(pupilRows.map((p, i) => ({ pupil: p.id, type: "pupil", uid: pupilUsers[i]!.id })))
    .execute();

  // родитель демо-ученика
  const { id: parentUid } = await db
    .insertInto("app_users")
    .values({ username: "parent", password_hash: hashPassword("parent"), status: 1 })
    .returning("id")
    .executeTakeFirstOrThrow();
  await db
    .insertInto("ediary_pupils_accounts")
    .values({ pupil: pupilRows[0]!.id, type: "parent", uid: parentUid })
    .execute();
  await db
    .insertInto("ediary_parent")
    .values({ pid: parentUid, cid: pupilUsers[0]!.id })
    .execute();

  // учитель (без привязки к ученику -> роль teacher)
  await db
    .insertInto("app_users")
    .values({ username: "teacher", password_hash: hashPassword("teacher"), status: 1 })
    .execute();

  // --- класс 9-А -------------------------------------------------------
  const { id: groupId } = await db
    .insertInto("ediary_groups")
    .values({
      ext_id: "grp-9a",
      schoolyear: schoolyearId,
      parallel: 9,
      shift: 1,
      termtype: termTypeId,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  await db
    .insertInto("ediary_groups_terms")
    .values(
      terms.map((t, i) => ({
        group_id: groupId,
        term: t.id,
        date_start: termRanges[i]!.date_start,
        date_end: termRanges[i]!.date_end,
      })),
    )
    .execute();

  await db
    .insertInto("ediary_groups_pupils")
    .values(
      pupilRows.map((p) => ({
        group_id: groupId,
        pupil: p.id,
        date_start: YEAR_START,
        date_end: YEAR_END,
      })),
    )
    .execute();

  // --- смена + звонки -------------------------------------------------
  const { id: shiftId } = await db
    .insertInto("ediary_shifts")
    .values({ name: 1, schoolyear: schoolyearId, parallelstart: 1, parallelend: 11 })
    .returning("id")
    .executeTakeFirstOrThrow();

  const lessonRows: {
    shift: number;
    lessonnumber: number;
    weekday: number;
    timebegin: string;
    timeend: string;
  }[] = [];
  for (let weekday = 1; weekday <= 5; weekday++) {
    for (let n = 0; n < LESSON_BEGIN.length; n++) {
      lessonRows.push({
        shift: shiftId,
        lessonnumber: n + 1,
        weekday,
        timebegin: LESSON_BEGIN[n]!,
        timeend: LESSON_END[n]!,
      });
    }
  }
  await db.insertInto("ediary_lessons").values(lessonRows).execute();

  // --- занятия + оценки/ДЗ/пропуски --------------------------------
  interface EventSeed {
    ext_id: string;
    date: string;
    lesson: number;
    subject: number;
    teacher: number;
    group_id: number;
    cabinet: string | null;
    homework: string | null;
  }
  const eventSeeds: EventSeed[] = [];
  let evNo = 0;

  for (let w = 0; w < WEEKS; w++) {
    for (let d = 0; d < 5; d++) {
      const date = addDays(YEAR_START, w * 7 + d);
      const weekday = weekdayOf(date); // 1..5
      const daySubjects = TIMETABLE[weekday] ?? [];
      const lessonsToday = 3 + Math.floor(rnd() * 3); // 3..5
      for (let l = 0; l < Math.min(lessonsToday, daySubjects.length); l++) {
        const subjName = daySubjects[l]!;
        eventSeeds.push({
          ext_id: `ev-${++evNo}`,
          date,
          lesson: l + 1,
          subject: subjectId.get(subjName)!,
          teacher: teacherId.get(SUBJECT_TEACHER[subjName]!)!,
          group_id: groupId,
          cabinet: `${200 + (l % 12)}`,
          homework: pick(HOMEWORK),
        });
      }
    }
  }

  const insertedEvents = await db
    .insertInto("ediary_events")
    .values(eventSeeds)
    .returning(["id", "ext_id"])
    .execute();
  const eventIdByExt = new Map(insertedEvents.map((e) => [e.ext_id, e.id]));

  const markRows: { event: number; pupil: number; value: string; comment: string | null }[] = [];
  const missingRows: { event: number; pupil: number }[] = [];
  const commentRows: { event: number; pupil: number; text: string }[] = [];

  for (const ev of eventSeeds) {
    const eventId = eventIdByExt.get(ev.ext_id)!;
    for (const p of pupilRows) {
      // демо-ученик получает оценки чаще, чтобы дневник был наполнен
      const isDemo = p.ext_id === "pupil-1";
      if (chance(isDemo ? 0.55 : 0.3)) {
        markRows.push({
          event: eventId,
          pupil: p.id,
          value: String(pick([3, 3, 4, 4, 4, 5, 5])),
          comment: pick(MARK_COMMENTS),
        });
      }
      if (chance(isDemo ? 0.06 : 0.04)) {
        missingRows.push({ event: eventId, pupil: p.id });
      }
      if (isDemo && chance(0.05)) {
        commentRows.push({ event: eventId, pupil: p.id, text: pick(TEACHER_NOTES) });
      }
    }
  }

  if (markRows.length) await db.insertInto("ediary_marks").values(markRows).execute();
  if (missingRows.length) await db.insertInto("ediary_missings").values(missingRows).execute();
  if (commentRows.length) await db.insertInto("ediary_comments").values(commentRows).execute();

  // --- итоговые (годовые) оценки -----------------------------------
  let finalNo = 0;
  for (const subjName of SUBJECTS.slice(0, 6)) {
    const { id: feId } = await db
      .insertInto("ediary_final_events")
      .values({
        ext_id: `fin-${++finalNo}`,
        type: "year",
        term_ext_id: null,
        subject: subjectId.get(subjName)!,
        schoolyear: schoolyearId,
        group_id: groupId,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    await db
      .insertInto("ediary_final_marks")
      .values(
        pupilRows.map((p) => ({
          event: feId,
          pupil: p.id,
          value: String(pick([3, 4, 4, 4, 5, 5])),
        })),
      )
      .execute();
  }

  await db.destroy();

  console.log("\nСид готов. Демо-входы:");
  console.log("  student / student   - ученик 9-А (роль student)");
  console.log("  parent  / parent    - родитель того же ученика (роль student)");
  console.log("  teacher / teacher    - учитель (роль teacher)");
  console.log(`\nЗанятий: ${eventSeeds.length}, оценок: ${markRows.length}, пропусков: ${missingRows.length}`);
}

main().catch(async (err) => {
  console.error("Ошибка сида:", err);
  await db.destroy().catch(() => {});
  process.exit(1);
});
