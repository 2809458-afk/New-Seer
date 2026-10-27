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
const SOUL822 = '自身攻击技能忽略对手双防值的25%，连续使用时效果提升10%，最高叠加至45%|回合开始时，若自身体力高于对手则自身当回合技能先制+1且直到本场战斗自身的下个回合开始，自身免疫受到的异常状态|战斗阶段结束时，若自身体力低于对手则吸取对手最大体力的1/3|（boss无效）';
const SOUL1646 = '自身使用攻击技能后获得1支灭神之箭|回合开始时，若自身体力高于对手则自身当回合技能先制+1且直到本场战斗自身的下个回合开始，自身免疫受到的异常状态|战斗阶段结束时，若自身体力低于对手则吸取对手最大体力的1/3|（boss无效）';
function battle(meSkills, sm) {
  return new B.Battle({ chart, comboOf: () => combo, rng: () => 0, level: 100,
    meTeam: [{ pet: pet(3514, '弑神猎皇'), combo, skills: meSkills, passives: B.parseSoulmark(sm || SOUL822) }],
    foeTeam: [{ pet: pet(2, '木桩'), combo, skills: [skill({ id: 2, name: '撞击', power: 10, category: { id: 1 } })] }] });
}
console.log('— 3514 弑神猎皇：魂印解析 —');
{
  const sm = B.parseSoulmark(SOUL822);
  const ig = sm.filter(x => x.kind === 'ignoreDefStack')[0];
  ok(!!ig && ig.base === 25 && ig.per === 10 && ig.cap === 45, '无视双防 25%，每次 +10%，上限 45%');
  ok(sm.some(x => x.kind === 'highHpPrioImmune' && x.prio === 1), '体力高：先制+1 且免疫异常');
  ok(sm.some(x => x.kind === 'endDrainIfLow' && x.num === 1 && x.den === 3), '体力低：回合末吸取 1/3');
  const sm2 = B.parseSoulmark(SOUL1646);
  ok(sm2.some(x => x.kind === 'arrowsOnAtk' && x.count === 1), '1646：攻击后获得 1 支灭神之箭');
  ok(sm2.some(x => x.kind === 'highHpPrioImmune'), '1646：同样有先制/免疫条');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0];
  eq(me.ignoreDefCur, 25, '初始无视双防 25%');
  ok(!!me.highHpPrioImmune && !!me.endDrainIfLow, '魂印字段装载');
}
console.log('— 3514 实战 —');
{
  const b = battle([skill({ id: 3, name: '攻击', power: 10, category: { id: 1 } })]);
  const me = b.me.team[0];
  b.step({ type: 'skill', index: 0 });
  eq(me.ignoreDefCur, 35, '第一次攻击后提升到 35%');
  b.step({ type: 'skill', index: 0 });
  eq(me.ignoreDefCur, 45, '第二次攻击后到上限 45%');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.hp = Math.floor(foe.maxHp * 0.5);
  b.startOfTurn();
  ok(!!me.priorityBuff && me.priorityBuff.value === 1, '体力高 → 本回合先制+1');
  ok(me.immuneStatus >= 1, '体力高 → 免疫异常');
  b.applyStatus(me, 'paralyze', 1, '对手');
  ok(!me.status, '免疫异常生效');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0], foe = b.foe.team[0];
  me.hp = Math.floor(me.maxHp * 0.3);
  foe.hp = foe.maxHp;
  const fhp0 = foe.hp, hp0 = me.hp;
  b.endOfTurn();
  ok(fhp0 - foe.hp === Math.floor(foe.maxHp / 3), '回合末吸取对手 1/3 最大体力（' + (fhp0 - foe.hp) + '）');
  eq(me.hp - hp0, fhp0 - foe.hp, '吸取量回复自身');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0], foe = b.foe.team[0];
  const sk = skill({ id: 6, name: '攻击', power: 80, category: { id: 1 } });
  const base = { actor: me, target: foe, skill: sk, level: 100, chart, skillCombo: combo, actorCombo: combo, targetCombo: combo, rng: () => 0.5 };
  me.ignoreDefCur = 0;
  const d0 = B.calcDamage(Object.assign({}, base)).damage;
  me.ignoreDefCur = 45;
  const d1 = B.calcDamage(Object.assign({}, base)).damage;
  ok(d1 > d0, '无视双防 45% 时伤害更高（' + d0 + ' → ' + d1 + '）');
}
if (fails) { console.error('FAILED ' + fails); process.exit(1); }
console.log('ALL PASS');
