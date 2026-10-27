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
const SOUL987 = '首次出战登场时获得4层自然祝福，之后每次登场时获得2层自然祝福|战斗阶段结束时，若当回合自身使用了技能则消耗1层自然祝福，若当回合自身未使用技能则获得1层自然祝福|（boss有效）';
function battle(meSkills) {
  return new B.Battle({ chart, comboOf: () => combo, rng: () => 0, level: 100,
    meTeam: [{ pet: pet(3711, '圣光莫妮卡'), combo, skills: meSkills, passives: B.parseSoulmark(SOUL987) }],
    foeTeam: [{ pet: pet(2, '木桩'), combo, skills: [skill({ id: 21 }), skill({ id: 22 }), skill({ id: 23 }), skill({ id: 24 }), skill({ id: 25 })] }] });
}
console.log('— 3711 圣光莫妮卡：自然祝福解析 —');
{
  const sm = B.parseSoulmark(SOUL987);
  ok(sm.some(x => x.kind === 'enterBless' && x.first === 4 && x.later === 2), '首次登场 4 层、之后 2 层');
  ok(sm.some(x => x.kind === 'blessTurnEnd'), '回合结束按是否使用技能增减层数');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0];
  me.bless = 0;
  me.blessEnterUsed = false;
  b.onEnter(me);
  eq(me.bless, 4, '首次登场 → 4 层');
  b.onEnter(me);
  eq(me.bless, 6, '再次登场 → +2 层');
  ok(me.blessTurnEnd === true, '回合结束规则装载');
}
console.log('— 3711 技能层数 —');
{
  const b = battle([skill({ id: 31, power: 150, category: { id: 1 }, info: '命中后获得1层自然祝福，若造成的伤害高于250则额外获得1层自然祝福' })]);
  const me = b.me.team[0];
  me.bless = 0;
  b.useSkill('me', 0, { isFirst: true });
  ok(me.bless >= 1, '攻击命中获得自然祝福（至少 1 层）');
}
{
  const b = battle([skill({ id: 32, info: '自身获得2层自然祝福' })]);
  const me = b.me.team[0];
  me.bless = 1;
  b.useSkill('me', 0, { isFirst: true });
  eq(me.bless, 3, '技能获得 2 层自然祝福');
}
{
  const b = battle([skill({ id: 33, info: '消耗自身所有自然祝福，每消耗1层则随机令对手1个技能PP值归零' })]);
  const me = b.me.team[0], foe = b.foe.team[0];
  me.bless = 3;
  b.useSkill('me', 0, { isFirst: true });
  eq(me.bless, 0, '消耗全部自然祝福');
  eq(foe.skills.filter(x => x.pp === 0).length, 3, '每层令对手 1 个技能 PP 归零');
}
console.log('— 3711 回合结束 —');
{
  const b = battle([skill({ id: 34, info: '当回合击败对手则回合结束时损失1层自然祝福' })]);
  const me = b.me.team[0];
  me.bless = 3;
  me.actedThisTurn = true;
  b.actedThisTurn = true;
  b.endOfTurn();
  eq(me.bless, 2, '使用技能 → 回合结束消耗 1 层');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0];
  me.bless = 3;
  b.endOfTurn();
  eq(me.bless, 4, '未使用技能 → 回合结束获得 1 层');
}
if (fails) { console.error('FAILED ' + fails); process.exit(1); }
console.log('ALL PASS');
