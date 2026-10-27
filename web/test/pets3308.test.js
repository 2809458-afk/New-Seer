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
const SOUL635 = '自身不处于双防强化状态时免疫异常状态；若自身先出手则使对手随机1个技能的PP值归零，若自身后出手则附加自身双防能力值总和25%的固定伤害并恢复等量体力（BOSS无效）';
function battle(meSkills, foeSkill, rngv) {
  return new B.Battle({ chart, comboOf: () => combo, rng: () => (rngv == null ? 0 : rngv), level: 100,
    meTeam: [{ pet: pet(3308, '万世北溟·玄武'), combo, skills: meSkills, passives: B.parseSoulmark(SOUL635) }],
    foeTeam: [{ pet: pet(2, '木桩'), combo, skills: [foeSkill || skill({ id: 2, name: '撞击', power: 10, category: { id: 1 } })] }] });
}
console.log('— 3308 玄武：魂印解析 —');
{
  const sm = B.parseSoulmark(SOUL635);
  ok(sm.some(x => x.kind === 'immuneStatusIfNoDefUp'), '不处于双防强化时免疫异常');
  ok(sm.some(x => x.kind === 'prioPpZero' && x.count === 1), '先出手清 1 个技能 PP');
  ok(sm.some(x => x.kind === 'defFixedHeal' && x.pct === 25), '后出手按双防和 25% 附伤回血');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0];
  b.applyStatus(me, 'paralyze', 1, '对手');
  ok(!me.status, '无双防强化 → 免疫异常');
  me.stages.def = 1;
  b.applyStatus(me, 'paralyze', 1, '对手');
  ok(!!me.status && me.status.id === 'paralyze', '有双防强化 → 可以被挂异常');
}
console.log('— 3308 实战 —');
{
  const b = battle([skill({ id: 3, name: '攻击', power: 50, category: { id: 1 } })]);
  const me = b.me.team[0], foe = b.foe.team[0];
  me.stats.spd = 999;
  b.step({ type: 'skill', index: 0 });
  ok(b.log.some(x => /PP 归零/.test(x)), '先出手 → 对手随机技能 PP 归零');
  ok(foe.skills.some(x => x.pp === 0), '对手确有技能 PP 变成 0');
}
{
  const b = battle([skill({ id: 3, name: '攻击', power: 0, category: { id: 1 } })]);
  const me = b.me.team[0], foe = b.foe.team[0];
  me.stats.spd = 1; foe.stats.spd = 999;
  const dmg = Math.max(1, Math.floor((me.stats.def + me.stats.spDef) * 25 / 100));
  const hp0 = foe.hp;
  b.step({ type: 'skill', index: 0 });
  eq(hp0 - foe.hp, dmg, '后出手 → 按双防和 25% 附加固定伤害');
  ok(b.log.some(x => /魂印：附加/.test(x)), '后出手附伤日志');
}
{
  const b = battle([skill({ id: 24190, name: '圣灵之光', effects: [{ info: '3回合内对手使用攻击技能，则使对手随机1个技能的PP值归零' }] })]);
  const me = b.me.team[0], foe = b.foe.team[0];
  b.step({ type: 'skill', index: 0 });
  ok(!!me.ppZeroOnFoeAtk && me.ppZeroOnFoeAtk.turns >= 1, '圣灵之光：对手攻击则清 PP（' + (me.ppZeroOnFoeAtk ? me.ppZeroOnFoeAtk.turns : 0) + ' 回合）');
  b.step({ type: 'skill', index: 0 });
  ok(b.log.some(x => /护佑令/.test(x)), '对手用攻击技能 → PP 归零触发');
}
if (fails) { console.error('FAILED ' + fails); process.exit(1); }
console.log('ALL PASS');
