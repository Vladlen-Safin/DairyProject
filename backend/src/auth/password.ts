import bcrypt from "bcrypt";

// OWASP рекомендует для bcrypt work factor не ниже 10. 12 даёт достаточную
// защиту при приемлемом времени входа для текущего числа пользователей.
const BCRYPT_ROUNDS = 12;

function passwordWithPepper(password: string, pepper: string): string {
  // Нулевой разделитель исключает неоднозначность склейки значений.
  return `${pepper}\0${password}`;
}

/** Создаёт bcrypt-хэш; соль bcrypt генерирует самостоятельно. */
export async function hashPassword(password: string, pepper: string): Promise<string> {
  return bcrypt.hash(passwordWithPepper(password, pepper), BCRYPT_ROUNDS);
}

/**
 * Проверяет только bcrypt-хэш. Пароли в открытом виде и старый scrypt-формат
 * намеренно не поддерживаются: их нужно перевести скриптом migrate-passwords.
 */
export async function verifyPassword(password: string, stored: string, pepper: string): Promise<boolean> {
  if (!isBcryptHash(stored)) return false;
  return bcrypt.compare(passwordWithPepper(password, pepper), stored);
}

export function isBcryptHash(value: string): boolean {
  return /^\$2[aby]\$\d{2}\$/.test(value);
}
