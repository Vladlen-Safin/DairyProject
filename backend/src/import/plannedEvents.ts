import { sql, type Kysely } from "kysely";
import type { DB } from "../db/types.js";

export interface EventSource {
  messageno: string;
  filename: string;
  firstPosition: number;
}

export async function publishPlannedEvents(db: Kysely<DB>, messageno: string): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`select pg_advisory_xact_lock(746120, hashtext(current_schema()))`.execute(trx);
    const published = await trx.selectFrom("ediary_import_checkpoint").select("id")
      .where("messageno", "=", messageno).where("filename", "=", "__planned_snapshot__")
      .executeTakeFirst();
    if (published) return;
    // Also remove the single corrupt empty-ID row left by the old importer.
    await sql`delete from ediary_events where ext_id is null or btrim(ext_id) = ''`.execute(trx);
    await sql`insert into ediary_events (ext_id, date, lesson, subject, teacher, group_id, cabinet, homework)
      select null, (payload->>'date')::date, (payload->>'lesson')::integer,
        (payload->>'subject')::integer, (payload->>'teacher')::integer,
        (payload->>'group_id')::integer, payload->>'cabinet', payload->>'homework'
      from ediary_planned_events_stage where messageno = ${messageno}
      order by filename, position`.execute(trx);
    await trx.insertInto("ediary_import_checkpoint").values({
      messageno, filename: "__planned_snapshot__", processed_count: 0, status: "published",
    }).execute();
    // The marker makes retries (including after FTP failure) idempotent even
    // when staging has already been cleaned by another request for this message.
  });
}

export async function discardPlannedStage(db: Kysely<DB>, messageno: string): Promise<void> {
  await sql`delete from ediary_planned_events_stage where messageno = ${messageno}`.execute(db);
}
