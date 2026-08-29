import type { Request, Response, NextFunction } from "express";
import { config } from "../config.js";
import { verifyJwt } from "../auth/jwt.js";

export type Role = "teacher" | "student";

export interface AuthedRequest extends Request {
  auth?: { userId: number; login: string; role: Role };
}

/** Читает cookie из сырого заголовка (без cookie-parser). */
export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

/** Требует валидный access-токен в заголовке Authorization: Bearer <token>. */
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const payload = token ? verifyJwt(token, config.jwtSecret) : null;

  if (!payload || payload.sub == null) {
    res.status(401).json({ error: "требуется авторизация" });
    return;
  }

  req.auth = {
    userId: Number(payload.sub),
    login: String(payload.login ?? ""),
    role: payload.role === "teacher" ? "teacher" : "student",
  };
  next();
}
