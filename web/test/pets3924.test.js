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
const SOUL1189 = '自身使用攻击技能若未造成伤害则使用后{吸取}对手最大{体力}的1/3且下回合自身所有技能先制+1；|自身每次先出手则技能命中前全属性+1，若自身体力高于最大体力的1/2则额外攻击+1、速度+1；自身每次后出手则技能命中前消除对手回合类效果，若对手不处于回合类效果或回合类效果无法被消除则使用技能后恢复自身最大体力的1/3并造成等量百分比伤害|（boss无效）';
function battle(meSkills) {
  return new B.Battle({ chart, comboOf: () => combo, rng: () => 0, level: 100,
    meTeam: [{ pet: pet(3924, '凛戾·寂灭魔神'), combo, skills: meSkills, passives: B.parseSoulmark(SOUL1189) }],
    foeTeam: [{ pet: pet(2, '木桩'), combo, skills: [skill({ id: 21 })] }] });
}
console.log('— 3924 凛戾·寂灭魔神：魂印解析 —');
{
  const sm = B.parseSoulmark(SOUL1189);
  ok(sm.some(x => x.kind === 'noDamageDrain' && x.den === 3 && x.prio === 1), '攻击未造成伤害 → 吸 1/3 血 + 下回合先制+1');
  ok(sm.some(x => x.kind === 'firstStatUp' && x.halfDen === 2), '先出手 → 全属性+1（体力过半额外攻速+1）');
  ok(sm.some(x => x.kind === 'lastClearHeal' && x.den === 3), '后出手 → 断回合，否则回 1/3 血 + 等量百分比伤害');
}
console.log('— 3924 先出手 —');
{
  const b = battle([skill({ id: 31, power: 1, category: { id: 1 } })]);
  const me = b.me.team[0];
  b.useSkill('me', 0, { isFirst: true });
  eq(me.stages.atk, 2, '先出手：攻击 +1，体力过半再加 +1');
  eq(me.stages.spd, 2, '先出手：速度 +1（全属性再 +1）');
  eq(me.stages.def, 1, '先出手：全属性 +1');
}
{
  const b = battle([skill({ id: 32, power: 1, category: { id: 1 } })]);
  const me = b.me.team[0];
  me.hp = Math.floor(me.maxHp / 3);
  b.useSkill('me', 0, { isFirst: true });
  eq(me.stages.atk, 1, '体力未过半：攻击只 +1');
  eq(me.stages.spd, 1, '体力未过半：速度只吃全属性 +1');
}
console.log('— 3924 后出手 —');
{
  const b = battle([skill({ id: 33 })]);
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.damageBuff = { turns: 2, mul: 2 };
  b.useSkill('me', 0, { isFirst: false });
  ok(!foe.damageBuff, '后出手：先消除对手回合类效果');
}
{
  const b = battle([skill({ id: 34 })]);
  const me = b.me.team[0], foe = b.foe.team[0];
  me.hp = me.maxHp - 500;
  const hp0 = me.hp, foeHp = foe.hp;
  b.useSkill('me', 0, { isFirst: false });
  eq(me.hp, Math.min(me.maxHp, hp0 + Math.floor(me.maxHp / 3)), '对手无回合类效果 → 回 1/3 体力');
  ok(foe.hp < foeHp, '并造成等量百分比伤害');
}
console.log('— 3924 未造成伤害吸血 —');
{
  const b = battle([skill({ id: 35, power: 0, category: { id: 1 } })]);
  const me = b.me.team[0], foe = b.foe.team[0];
  me.hp = me.maxHp - 300;
  const hp0 = me.hp, foeHp = foe.hp;
  b.useSkill('me', 0, { isFirst: true });
  ok(me.hp > hp0, '未造成伤害 → 吸取对手最大体力 1/3（回血 ' + (me.hp - hp0) + '）');
  ok(foe.hp < foeHp, '对手掉血');
  eq(me.pendingNextPrio, 1, '记下下回合先制 +1');
  b.startOfTurn();
  ok(me.priorityBuff && me.priorityBuff.value >= 1, '下回合先制生效');
}
if (fails) { console.error('FAILED ' + fails); process.exit(1); }
console.log('ALL PASS');
