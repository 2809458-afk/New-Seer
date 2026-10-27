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
const SOUL1555 = '每次登场首回合若对手处于能力提升状态则自身受到的攻击伤害降低50%且下回合对手属性技能失效，当回合战斗阶段结束时若双方全属性能力差值≥3开启倪克斯结界：下2回合对手攻击技能先制效果失效、下2回合自身攻击必定命中、2回合内每个战斗阶段结束时恢复自身所有技能1点PP值；|战斗阶段结束时若自身体力高于回合开始时则下回合攻击必定打出致命一击，战斗阶段结束时若自身体力等于回合开始时则下回合攻击技能先制+1，战斗阶段结束时若自身体力低于回合开始时则恢复自身最大体力的1/3（boss无效）';
function battle(meSkills) {
  return new B.Battle({ chart, comboOf: () => combo, rng: () => 0, level: 100,
    meTeam: [{ pet: pet(4329, '倪克斯'), combo, skills: meSkills, passives: B.parseSoulmark(SOUL1555) }],
    foeTeam: [{ pet: pet(2, '木桩'), combo, skills: [skill({ id: 21 })] }] });
}
console.log('— 4329 倪克斯：魂印解析 —');
{
  const sm = B.parseSoulmark(SOUL1555);
  ok(sm.some(x => x.kind === 'nyxEnter' && x.reduce === 50), '登场首回合：对手有强化则受到攻击伤害 -50%');
  ok(sm.some(x => x.kind === 'nyxField' && x.diff === 3 && x.turns === 2 && x.pp === 1), '倪克斯结界：差值≥3，2 回合，每回合回 1 PP');
  ok(sm.some(x => x.kind === 'nyxHpBranch' && x.equal === 1 && x.low === 3), '回合末三分支：高→必暴 / 等→先制+1 / 低→回 1/3');
}
console.log('— 4329 登场首回合 —');
{
  const b = battle([skill()]);
  const me = b.me.team[0], foe = b.foe.team[0];
  me.enterThisTurn = true;
  foe.stages.atk = 2;
  b.startOfTurn();
  ok(Math.abs((me.turnTakenMul || 1) - 0.5) < 1e-9, '对手有强化 → 本回合受到攻击伤害 ×0.5');
  eq(foe.pendingSkillBlock, 1, '下回合对手属性技能失效已排程');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.pendingSkillBlock = 1;
  b.endOfTurn();
  b.startOfTurn();
  eq(foe.skillBlock, 1, '下回合对手属性技能失效生效');
}
console.log('— 4329 回合末三分支 —');
{
  const b = battle([skill()]);
  const me = b.me.team[0];
  me.turnStartHp = me.hp - 100;
  b.endOfTurn();
  ok(me.critBuffTurns >= 1, '体力高于回合开始 → 下回合必暴');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0];
  me.turnStartHp = me.hp;
  b.endOfTurn();
  eq(me.pendingNextPrio, 1, '体力等于回合开始 → 下回合先制 +1');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0];
  me.hp = me.maxHp - 900;
  me.turnStartHp = me.hp + 300;
  const hp0 = me.hp;
  b.endOfTurn();
  ok(me.hp > hp0, '体力低于回合开始 → 回 1/3 体力');
}
console.log('— 4329 倪克斯结界 —');
{
  const b = battle([skill()]);
  const me = b.me.team[0], foe = b.foe.team[0];
  me.nyxFieldTurns = 2;
  foe.skills[0].pp = 5;
  me.skills[0].pp = 5;
  b.startOfTurn();
  ok(me.mustHitTurns >= 1, '结界：自身攻击必定命中');
  ok(foe.priorityDown && foe.priorityDown.value >= 10, '结界：对手攻击先制失效');
  b.endOfTurn();
  ok(me.skills[0].pp > 5, '结界：回合末恢复技能 PP');
}
if (fails) { console.error('FAILED ' + fails); process.exit(1); }
console.log('ALL PASS');
