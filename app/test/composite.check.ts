/* P2 组合解析校验：拆段 + 逐段规则 + 条件标记
 * 运行：cd app && npx tsx test/composite.check.ts
 */
import { parseComposite } from '../src/data/composite';

let fails = 0;
function check(text: string, expect: unknown) {
  const got = parseComposite(text);
  const ok = JSON.stringify(got) === JSON.stringify(expect);
  if (ok) console.log(`  ok   ${text}`);
  else { fails++; console.error(`  FAIL ${text}\n    期望 ${JSON.stringify(expect)}\n    实际 ${JSON.stringify(got)}`); }
}

// 两段都能被规则表解析 → 组合成功
// oracle 并不输出 elseBranch 结构；未对齐前整体放弃。
check('额外附加50点固定伤害，未触发则恢复50点体力', null);

check('消除对手能力提升状态，消除成功则恢复自身最大体力的1/3', [
  { kind: 'clear', target: 'foe', which: 'positive' },
  { kind: 'heal', num: 1, den: 3, req: { type: 'clearSuccess' } }
]);

check('若对手中毒，威力翻倍', null);

// 任一段未覆盖 → 整体放弃，交回旧解析器
check('当回合若未击败对手则70%令对手石化，未触发则令自身全属性+1', null);

// 条件原文不认识 → 不接管
check('额外附加50点固定伤害，未触发则随便什么', null);

console.log(fails ? `\n✗ ${fails} 项失败` : '\n✓ 组合解析校验通过');
process.exit(fails ? 1 : 0);
