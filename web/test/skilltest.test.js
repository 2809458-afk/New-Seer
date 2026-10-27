global.self = global;
const B = require('../js/battle.js');
let fails = 0;
function ok(cond, msg) { if (cond) console.log('  ok  ' + msg); else { fails++; console.error('  FAIL ' + msg); } }
function eq(a, b, msg) { ok(a === b, msg + ' (期望 ' + b + '，实际 ' + a + ')'); }
const combo = { id: 1, name: '草', primary: { id: 1 }, secondary: null };
const chart = { 1: { 1: 1 } };
function pet(id, name) { return { id, name, base_stats: { hp: 1000, atk: 140, def: 100, sp_atk: 100, sp_def: 100, spd: 100 } }; }
function skill(over) {
  return Object.assign({ id: 1, name: '撞击', power: 10, max_pp: 10, accuracy: 100, crit_rate: 0,
    priority: 0, must_hit: true, category: { id: 1 }, type: { id: 1 }, info: '', effects: [] }, over || {});
}
function mk(myCount, foeCount) {
  const me = [], foe = [];
  for (let i = 0; i < (myCount || 1); i++) me.push({ pet: pet(9001 + i, '我方'), combo, skills: [skill({ id: 11 })] });
  for (let j = 0; j < (foeCount || 2); j++) foe.push({ pet: pet(1, '布布种子'), combo, skills: [skill({ id: 12 })] });
  return new B.Battle({ chart, comboOf: () => combo, rng: () => 0, level: 100, meTeam: me, foeTeam: foe });
}

console.log('— 回合类效果（每回合回 1/3，持续 3 回合）—');
{
  const b = mk();
  const me = b.activeOf('me');
  me.hp = me.maxHp - 2000;
  ok(b.testRoundHeal('me') === true, 'testRoundHeal 返回 true');
  eq(me.teHeal.turns, 3, '默认持续 3 回合');
  eq(me.teHeal.pct.toFixed(4), (1 / 3).toFixed(4), '每回合回 1/3');
  const before = me.hp;
  b.endOfTurn();
  eq(me.hp - before, Math.floor(me.maxHp / 3), '第 1 回合结束回复 1/3');
  eq(me.teHeal.turns, 2, '剩余 2 回合');
}
{
  const b = mk();
  const me = b.activeOf('me');
  me.hp = me.maxHp - 2000;
  b.testRoundHeal('me');
  const hp1 = me.hp;
  b.endOfTurn(); const d1 = me.hp - hp1;
  b.endOfTurn(); const d2 = me.hp - hp1 - d1;
  b.endOfTurn(); const d3 = me.hp - hp1 - d1 - d2;
  ok(d1 > 0 && d2 > 0 && d3 > 0, '连续 3 回合都回血（' + d1 + '/' + d2 + '/' + d3 + '）');
  ok(!me.teHeal, '3 回合后效果自动结束');
  const hpAfter = me.hp;
  b.endOfTurn();
  eq(me.hp, hpAfter, '结束后不再回血');
}
{
  const b = mk();
  const me = b.activeOf('me');
  me.hp = me.maxHp - 2000;
  b.testRoundHeal('me', 1);
  eq(me.teHeal.turns, 1, '可指定回合数 1');
  b.endOfTurn();
  ok(!me.teHeal, '1 回合后消失');
  const hpAfter = me.hp;
  b.endOfTurn();
  eq(me.hp, hpAfter, '之后不再回血');
}
{
  const b = mk();
  const me = b.activeOf('me');
  me.hp = me.maxHp - 2000;
  b.testRoundHeal('me');
  const n = b.testClearRound('me');
  ok(n >= 1, '消除回合类效果返回数量（' + n + '）');
  ok(!me.teHeal, 'teHeal 已被清除');
  const before = me.hp;
  b.endOfTurn();
  eq(me.hp, before, '清除后回合结束不再回血');
}
{
  const b = mk();
  const foe = b.activeOf('foe');
  foe.hp = foe.maxHp - 2000;
  b.testRoundHeal('foe');
  eq(foe.teHeal.turns, 3, '对手侧同样 3 回合');
  const before = foe.hp;
  b.endOfTurn();
  eq(foe.hp - before, Math.floor(foe.maxHp / 3), '对手侧同样回复');
}

