import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Pool } from "pg";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const sql = readFileSync(path.join(__dirname, "../migrations/001_init.sql"), "utf-8");
  await pool.query(sql);
  await pool.end();
  console.log("Миграция выполнена успешно");
}

main().catch((err) => {
  console.error("Ошибка миграции:", err);
  process.exit(1);
});