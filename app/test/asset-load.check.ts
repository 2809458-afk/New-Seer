import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PetArtCache, type AssetManifest } from '../src/data/assets';

const original = { fetch: globalThis.fetch, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
const bytes = new Uint8Array([1, 2, 3]);
const h = createHash('sha1').update(bytes).digest('hex').slice(0, 16);
const manifest: AssetManifest = { schema: 1, kind: 'assets', generatedAt: '', base: 'web/assets/pets', count: 3,
  items: { 1: { h, size: 3 }, 2: { h, size: 3 }, 3: { h: 'bad', size: 3 } } };
let calls = 0, counter = 0;
const revoked: string[] = [];
try {
  globalThis.fetch = async () => { calls++; return new Response(bytes, { headers: { 'Content-Type': 'image/png' } }); };
  URL.createObjectURL = () => `blob:${++counter}`;
  URL.revokeObjectURL = (url) => { revoked.push(url); };
  const cache = new PetArtCache({ petArtBase: 'unused', capacity: 1 }, manifest);
  const pair = await Promise.all([cache.load(1), cache.load(1)]);
  assert.deepEqual(pair, ['blob:1', 'blob:1']);
  assert.equal(calls, 1, 'concurrent loads share request');
  await cache.load(1); assert.equal(calls, 1, 'cache hit avoids network');
  await cache.load(2); assert.deepEqual(revoked, ['blob:1']);
  assert.equal(cache.loadedCount, 1, 'blob capacity enforced');
  await assert.rejects(cache.load(3), /校验失败/);
  assert.equal(cache.loadedCount, 1, 'corrupt resource not cached');
  cache.reset(); assert.deepEqual(revoked, ['blob:1', 'blob:2']);
  assert.equal(cache.loadedCount, 0);
  globalThis.fetch = async () => new Response('', { status: 404 });
  await assert.rejects(cache.load(1), /加载失败/);
  console.log('asset loading: dedupe / LRU / hash / reset / 404 PASS');
} finally {
  globalThis.fetch = original.fetch; URL.createObjectURL = original.create; URL.revokeObjectURL = original.revoke;
}