console.log('— 自爆（按被击败结算）—');
{
  const b = mk(1, 3);
  ok(b.testForceFaint('foe') === true, '敌方自爆成功');
  eq(b.foe.team[0].hp, 0, '对手 1 号体力归零');
  eq(b.foe.active, 1, '对手自动换上下一只');
  ok(!b.over, '战斗继续');
  eq(b.foe.team[1].hp, b.foe.team[1].maxHp, '新上场精灵满血');
}
{
  const b = mk(2, 2);
  ok(b.testForceFaint('me') === true, '我方自爆成功');
  eq(b.me.team[0].hp, 0, '我方 1 号体力归零');
  ok(b.needPlayerSwitch === true, '需要我方手动换人');
  ok(!b.over, '还有其他精灵，战斗不结束');
}
{
  const b = mk(1, 2);
  b.testForceFaint('me');
  ok(b.over === true, '我方全灭 → 战斗结束');
  eq(b.winner, 'foe', '判定为对方获胜');
}
{
  const b = mk(1, 2);
  const foe = b.activeOf('foe');
  foe.hp = 0;
  ok(b.testForceFaint('foe') === false, '已倒下的精灵不能重复自爆');
}

console.log('— 全属性 ±1 —');
{
  const b = mk();
  const me = b.activeOf('me');
  b.testShiftStats('me', 1);
  eq(me.stages.atk, 1, '攻击 +1');
  eq(me.stages.spd, 1, '速度 +1');
  eq(me.stages.acc, 1, '命中 +1');
  b.testShiftStats('me', -1);
  eq(me.stages.atk, 0, '回到 0');
  for (let i = 0; i < 8; i++) b.testShiftStats('me', -1);
  eq(me.stages.atk, -6, '下限 -6');
  for (let i = 0; i < 14; i++) b.testShiftStats('me', 1);
  eq(me.stages.atk, 6, '上限 +6');
}
{
  const b = mk();
  const foe = b.activeOf('foe');
  b.testShiftStats('foe', 1);
  eq(foe.stages.spDef, 1, '对手侧全属性 +1');
}


console.log('— 被击败后的待结算效果（3033 渡）—');
const SOUL393 = '自身被击败后，吸取对手的能力提升状态并附加给下一只出战精灵，然后令对手所有技能PP归0并消除对手回合类效果（boss无效）';
{
  const b = new B.Battle({ chart, comboOf: () => combo, rng: () => 0, level: 100,
    meTeam: [{ pet: pet(3033, '帝天战佛'), combo, skills: [skill({ id: 21 })], passives: B.parseSoulmark(SOUL393) }],
    foeTeam: [{ pet: pet(1, '布布种子'), combo, skills: [skill({ id: 22 })] }] });
  const me = b.activeOf('me'), foe = b.activeOf('foe');
  foe.stages.atk = 2;
  foe.stages.spd = 1;
  b.testRoundHeal('foe', 3);
  ok(!!foe.teHeal, '先给对手挂上回合类效果');
  b.testForceFaint('me');
  ok(!foe.teHeal, '自爆后「渡」消除对手回合类效果');
  eq(foe.stages.atk, 0, '「渡」吸取对手攻击强化');
  ok(foe.skills.every(s => s.pp === 0), '「渡」令对手所有技能 PP 归 0');
}


console.log('— 3033 天地一念断：有强化才翻倍 —');
const skill19285 = { id: 19285, name: '天地一念断', power: 150, max_pp: 5, accuracy: 100, crit_rate: 0,
  priority: 0, must_hit: true, category: { id: 1 }, type: { id: 1 },
  effects: [{ info: '给对手造成伤害时，伤害数值的100%恢复自身体力' }, { info: '自身处于能力提升状态时造成的伤害翻倍' }] };
