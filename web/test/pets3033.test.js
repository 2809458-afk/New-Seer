/* 3033 帝天战佛：node test/pets3033.test.js */
global.self = global;
const B = require('../js/battle.js');

let fails = 0;
function ok(cond, msg) {
  if (cond) console.log('  ok  ' + msg);
  else { fails++; console.error('  FAIL ' + msg); }
}
function eq(a, b, msg) {
  ok(a === b, msg + ' (期望 ' + b + '，实际 ' + a + ')');
}
const combo = { id: 1, name: '草', primary: { id: 1 }, secondary: null };
const chart = { 1: { 1: 1 } };

function pet(id, name) {
  return { id, name, base_stats: { hp: 1000, atk: 140, def: 100, sp_atk: 100, sp_def: 100, spd: 100 } };
}
function skill(over) {
  return Object.assign({
    id: 1, name: '测试技能', power: 0, max_pp: 10, accuracy: 100, crit_rate: 0,
    priority: 0, must_hit: true, category: { id: 4 }, type: { id: 1 }, info: '', effects: []
  }, over || {});
}
const SOUL393 = '自身被击败后，吸取对手的能力提升状态并附加给下一只出战精灵，然后令对手所有技能PP归0并消除对手回合类效果（boss无效）';

function battle(meSkills, foeSkill, mePassives, extraMe) {
  const meTeam = [{ pet: pet(3033, '帝天战佛'), combo, skills: meSkills, passives: mePassives || [] }];
  if (extraMe) meTeam.push({ pet: pet(9999, '替补'), combo, skills: [skill()] });
  return new B.Battle({
    chart, comboOf: () => combo, rng: () => 0, level: 100,
    meTeam,
    foeTeam: [{ pet: pet(2, '木桩'), combo, skills: [foeSkill || skill()] }]
  });
}

console.log('— 3033 帝天战佛：魂印「渡」—');
{
  const sm = B.parseSoulmark(SOUL393);
  ok(sm.some(x => x.kind === 'dtzfSoul'), '魂印 393 解析为「渡」');
}
{
  const b = battle([skill()], null, B.parseSoulmark(SOUL393), true);
  ok(b.me.team[0].dtzfSoul === true, 'pet.id 3033 兜底开启「渡」');
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.stages.atk = 2;
  foe.stages.spd = 1;
  foe.skills[0].pp = 7;
  foe.damageBuff = { turns: 3, mul: 2 };
  me.hp = 0;
  b.checkFaints();
  b.endOfTurn();
  ok(b.log.some(x => /「渡」/.test(x)), '「渡」发动');
  eq(foe.stages.atk, 0, '「渡」吸取对手能力提升（攻击归 0）');
  eq(foe.damageBuff, null, '「渡」消除对手回合类效果');
  eq(foe.skills[0].pp, 0, '「渡」清空对手技能 PP');
  ok(b.dtzfCarry && b.dtzfCarry.me && b.dtzfCarry.me.atk === 2, '强化先记在己方待交接（2 级）');
  const sub = b.me.team[1];
  b.onEnter(sub);
  eq(sub.stages.atk, 2, '下一只登场精灵继承「渡」的强化');
  eq(sub.stages.spd, 1, '速度强化一并继承');
  ok(!b.dtzfCarry.me, '交接只发生一次');
}

console.log('— 渡世渡劫（24736）—');
{
  const sk = skill({ id: 24736, name: '渡世渡劫', effects: [
    { info: '全属性+1，自身满体力时强化效果翻倍' },
    { info: '3回合对手无法使自身能力出现提升状态' },
    { info: '5回合内免疫并反弹所有受到的异常状态' }
  ] });
  const b = battle([sk]);
  const me = b.me.team[0];
  b.step({ type: 'skill', index: 0 });
  eq(me.stages.atk, 2, '满体力：全属性 +2');
  eq(me.stages.spd, 2, '满体力：速度 +2');
  ok(b.foe.team[0].noStatUp > 0, '对手陷入无法提升能力（回合末先扣 1，引擎既有口径）');
  ok(me.immuneStatus > 0, '免疫所有异常状态');
  ok(me.reflectStatus === 5 || me.reflectStatus > 0, '异常状态反弹');
}
{
  const sk = skill({ id: 24736, name: '渡世渡劫', effects: [{ info: '全属性+1，自身满体力时强化效果翻倍' }] });
  const b = battle([sk]);
  const me = b.me.team[0];
  me.hp = me.maxHp - 1;
  b.step({ type: 'skill', index: 0 });
  eq(me.stages.atk, 1, '非满体力：全属性 +1');
}

