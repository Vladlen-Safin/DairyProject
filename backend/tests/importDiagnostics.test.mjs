import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import * as diagnostics from '../dist/import/diagnostics.js';

test('concurrent requests retain their own message and request IDs; errors omit sensitive data', async t => {
  const logs = [];
  t.mock.method(console, 'log', line => logs.push(JSON.parse(line)));
  await Promise.all(['one', 'two'].map(message => diagnostics.withImportDiagnostics(async () => {
    diagnostics.setImportMessage(message);
    await diagnostics.importStep(message, async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
    });
  })));
  for (const message of ['one', 'two']) {
    const lines = logs.filter(line => line.stage === message);
    assert.deepEqual(lines.map(line => line.status), ['START', 'OK']);
    assert.ok(lines.every(line => line.messageno === message && line.requestId === lines[0].requestId));
  }
  assert.notEqual(logs[0].requestId, logs[1].requestId);
  const error = Object.assign(new Error('password=private XML and SQL data'), { code: 'EACCES' });
  await assert.rejects(diagnostics.importStep('write', () => { throw error; }), e => e === error);
  assert.equal(logs.at(-1).errorCode, 'EACCES');
  assert.equal(logs.at(-1).status, 'ERROR');
  assert.ok(!JSON.stringify(logs).includes('private'));
});

// Execute the compiled handler with in-memory dependencies: no production DB or FTP calls.
async function harness({ uploadFails = false, writeFails = false, done = true, already = false } = {}) {
  const calls = [];
  let xml;
  const dependencies = {
    ...diagnostics, path, XMLBuilder, db: {},
    fs: { writeFile: async (_path, content) => {
      calls.push('write');
      if (writeFails) throw Object.assign(new Error('disk failure'), { code: 'EACCES' });
      xml = content;
    } },
    config: { xmlLocalCacheDir: 'test-cache', importTimeBudgetMs: 100, importApiToken: null },
    downloadFilelist: async () => 'filelist.xml',
    readFileList: async () => ({ messageno: '42', files: [{ filename: 'events.xml', type: 'events' }] }),
    findMessageResult: async () => already ? {} : undefined,
    isFreshMessage: async () => true,
    downloadMessageFiles: async () => {},
    importEventsFile: async () => ({ success: 1, fail: 0, errorLog: [], done }),
    upsertFileResult: async (_db, filename) => calls.push(`save:${filename}`),
    allResultsForMessage: async () => [],
    uploadResult: async () => { calls.push('upload'); if (uploadFails) throw new Error('FTP failed'); },
    cleanupMessageFiles: async () => calls.push('cleanup'),
  };
  const source = (await readFile(new URL('../dist/routes/importxml.js', import.meta.url), 'utf8'))
    .replace(/^import[\s\S]*?;\s*/gm, '').replace('export async function', 'async function');
  const handler = new Function(...Object.keys(dependencies), `${source}\nreturn importXmlHandler;`)(...Object.values(dependencies));
  const response = { statusCode: 200, headersSent: false, type() { return this; }, status(code) { this.statusCode = code; return this; }, send(code) { this.body = code; this.headersSent = true; return this; } };
  await handler({}, response);
  return { calls, xml, response };
}

test('result is valid XML and completion is recorded only after successful upload', async t => {
  t.mock.method(console, 'log', () => {});
  const { calls, xml, response } = await harness();
  assert.deepEqual(calls, ['save:events.xml', 'write', 'upload', 'save:filelist.xml', 'cleanup']);
  assert.equal(new XMLParser().parse(xml).result.MessageNo, 42);
  assert.equal(response.body, 'DONE');
});

test('failed write/upload does not mark message completed or clean cached inputs', async t => {
  t.mock.method(console, 'log', () => {});
  for (const options of [{ writeFails: true }, { uploadFails: true }]) {
    const { calls, response } = await harness(options);
    assert.equal(response.statusCode, 500);
    assert.equal(response.body, 'ERROR');
    assert.ok(!calls.includes('save:filelist.xml'));
    assert.ok(!calls.includes('cleanup'));
    if (options.writeFails) assert.ok(!calls.includes('upload'));
  }
});

test('CONTINUE and ALREADY explain why result.xml is not generated', async t => {
  const logs = [];
  t.mock.method(console, 'log', line => logs.push(JSON.parse(line)));
  for (const [options, code] of [[{ done: false }, 'CONTINUE'], [{ already: true }, 'ALREADY']]) {
    const { calls, response } = await harness(options);
    assert.equal(response.body, code);
    assert.ok(!calls.includes('write'));
    assert.ok(logs.some(line => line.stage === 'response' && line.code === code && line.reason));
  }
});
