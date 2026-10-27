global.self = global;
const B = require('../js/battle.js');
let fails = 0;
function ok(cond, msg) { if (cond) console.log('  ok  ' + msg); else { fails++; console.error('  FAIL ' + msg); } }
function eq(a, b, msg) { ok(a === b, msg + ' (期望 ' + b + '，实际 ' + a + ')'); }
const combo = { id: 1, name: '草', primary: { id: 1 }, secondary: null };
const chart = { 1: { 1: 1 } };
function pet(id, name) { return { id, name, base_stats: { hp: 1000, atk: 140, def: 100, sp_atk: 100, sp_def: 100, spd: 100 } }; }
function skill(over) {
  return Object.assign({ id: 1, name: '测试技能', power: 0, max_pp: 10, accuracy: 100, crit_rate: 0,
    priority: 0, must_hit: true, category: { id: 4 }, type: { id: 1 }, info: '', effects: [] }, over || {});
}
const SOUL1082 = '自身所有技能先出手时100%使对手当回合技能失效，每触发1次则概率下降25%，每下降25%则自身在整场战斗中造成的攻击伤害提升25%，概率降低为0%的当回合使对手随机2项技能PP值归零；|回合开始时若自身不处于能力提升状态则当回合所有技能先制+1，若自身处于能力提升状态则当回合攻击造成的伤害提升50%（boss无效）';
function battle(meSkills) {
  return new B.Battle({ chart, comboOf: () => combo, rng: () => 0, level: 100,
    meTeam: [{ pet: pet(3807, '欧德奈瑞'), combo, skills: meSkills, passives: B.parseSoulmark(SOUL1082) }],
    foeTeam: [{ pet: pet(2, '木桩'), combo, skills: [skill({ id: 21 }), skill({ id: 22 }), skill({ id: 23 }), skill({ id: 24 })] }] });
}
console.log('— 3807 欧德奈瑞：魂印解析 —');
{
  const sm = B.parseSoulmark(SOUL1082);
  const fs = sm.filter(x => x.kind === 'firstNullifyScale')[0];
  ok(!!fs && fs.pct === 100 && fs.step === 25 && fs.bonus === 25 && fs.ppCount === 2, '先手失效：100% 起、每次 -25%、每次 +25% 增伤、耗尽清 2 PP');
  ok(sm.some(x => x.kind === 'startStageBranch' && x.prio === 1 && x.dealtPct === 50), '有/无强化分支：先制+1 / 伤害+50%');
}
console.log('— 3807 回合开始分支 —');
{
  const b = battle([skill()]);
  const me = b.me.team[0];
  me.priorityBuff = null;
  b.startOfTurn();
  ok(!!me.priorityBuff && me.priorityBuff.value === 1, '无能力提升 → 所有技能先制 +1');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0];
  me.stages.atk = 1;
  me.priorityBuff = null;
  me.damageBuff = null;
  b.startOfTurn();
  ok(!me.priorityBuff, '有强化 → 不给先制');
  ok(!!me.damageBuff && Math.abs(me.damageBuff.mul - 1.5) < 1e-9, '有强化 → 当回合伤害 ×1.5');
}
console.log('— 3807 先手失效递减 —');
{
  const b = battle([skill()]);
  const me = b.me.team[0], foe = b.foe.team[0];
  b.useSkill('me', 0, { isFirst: true });
  eq(foe.skillNull, 1, '先手 → 对手当回合技能失效');
  eq(me.firstNullPct, 75, '触发后概率降为 75%');
  eq(me.firstNullBonus, 25, '永久增伤 +25%');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0], foe = b.foe.team[0];
  for (let i = 0; i < 4; i++) b.useSkill('me', 0, { isFirst: true });
  eq(me.firstNullPct, 0, '触发 4 次后概率归零');
  eq(me.firstNullBonus, 100, '累计永久增伤 +100%');
  eq(foe.skills.filter(x => x.pp === 0).length, 2, '概率归零当回合清对手 2 项 PP');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0], foe = b.foe.team[0];
  b.useSkill('me', 0, { isFirst: false });
  eq(foe.skillNull || 0, 0, '后手不触发失效');
  eq(me.firstNullPct, 100, '后手不消耗概率');
}
console.log('— 3807 永久增伤进 calcDamage —');
{
  const mk = (bonus) => {
    const b = battle([skill({ power: 60, category: { id: 1 } })]);
    b.me.team[0].firstNullBonus = bonus;
    const hp0 = b.foe.team[0].hp;
    b.useSkill('me', 0, { isFirst: false });
    return hp0 - b.foe.team[0].hp;
  };
  const d0 = mk(0), d100 = mk(100);
  ok(d100 > d0, '永久增伤进伤害计算 (' + d0 + ' → ' + d100 + ')');
}
if (fails) { console.error('FAILED ' + fails); process.exit(1); }
console.log('ALL PASS');
