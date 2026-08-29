import crypto from "node:crypto";

/**
 * Хэш пароля для демо-пользователей seed-скрипта: `scrypt:<saltHex>:<hashHex>`.
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

/**
 * Проверка пароля. Поддерживает два формата хранения в app_users.password_hash:
 *  - `scrypt:<salt>:<hash>` - пользователи из seed-скрипта;
 *  - `plain:<password>`     - учётки из выгрузки 1С (book.xml), пока нет
 *                             полноценного слоя авторизации.
 */
export function verifyPassword(password: string, stored: string): boolean {
  if (stored.startsWith("plain:")) {
    return safeEqual(password, stored.slice("plain:".length));
  }
  if (stored.startsWith("scrypt:")) {
    const [, saltHex, hashHex] = stored.split(":");
    if (!saltHex || !hashHex) return false;
    const hash = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), 64);
    return safeEqual(hash.toString("hex"), hashHex);
  }
  return false;
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
