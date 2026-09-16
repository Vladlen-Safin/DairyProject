import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readChunkedXml } from '../dist/xml/chunkedXmlReader.js';

const xml = '<file><events>' + Array.from({ length: 1100 }, (_, id) =>
  `<event><id>${id}</id></event>`).join('') + '</events></file>';
const delay = () => new Promise(resolve => setTimeout(resolve, 2));

test('one chunk crossing batch boundaries never overlaps consumers or repeats batches', async () => {
  let active = 0;
  let batch = [];
  const saved = [];
  await readChunkedXml(Readable.from([xml]), {
    collectPath: ['file', 'events', 'event'],
    onItem: async item => {
      assert.equal(++active, 1);
      batch.push(item.id);
      if (batch.length >= 500) {
        await delay();
        saved.push(...batch);
        batch = [];
      }
      active--;
    },
  });
  saved.push(...batch);
  assert.deepEqual(saved, Array.from({ length: 1100 }, (_, id) => String(id)));
  assert.equal(active, 0);
});

test('abort stops at the last consumed item, even within one chunk', async () => {
  const signal = { aborted: false };
  const seen = [];
  await readChunkedXml(Readable.from([xml]), {
    collectPath: ['file', 'events', 'event'], signal,
    onItem: async item => {
      await delay();
      seen.push(item.id);
      signal.aborted = seen.length === 3;
    },
  });
  assert.deepEqual(seen, ['0', '1', '2']);
});

test('consumer failure rejects without consuming subsequent items', async () => {
  let calls = 0;
  await assert.rejects(readChunkedXml(Readable.from([xml]), {
    collectPath: ['file', 'events', 'event'],
    onItem: async () => { calls++; await delay(); throw new Error('write failed'); },
  }), /write failed/);
  assert.equal(calls, 1);
});