console.log('— 不败之地（24737）—');
{
  const sk = skill({ id: 24737, name: '不败之地', effects: [
    { info: '4回合内每回合使用技能恢复自身最大体力的1/3' },
    { info: '2回合内免疫受到的致命一击伤害并直接扣除对手等量体力' },
    { info: '3回合内对手使用技能消耗的PP值变为2倍' }
  ] });
  const b = battle([sk]);
  const me = b.me.team[0], foe = b.foe.team[0];
  b.step({ type: 'skill', index: 0 });
  ok(me.immuneCritReflect > 0, '免疫致命一击伤害');
  ok(foe.ppCostMul && foe.ppCostMul.mul === 2, '对手 3 回合 PP 消耗 2 倍');
  const pp0 = foe.skills[0].pp;
  b.step({ type: 'skill', index: 0 });
  eq(pp0 - foe.skills[0].pp, 2, '对手使用技能消耗 2 点 PP');
}
{
  const atk = skill({ id: 9001, name: '必暴击', power: 60, category: { id: 1 } });
  const b = battle([atk]);
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.immuneCritReflect = 2;
  const foeHp0 = foe.hp, meHp0 = me.hp;
  me.guaranteeCrit = 1;
  b.step({ type: 'skill', index: 0 });
  eq(foe.hp, foeHp0, '致命一击伤害被完全免疫');
  ok(me.hp < meHp0, '出手方被直接扣除等量体力');
  ok(b.log.some(x => /免疫了致命一击伤害/.test(x)), '日志记录反噬');
}

console.log('— 佛晓跃金破（19286）/ 天地一念断（19285）—');
{
  const sk = skill({ id: 19286, name: '佛晓跃金破', power: 60, category: { id: 1 }, must_hit: true, effects: [
    { info: '使对手的能力提升效果转化到自己身上' },
    { info: '每次使用则当回合造成的攻击伤害额外提升30%，最高额外提升120%' },
    { info: '击败对手时若自身处于能力提升状态，则将所处的能力提升状态翻倍' }
  ] });
  const b = battle([sk]);
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.stages.atk = 2;
  b.step({ type: 'skill', index: 0 });
  ok(me.stages.atk >= 2, '吸强：对手攻击提升转到自身');
  eq(foe.stages.atk, 0, '对手攻击提升被转化走');
  eq(me.doubleStagesOnKill, true, '击败对手时强化翻倍已挂上');
  eq(me.rampInc > 0.29 && me.rampInc < 0.31, true, '每次使用威力额外 +30%');
  eq(me.rampCap, 1.2, '最高额外 +120%');
}
{
  const sk = skill({ id: 19285, name: '天地一念断', power: 60, category: { id: 1 }, must_hit: true,
    effects: [{ info: '给对手造成伤害时，伤害数值的100%恢复自身体力' }, { info: '自身处于能力提升状态时造成的伤害翻倍' }] });
  // 有强化时本次攻击伤害 ×2（不再挂成下一回合的持久 buff）
  const b1 = battle([sk]);
  const f1 = b1.foe.team[0];
  f1.maxHp = f1.hp = f1.stats.hp = 100000;
  const d1 = (function () { const h0 = f1.hp; b1.useSkill('me', 0, { isFirst: true }); return h0 - f1.hp; })();

  const b2 = battle([sk]);
  const m2 = b2.me.team[0], f2 = b2.foe.team[0];
  f2.maxHp = f2.hp = f2.stats.hp = 100000;
  m2.stages.atk = 1;
  const d2 = (function () { const h0 = f2.hp; b2.useSkill('me', 0, { isFirst: true }); return h0 - f2.hp; })();
  ok(d2 / d1 > 2.4, '有强化时本次伤害翻倍（无强化 ' + d1 + ' → 强化后 ' + d2 + '）');
  ok(!m2.damageBuff, '翻倍不会残留成下一回合的 buff');

  const b = battle([sk]);
  const me = b.me.team[0];
  me.stages.atk = 1;
  const hp0 = me.hp = Math.floor(me.maxHp / 2);
  b.step({ type: 'skill', index: 0 });
  ok(me.hp > hp0, '造成伤害后按 100% 回血');
}
{
  const kill = skill({ id: 9002, name: '击杀', power: 500, category: { id: 1 }, must_hit: true });
  const b = battle([kill]);
  const me = b.me.team[0], foe = b.foe.team[0];
  me.doubleStagesOnKill = true;
  me.stages.atk = 2;
  foe.hp = 1;
  b.step({ type: 'skill', index: 0 });
  eq(me.stages.atk, 4, '击败对手后自身能力提升翻倍');
}

