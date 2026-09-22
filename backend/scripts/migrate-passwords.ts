/**
 * Одноразовая миграция паролей 1С из legacy-формата plain:<пароль> в bcrypt.
 *
 * По умолчанию выполняется только проверка:
 *   npm run users:hash
 * Для записи изменений:
 *   npm run users:hash:apply
 */
import "dotenv/config";
import { db } from "../src/db/index.js";
import { config } from "../src/config.js";
import { hashPassword, isBcryptHash } from "../src/auth/password.js";

const apply = process.argv.includes("--apply");

async function main() {
  const users = await db.selectFrom("app_users").select(["id", "username", "password_hash"]).execute();
  const plaintextUsers = users.filter((user) => user.password_hash.startsWith("plain:"));
  const unsupportedUsers = users.filter(
    (user) => !user.password_hash.startsWith("plain:") && !isBcryptHash(user.password_hash),
  );

  if (unsupportedUsers.length > 0) {
    throw new Error(
      `Найдены ${unsupportedUsers.length} учётных записей в неподдерживаемом формате. ` +
        "Их нельзя перевести в bcrypt без исходного пароля.",
    );
  }

  if (!apply) {
    console.log(`Проверка: будет переведено в bcrypt: ${plaintextUsers.length}; уже bcrypt: ${users.length - plaintextUsers.length}.`);
    console.log("Для записи выполните: npm run users:hash:apply");
    return;
  }

  // Сначала рассчитываем хэши, затем краткой транзакцией заменяем значения в БД.
  // Одновременно запускаем не более четырёх bcrypt-операций, чтобы не перегружать CPU.
  const migrated: { id: number; passwordHash: string }[] = [];
  for (let i = 0; i < plaintextUsers.length; i += 4) {
    const batch = plaintextUsers.slice(i, i + 4);
    migrated.push(
      ...(await Promise.all(
        batch.map(async (user) => ({
          id: user.id,
          passwordHash: await hashPassword(user.password_hash.slice("plain:".length), config.passwordPepper),
        })),
      )),
    );
  }

  await db.transaction().execute(async (trx) => {
    for (const user of migrated) {
      await trx.updateTable("app_users").set({ password_hash: user.passwordHash }).where("id", "=", user.id).execute();
    }
  });

  console.log(`Готово: ${migrated.length} учётных записей переведено в bcrypt.`);
}

main()
  .catch((error) => {
    console.error("Ошибка миграции паролей:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.destroy();
  });
