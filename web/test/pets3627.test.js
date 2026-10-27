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
const SOUL921 = '自身攻击技能命中前消除对手回合类效果；|若对手先出手则对手技能命中前直至当回合结束后自身免疫异常状态且当回合受到的攻击伤害减少50%；|若自身先出手则自身技能命中前直至当回合结束后自身免疫能力下降状态且当回合造成的攻击伤害提升50%|（boss无效）';
function battle(meSkills, foeSkill) {
  return new B.Battle({ chart, comboOf: () => combo, rng: () => 0, level: 100,
    meTeam: [{ pet: pet(3627, '不羁·弗里德'), combo, skills: meSkills, passives: B.parseSoulmark(SOUL921) }],
    foeTeam: [{ pet: pet(2, '木桩'), combo, skills: [foeSkill || skill({ id: 2, name: '撞击', power: 10, category: { id: 1 } })] }] });
}
console.log('— 3627 不羁·弗里德：魂印解析 —');
{
  const sm = B.parseSoulmark(SOUL921);
  ok(sm.some(x => x.kind === 'preHitClearFoe'), '攻击命中前消除对手回合类效果');
  ok(sm.some(x => x.kind === 'ifFoeFirstReduce' && x.pct === 50), '对手先手 → 免疫异常 + 减伤 50%');
  ok(sm.some(x => x.kind === 'ifSelfFirstBoost' && x.pct === 50), '自身先手 → 免疫下降 + 伤害 +50%');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0];
  ok(me.preHitClearFoe === true && !!me.ifFoeFirstReduce && !!me.ifSelfFirstBoost, '魂印字段装载');
}
console.log('— 3627 实战 —');
{
  const b = battle([skill({ id: 3, name: '攻击', power: 80, category: { id: 1 } })]);
  const foe = b.foe.team[0];
  foe.damageBuff = { turns: 3, mul: 2 };
  b.useSkill('me', 0, { isFirst: true });
  ok(!foe.damageBuff, '攻击命中前断掉对手回合类效果');
}
{
  const b = battle([skill({ id: 3, name: '攻击', power: 80, category: { id: 1 } })]);
  const me = b.me.team[0];
  b.useSkill('me', 0, { isFirst: true });
  ok(!!me.damageBuff && Math.abs(me.damageBuff.mul - 1.5) < 1e-9, '自身先手 → 本回合伤害 ×1.5');
  ok(me.immuneStat >= 1, '自身先手 → 免疫能力下降');
}
{
  const b = battle([skill()], skill({ id: 2, name: '重击', power: 200, category: { id: 1 } }));
  const me = b.me.team[0];
  b.useSkill('foe', 0, { isFirst: true });
  ok(Math.abs((me.turnTakenMul || 1) - 0.5) < 1e-9, '对手先手 → 当回合受伤 ×0.5');
  ok(me.immuneStatus >= 1, '对手先手 → 免疫异常');
  b.applyStatus(me, 'paralyze', 1, '对手');
  ok(!me.status, '免疫异常生效');
}
if (fails) { console.error('FAILED ' + fails); process.exit(1); }
console.log('ALL PASS');
