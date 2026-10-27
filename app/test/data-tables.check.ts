/* P2 起点校验：data/*.json 能否被 TS 类型层正确解析
 * 运行：cd app && npx tsx test/data-tables.check.ts
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCombos, parseMintmarks } from '../src/data/tables';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fails = 0;

function load<T>(rel: string, fn: (raw: unknown) => { ok: boolean; value: T; errors: string[] }) {
  const p = resolve(ROOT, rel);
  if (!existsSync(p)) { console.error(`  FAIL 缺文件 ${rel}`); fails++; return null; }
  const raw = JSON.parse(readFileSync(p, 'utf8'));
  const r = fn(raw);
  if (!r.ok) { fails++; console.error(`  FAIL ${rel} 解析错误 ${r.errors.length} 条，例：${r.errors.slice(0, 3).join(' | ')}`); }
  else console.log(`  ok   ${rel} → ${Array.isArray(r.value) ? r.value.length : 0} 条`);
  return r.value;
}

const combos = load('data/combos.json', parseCombos);
const mintmarks = load('data/mintmarks.json', parseMintmarks);
// data/grades.json 是「分级报告」（统计 + 示例），不是逐只数据表，故不在此校验

// 结构抽查：组合必须有主属性；刻印必须有名字
if (combos) {
  const bad = combos.filter((c) => !c.primary);
  if (bad.length) { fails++; console.error(`  FAIL ${bad.length} 个组合缺 primary，例 ${bad[0].id}`); }
  else console.log('  ok   组合均有 primary');
  const dual = combos.filter((c) => c.secondary);
  console.log(`       其中双属性 ${dual.length} 个`);
}
if (mintmarks) {
  const noName = mintmarks.filter((m) => !m.name.trim());
  if (noName.length) { fails++; console.error(`  FAIL ${noName.length} 个刻印缺名字`); }
  else console.log('  ok   刻印均有名字');
}

console.log(fails ? `\n✗ ${fails} 项失败` : '\n✓ 数据表校验通过');
process.exit(fails ? 1 : 0);
