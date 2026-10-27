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
const SOUL535 = '攻击技能35%使对手睡眠，未触发则自身特攻+1、速度+1且有50%的概率消除对手回合类效果；攻击技能命中睡眠中的对手时，附加自身最大体力1/3的固定伤害（boss无效）';
const SOUL548 = '攻击技能40%使对手睡眠，未触发则自身特攻+1、速度+1且有60%的概率消除对手回合类效果；攻击技能命中睡眠中的对手时，附加自身最大体力1/3的固定伤害（boss无效）';
function battle(meSkills, foeSkill, sm, rngv) {
  return new B.Battle({ chart, comboOf: () => combo, rng: () => (rngv == null ? 0 : rngv), level: 100,
    meTeam: [{ pet: pet(3205, '王·缪斯'), combo, skills: meSkills, passives: B.parseSoulmark(sm || SOUL535) }],
    foeTeam: [{ pet: pet(2, '木桩'), combo, skills: [foeSkill || skill({ id: 2, name: '撞击', power: 10, category: { id: 1 } })] }] });
}
console.log('— 3205 王·缪斯：魂印解析 —');
{
  const sm = B.parseSoulmark(SOUL535);
  const ase = sm.filter(x => x.kind === 'atkStatusElse')[0];
  ok(!!ase && ase.statusId === 'sleep' && ase.chance === 35, '35% 睡眠');
  ok(ase.stats.length === 2 && ase.stats[0].stat === 'spAtk' && ase.stats[1].stat === 'spd', '未触发强化特攻+1/速度+1');
  eq(ase.clearChance, 50, '50% 断回合');
  const hf = sm.filter(x => x.kind === 'hitStatusFixed')[0];
  ok(!!hf && hf.statusId === 'sleep' && hf.num === 1 && hf.den === 3, '命中睡眠目标附加 1/3 最大体力固伤');
  eq(B.parseSoulmark(SOUL548).filter(x => x.kind === 'atkStatusElse')[0].chance, 40, '548：40% 睡眠');
}
{
  const b = battle([skill({ id: 3, name: '攻击', power: 50, category: { id: 1 } })]);
  ok(!!b.me.team[0].atkStatusElse && !!b.me.team[0].hitStatusFixed, '魂印字段装载');
}
console.log('— 3205 实战 —');
{
  const b = battle([skill({ id: 3, name: '攻击', power: 50, category: { id: 1 } })], null, null, 0);
  const foe = b.foe.team[0];
  b.step({ type: 'skill', index: 0 });
  ok(b.log.some(x => /睡眠/.test(x)) || (!!foe.status && foe.status.id === 'sleep'), '35% 触发 → 对手睡眠');
}
{
  const b = battle([skill({ id: 3, name: '攻击', power: 50, category: { id: 1 } })], null, null, 0.99);
  const me = b.me.team[0], foe = b.foe.team[0];
  b.step({ type: 'skill', index: 0 });
  ok(!foe.status || foe.status.id !== 'sleep', '0.99 → 不触发睡眠');
  ok(me.stages.spAtk >= 1 && me.stages.spd >= 1, '未触发 → 特攻/速度 +1');
}
{
  const b = battle([skill({ id: 3, name: '攻击', power: 0, category: { id: 1 } })]);
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.status = { id: 'sleep', turns: 3 };
  b.step({ type: 'skill', index: 0 });
  eq(foe.maxHp - foe.hp, Math.floor(me.maxHp / 3), '命中睡眠目标附加 1/3 最大体力固伤');
}
{
  const b = battle([skill({ id: 3, name: '攻击', power: 0, category: { id: 1 } })]);
  const foe = b.foe.team[0];
  b.step({ type: 'skill', index: 0 });
  eq(foe.maxHp - foe.hp, 0, '目标未睡眠 → 不加固定伤害');
}
if (fails) { console.error('FAILED ' + fails); process.exit(1); }
console.log('ALL PASS');
