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
const SOUL1253 = '登场后召唤狂怒雷电:首次攻击100%打出致命一击且附加造成伤害值50%的百分比伤害，之后每次登场致命一击触发概率为50%；回合开始时，若自身体力高于最大体力的1/2则当回合攻击技能造成的伤害提升50%，先出手时伤害提升效果翻倍；若自身体力低于最大体力的1/2则攻击技能命中后附加自身已损失体力50%的百分比伤害，先出手时伤害附加效果翻倍（boss无效）';
function battle(meSkills) {
  return new B.Battle({ chart, comboOf: () => combo, rng: () => 0, level: 100,
    meTeam: [{ pet: pet(3994, '暴乱·格劳瑞'), combo, skills: meSkills, passives: B.parseSoulmark(SOUL1253) }],
    foeTeam: [{ pet: pet(2, '木桩'), combo, skills: [skill({ id: 21 })] }] });
}
console.log('— 3994 暴乱·格劳瑞：魂印解析 —');
{
  const sm = B.parseSoulmark(SOUL1253);
  ok(sm.some(x => x.kind === 'rageCrit' && x.first === 100 && x.extra === 50 && x.later === 50), '狂怒雷电：首次 100% 暴击 + 50% 百分比伤害，之后 50%');
  ok(sm.some(x => x.kind === 'rageHigh' && x.high === 50), '体力过半：伤害 +50%，先手翻倍');
  ok(sm.some(x => x.kind === 'rageLow' && x.low === 50), '体力不足：附加已损失体力 50% 百分比伤害，先手翻倍');
}
console.log('— 3994 登场暴击概率 —');
{
  const b = battle([skill()]);
  const me = b.me.team[0];
  eq(me.rageChance, 100, '首次登场：暴击概率 100%');
  me.rageUsed = true;
  b.onEnter(me);
  eq(me.rageChance, 50, '再次登场：暴击概率 50%');
}
console.log('— 3994 半血分支 —');
{
  const b = battle([skill({ id: 31, power: 60, category: { id: 1 } })]);
  const me = b.me.team[0];
  b.startOfTurn();
  ok(me.hpHalfHighB === true, '满血：判定为高体力分支');
  b.useSkill('me', 0, { isFirst: false });
  ok(Math.abs(me.damageBuff.mul - 1.5) < 1e-9, '高体力后手：伤害 ×1.5');
  const b2 = battle([skill({ id: 32, power: 60, category: { id: 1 } })]);
  b2.startOfTurn();
  b2.useSkill('me', 0, { isFirst: true });
  ok(Math.abs(b2.me.team[0].damageBuff.mul - 2) < 1e-9, '高体力先手：伤害 ×2');
}
console.log('— 3994 低体力附加伤害 —');
{
  const b = battle([skill({ id: 33, power: 40, category: { id: 1 } })]);
  const me = b.me.team[0], foe = b.foe.team[0];
  me.hp = Math.floor(me.maxHp / 2) - 100;
  b.startOfTurn();
  ok(me.hpHalfLowB === true, '低体力分支');
  const foeHp0 = foe.hp;
  b.useSkill('me', 0, { isFirst: false });
  ok(foeHp0 - foe.hp > 0, '低体力：命中后附加百分比伤害（对手掉血 ' + (foeHp0 - foe.hp) + '）');
}
console.log('— 3994 狂怒雷电 —');
{
  const b = battle([skill({ id: 34, power: 80, category: { id: 1 } })]);
  const me = b.me.team[0], foe = b.foe.team[0];
  const plain = battle([skill({ id: 35, power: 80, category: { id: 1 } })]);
  plain.me.team[0].rageChance = 0;
  const hpA = b.foe.team[0].hp, hpB = plain.foe.team[0].hp;
  b.useSkill('me', 0, { isFirst: true });
  plain.useSkill('me', 0, { isFirst: true });
  const dmgA = hpA - b.foe.team[0].hp, dmgB = hpB - plain.foe.team[0].hp;
  ok(dmgA > dmgB, '狂怒雷电暴击 + 附加伤害更高 (' + dmgB + ' → ' + dmgA + ')');
  eq(me.rageChance, 0, '触发后本次登场概率清零');
}
if (fails) { console.error('FAILED ' + fails); process.exit(1); }
console.log('ALL PASS');
