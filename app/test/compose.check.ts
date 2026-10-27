/* P2 组合层校验：复合句结构拆分
 * 运行：cd app && npx tsx test/compose.check.ts
 */
import { splitCompound } from '../src/data/compose';

let fails = 0;
function check(text: string, expect: Array<{ branch: string; text: string; cond?: string }>) {
  const got = splitCompound(text);
  const ok = JSON.stringify(got) === JSON.stringify(expect);
  if (ok) console.log(`  ok   ${text}`);
  else {
    fails++;
    console.error(`  FAIL ${text}\n    期望 ${JSON.stringify(expect)}\n    实际 ${JSON.stringify(got)}`);
  }
}

check('当回合若未击败对手则70%令对手石化，未触发则令自身全属性+1', [
  { branch: 'main', text: '当回合若未击败对手则70%令对手石化' },
  { branch: 'else', text: '令自身全属性+1', cond: '未触发' }
]);

check('消除对手能力提升状态，消除成功则3回合内对手造成的攻击伤害不超过200点', [
  { branch: 'main', text: '消除对手能力提升状态' },
  { branch: 'then', text: '3回合内对手造成的攻击伤害不超过200点', cond: '消除成功' }
]);

check('若对手中毒，技能威力翻倍', [
  { branch: 'cond', text: '技能威力翻倍', cond: '对手中毒' }
]);

check('额外附加50点固定伤害', [{ branch: 'main', text: '额外附加50点固定伤害' }]);

console.log(fails ? `\n✗ ${fails} 项失败` : '\n✓ 复合句拆分校验通过');
process.exit(fails ? 1 : 0);
