import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { sql } from 'kysely';
import 'dotenv/config';

test('anonymous timetable snapshot preserves lessons across retries, chunks and files', {
  skip: process.env.RUN_IMPORT_DB_TESTS !== '1', timeout: 60000,
}, async t => {
  t.mock.method(console, 'log', () => {});
  const schema = 'import_test_' + randomUUID().replaceAll('-', '');
  assert.match(schema, /^import_test_[a-f0-9]{32}$/);
  const connectionString = process.env.IMPORT_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  const admin = new Pool({ connectionString });
  const dir = await mkdtemp(path.join(tmpdir(), 'diary-import-test-'));
  let db;
  let schemaCreated = false;
  try {
    await admin.query('CREATE SCHEMA "' + schema + '"');
    schemaCreated = true;
    const url = new URL(connectionString);
    url.searchParams.set('options', '-c search_path=' + schema);
    process.env.DATABASE_URL = url.toString();
    process.env.PASSWORD_PEPPER ??= 'test';
    process.env.FTP_HOST ??= 'unused';
    process.env.FTP_USER ??= 'unused';
    process.env.FTP_PASSWORD ??= 'unused';
    ({ db } = await import('../dist/db/index.js'));
    for (const name of ['001_init.sql', '003_planned_events.sql']) {
      await sql.raw(await readFile(new URL('../migrations/' + name, import.meta.url), 'utf8')).execute(db);
    }
    await db.insertInto('ediary_schoolyears').values({ ext_id: 'year', name: '2026', start: '2026-01-01', end: '2026-12-31' }).execute();
    await db.insertInto('ediary_subjects').values({ ext_id: 'subject', name: 'Math' }).execute();
    await db.insertInto('ediary_teachers').values({ ext_id: 'teacher', name: 'Teacher' }).execute();
    await db.insertInto('ediary_groups').values({ ext_id: 'group', schoolyear: 1 }).execute();
    await db.insertInto('ediary_pupils').values({ ext_id: 'pupil' }).execute();
    const { importEventsFile } = await import('../dist/import/eventsFileImporter.js');
    const { importEventsBatch } = await import('../dist/import/eventsImporter.js');
    const { loadHelperCaches } = await import('../dist/import/helperTables.js');
    const caches = await loadHelperCaches(db);
    const raw = { id: 'event', date: '2026-09-18', lesson: '1', subject: 'subject', teacher: 'teacher', group: 'group', marks: { mark: { pupil: 'pupil', value: '5' } } };
    const noChildren = '<event><id>event</id><date>2026-09-18</date><lesson>1</lesson><subject>subject</subject><teacher>teacher</teacher><group>group</group><homework>Read</homework></event>';
    const run = async (fn, name, body, no) => {
      await writeFile(path.join(dir, name), '<file><MessageNo>' + no + '</MessageNo>' + body + '</file>');
      const result = await fn(dir, name, no, 30000);
      assert.equal(result.done, true);
      assert.deepEqual(result.errorLog, []);
      return result;
    };
    const { publishPlannedEvents, discardPlannedStage } = await import('../dist/import/plannedEvents.js');
    const planned = () => db.selectFrom('ediary_events').selectAll().where('ext_id', 'is', null).orderBy('lesson').execute();
    const anonymous = Array.from({ length: 266 }, (_, i) => ({ ...raw, id: i % 2 ? '' : undefined,
      lesson: String(i + 1), homework: 'Task ' + i }));
    const source = { messageno: 'plans1', filename: 'events.xml', firstPosition: 1 };
    const planErrors = [];
    assert.deepEqual(await importEventsBatch(db, caches, anonymous, planErrors, source), { success: 266, fail: 0 });
    assert.deepEqual(planErrors, []);
    assert.equal((await planned()).length, 0, 'incomplete snapshot is not visible');
    await importEventsBatch(db, caches, anonymous, [], source);
    await publishPlannedEvents(db, 'plans1');
    assert.equal((await planned()).length, 266, '266 empty IDs must remain 266 separate lessons, retry adds no duplicates');
    const anonymousIds = (await planned()).map(r => r.id);
    assert.equal((await db.selectFrom('ediary_marks').selectAll().where('event', 'in', anonymousIds).execute()).length, 0);
    await publishPlannedEvents(db, 'plans1');
    assert.equal((await planned()).length, 266, 'retry after upload failure preserves the snapshot');
    const previousPlans = await planned();
    await sql`insert into ediary_planned_events_stage values ('invalid-plan', 'events.xml', 1,
      '{"date":"2026-10-13","lesson":1,"subject":-1,"teacher":1,"group_id":1}'::jsonb)`.execute(db);
    await assert.rejects(publishPlannedEvents(db, 'invalid-plan'), { code: '23503' });
    assert.deepEqual(await planned(), previousPlans, 'publication error rolls back removal of the previous snapshot');

    // Split files and CONTINUE must contribute to one snapshot without clearing each other.
    const planXml = noChildren.replace('<id>event</id>', '<id/>');
    await run(importEventsFile, 'part1.xml', '<events>' + planXml + '</events>', 'plans2');
    await writeFile(path.join(dir, 'part2.xml'), '<file><MessageNo>plans2</MessageNo><events>' +
      planXml.replace('<lesson>1</lesson>', '<lesson>2</lesson>') +
      planXml.replace('<lesson>1</lesson>', '<lesson>3</lesson>') + '</events></file>');
    let partial = await importEventsFile(dir, 'part2.xml', 'plans2', 0);
    assert.equal(partial.done, false);
    assert.equal((await planned()).length, 266, 'CONTINUE preserves the previous visible snapshot');
    for (let tries = 0; !partial.done && tries < 5; tries++) partial = await importEventsFile(dir, 'part2.xml', 'plans2', 30000);
    assert.equal(partial.done, true);
    await publishPlannedEvents(db, 'plans2');
    assert.deepEqual((await planned()).map(r => r.lesson), [1, 2, 3]);

    // A conducted lesson obtains an ID; the new snapshot no longer contains its anonymous predecessor.
    await importEventsBatch(db, caches, [{ ...raw, id: 'conducted-plan' }], []);
    await run(importEventsFile, 'part.xml', '<events>' + planXml.replace('<lesson>1</lesson>', '<lesson>2</lesson>') + '</events>', 'plans3');
    await publishPlannedEvents(db, 'plans3');
    assert.deepEqual((await planned()).map(r => r.lesson), [2]);
    assert.ok(await db.selectFrom('ediary_events').select('id').where('ext_id', '=', 'conducted-plan').executeTakeFirst());
    // Old corrupt blank-ID rows are removed only on successful snapshot publication.
    const legacy = await db.selectFrom('ediary_events').selectAll().where('ext_id', '=', 'conducted-plan').executeTakeFirstOrThrow();
    const { id: legacyId, ...legacyRow } = legacy;
    await db.insertInto('ediary_events').values({ ...legacyRow, ext_id: '' }).execute();
    await publishPlannedEvents(db, 'empty-plans');
    assert.equal((await planned()).length, 0);
    assert.equal((await db.selectFrom('ediary_events').select('id').where('ext_id', '=', '').execute()).length, 0);
    assert.ok(await db.selectFrom('ediary_events').select('id').where('ext_id', '=', 'conducted-plan').executeTakeFirst());
    await discardPlannedStage(db, 'plans1');
    const cleared = await sql`select count(*)::int as count from ediary_planned_events_stage where messageno = 'plans1'`.execute(db);
    assert.equal(cleared.rows[0].count, 0);
    await publishPlannedEvents(db, 'plans1');
    assert.equal((await planned()).length, 0, 'completed old message cannot republish after staging cleanup');
  } finally {
    if (db) await db.destroy();
    if (schemaCreated) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
    const resolved = path.resolve(dir);
    assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
    assert.ok(path.basename(resolved).startsWith('diary-import-test-'));
    await rm(resolved, { recursive: true, force: true });
  }
});
