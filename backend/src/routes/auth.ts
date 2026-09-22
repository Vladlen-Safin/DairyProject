import { Router } from "express";
import { db } from "../db/index.js";
import { config } from "../config.js";
import { verifyPassword } from "../auth/password.js";
import { signJwt, verifyJwt } from "../auth/jwt.js";
import { readCookie, type Role } from "../middleware/auth.js";

/**
 * Демо-авторизация под контракт фронтенда (dairy/src/app/services/auth):
 *   POST /api/auth/login   { login, password } -> { accessToken, user }
 *   POST /api/auth/refresh (refresh-cookie)    -> { accessToken }
 *   POST /api/auth/logout                      -> { ok: true }
 *
 * access-токен - короткоживущий Bearer; refresh-токен - в httpOnly cookie.
 */
export const authRouter = Router();

const ACCESS_TTL_SEC = 15 * 60;
const REFRESH_TTL_SEC = 7 * 24 * 3600;
const REFRESH_COOKIE = "refreshToken";
const REFRESH_PATH = "/api/auth";

function resolveRole(accountType: string | null | undefined): Role {
  return accountType === "pupil" || accountType === "parent" ? "student" : "teacher";
}

async function loadUserByLogin(login: string) {
  return db
    .selectFrom("app_users as u")
    .leftJoin("ediary_pupils_accounts as pa", "pa.uid", "u.id")
    .select(["u.id", "u.username", "u.password_hash", "pa.type as account_type"])
    .where("u.username", "=", login)
    .executeTakeFirst();
}

async function loadUserById(id: number) {
  return db
    .selectFrom("app_users as u")
    .leftJoin("ediary_pupils_accounts as pa", "pa.uid", "u.id")
    .select(["u.id", "u.username", "pa.type as account_type"])
    .where("u.id", "=", id)
    .executeTakeFirst();
}

authRouter.post("/login", async (req, res) => {
  const login = String(req.body?.login ?? "").trim();
  const password = String(req.body?.password ?? "");
  if (!login || !password) {
    return res.status(400).json({ error: "нужны login и password" });
  }

  const user = await loadUserByLogin(login);
  if (!user || !(await verifyPassword(password, user.password_hash, config.passwordPepper))) {
    return res.status(401).json({ error: "Неверный логин или пароль" });
  }

  const role = resolveRole(user.account_type);
  const accessToken = signJwt(
    { sub: user.id, login: user.username, role },
    config.jwtSecret,
    ACCESS_TTL_SEC,
  );
  const refreshToken = signJwt({ sub: user.id, typ: "refresh" }, config.jwtSecret, REFRESH_TTL_SEC);

  res.cookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: REFRESH_TTL_SEC * 1000,
    path: REFRESH_PATH,
  });
  res.json({ accessToken, user: { id: user.id, login: user.username, role } });
});

authRouter.post("/refresh", async (req, res) => {
  const token = readCookie(req, REFRESH_COOKIE);
  const payload = token ? verifyJwt(token, config.jwtSecret) : null;
  if (!payload || payload.typ !== "refresh" || payload.sub == null) {
    return res.status(401).json({ error: "нет активной сессии" });
  }

  const user = await loadUserById(Number(payload.sub));
  if (!user) return res.status(401).json({ error: "нет активной сессии" });

  const role = resolveRole(user.account_type);
  const accessToken = signJwt(
    { sub: user.id, login: user.username, role },
    config.jwtSecret,
    ACCESS_TTL_SEC,
  );
  res.json({ accessToken });
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(REFRESH_COOKIE, { path: REFRESH_PATH });
  res.json({ ok: true });
});
