import type { Kysely } from "kysely";
import type { DB } from "../db/types.js";

export async function upsertFileResult(
  db: Kysely<DB>,
  file: string,
  messageno: string,
  newErrors: string[],
  successDelta: number,
  failDelta: number,
) {
  const existing = await db
    .selectFrom("ediary_import_results")
    .selectAll()
    .where("file", "=", file)
    .where("messageno", "=", messageno)
    .executeTakeFirst();

  const errors = [existing?.errors, ...newErrors].filter(Boolean).join("\r\n");
  const success = (existing?.success ?? 0) + successDelta;
  const fail = (existing?.fail ?? 0) + failDelta;

  await db
    .insertInto("ediary_import_results")
    .values({ file, messageno, errors, success, fail })
    .onConflict((oc) =>
      oc.columns(["file", "messageno"]).doUpdateSet({ errors, success, fail, updated_at: new Date() }),
    )
    .execute();

  return { errors, success, fail };
}

export async function findMessageResult(db: Kysely<DB>, file: string, messageno: string) {
  return db
    .selectFrom("ediary_import_results")
    .selectAll()
    .where("file", "=", file)
    .where("messageno", "=", messageno)
    .executeTakeFirst();
}

export async function allResultsForMessage(db: Kysely<DB>, messageno: string) {
  return db.selectFrom("ediary_import_results").selectAll().where("messageno", "=", messageno).execute();
}