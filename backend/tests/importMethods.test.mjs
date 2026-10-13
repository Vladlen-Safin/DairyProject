import { test } from 'node:test';
import assert from 'node:assert/strict';

// No real database or FTP connection is needed for method and token checks.
Object.assign(process.env, {
  DATABASE_URL: 'postgres://unused:unused@127.0.0.1:1/unused',
  PASSWORD_PEPPER: 'test', FTP_HOST: '127.0.0.1', FTP_PORT: '1',
  FTP_USER: 'test', FTP_PASSWORD: 'test', IMPORT_API_TOKEN: 'test-token',
});
const { importXmlHandler } = await import('../dist/routes/importxml.js');

function response() {
  return {
    statusCode: 200, headers: {}, body: undefined, ended: false,
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    type() { return this; },
    end() { this.ended = true; return this; },
    send(body) { this.body = body; this.ended = true; return this; },
  };
}

test('HEAD returns empty 200 before authorization or import', async () => {
  const res = response();
  await importXmlHandler({ method: 'HEAD', header() { assert.fail('must not authorize HEAD'); } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, undefined);
  assert.equal(res.ended, true);
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('non-GET methods return 405 before authorization or import', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const res = response();
    await importXmlHandler({ method, header() { assert.fail('must not authorize rejected methods'); } }, res);
    assert.equal(res.statusCode, 405, method);
    assert.equal(res.headers.Allow, 'GET, HEAD');
    assert.equal(res.body, 'METHOD_NOT_ALLOWED');
  }
});

test('GET enters the existing authorization flow', async () => {
  const res = response();
  await importXmlHandler({ method: 'GET', header() { return undefined; } }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body, 'UNAUTHORIZED');
});
