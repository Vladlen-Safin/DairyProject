import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { sql } from 'kysely';
import 'dotenv/config';

// Explicit opt-in. All test data lives in a new, randomly named schema.
test('full XML import preserves unchanged rows and applies parent/child changes', {
  skip: process.env.RUN_IMPORT_DB_TESTS !== '1', timeout: 60000,
}, async () => {
  const schema = `import_test_${randomUUID().replaceAll('-', '')}`;
  assert.match(schema, /^import_test_[a-f0-9]{32}$/);
  const connectionString = process.env.IMPORT_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  assert.ok(connectionString, 'Set IMPORT_TEST_DATABASE_URL or DATABASE_URL');
  const admin = new Pool({ connectionString });
  const dir = await mkdtemp(path.join(tmpdir(), 'diary-import-test-'));
  let db;
  let schemaCreated = false;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    const url = new URL(connectionString);
    url.searchParams.set('options', `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
    process.env.FTP_HOST ??= 'unused';
    process.env.FTP_USER ??= 'unused';
    process.env.FTP_PASSWORD ??= 'unused';
    ({ db } = await import('../dist/db/index.js'));
    const migration = await readFile(new URL('../migrations/001_init.sql', import.meta.url), 'utf8');
    await sql.raw(migration).execute(db);
    const { importBookFile } = await import('../dist/import/bookImporter.js');
    const { importGroupsFile } = await import('../dist/import/groupsImporter.js');
    const { importEventsFile } = await import('../dist/import/eventsFileImporter.js');
    const { importFinalMarksFile } = await import('../dist/import/finalMarksImporter.js');

    const book = `<schoolyears><schoolyear><id>year</id><name>2026</name><start>2026-01-01</start><end>2026-12-31</end></schoolyear></schoolyears>
      <terms><scheme><id>scheme</id><name>Terms</name><term><id>term</id><name>First</name></term></scheme></terms>
      <teachers><teacher><id>teacher</id><name>Teacher</name></teacher></teachers>
      <subjects><subject><id>subject</id><name>Math</name></subject></subjects>
      <pupils><pupil><id>pupil</id><users><user><username>student</username><password>test</password><type>pupil</type></user>
      <user><username>parent</username><password>test</password><type>parent</type></user></users></pupil></pupils>
      <calls><schoolyear><id>year</id><shift><name>1</name><parallelstart>1</parallelstart><parallelend>11</parallelend>
      <lesson><lessonnumber>1</lessonnumber><weekday>1</weekday><weekday>2</weekday><timebegin>08:00</timebegin><timeend>08:45</timeend></lesson>
      </shift></schoolyear></calls>`;
    const groups = `<groups><group><id>group</id><schoolyear>year</schoolyear><groupdata><parallel>5</parallel><shift>1</shift>
      <termscheme><id>scheme</id><term><id>term</id><date_start>2026-01-01</date_start><date_end>2026-12-31</date_end></term></termscheme>
      </groupdata><pupils><pupil><id>pupil</id><date_start>2026-01-01</date_start></pupil></pupils></group></groups>`;
    const event = `<event><id>event</id><date>2026-09-18</date><lesson>1</lesson><subject>subject</subject><teacher>teacher</teacher>
      <group>group</group><homework>Read</homework><marks><mark><pupil>pupil</pupil><value>4</value></mark>
      <mark><pupil>pupil</pupil><value>5</value></mark></marks><comments><comment><pupil>pupil</pupil><text>Good</text></comment></comments>
      <missing><pupil>pupil</pupil></missing></event>`;
    const finals = `<final_marks><final_event><id>final</id><schoolyear>year</schoolyear><subject>subject</subject>
      <type>year</type><group>group</group><pupil><id>pupil</id><value>4</value></pupil></final_event></final_marks>`;
    const run = async (fn, name, body, no = '1') => {
      await writeFile(path.join(dir, name), `<file><MessageNo>${no}</MessageNo>${body}</file>`);
      const result = await fn(dir, name, no, 30000);
      assert.ok(result);
      assert.equal(result.done, true);
      assert.deepEqual(result.errorLog, []);
      return result;
    };
    const full = async (no) => {
      await run(importBookFile, 'book.xml', book, no);
      await run(importGroupsFile, 'groups.xml', groups, no);
      await run(importEventsFile, 'events.xml', `<events>${event}</events>`, no);
      await run(importFinalMarksFile, 'final.xml', finals, no);
    };
    const tables = ['app_users', 'ediary_schoolyears', 'ediary_term_types', 'ediary_terms', 'ediary_teachers',
      'ediary_subjects', 'ediary_pupils', 'ediary_pupils_accounts', 'ediary_parent', 'ediary_shifts', 'ediary_lessons',
      'ediary_groups', 'ediary_groups_terms', 'ediary_groups_pupils', 'ediary_events', 'ediary_comments', 'ediary_marks',
      'ediary_missings', 'ediary_final_events', 'ediary_final_marks'];
    const snapshot = async () => Object.fromEntries(await Promise.all(tables.map(async (table) => {
      const result = await sql`select *, xmin::text as version from ${sql.table(table)}`.execute(db);
      return [table, result.rows.map((row) => JSON.stringify(row)).sort()];
    })));
    await full('1');
    const first = await snapshot();
    await full('2');
    assert.deepEqual(await snapshot(), first, 'new MessageNo with identical data must preserve IDs and xmin');

    const { syncChildren } = await import('../dist/import/syncRows.js');
    const eventId = JSON.parse(first.ediary_events[0]).id;
    await assert.rejects(syncChildren(db, 'ediary_marks', 'event', [eventId],
      [{ event: eventId, pupil: -1, value: '5', comment: null }]), { code: '23503' });
    assert.deepEqual(await snapshot(), first, 'failed child replacement must roll back deletion');

    const { importEventsBatch } = await import('../dist/import/eventsImporter.js');
    const { loadHelperCaches } = await import('../dist/import/helperTables.js');
    const caches = await loadHelperCaches(db);
    const raw = { id: 'concurrent', date: '2026-09-18', lesson: '1', subject: 'subject', teacher: 'teacher',
      group: 'group', marks: { mark: { pupil: 'pupil', value: '5' } } };
    await Promise.all([importEventsBatch(db, caches, [raw], []), importEventsBatch(db, caches, [raw], [])]);
    const concurrent = await db.selectFrom('ediary_events').select('id').where('ext_id', '=', raw.id).executeTakeFirstOrThrow();
    assert.equal((await db.selectFrom('ediary_marks').selectAll().where('event', '=', concurrent.id).execute()).length, 1);
    await importEventsBatch(db, caches, [{ id: raw.id, delete: '1' }], []);
    assert.deepEqual(await snapshot(), first, 'parallel imports must not duplicate children');

    // Order changes in a child collection are not data changes.
    const reversed = event.replace('<value>4</value>', '<value>SWAP</value>')
      .replace('<value>5</value>', '<value>4</value>').replace('<value>SWAP</value>', '<value>5</value>');
    await run(importEventsFile, 'events.xml', `<events>${reversed}</events>`, '3');
    assert.deepEqual(await snapshot(), first);

    await run(importEventsFile, 'events.xml', `<events>${event.replace('<value>4</value>', '<value>3</value>')}</events>`, '4');
    const changedMark = await snapshot();
    assert.notDeepEqual(changedMark.ediary_marks, first.ediary_marks);
    for (const table of tables.filter((table) => table !== 'ediary_marks')) assert.deepEqual(changedMark[table], first[table], table);

    const noChildren = event.replace(/<marks>.*?<\/marks>/s, '').replace(/<comments>.*?<\/comments>/s, '')
      .replace(/<missing>.*?<\/missing>/s, '');
    await run(importEventsFile, 'events.xml', `<events>${noChildren}</events>`, '5');
    const empty = await snapshot();
    for (const table of ['ediary_marks', 'ediary_comments', 'ediary_missings']) assert.deepEqual(empty[table], []);
    assert.deepEqual(empty.ediary_events, first.ediary_events);

    await run(importEventsFile, 'events.xml', `<events>${noChildren.replace('<homework>Read</homework>', '<homework>Write</homework>')}</events>`, '6');
    assert.notDeepEqual((await snapshot()).ediary_events, first.ediary_events);
    await run(importBookFile, 'book.xml', book.replace('<name>First</name>', '<name>Renamed</name>'), '7');
    const renamed = await snapshot();
    assert.notDeepEqual(renamed.ediary_terms, first.ediary_terms);
    assert.deepEqual(renamed.ediary_groups_terms, first.ediary_groups_terms, 'period rename must preserve group references');

    await run(importFinalMarksFile, 'final.xml', finals.replace('<value>4</value>', '<value>5</value>'), '8');
    const finalChanged = await snapshot();
    assert.deepEqual(finalChanged.ediary_final_events, first.ediary_final_events);
    assert.notDeepEqual(finalChanged.ediary_final_marks, first.ediary_final_marks);
    await run(importGroupsFile, 'groups.xml', groups.replace(/<pupils>.*?<\/pupils>/s, '<pupils/>'), '9');
    const emptyGroup = await snapshot();
    assert.deepEqual(emptyGroup.ediary_groups, first.ediary_groups);
    assert.deepEqual(emptyGroup.ediary_groups_pupils, []);
    await run(importBookFile, 'book.xml', book.replace('<timebegin>08:00</timebegin>', '<timebegin>08:10</timebegin>'), '10');
    const changedCalls = await snapshot();
    assert.notDeepEqual(changedCalls.ediary_lessons, first.ediary_lessons);
    assert.deepEqual(changedCalls.ediary_pupils, first.ediary_pupils);
    await run(importEventsFile, 'events.xml', '<events><event><id>event</id><delete>1</delete></event></events>', '9');
    assert.deepEqual((await snapshot()).ediary_events, []);
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