console.log('— 佛祖光辉（24735）/ 金轮百转（19283）—');
{
  const sk = skill({ id: 24735, name: '佛祖光辉', effects: [
    { info: '100%令对手全属性-1' },
    { info: '降低对手所有PP一点，并恢复自身所有PP一点' }
  ] });
  const b = battle([sk]);
  const me = b.me.team[0], foe = b.foe.team[0];
  me.skills[0].pp = 5;
  foe.skills[0].pp = 5;
  b.step({ type: 'skill', index: 0 });
  eq(foe.stages.atk, -1, '对手全属性 -1');
  eq(foe.stages.spd, -1, '对手速度 -1');
  eq(foe.skills[0].pp, 3, '对手使用 1 点 PP 后再被扣 1 点');
  eq(me.skills[0].pp, 5, '自身所有 PP +1（扣 1 用 1 回 1）');
}
{
  const sk = skill({ id: 19283, name: '金轮百转', power: 60, category: { id: 1 }, effects: [
    { info: '无视伤害限制效果' }, { info: '无视攻击免疫效果' }
  ] });
  const fx = B.parseSkillEffects(sk);
  ok(fx.some(x => x.kind === 'ignoreGuards'), '金轮百转：无视伤害限制');
  ok(fx.some(x => x.kind === 'ignoreImmune'), '金轮百转：无视攻击免疫');
}

console.log('— 帝天圣战（19281）：断回合 + 害怕 —');
{
  const dsz = skill({ id: 19281, name: '帝天圣战', power: 80, category: { id: 1 }, must_hit: true,
    effects: [{ info: '消除对手回合类效果，消除成功则令对手害怕' }] });
  const b = battle([dsz]);
  const foe = b.foe.team[0];
  b.testRoundHeal('foe');
  foe.shield = 50;
  foe.critBuffTurns = 2;
  ok(!!foe.teHeal && foe.shield > 0, '先给对手挂上回合类效果');
  b.useSkill('me', 0, { isFirst: true });
  ok(!foe.teHeal, '「消除对手回合类效果」把回血效果清掉');
  eq(foe.shield, 0, '护盾也被清掉');
  eq(foe.critBuffTurns, 0, '必暴回合也被清掉');
  ok(!!foe.status && foe.status.id === 'fear', '消除成功后对手害怕');
}
{
  const dsz = skill({ id: 19281, name: '帝天圣战', power: 80, category: { id: 1 }, must_hit: true,
    effects: [{ info: '消除对手回合类效果，消除成功则令对手害怕' }] });
  const b = battle([dsz]);
  const foe = b.foe.team[0];
  ok(!foe.teHeal && !foe.shield, '对手没有任何回合类效果');
  b.useSkill('me', 0, { isFirst: true });
  ok(!foe.status, '没有回合效果可消时不触发害怕');
}

