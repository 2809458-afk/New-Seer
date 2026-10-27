/* P2 覆盖度量：用真实效果样本集（web/data/effect-ids.json）比对规则表 vs 旧解析器
 * 不变量：规则表一旦命中，结果必须与旧解析器一致（不允许「命中但结果不同」）
 * 运行：cd app && npx tsx test/rules.coverage.ts
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { parseRuleList } from '../src/data/rules';
import { parseComposite } from '../src/data/composite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const legacy = require('../../web/js/battle.js');

interface Entry { n?: number; sample?: string; t?: Array<Record<string, unknown>> }
const table = JSON.parse(readFileSync(resolve(ROOT, 'web/data/effect-ids.json'), 'utf8')) as { ids?: Record<string, Entry> };
const entries = Object.values(table.ids || {}).filter((e) => typeof e.sample === 'string' && e.sample.trim());

let hit = 0, agree = 0, disagree = 0;
const disagreeSamples: string[] = [];
const missed: string[] = [];

for (const e of entries) {
  const sample = String(e.sample).trim();
  const got = parseRuleList(sample);
  if (!got) { missed.push(sample); continue; }
  hit++;
  const out: unknown[] = [];
  legacy.parseOneEffect(sample, out);
  const same = JSON.stringify(got) === JSON.stringify(out);
  if (same) agree++;
  else { disagree++; if (disagreeSamples.length < 5) disagreeSamples.push(sample); }
}

const total = entries.length;
let compositeHit = 0;
const compositeSamples: string[] = [];
for (const e of entries) {
  const sample = String(e.sample).trim();
  if (parseRuleList(sample)) continue;
  const got = parseComposite(sample);
  if (got) {
    const expected: unknown[] = [];
    legacy.parseOneEffect(sample, expected);
    if (JSON.stringify(got) !== JSON.stringify(expected)) {
      disagree++; disagreeSamples.push(sample); continue;
    }
    compositeHit++;
    if (compositeSamples.length < 6) compositeSamples.push(sample);
  }
}
console.log(`样本总数 ${total}`);
console.log(`单句规则命中 ${hit}（${((hit / total) * 100).toFixed(1)}%），其中一致 ${agree}，不一致 ${disagree}`);
console.log(`组合解析额外命中 ${compositeHit}（${((compositeHit / total) * 100).toFixed(1)}%）`);
console.log(`合计 TS 接管 ${hit + compositeHit} / ${total}（${(((hit + compositeHit) / total) * 100).toFixed(1)}%）`);
if (compositeSamples.length) console.log('组合命中样例：\n  ' + compositeSamples.join('\n  '));
console.log(`未命中 ${missed.length}（仍由旧解析器负责）`);

// —— 段级覆盖：把样本按标点切成分句，统计有多少分句能被规则表处理 ——
function clauses(sample: string): string[] {
  return sample
    .split(/[，,；;]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      // 「…则 X」只取结果段；仍保留原句以便统计
      const m = /则(.+)$/.exec(s);
      return m ? m[1].trim() : s;
    })
    .filter(Boolean);
}

let clauseTotal = 0, clauseHit = 0;
const clauseMiss = new Map<string, number>();
for (const e of entries) {
  for (const c of clauses(String(e.sample))) {
    clauseTotal++;
    const got = parseRuleList(c);
    if (got) {
      const expected: unknown[] = [];
      legacy.parseOneEffect(c, expected);
      if (JSON.stringify(got) === JSON.stringify(expected)) clauseHit++;
      else { disagree++; disagreeSamples.push(c); }
    } else clauseMiss.set(c, (clauseMiss.get(c) || 0) + 1);
  }
}
console.log(`\n段级覆盖：${clauseHit} / ${clauseTotal}（${((clauseHit / clauseTotal) * 100).toFixed(1)}%）`);
const topClause = [...clauseMiss.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
console.log('未覆盖分句 TOP：');
for (const [t, n] of topClause) console.log(`  ${String(n).padStart(3)}× ${t}`);
if (disagreeSamples.length) console.log('不一致样例：\n  ' + disagreeSamples.join('\n  '));
// 未命中按出现次数排序，作为下一批规则的取材依据
const missedTop = entries
  .filter((e) => !parseRuleList(String(e.sample).trim()))
  .map((e) => ({ s: String(e.sample).trim(), n: e.n || 1 }))
  .sort((a, b) => b.n - a.n)
  .slice(0, 12);
console.log('未命中 TOP（按出现次数）：');
for (const m of missedTop) console.log(`  ${String(m.n).padStart(3)}× ${m.s}`);

if (disagree > 0) { console.error(`\n✗ ${disagree} 条「命中但结果不同」`); process.exit(1); }
console.log('\n✓ 规则表命中项与旧解析器完全一致');
