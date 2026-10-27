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
const SOUL847 = '首次出战登场时，自身无效对手下次攻击技能并消除对手的回合类效果，若消除成功则当回合开始时令对手害怕|回合开始时，若自身体力高于最大体力的1/2则以回合类效果的形式使自身当回合回合类效果无法被消除，若自身体力低于最大体力的1/2则当回合自身所有技能先制+1且战斗阶段结束时恢复自身最大体力的1/3（boss无效）';
function battle(meSkills) {
  return new B.Battle({ chart, comboOf: () => combo, rng: () => 0, level: 100,
    meTeam: [{ pet: pet(3541, '魔灵王·斯摩亚蒂'), combo, skills: meSkills, passives: B.parseSoulmark(SOUL847) }],
    foeTeam: [{ pet: pet(2, '木桩'), combo, skills: [skill({ id: 2, name: '撞击', power: 10, category: { id: 1 } })] }] });
}
console.log('— 3541 魔灵王·斯摩亚蒂：魂印解析 —');
{
  const sm = B.parseSoulmark(SOUL847);
  ok(sm.some(x => x.kind === 'firstEntryNullAttack'), '首次登场：无效对手下次攻击 + 断回合');
  ok(sm.some(x => x.kind === 'halfHpRoundLock'), '体力>1/2：回合效果不可消');
  const hh = sm.filter(x => x.kind === 'halfHpPrioHeal')[0];
  ok(!!hh && hh.prio === 1 && hh.num === 1 && hh.den === 3, '体力<1/2：先制+1 + 回合末回复 1/3');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0];
  ok(me.firstEntryNullAttack === true && me.halfHpRoundLock === true && !!me.halfHpPrioHeal, '魂印字段装载');
}
console.log('— 3541 实战 —');
{
  const b = battle([skill()]);
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.stages.atk = 3;
  foe.damageBuff = { turns: 2, mul: 2 };
  me.firstEntryUsed = false;
  b.onEnter(me);
  eq(foe.skillNull, 1, '登场：对手下次攻击技能无效');
  eq(foe.stages.atk, 3, '登场：只管断回合，不清对手强化');
  ok(!foe.damageBuff, '登场：消除对手回合类效果');
  ok(me.pendingFoeFear === true, '断回合成功 → 标记对手害怕');
  b.startOfTurn();
  ok(!!foe.status && foe.status.id === 'fear', '回合开始令对手害怕');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0];
  b.startOfTurn();
  ok((me.starRoundLock || 0) >= 1, '体力>1/2 → 回合效果不可消');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0];
  me.hp = Math.floor(me.maxHp * 0.3);
  b.startOfTurn();
  ok(!!me.priorityBuff && me.priorityBuff.value === 1, '体力<1/2 → 本回合先制+1');
  const hp0 = me.hp;
  const heal = Math.min(Math.floor(me.maxHp / 3), me.maxHp - me.hp);
  b.endOfTurn();
  eq(me.hp - hp0, heal, '回合末回复 1/3 最大体力');
}
if (fails) { console.error('FAILED ' + fails); process.exit(1); }
console.log('ALL PASS');
