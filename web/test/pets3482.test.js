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
const SOUL792 = '自身使用攻击技能后令对手下1次属性技能无效，自身使用属性技能后战斗阶段结束时恢复自身最大体力的1/3并造成等量百分比伤害，自身体力低于1/2时恢复效果和百分比伤害翻倍；|回合开始时，若自身体力高于对手则当回合自身造成的伤害翻倍，若自身体力低于对手则战斗阶段结束时恢复等同于当回合造成伤害数值的体力并造成等量百分比伤害；|每次受到攻击都会反馈给对手所受攻击伤害1/4的百分比伤害，反馈的伤害超过100时自身全属性+1（boss无效）';
function battle(meSkills, foeSkill) {
  return new B.Battle({ chart, comboOf: () => combo, rng: () => 0, level: 100,
    meTeam: [{ pet: pet(3482, '圣·瑞尔斯'), combo, skills: meSkills, passives: B.parseSoulmark(SOUL792) }],
    foeTeam: [{ pet: pet(2, '木桩'), combo, skills: [foeSkill || skill({ id: 2, name: '撞击', power: 10, category: { id: 1 } })] }] });
}
console.log('— 3482 圣·瑞尔斯：魂印解析 —');
{
  const sm = B.parseSoulmark(SOUL792);
  ok(sm.some(x => x.kind === 'foeStatusSealOnAtk' && x.times === 1), '攻击后令对手下 1 次属性技无效');
  const sh = sm.filter(x => x.kind === 'statusSkillEndHeal')[0];
  ok(!!sh && sh.num === 1 && sh.den === 3 && sh.doubleLow === true, '属性技后回合末回复 1/3（低血翻倍）');
  ok(sm.some(x => x.kind === 'startDamageDouble'), '体力高于对手 → 当回合伤害翻倍');
  ok(sm.some(x => x.kind === 'endHealByDealt'), '体力低于对手 → 回合末按造成伤害回血');
  const rf = sm.filter(x => x.kind === 'reflectOnHitPct')[0];
  ok(!!rf && rf.num === 1 && rf.den === 4 && rf.threshold === 100, '受击反馈 1/4 百分比伤害，超过 100 全属性+1');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0];
  ok(me.foeStatusSealOnAtk === 1 && !!me.statusSkillEndHeal && me.startDamageDouble === true && !!me.reflectOnHitPct, '魂印字段装载');
}
console.log('— 3482 实战 —');
{
  const b = battle([skill({ id: 3, name: '攻击', power: 0, category: { id: 1 } })]);
  const foe = b.foe.team[0];
  b.step({ type: 'skill', index: 0 });
  eq(foe.statusSkillNull, 1, '攻击后对手下 1 次属性技无效');
}
{
  const b = battle([skill({ id: 4, name: '属性技' })]);
  const me = b.me.team[0];
  me.hp = Math.floor(me.maxHp * 0.5);
  const hp0 = me.hp;
  b.step({ type: 'skill', index: 0 });
  ok(me.hp > hp0, '属性技后回合末回血（' + (me.hp - hp0) + '）');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.hp = Math.floor(foe.maxHp * 0.5);
  b.startOfTurn();
  ok(!!me.damageBuff && me.damageBuff.mul === 2 && me.damageBuff.turns === 1, '体力高 → 当回合伤害 ×2');
  eq(me.endHealByDealtActive, false, '体力高 → 不启用按伤害回血');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0], foe = b.foe.team[0];
  me.hp = Math.floor(me.maxHp * 0.4);
  foe.hp = foe.maxHp;
  b.startOfTurn();
  eq(me.endHealByDealtActive, true, '体力低 → 启用按伤害回血');
  me.lastDealt = 300;
  const hp0 = me.hp, fhp0 = foe.hp;
  b.endOfTurn();
  ok(me.hp - hp0 === 300, '回合末按造成伤害回复 300（实际 ' + (me.hp - hp0) + '）');
  ok(fhp0 - foe.hp === 300, '同时造成等量百分比伤害（' + (fhp0 - foe.hp) + '）');
}
{
  const b = battle([skill()], skill({ id: 5, name: '重击', power: 900, category: { id: 1 }, must_hit: true }));
  const me = b.me.team[0], foe = b.foe.team[0];
  me.stats.spd = 1; foe.stats.spd = 999;
  const fhp0 = foe.hp;
  b.step({ type: 'skill', index: 0 });
  ok(foe.hp < fhp0, '受击反馈百分比伤害（对手掉了 ' + (fhp0 - foe.hp) + '）');
}
if (fails) { console.error('FAILED ' + fails); process.exit(1); }
console.log('ALL PASS');
