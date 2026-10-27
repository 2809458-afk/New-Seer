/* P2 差分：规则表 vs 旧 parseOneEffect（金标准）
 * 运行：cd app && npx tsx test/rules.compare.ts
 */
import { createRequire } from 'node:module';
import { parseWithRules, parseRuleList } from '../src/data/rules';

const require = createRequire(import.meta.url);
const legacy = require('../../web/js/battle.js');

let fails = 0;
function legacyFirst(text: string) {
  const out: unknown[] = [];
  legacy.parseOneEffect(text, out);
  return out[0] as Record<string, unknown> | undefined;
}

function cmp(text: string, keys: string[]) {
  const a = parseWithRules(text);
  const b = legacyFirst(text);
  if (!a || !b) {
    fails++;
    console.error(`  FAIL 未解析：${text}（新=${!!a} 旧=${!!b}）`);
    return;
  }
  const diffs = keys.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  if (diffs.length) {
    fails++;
    console.error(`  FAIL ${text}\n    新=${JSON.stringify(a)}\n    旧=${JSON.stringify(b)}`);
  } else {
    console.log(`  ok   ${text}（kind=${String(a.kind)}）`);
  }
}

cmp('额外附加50点固定伤害', ['kind', 'value']);
cmp('恢复自身最大体力的1/3', ['kind', 'num', 'den']);
cmp('造成伤害的30%恢复自身体力', ['kind', 'num', 'den']);
cmp('给予对方损伤的一半会恢复自己的体力', ['kind', 'num', 'den']);
cmp('技能使用成功时，100%改变自身防御等级+1', ['kind', 'target', 'stat', 'stages']);
cmp('15%改变对手命中等级-1', ['kind', 'target', 'stat', 'stages']);
cmp('命中后100%令对方中毒', ['kind', 'statusId', 'chance']);
cmp('10%令对手疲惫3回合', ['kind', 'statusId', 'turns']);
cmp('3回合内受到物理攻击伤害减半', ['kind', 'turns', 'mul', 'scope']);

// —— 第二批 ——
cmp('随机附加100~200点固定伤害', ['kind', 'min', 'max']);
cmp('附加自身最大体力20%的百分比伤害', ['kind', 'pct']);
cmp('恢复50点体力', ['kind', 'value']);
cmp('3回合内每回合都能附加30点固定伤害', ['kind', 'turns', 'value']);
cmp('1回合做3次攻击', ['kind', 'min', 'max']);
cmp('1回合做2~5次攻击', ['kind', 'min', 'max']);
cmp('为自身附加200点护盾', ['kind', 'value']);
cmp('下2回合自身攻击技能必定打出致命一击', ['kind', 'turns']);
cmp('下3回合自身攻击先制+2', ['kind', 'turns', 'value']);
cmp('威力翻倍', ['kind', 'mul']);
cmp('3回合内免疫异常状态', ['kind', 'turns']);
cmp('消除对手能力提升状态', ['kind', 'target', 'which']);
cmp('解除自身的能力下降状态', ['kind', 'target', 'which']);
cmp('令对手随机2项技能PP值归零', ['kind', 'count']);
cmp('对方体力小于1/2时威力加倍', ['kind', 'cond', 'threshold', 'mul']);
cmp('先出手的话威力为2倍', ['kind', 'cond', 'mul']);
cmp('后出手的话威力为2倍', ['kind', 'cond', 'mul']);
cmp('威力随机，随机范围50~150', ['kind', 'min', 'max']);
cmp('令对手石化', ['kind', 'statusId', 'chance', 'turns']);
cmp('令对手诅咒', ['kind', 'statusId', 'chance', 'turns']);
cmp('吸取对手最大体力的1/3', ['kind', 'num', 'den']);
cmp('消除对手回合类效果', ['kind']);
cmp('恢复自身全部体力', ['kind', 'num', 'den']);
cmp('免疫下1次对手的攻击', ['kind']);
cmp('吸取对手能力提升状态', ['kind']);
cmp('反转自身能力下降状态', ['kind', 'dbl']);
cmp('消耗自身全部体力', ['kind']);
cmp('2回合内令对手使用的属性技能无效', ['kind', 'turns']);
cmp('先制+1', ['kind', 'value']);
cmp('技能威力翻倍', ['kind', 'mul']);
cmp('随机附加2种异常状态', ['kind', 'count']);
cmp('消除双方能力提升、下降状态', ['kind']);

// 全属性 ±N：旧解析器返回 5 条，逐项比对
{
  const cases = ['全属性+1', '自身全属性+1', '令对手全属性-1'];
  for (const text of cases) {
    const got = parseRuleList(text);
    const out: unknown[] = [];
    legacy.parseOneEffect(text, out);
    if (JSON.stringify(got) === JSON.stringify(out)) console.log(`  ok   ${text}（5 条一致）`);
    else { fails++; console.error(`  FAIL ${text}\n    新=${JSON.stringify(got)}\n    旧=${JSON.stringify(out)}`); }
  }
}

console.log(fails ? `\n✗ ${fails} 项不一致` : '\n✓ 规则表与旧引擎一致');
process.exit(fails ? 1 : 0);

