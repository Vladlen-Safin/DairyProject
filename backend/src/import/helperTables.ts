import type { Kysely } from "kysely";
import type { DB } from "../db/types.js";

export interface HelperCaches {
  subjectsByExtId: Map<string, number>;
  teachersByExtId: Map<string, number>;
  pupilsByExtId: Map<string, number>;
  /** ext_id группы -> (id учебного года -> внутренний id группы) - группа переиздаётся каждый год */
  groupsByExtId: Map<string, Map<number, number>>;
  schoolyears: { id: number; start: string; end: string }[];
}

export async function loadHelperCaches(db: Kysely<DB>): Promise<HelperCaches> {
  const [subjects, teachers, pupils, groups, schoolyears] = await Promise.all([
    db.selectFrom("ediary_subjects").select(["id", "ext_id"]).execute(),
    db.selectFrom("ediary_teachers").select(["id", "ext_id"]).execute(),
    db.selectFrom("ediary_pupils").select(["id", "ext_id"]).execute(),
    db.selectFrom("ediary_groups").select(["id", "ext_id", "schoolyear"]).execute(),
    db.selectFrom("ediary_schoolyears").select(["id", "start", "end"]).execute(),
  ]);

  const groupsByExtId = new Map<string, Map<number, number>>();
  for (const g of groups) {
    if (!groupsByExtId.has(g.ext_id)) groupsByExtId.set(g.ext_id, new Map());
    groupsByExtId.get(g.ext_id)!.set(g.schoolyear, g.id);
  }

  return {
    subjectsByExtId: new Map(subjects.map((s) => [s.ext_id, s.id])),
    teachersByExtId: new Map(teachers.map((t) => [t.ext_id, t.id])),
    pupilsByExtId: new Map(pupils.map((p) => [p.ext_id, p.id])),
    groupsByExtId,
    schoolyears: schoolyears.map((s) => ({ id: s.id, start: s.start, end: s.end })),
  };
}

/** Определяет учебный год по дате события - сравнение ISO-строк YYYY-MM-DD работает корректно лексикографически */
export function findSchoolyearIdForDate(caches: HelperCaches, dateStr: string): number | undefined {
  return caches.schoolyears.find((sy) => sy.start <= dateStr && dateStr <= sy.end)?.id;
}