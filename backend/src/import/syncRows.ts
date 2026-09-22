import { sql, type Kysely } from "kysely";
import type { DB } from "../db/types.js";

type Row = Record<string, unknown>;

function signature(row: Row): string {
  return JSON.stringify(Object.keys(row).filter((key) => key !== "id").sort().map((key) => [key, row[key]]));
}

/** Compare multisets: XML ordering is irrelevant, but duplicate counts matter. */
export function sameRows(existing: Row[], incoming: Row[]): boolean {
  if (existing.length !== incoming.length) return false;
  const a = existing.map(signature).sort();
  const b = incoming.map(signature).sort();
  return a.every((value, index) => value === b[index]);
}

function predicate(row: Row, keys: string[]) {
  return sql.join(keys.map((key) => row[key] == null
    ? sql`${sql.ref(key)} is null` : sql`${sql.ref(key)} = ${row[key]}`), sql` and `);
}

async function insertRows(db: Kysely<DB>, table: keyof DB, rows: Row[], keys: string[] = []) {
  if (!rows.length) return [];
  const columns = Object.keys(rows[0]!);
  const result = await sql<Row & { id: number }>`insert into ${sql.table(table)}
    (${sql.join(columns.map((column) => sql.ref(column)))}) values
    ${sql.join(rows.map((row) => sql`(${sql.join(columns.map((column) => sql`${row[column]}`))})`))}
    ${keys.length ? sql`on conflict (${sql.join(keys.map((key) => sql.ref(key)))}) do nothing` : sql``}
    returning *`.execute(db);
  return result.rows;
}

/** Read a batch once; write only new or changed rows. Preserve existing IDs. */
export async function upsertChanged(
  db: Kysely<DB>, table: keyof DB, keys: string[], rows: Row[],
): Promise<(Row & { id: number })[]> {
  if (!rows.length) return [];
  const keyOf = (row: Row) => JSON.stringify(keys.map((key) => row[key]));
  const unique = new Map(rows.map((row) => [keyOf(row), row]));
  const existing = await sql<Row & { id: number }>`select * from ${sql.table(table)} where
    ${sql.join([...unique.values()].map((row) => sql`(${predicate(row, keys)})`), sql` or `)}`.execute(db);
  const byKey = new Map(existing.rows.map((row) => [keyOf(row), row]));
  const missing: Row[] = [];
  for (const [key, row] of unique) {
    const previous = byKey.get(key);
    if (!previous) {
      missing.push(row);
    } else if (Object.keys(row).some((column) => row[column] !== previous[column])) {
      await sql`update ${sql.table(table)} set
        ${sql.join(Object.keys(row).map((column) => sql`${sql.ref(column)} = ${row[column]}`))}
        where ${predicate(row, keys)}`.execute(db);
      byKey.set(key, { ...previous, ...row });
    }
  }
  for (const row of await insertRows(db, table, missing, keys)) byKey.set(keyOf(row), row);
  // Another importer may have inserted a previously missing key while we read.
  const raced = missing.filter((row) => !byKey.has(keyOf(row)));
  if (raced.length) for (const row of await upsertChanged(db, table, keys, raced)) byKey.set(keyOf(row), row);
  return rows.map((row) => byKey.get(keyOf(row))!);
}

export async function upsertOne(db: Kysely<DB>, table: keyof DB, keys: string[], row: Row) {
  return (await upsertChanged(db, table, keys, [row]))[0]!;
}

/** Replace children only for parents whose complete collection changed. */
export async function syncChildren(
  db: Kysely<DB>, table: keyof DB, parentColumn: string, parentIds: number[], rows: Row[],
): Promise<void> {
  if (!parentIds.length) return;
  if (!db.isTransaction) {
    await db.transaction().execute((trx) => syncChildren(trx, table, parentColumn, parentIds, rows));
    return;
  }
  const existing = await sql<Row>`select * from ${sql.table(table)}
    where ${sql.ref(parentColumn)} in (${sql.join(parentIds)})`.execute(db);
  const group = (values: Row[]) => {
    const result = new Map<number, Row[]>();
    for (const row of values) {
      const id = row[parentColumn] as number;
      const list = result.get(id) ?? [];
      list.push(row);
      result.set(id, list);
    }
    return result;
  };
  const before = group(existing.rows);
  const after = group(rows);
  const changed = [...new Set(parentIds)].filter((id) => !sameRows(before.get(id) ?? [], after.get(id) ?? []));
  if (!changed.length) return;
  await sql`delete from ${sql.table(table)} where ${sql.ref(parentColumn)} in (${sql.join(changed)})`.execute(db);
  await insertRows(db, table, changed.flatMap((id) => after.get(id) ?? []));
}
