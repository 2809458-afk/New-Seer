/* §7/§10：资源清单生成 —— 内容寻址（sha1 前 16 位）+ manifest
 *
 * 用法：
 *   node tools/build-asset-manifest.mjs [--dir web/assets/pets] [--out app/public/assets-manifest.json] [--limit N]
 *
 * 产物结构（前端按 id → hash 取图，manifest 很小，可随包发布）：
 *   { schema, kind, generatedAt, base, count, items: { "<id>": { h, size } } }
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i < 0 ? def : process.argv[i + 1];
}

const dirArg = arg('dir', 'web/assets/pets');
const outArg = arg('out', 'app/public/assets-manifest.json');
const limit = Number(arg('limit', '0')) || 0;

const absDir = resolve(ROOT, dirArg);
const outPath = resolve(ROOT, outArg);

const files = readdirSync(absDir)
  .filter((f) => f.toLowerCase().endsWith('.png'))
  .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

const picked = limit > 0 ? files.slice(0, limit) : files;
const items = {};
const t0 = Date.now();

for (const f of picked) {
  const full = resolve(absDir, f);
  const buf = readFileSync(full);
  const h = createHash('sha1').update(buf).digest('hex').slice(0, 16);
  const id = basename(f, '.png');
  items[id] = { h, size: statSync(full).size };
}

const manifest = {
  schema: 1,
  kind: 'assets',
  generatedAt: new Date().toISOString(),
  base: dirArg.replace(/\\/g, '/').replace(/^\.\//, ''),
  count: Object.keys(items).length,
  items
};
manifest.contentHash = createHash('sha256').update(JSON.stringify({ base: manifest.base, items })).digest('hex');
manifest.dataVersion = manifest.contentHash.slice(0, 16);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(manifest), 'utf8');

console.log(`扫描 ${picked.length}/${files.length} 张，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`manifest -> ${outArg}（${(JSON.stringify(manifest).length / 1024).toFixed(0)} KB）`);
console.log('样例:', Object.entries(items).slice(0, 3).map(([k, v]) => `${k}=${v.h}`).join(' '));

// 原始 data/ 保持只读；版本信封由生成器随代码包发布。
if (limit === 0) {
  const dataItems = {};
  for (const name of ['pets', 'combos', 'types', 'skills', 'soulmarks']) {
    const buf = readFileSync(resolve(ROOT, 'data', name + '.json'));
    dataItems[name] = {
      url: '/data/' + name + '.json',
      contentHash: createHash('sha256').update(buf).digest('hex'),
      size: buf.length
    };
  }
  const contentHash = createHash('sha256').update(JSON.stringify(dataItems)).digest('hex');
  writeFileSync(resolve(dirname(outPath), 'data-manifest.json'), JSON.stringify({
    schema: 1, kind: 'data', dataVersion: contentHash.slice(0, 16), contentHash, items: dataItems
  }), 'utf8');
}
