import { Router, type Request, type Response } from "express";
import { db } from "../db/index.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";

/**
 * Минимальный read-API для фронтенда (Angular в ../dairy).
 * Только чтение импортированных данных - без авторизации.
 * Полноценный слой auth (JWT + refresh cookie, как ждёт фронт на /api/auth/*)
 * проектируется отдельным шагом.
 */
export const readRouter = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function asId(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * GET /api/me - профиль текущего пользователя: роль, привязанный ученик,
 * текущая группа/класс, периоды обучения. Нужен фронтенду, чтобы понять,
 * чьи и какие данные запрашивать.
 */
readRouter.get("/me", requireAuth, async (req: AuthedRequest, res: Response) => {
  const { userId, login, role } = req.auth!;

  const account = await db
    .selectFrom("ediary_pupils_accounts as pa")
    .innerJoin("ediary_pupils as p", "p.id", "pa.pupil")
    .select(["p.id as pupil_id", "p.ext_id as pupil_ext_id", "pa.type"])
    .where("pa.uid", "=", userId)
    .executeTakeFirst();

  let group: {
    id: number;
    ext_id: string;
    parallel: number | null;
    schoolyear_id: number;
    schoolyear_name: string;
    schoolyear_start: string;
    schoolyear_end: string;
  } | null = null;
  let terms: { id: number; name: string; date_start: string; date_end: string }[] = [];

  if (account) {
    group =
      (await db
        .selectFrom("ediary_groups_pupils as gp")
        .innerJoin("ediary_groups as g", "g.id", "gp.group_id")
        .innerJoin("ediary_schoolyears as sy", "sy.id", "g.schoolyear")
        .select([
          "g.id",
          "g.ext_id",
          "g.parallel",
          "sy.id as schoolyear_id",
          "sy.name as schoolyear_name",
          "sy.start as schoolyear_start",
          "sy.end as schoolyear_end",
        ])
        .where("gp.pupil", "=", account.pupil_id)
        .orderBy("gp.date_start", "desc")
        .executeTakeFirst()) ?? null;

    if (group) {
      terms = await db
        .selectFrom("ediary_groups_terms as gt")
        .innerJoin("ediary_terms as t", "t.id", "gt.term")
        .select(["t.id", "t.name", "gt.date_start", "gt.date_end"])
        .where("gt.group_id", "=", group.id)
        .orderBy("gt.date_start")
        .execute();
    }
  }

  res.json({
    id: userId,
    login,
    role,
    pupil: account ? { id: account.pupil_id, ext_id: account.pupil_ext_id } : null,
    group,
    terms,
    studyPeriod: group?.schoolyear_name ?? null,
  });
});

/** GET /api/health - живость сервиса и БД + счётчики по таблицам. */
readRouter.get("/health", async (_req: Request, res: Response) => {
  try {
    const tables = [
      "ediary_schoolyears",
      "ediary_subjects",
      "ediary_teachers",
      "ediary_pupils",
      "ediary_groups",
      "ediary_events",
      "ediary_marks",
      "ediary_final_events",
    ] as const;

    const counts: Record<string, number> = {};
    await Promise.all(
      tables.map(async (t) => {
        const row = await db.selectFrom(t).select(db.fn.countAll<string>().as("n")).executeTakeFirst();
        counts[t] = Number(row?.n ?? 0);
      }),
    );

    res.json({ ok: true, db: true, counts });
  } catch (err) {
    res.status(500).json({ ok: false, db: false, error: (err as Error).message });
  }
});

/** GET /api/schoolyears */
readRouter.get("/schoolyears", async (_req: Request, res: Response) => {
  const rows = await db
    .selectFrom("ediary_schoolyears")
    .select(["id", "ext_id", "name", "start", "end"])
    .orderBy("start", "desc")
    .execute();
  res.json(rows);
});

/** GET /api/subjects */
readRouter.get("/subjects", async (_req: Request, res: Response) => {
  const rows = await db
    .selectFrom("ediary_subjects")
    .select(["id", "ext_id", "name"])
    .orderBy("name")
    .execute();
  res.json(rows);
});

/** GET /api/teachers */
readRouter.get("/teachers", async (_req: Request, res: Response) => {
  const rows = await db
    .selectFrom("ediary_teachers")
    .select(["id", "ext_id", "name"])
    .orderBy("name")
    .execute();
  res.json(rows);
});

/** GET /api/groups?schoolyear=<id> */
readRouter.get("/groups", async (req: Request, res: Response) => {
  let q = db
    .selectFrom("ediary_groups")
    .select(["id", "ext_id", "schoolyear", "parallel", "shift", "termtype"])
    .orderBy("parallel");

  const schoolyear = asId(req.query.schoolyear);
  if (req.query.schoolyear !== undefined) {
    if (schoolyear === null) return res.status(400).json({ error: "schoolyear должен быть положительным целым" });
    q = q.where("schoolyear", "=", schoolyear);
  }

  res.json(await q.execute());
});

/**
 * GET /api/events?group=<id>&from=<YYYY-MM-DD>&to=<YYYY-MM-DD>
 * Возвращает события группы за период с вложенными оценками, комментариями и пропусками.
 * group обязателен. Период по умолчанию - последние 30 дней. Лимит 1000 событий.
 */
readRouter.get("/events", async (req: Request, res: Response) => {
  const group = asId(req.query.group);
  if (group === null) return res.status(400).json({ error: "нужен параметр group (положительное целое)" });

  const to = typeof req.query.to === "string" && DATE_RE.test(req.query.to)
    ? req.query.to
    : new Date().toISOString().slice(0, 10);
  const from = typeof req.query.from === "string" && DATE_RE.test(req.query.from)
    ? req.query.from
    : new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  const events = await db
    .selectFrom("ediary_events as e")
    .innerJoin("ediary_subjects as s", "s.id", "e.subject")
    .innerJoin("ediary_teachers as t", "t.id", "e.teacher")
    .select([
      "e.id",
      "e.ext_id",
      "e.date",
      "e.lesson",
      "e.cabinet",
      "e.homework",
      "s.name as subject",
      "t.name as teacher",
    ])
    .where("e.group_id", "=", group)
    .where("e.date", ">=", from)
    .where("e.date", "<=", to)
    .orderBy("e.date")
    .orderBy("e.lesson")
    .limit(1000)
    .execute();

  const ids = events.map((e) => e.id);
  const [marks, comments, missings] = ids.length
    ? await Promise.all([
        db
          .selectFrom("ediary_marks as m")
          .innerJoin("ediary_pupils as p", "p.id", "m.pupil")
          .select(["m.event", "p.id as pupil", "p.ext_id as pupil_ext_id", "m.value", "m.comment"])
          .where("m.event", "in", ids)
          .execute(),
        db
          .selectFrom("ediary_comments as c")
          .innerJoin("ediary_pupils as p", "p.id", "c.pupil")
          .select(["c.event", "p.id as pupil", "p.ext_id as pupil_ext_id", "c.text"])
          .where("c.event", "in", ids)
          .execute(),
        db
          .selectFrom("ediary_missings as ms")
          .innerJoin("ediary_pupils as p", "p.id", "ms.pupil")
          .select(["ms.event", "p.id as pupil", "p.ext_id as pupil_ext_id"])
          .where("ms.event", "in", ids)
          .execute(),
      ])
    : [[], [], []];

  const byEvent = <T extends { event: number }>(rows: T[]) => {
    const map = new Map<number, Omit<T, "event">[]>();
    for (const { event, ...rest } of rows) {
      (map.get(event) ?? map.set(event, []).get(event)!).push(rest);
    }
    return map;
  };
  const marksMap = byEvent(marks);
  const commentsMap = byEvent(comments);
  const missingsMap = byEvent(missings);

  res.json(
    events.map((e) => ({
      ...e,
      marks: marksMap.get(e.id) ?? [],
      comments: commentsMap.get(e.id) ?? [],
      missings: missingsMap.get(e.id) ?? [],
    })),
  );
});

/**
 * GET /api/final-marks?group=<id>&pupil=<id>
 * Итоговые события с оценками. Хотя бы один из фильтров обязателен.
 */
readRouter.get("/final-marks", async (req: Request, res: Response) => {
  const group = asId(req.query.group);
  const pupil = asId(req.query.pupil);
  if (group === null && pupil === null) {
    return res.status(400).json({ error: "нужен параметр group или pupil" });
  }

  let eq = db
    .selectFrom("ediary_final_events as fe")
    .innerJoin("ediary_subjects as s", "s.id", "fe.subject")
    .select(["fe.id", "fe.ext_id", "fe.type", "fe.term_ext_id", "fe.group_id", "s.name as subject"]);
  if (group !== null) eq = eq.where("fe.group_id", "=", group);

  let events = await eq.execute();

  let marksQuery = db
    .selectFrom("ediary_final_marks as fm")
    .innerJoin("ediary_pupils as p", "p.id", "fm.pupil")
    .select(["fm.event", "p.id as pupil", "p.ext_id as pupil_ext_id", "fm.value"]);
  if (pupil !== null) marksQuery = marksQuery.where("fm.pupil", "=", pupil);
  if (events.length) marksQuery = marksQuery.where("fm.event", "in", events.map((e) => e.id));

  const marks = await marksQuery.execute();

  if (pupil !== null) {
    const withMarks = new Set(marks.map((m) => m.event));
    events = events.filter((e) => withMarks.has(e.id));
  }

  const marksMap = new Map<number, { pupil: number; pupil_ext_id: string; value: string }[]>();
  for (const { event, ...rest } of marks) {
    (marksMap.get(event) ?? marksMap.set(event, []).get(event)!).push(rest);
  }

  res.json(events.map((e) => ({ ...e, marks: marksMap.get(e.id) ?? [] })));
});
