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
const SOUL772 = '回合开始时若自身体力高于对手则令自身随机2项能力值+1并附加给对手相同属性的能力下降；|回合开始时若自身体力低于对手则当回合受到的攻击伤害额外减少1/3，且直至本场战斗结束，自身受到的固定伤害和百分比伤害将持续减少1/3；|自身首次使用攻击技能则出手流程结束时70%令对手失明，之后每次使用概率提升10%，最高提升至100%，未触发则消除对手回合类效果且令自身下回合造成的攻击伤害提升100%|（固定伤害和百分比伤害减免效果下场后保留，失明概率提升效果下场不保留，所有特效boss无效）';
function battle(meSkills, rngv) {
  return new B.Battle({ chart, comboOf: () => combo, rng: () => (rngv == null ? 0 : rngv), level: 100,
    meTeam: [{ pet: pet(3456, '圣光·斯嘉丽'), combo, skills: meSkills, passives: B.parseSoulmark(SOUL772) }],
    foeTeam: [{ pet: pet(2, '木桩'), combo, skills: [skill({ id: 2, name: '撞击', power: 10, category: { id: 1 } })] }] });
}
function sumStages(c) { return Object.keys(c.stages).reduce(function (a, k) { return a + c.stages[k]; }, 0); }
console.log('— 3456 圣光·斯嘉丽：魂印解析 —');
{
  const sm = B.parseSoulmark(SOUL772);
  ok(sm.some(x => x.kind === 'randomUpFoeDown' && x.count === 2 && x.stages === 1), '体力高：随机 2 项 +1 并给对手同项 -1');
  ok(sm.some(x => x.kind === 'lowHpExtraReduce' && x.num === 1 && x.den === 3), '体力低：当回合额外减伤 1/3');
  ok(sm.some(x => x.kind === 'fixedPctPersistReduce' && x.num === 1 && x.den === 3), '固伤/百分比伤害永久减 1/3');
  const bs = sm.filter(x => x.kind === 'blindStack')[0];
  ok(!!bs && bs.base === 70 && bs.per === 10 && bs.cap === 100 && bs.missBuffPct === 100, '失明 70% 起、每次 +10%、上限 100%');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0];
  ok(!!me.randomUpFoeDown && !!me.blindStack && Math.abs(me.fixedPctPersistMul - 2 / 3) < 1e-9, '魂印字段装载');
}
console.log('— 3456 实战 —');
{
  const b = battle([skill()]);
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.hp = Math.floor(foe.maxHp * 0.5);
  b.startOfTurn();
  eq(sumStages(me), 2, '体力高：自身合计 +2 级');
  eq(sumStages(foe), -2, '体力高：对手合计 -2 级');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0], foe = b.foe.team[0];
  me.hp = Math.floor(me.maxHp * 0.3);
  b.startOfTurn();
  ok(Math.abs(me.turnTakenMul - 2 / 3) < 1e-9, '体力低：当回合攻击伤害额外 ×2/3');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0];
  eq(b.directDamage(me, 300, 'fixed'), 200, '固伤 300 被永久减到 200');
  eq(b.directDamage(me, 300, 'percent'), 200, '百分比 300 被永久减到 200');
}
{
  const b = battle([skill({ id: 3, name: '攻击', power: 0, category: { id: 1 } })], 0);
  const me = b.me.team[0];
  b.step({ type: 'skill', index: 0 });
  ok(b.log.some(x => /失明/.test(x)), '首次攻击 70% 触发失明');
  eq(me.blindStackChance, 80, '失明概率提升到 80%');
}
{
  const b = battle([skill({ id: 3, name: '攻击', power: 0, category: { id: 1 } })], 0.99);
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.damageBuff = { turns: 3, mul: 2 };
  b.step({ type: 'skill', index: 0 });
  ok(!foe.damageBuff, '未触发失明 → 消除对手回合类效果');
  ok(!!me.damageBuff && me.damageBuff.mul === 2, '未触发失明 → 下回合攻击伤害提升 100%');
}
if (fails) { console.error('FAILED ' + fails); process.exit(1); }
console.log('ALL PASS');
