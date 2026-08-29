import { Pool, types } from "pg";
import { Kysely, PostgresDialect } from "kysely";
import type { DB } from "./types.ts";
import { config } from "../config.js";

// OID 1082 = тип date. По умолчанию node-postgres парсит DATE в JS Date
// в локальной таймзоне сервера, из-за чего возможен сдвиг на день -
// именно этот класс багов в PHP-версии лечился хаками на "переход на зимнее/летнее время".
// Отключаем парсинг: работаем со строками формата YYYY-MM-DD напрямую.
types.setTypeParser(1082, (val) => val);

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: config.dbPoolSize,
});

export const db = new Kysely<DB>({
  dialect: new PostgresDialect({ pool }),
});