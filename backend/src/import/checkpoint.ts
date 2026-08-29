import type { Kysely } from "kysely";
import type { DB } from "../db/types.js";

export async function getCheckpoint(db: Kysely<DB>, messageno: string, filename: string) {
  return db
    .selectFrom("ediary_import_checkpoint")
    .selectAll()
    .where("messageno", "=", messageno)
    .where("filename", "=", filename)
    .executeTakeFirst();
}

export async function saveCheckpoint(
  db: Kysely<DB>,
  messageno: string,
  filename: string,
  processedCount: number,
) {
  await db
    .insertInto("ediary_import_checkpoint")
    .values({ messageno, filename, processed_count: processedCount, status: "in_progress" })
    .onConflict((oc) =>
      oc.columns(["messageno", "filename"]).doUpdateSet({
        processed_count: processedCount,
        status: "in_progress",
        updated_at: new Date(),
      }),
    )
    .execute();
}

export async function clearCheckpoint(db: Kysely<DB>, messageno: string, filename: string) {
  await db
    .deleteFrom("ediary_import_checkpoint")
    .where("messageno", "=", messageno)
    .where("filename", "=", filename)
    .execute();
}