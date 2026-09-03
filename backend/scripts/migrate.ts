import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Pool } from "pg";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// По умолчанию разворачивает схему с нуля (001_init.sql).
// Отдельный файл миграции - аргументом:  npm run migrate -- 002_widen_mark_values.sql
const file = process.argv[2] ?? "001_init.sql";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const sql = readFileSync(path.join(__dirname, "../migrations", file), "utf-8");
  await pool.query(sql);
  await pool.end();
  console.log(`Миграция ${file} выполнена успешно`);
}

main().catch((err) => {
  console.error("Ошибка миграции:", err);
  process.exit(1);
});