const skill24737 = { id: 24737, name: '不败之地', power: 0, max_pp: 5, accuracy: 100, crit_rate: 0,
  priority: 0, must_hit: true, category: { id: 4 }, type: { id: 1 },
  effects: [{ info: '4回合内每回合使用技能恢复自身最大体力的1/3' },
    { info: '2回合内免疫受到的致命一击伤害并直接扣除对手等量体力' },
    { info: '3回合内对手使用技能消耗的PP值变为2倍' }] };
{
  const fx = B.parseSkillEffects(skill19285);
  ok(fx.some(e => e.kind === 'damageBuff' && e.mul === 2 && e.req && e.req.type === 'selfStatUp'), '「有强化时翻倍」解析为条件增伤');
}
{
  const fxb = B.parseSkillEffects(skill24737);
  ok(fxb.some(e => e.kind === 'useHeal' && e.turns === 4 && e.num === 1 && e.den === 3), '不败之地：4 回合用技能回血 1/3');
  ok(fxb.some(e => e.kind === 'immuneCritReflect' && e.turns === 2), '不败之地：2 回合免致命并反噬');
  ok(fxb.some(e => e.kind === 'ppCostMul' && e.turns === 3 && e.mul === 2), '不败之地：3 回合 PP 消耗 ×2');
}
function dmgOf(withStage) {
  const b = new B.Battle({ chart, comboOf: () => combo, rng: () => 0, level: 100,
    meTeam: [{ pet: pet(3033, '帝天战佛'), combo, skills: [skill19285] }],
    foeTeam: [{ pet: pet(1, '布布种子'), combo, skills: [skill({ id: 99 })] }] });
  const me = b.activeOf('me'), foe = b.activeOf('foe');
  foe.maxHp = foe.hp = foe.stats.hp = 100000;
  if (withStage) ['atk', 'def', 'spAtk', 'spDef', 'spd'].forEach(k => { me.stages[k] = 1; });
  const hp0 = foe.hp;
  b.useSkill('me', 0, { isFirst: true });
  return hp0 - foe.hp;
}
{
  const noStage = dmgOf(false);
  const withStage = dmgOf(true);
  ok(noStage > 0, '无强化时造成伤害 ' + noStage);
  const ratio = withStage / noStage;
  ok(ratio > 2.6 && ratio < 3.4, '全属性+1 后伤害≈3 倍（能力 1.5 × 翻倍 2 = ' + ratio.toFixed(2) + '）');
}
console.log('— 3033 不败之地：回合效果 —');
{
  const b = new B.Battle({ chart, comboOf: () => combo, rng: () => 0, level: 100,
    meTeam: [{ pet: pet(3033, '帝天战佛'), combo, skills: [skill24737] }],
    foeTeam: [{ pet: pet(1, '布布种子'), combo, skills: [skill({ id: 99 })] }] });
  const me = b.activeOf('me'), foe = b.activeOf('foe');
  me.hp = 200;
  b.useSkill('me', 0, { isFirst: true });
  ok(!!me.teUseHeal && me.teUseHeal.turns === 4, '挂上 4 回合用技能回血');
  ok(me.hp > 200, '施放当回合就回复了体力（' + me.hp + '）');
  ok(me.immuneCritReflect === 2, '2 回合免致命并反噬');
  ok(!!foe.ppCostMul && foe.ppCostMul.mul === 2 && foe.ppCostMul.turns === 3, '对手 3 回合内 PP 消耗 ×2');
  const snap = b.snapshot();
  const effMe = snap.me.team[0].effects.map(e => e.text).join('|');
  const effFoe = snap.foe.team[0].effects.map(e => e.text).join('|');
  ok(effMe.indexOf('用技能回血33%') >= 0, '我方状态栏显示用技能回血：' + effMe);
  ok(effMe.indexOf('免致命反噬') >= 0, '我方状态栏显示免致命反噬：' + effMe);
  ok(effFoe.indexOf('PP消耗×2') >= 0, '对手状态栏显示 PP 消耗 ×2：' + effFoe);
  for (let i = 0; i < 4; i++) b.endOfTurn();
  ok(!me.teUseHeal, '4 回合后自动结束');
  ok(!foe.ppCostMul, 'PP 消耗 ×2 结束后清空');
}


