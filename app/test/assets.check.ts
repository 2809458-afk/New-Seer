/* §7 资源层用例：URL 规则 + LRU 淘汰
 * 运行：cd app && npx tsx test/assets.check.ts
 */
import { petArtUrl, LruCache, PetArtCache, DEFAULT_ASSET_CONFIG, manifestUrl, type AssetManifest } from '../src/data/assets';

let fails = 0;
const eq = (a: unknown, b: unknown, msg: string) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (ok) console.log(`  ok   ${msg}`);
  else { fails++; console.error(`  FAIL ${msg}（期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}）`); }
};

eq(petArtUrl(1), 'assets/pets/1.png', 'URL 规则：assets/pets/<id>.png');
eq(petArtUrl(4939, { petArtBase: 'web/assets/pets', capacity: 4 }), 'web/assets/pets/4939.png', 'URL 规则支持自定义根');

{
  const c = new LruCache<number, string>(3);
  c.set(1, 'a'); c.set(2, 'b'); c.set(3, 'c');
  c.get(1);              // 1 变成最近使用
  c.set(4, 'd');         // 淘汰 2
  eq(c.has(2), false, 'LRU：最久未用的 2 被淘汰');
  eq(c.has(1) && c.has(3) && c.has(4), true, 'LRU：1/3/4 保留');
  eq(c.size, 3, 'LRU：容量不超限');
}

{
  const art = new PetArtCache({ petArtBase: 'assets/pets', capacity: 2 });
  const u1 = art.urlFor(1);
  const u2 = art.urlFor(2);
  art.urlFor(3);         // 淘汰 1
  eq(u1, 'assets/pets/1.png', 'PetArtCache：返回正确 URL');
  eq(u2, 'assets/pets/2.png', 'PetArtCache：第二只 URL');
  eq(art.cachedCount, 2, 'PetArtCache：容量 2 生效');
  eq(DEFAULT_ASSET_CONFIG.capacity, 96, '默认容量 96');
}

// §10 内容寻址：有 manifest 时用 hash 做缓存键
{
  const m: AssetManifest = {
    schema: 1, kind: 'assets', generatedAt: 'x', base: 'web/assets/pets', count: 1,
    items: { '7': { h: 'abcdef0123456789', size: 123 } }
  };
  eq(manifestUrl(7, m), 'web/assets/pets/7.png?v=abcdef0123456789', 'manifest：命中 id 带 hash，base 取自 manifest');
  eq(manifestUrl(8, m), 'web/assets/pets/8.png', 'manifest：未命中则无 version 参数');
  eq(manifestUrl(7, null), 'assets/pets/7.png', 'manifest：为空时退化为普通 URL');
  eq(new PetArtCache(undefined, m).urlFor(7), 'web/assets/pets/7.png?v=abcdef0123456789', 'LRU 使用 manifest hash');
}

console.log(fails ? `\n✗ ${fails} 项失败` : '\n✓ 资源层用例通过');
process.exit(fails ? 1 : 0);
