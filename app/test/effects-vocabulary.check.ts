/* P2 校验：
 * 1) effects.ts 的词汇表必须与旧解析器一致（漂移检测）
 * 2) 规则表（RuleEntry）形态可用：正则 → 效果模板
 * 运行：cd app && npx tsx test/effects-vocabulary.check.ts
 */
// @ts-ignore Node-only source overlay
import { readEffectiveOracle } from '../config/oracle.mjs';
import { EFFECT_KINDS, isEffectKind, type RuleEntry } from '../src/data/effects';

let fails = 0;
const ok = (cond: boolean, msg: string) => {
  if (cond) console.log(`  ok   ${msg}`);
  else { fails++; console.error(`  FAIL ${msg}`); }
};

// 1) 漂移检测
const legacy = readEffectiveOracle();
const fromLegacy = [...new Set([...legacy.matchAll(/kind:\s*'([a-zA-Z0-9_]+)'/g)].map((m) => m[1]))].sort();
const missing = fromLegacy.filter((k) => !isEffectKind(k));
const extra = EFFECT_KINDS.filter((k) => fromLegacy.indexOf(k) < 0);
ok(missing.length === 0, `词汇表覆盖旧解析器全部 kind（缺 ${missing.length}）${missing.slice(0, 5).join(',')}`);
ok(extra.length === 0, `词汇表无多余 kind（多 ${extra.length}）`);
ok(EFFECT_KINDS.length === fromLegacy.length, `kind 数量 = ${EFFECT_KINDS.length}（实际判定核 ${fromLegacy.length}）`);

// 2) 规则表形态：同一份数据驱动解析，不再写 if/else
const rules: RuleEntry[] = [
  {
    name: 'flat-damage',
    pattern: /^(?:额外)?附加(\d+)点(?:固定)?伤害$/,
    build: (m) => ({ kind: 'flat', value: Number(m[1]) })
  },
  {
    name: 'stat-stage',
    pattern: /^(?:使|令)?(对手|自身)(攻击|防御|特攻|特防|速度)等级([+-]\d+)$/,
    build: (m) => ({
      kind: 'stat',
      target: m[1] === '自身' ? 'self' : 'foe',
      stat: { 攻击: 'atk', 防御: 'def', 特攻: 'spAtk', 特防: 'spDef', 速度: 'spd' }[m[2]],
      stages: Number(m[3])
    })
  }
];

function parseByRules(text: string) {
  for (const r of rules) {
    const m = r.pattern.exec(text);
    if (m) return r.build(m);
  }
  return null;
}

ok(JSON.stringify(parseByRules('附加50点固定伤害')) === JSON.stringify({ kind: 'flat', value: 50 }), '规则表：附加固定伤害');
ok(JSON.stringify(parseByRules('令对手防御等级-1')) === JSON.stringify({ kind: 'stat', target: 'foe', stat: 'def', stages: -1 }), '规则表：能力等级');
ok(parseByRules('完全无关的文本') === null, '规则表：未命中返回 null');

console.log(fails ? `\n✗ ${fails} 项失败` : '\n✓ 词汇表与规则表校验通过');
process.exit(fails ? 1 : 0);