console.log('— 佛晓跃金破（19286）：当回合递增，换技能重头叠 —');
{
  const fxj = skill({ id: 19286, name: '佛晓跃金破', power: 160, category: { id: 1 }, must_hit: true, effects: [
    { info: '使对手的能力提升效果转化到自己身上' },
    { info: '每次使用则当回合造成的攻击伤害额外提升30%，最高额外提升120%' },
    { info: '击败对手时若自身处于能力提升状态，则将所处的能力提升状态翻倍' }
  ] });
  const zy = skill({ id: 20307, name: '战意', effects: [{ info: '技能使用成功时，100%改变自身防御等级+1' }] });
  const ct = skill({ id: 10086, name: '冲顶', power: 40, category: { id: 1 }, must_hit: true });
  const b = battle([fxj, zy, ct]);
  const foe = b.foe.team[0];
  foe.hp = foe.maxHp = 200000;
  function hit(i) { const before = foe.hp; b.step({ type: 'skill', index: i }); return before - foe.hp; }
  const d1 = hit(0), d2 = hit(0), d3 = hit(0), d4 = hit(0), d5 = hit(0), d6 = hit(0);
  ok(d1 > 0, '首次使用无增伤，基础伤害 ' + d1);
  ok(d2 > d1 && d3 > d2 && d4 > d3, '第二次起递增：' + d1 + ' → ' + d2 + ' → ' + d3 + ' → ' + d4);
  ok(Math.abs((d2 - d1) - (d3 - d2)) <= 1 && Math.abs((d3 - d2) - (d4 - d3)) <= 1,
    '每多用一次多一档（基础伤害的 30%，允许取整误差 1）');
  eq(d6, d5, '叠到 +120% 上限后不再提高 (期望 ' + d5 + '，实际 ' + d6 + ')');
  const r6 = d6 / d1;
  ok(Math.abs(r6 - 2.2) < 0.02, '上限为首次伤害的 2.2 倍（实际 ' + r6.toFixed(2) + '）');
  hit(1); // 战意：换成别的技能
  eq(b.me.team[0].rampUses, 0, '换技能后连击层数清零');
  const d7 = hit(0);
  eq(d7, d1, '再次使用回到无增伤的首发伤害');
  const d8 = hit(2);
  ok(d8 < d1 * 0.6, '别的技能不继承当回合增伤（冲顶 ' + d8 + '）');
}

console.log('— 效果编号直读（id 优先，文本兜底）—');
{
  function parse(id, args, info) {
    return B.parseSkillEffects(skill({ id: 1, power: 1, effects: [{ id: id, info: info || '', args: args }] }));
  }
  eq(parse(4, [5, 100, 1])[0].stat, 'acc', 'id 4：args[0]=5 → 命中等级');
  eq(parse(4, [1, 100, 1])[0].stat, 'def', 'id 4：args[0]=1 → 防御等级');
  ok(parse(889, []).some(f => f.kind === 'clearFoe'), 'id 889：断回合');
  ok(parse(889, [6]).some(f => f.kind === 'status' && f.statusId === 'fear' && f.req.type === 'clearSuccess'), 'id 889：消除成功才害怕（编号 6）');
ok(parse(889, [7]).some(f => f.kind === 'status' && f.statusId === 'tired'), 'id 889：编号 7 = 疲惫');
  eq(parse(765, [3])[0].turns, 3, 'id 765：锁强化回合数取 args');
  eq(parse(191, [5])[0].turns, 5, 'id 191：免疫并反弹异常回合数');
  eq(parse(57, [4, 3])[0].den, 3, 'id 57：用技能回血 1/3');
  eq(parse(440, [3, 2])[0].mul, 2, 'id 440：PP 消耗 ×2');
  ok(Math.abs(parse(795, [30, 120])[0].inc - 0.3) < 1e-9, 'id 795：递增 30%');
  eq(parse(893, [1]).filter(f => f.kind === 'stat').length, 5, 'id 893：全属性 +1');
  eq(parse(2, []).length, 1, 'id 2：低血威力加倍');
  eq(parse(9999, [], '技能使用成功时，100%改变自身命中等级+1')[0].stat, 'acc', '未收录 id：回退文本解析');
}
console.log(fails ? '\n' + fails + ' 项失败' : '\n全部通过');
process.exit(fails ? 1 : 0);