console.log('— 害怕：随机 1~2 回合无法行动 —');
{
  const b = new B.Battle({ chart, comboOf: () => combo, rng: () => 0, level: 100,
    meTeam: [{ pet: pet(9001, '我方'), combo, skills: [skill({ id: 1 })] }],
    foeTeam: [{ pet: pet(1, '布布种子'), combo, skills: [skill({ id: 2 })] }] });
  const foe = b.activeOf('foe');
  b.applyStatus(foe, 'fear', 1);
  ok(foe.status && foe.status.id === 'fear', '陷入害怕');
  ok(foe.status.turns === 2, 'rng 偏低时害怕 2 回合（实际 ' + foe.status.turns + '）');
}
{
  const b = new B.Battle({ chart, comboOf: () => combo, rng: () => 0.9, level: 100,
    meTeam: [{ pet: pet(9001, '我方'), combo: combo, skills: [skill({ id: 1 })] }],
    foeTeam: [{ pet: pet(1, '布布种子'), combo, skills: [skill({ id: 2 })] }] });
  const foe = b.activeOf('foe');
  b.applyStatus(foe, 'fear', 1);
  ok(foe.status.turns === 1, 'rng 偏高时害怕 1 回合（实际 ' + foe.status.turns + '）');
}
{
  const b = new B.Battle({ chart, comboOf: () => combo, rng: () => 0, level: 100,
    meTeam: [{ pet: pet(9001, '我方'), combo, skills: [skill({ id: 1 })] }],
    foeTeam: [{ pet: pet(1, '布布种子'), combo, skills: [skill({ id: 2 })] }] });
  const foe = b.activeOf('foe');
  b.applyStatus(foe, 'fear', 1);
  b.step({ type: 'skill', index: 0 });
  ok(b.log.some(l => l.indexOf('因害怕无法行动') >= 0), '害怕当回合就不让对手行动');
}

console.log('— 「无法使自身能力出现提升」—');
{
  const dsj = { id: 24736, name: '渡世渡劫', power: 0, max_pp: 5, accuracy: 100, crit_rate: 0,
    priority: 0, must_hit: true, category: { id: 4 }, type: { id: 1 },
    effects: [{ info: '全属性+1，自身满体力时强化效果翻倍' },
      { info: '3回合对手无法使自身能力出现提升状态' },
      { info: '5回合内免疫并反弹所有受到的异常状态' }] };
  const up = { id: 77, name: '强化', power: 0, max_pp: 9, accuracy: 100, crit_rate: 0, priority: 0,
    must_hit: true, category: { id: 4 }, type: { id: 1 }, effects: [{ info: '自身攻击+1' }] };
  const b = new B.Battle({ chart, comboOf: () => combo, rng: () => 0, level: 100,
    meTeam: [{ pet: pet(3033, '帝天战佛'), combo, skills: [dsj] }],
    foeTeam: [{ pet: pet(1, '布布种子'), combo, skills: [up] }] });
  const foe = b.activeOf('foe');
  b.useSkill('me', 0, { isFirst: true });
  ok(foe.noStatUp >= 3, '被施加 3 回合「无法提升能力」（实际 ' + foe.noStatUp + '）');
  b.useSkill('foe', 0, { isFirst: false });
  eq(foe.stages.atk, 0, '对手强化技能被挡下');
  const eff = b.snapshot().foe.team[0].effects.map(e => e.text).join('|');
  ok(eff.indexOf('锁强化(3)') >= 0, '状态栏显示锁强化：' + eff);
}

console.log(fails ? ('FAILED ' + fails) : 'ALL OK');
process.exit(fails ? 1 : 0);
