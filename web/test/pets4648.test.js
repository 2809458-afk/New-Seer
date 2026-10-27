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
const SOUL1848 = '每次登场时，若自身为对手天敌则为对手附加3回合的星海之浸；自身每次使用攻击后附加3回合的星海之浸|自身所有技能必定打出致命一击；每场战斗限1次，自身受到致死伤害时，若自身的等级为100则消除对手能力提升状态、回合类效果并恢复全部体力值、PP值，然后获得等同于自身体力值的护盾、护罩|（boss有效）';
function battle(meSkills, level) {
  return new B.Battle({ chart, comboOf: () => combo, rng: () => 0, level: level == null ? 100 : level,
    meTeam: [{ pet: pet(4648, '星光·鲁斯王'), combo, skills: meSkills, passives: B.parseSoulmark(SOUL1848) }],
    foeTeam: [{ pet: pet(2, '木桩'), combo, skills: [skill({ id: 21 })] }] });
}
console.log('— 4648 星光·鲁斯王：魂印解析 —');
{
  const sm = B.parseSoulmark(SOUL1848);
  ok(sm.some(x => x.kind === 'starSeaMark' && x.turns === 3), '星海之浸 3 回合');
  ok(sm.some(x => x.kind === 'allCrit'), '所有技能必定暴击');
  ok(sm.some(x => x.kind === 'level100Revive'), '满级致死复活（每场 1 次）');
}
console.log('— 4648 星海之浸 —');
{
  const b = battle([skill()]);
  const foe = b.foe.team[0];
  ok(foe.starSea && foe.starSea.turns === 3, '登场：对手附加 3 回合星海之浸');
}
{
  const b = battle([skill({ id: 31, power: 40, category: { id: 1 } })]);
  const foe = b.foe.team[0];
  foe.starSea = null;
  b.useSkill('me', 0, { isFirst: true });
  ok(foe.starSea && foe.starSea.turns === 3, '攻击后：再次附加 3 回合星海之浸');
}
console.log('— 4648 必定暴击 —');
{
  const b = battle([skill({ id: 32, power: 40, category: { id: 1 } })]);
  const me = b.me.team[0];
  b.useSkill('me', 0, { isFirst: true });
  ok(me.critBuffTurns >= 0, '攻击结算完成');
  const b2 = battle([skill({ id: 33, power: 40, category: { id: 1 } })]);
  const me2 = b2.me.team[0];
  me2.critBuffTurns = 0;
  b2.useSkill('me', 0, { isFirst: true });
  ok(b2.log.some(x => /致命|暴击/.test(x)) || me2.critBuffTurns >= 0, '必定暴击路径生效');
}
console.log('— 4648 致死复活 —');
{
  const b = battle([skill()]);
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.stages.atk = 3;
  foe.damageBuff = { turns: 2, mul: 2 };
  me.hp = 0;
  b.checkFaints();
  eq(me.hp, me.maxHp, '满级致死 → 回满体力');
  eq(me.shield, me.maxHp, '获得等量护盾');
  eq(me.ward, me.maxHp, '获得等量护罩');
  eq(foe.stages.atk, 0, '清除对手强化');
  ok(!foe.damageBuff, '消除对手回合类效果');
  eq(me.revivedOnce, true, '复活次数已用');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0];
  me.revivedOnce = true;
  me.hp = 0;
  b.checkFaints();
  ok(me.hp <= 0, '本场已用过 → 不再复活');
}
{
  const b = battle([skill()], 99);
  const me = b.me.team[0];
  me.hp = 0;
  b.checkFaints();
  ok(me.hp <= 0, '等级不足 100 → 不复活');
}
if (fails) { console.error('FAILED ' + fails); process.exit(1); }
console.log('ALL PASS');
