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
const SOUL732 = '攻击技能命中后附加自身最大体力值25%的百分比伤害；回合开始时，若自身体力高于最大体力的1/2，则当回合受到的攻击伤害减少50%；战斗阶段结束时，若自身体力低于最大体力的1/2，则恢复自身最大体力的1/4并造成等量百分比伤害（boss无效）';
const SOUL1031 = '攻击技能命中后附加自身最大体力值30%的百分比伤害；回合开始时，若自身体力高于最大体力的1/2，则当回合受到的攻击伤害减少60%；战斗阶段结束时，若自身体力低于最大体力的1/2，则恢复自身最大体力的1/3并造成等量百分比伤害（boss无效）';
function battle(meSkills, sm) {
  return new B.Battle({ chart, comboOf: () => combo, rng: () => 0, level: 100,
    meTeam: [{ pet: pet(3421, '圣灵之魂迈尔斯'), combo, skills: meSkills, passives: B.parseSoulmark(sm || SOUL732) }],
    foeTeam: [{ pet: pet(2, '木桩'), combo, skills: [skill({ id: 2, name: '撞击', power: 10, category: { id: 1 } })] }] });
}
console.log('— 3421 圣灵之魂迈尔斯：魂印解析 —');
{
  const sm = B.parseSoulmark(SOUL732);
  ok(sm.some(x => x.kind === 'atkHitPercentMaxHp' && x.pct === 25), '命中后附加 25% 最大体力百分比伤害');
  ok(sm.some(x => x.kind === 'startTakenMul' && x.pct === 50), '体力>1/2 时当回合攻击减伤 50%');
  ok(sm.some(x => x.kind === 'endHealLowPct' && x.num === 1 && x.den === 4), '回合末低血回复 1/4 + 等量百分比伤害');
  const sm2 = B.parseSoulmark(SOUL1031);
  ok(sm2.some(x => x.kind === 'atkHitPercentMaxHp' && x.pct === 30), '1031：30% 附伤');
  ok(sm2.some(x => x.kind === 'startTakenMul' && x.pct === 60), '1031：减伤 60%');
  ok(sm2.some(x => x.kind === 'endHealLowPct' && x.den === 3), '1031：回复 1/3');
}
{
  const b = battle([skill()]);
  ok(b.me.team[0].atkHitPercentMaxHp === 25 && b.me.team[0].startTakenMulPct === 50, '魂印字段装载');
}
console.log('— 3421 实战 —');
{
  const b = battle([skill({ id: 3, name: '攻击', power: 0, category: { id: 1 } })]);
  const me = b.me.team[0], foe = b.foe.team[0];
  b.step({ type: 'skill', index: 0 });
  eq(foe.maxHp - foe.hp, Math.floor(me.maxHp * 25 / 100), '攻击命中附加 25% 最大体力百分比伤害');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0];
  b.step({ type: 'skill', index: 0 });
  ok(Math.abs(me.turnTakenMul - 0.5) < 1e-9, '体力高于 1/2 → 当回合攻击伤害 ×0.5');
  me.hp = Math.floor(me.maxHp * 0.3);
  b.startOfTurn();
  eq(me.turnTakenMul, 1, '体力低于 1/2 → 不减伤');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0], foe = b.foe.team[0];
  me.hp = Math.floor(me.maxHp * 0.2);
  const hp0 = me.hp, fhp0 = foe.hp;
  const heal = Math.min(Math.floor(me.maxHp / 4), me.maxHp - me.hp);
  b.endOfTurn();
  eq(me.hp - hp0, heal, '回合末低血回复 1/4 最大体力');
  ok(foe.hp < fhp0, '同时对对手造成等量百分比伤害（' + (fhp0 - foe.hp) + '）');
}
if (fails) { console.error('FAILED ' + fails); process.exit(1); }
console.log('ALL PASS');
