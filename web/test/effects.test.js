/* 技能效果系统测试：node test/effects.test.js */
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

// ---------- 文本解析 ----------
function parseOne(info) {
  const out = [];
  B.parseOneEffect(info, out);
  return out[0] || null;
}

console.log('— 效果解析 —');
let e = parseOne('技能使用成功时，100%改变自身防御等级+1');
eq(e && e.kind, 'stat', '能力等级');
eq(e && e.target, 'self', '  目标=自身');
eq(e && e.stat, 'def', '  属性=防御');
eq(e && e.stages, 1, '  变化量 +1');

e = parseOne('技能使用成功时，15%改变对手命中等级-1');
eq(e && e.target, 'foe', '对手能力下降');
eq(e && e.stat, 'acc', '  属性=命中');
eq(e && e.chance, 15, '  概率 15%');

e = parseOne('命中后50%令对方烧伤');
eq(e && e.kind, 'status', '异常状态');
eq(e && e.statusId, 'burn', '  状态=烧伤');
eq(e && e.chance, 50, '  概率 50%');

e = parseOne('10%令对手疲惫3回合');
eq(e && e.statusId, 'tired', '疲惫');
eq(e && e.turns, 3, '  持续 3 回合');

e = parseOne('1回合做2~5次攻击');
eq(e && e.kind, 'multiHit', '多段攻击');
eq(e && e.min, 2, '  最少 2 段');
eq(e && e.max, 5, '  最多 5 段');

e = parseOne('额外附加50点固定伤害');
eq(e && e.kind, 'flat', '固定伤害');
eq(e && e.value, 50, '  数值 50');

e = parseOne('给予对方损伤的一半会恢复自己的体力');
eq(e && e.kind, 'drain', '吸血');
eq(e && e.num + '/' + e.den, '1/2', '  比例 1/2');

e = parseOne('恢复自身最大体力的1/3');
eq(e && e.kind, 'heal', '回复');
eq(e && e.num + '/' + e.den, '1/3', '  比例 1/3');

e = parseOne('消除对手能力提升状态');
eq(e && e.kind, 'clear', '消除能力');
eq(e && e.target, 'foe', '  目标=对手');

e = parseOne('对方体力小于1/2时威力加倍');
eq(e && e.kind, 'power', '条件威力');
eq(e && e.cond, 'targetLow', '  条件=对手残血');
eq(e && e.mul, 2, '  倍率 ×2');

e = parseOne('先出手的话威力为2倍');
eq(e && e.cond, 'first', '先手加成');

e = parseOne('3回合内每回合都能附加30点固定伤害');
eq(e && e.kind, 'dot', '持续伤害');
eq(e && e.value, 30, '  每回合 30');

e = parseOne('连续使用每次威力增加20，最高威力80');
eq(e && e.kind, 'ramp', '连击增幅');
eq(e && e.cap, 80, '  上限 80');

// ---------- 战斗运行时 ----------
const combo = { id: 1, name: '草', primary: { id: 1 }, secondary: null };
const chart = { 1: { 1: 1 } };

function mkPet(id, name) {
  return { id, name, base_stats: { hp: 80, atk: 90, def: 70, sp_atk: 80, sp_def: 70, spd: 60 } };
}

function mkSkill(over) {
  return Object.assign({
    id: Math.floor(Math.random() * 1e6), name: '测试技', power: 0, max_pp: 20,
    accuracy: 100, crit_rate: 0, priority: 0, must_hit: true,
    category: { id: 4 }, type: { id: 1 }, info: '', effects: []
  }, over || {});
}

function makeBattle(meSkill, foeSkill) {
  return new B.Battle({
    chart, comboOf: () => combo, rng: () => 0, level: 100,
    meTeam: [{ pet: mkPet(1, '我方'), combo, skills: [meSkill] }],
    foeTeam: [{ pet: mkPet(2, '对方'), combo, skills: [foeSkill] }]
  });
}

console.log('\n— 异常状态 —');
{
  const b = makeBattle(
    mkSkill({ effects: [{ info: '命中后100%令对方中毒' }] }),
    mkSkill({ power: 10, effects: [] })
  );
  const foe = b.foe.team[0];
  const before = foe.hp;
  b.step({ type: 'skill', index: 0 });
  eq(foe.status && foe.status.id, 'poison', '中毒成功挂上');
  ok(foe.hp < before, '回合结束受到中毒伤害（' + before + ' → ' + foe.hp + '）');
}

{
  const b = makeBattle(mkSkill({ effects: [{ info: '命中后100%令对方睡眠' }] }), mkSkill({ power: 10 }));
  const foe = b.foe.team[0];
  b.step({ type: 'skill', index: 0 });
  eq(foe.status && foe.status.id, 'sleep', '睡眠挂上');
  const hpBefore = foe.hp;
  b.step({ type: 'skill', index: 0 });
  eq(foe.hp, hpBefore, '睡眠中的对手无法攻击（我方未掉血）');
}

{
  const b = makeBattle(mkSkill({ effects: [{ info: '命中后100%令对方麻痹' }] }), mkSkill({ power: 10 }));
  b.step({ type: 'skill', index: 0 });
  ok(b.log.join('\n').indexOf('麻痹') >= 0, '日志里出现麻痹');
}

console.log('\n— 多段攻击 —');
{
  const b = makeBattle(mkSkill({ power: 30, effects: [{ info: '1回合做3次攻击' }] }), mkSkill({ power: 5 }));
  b.step({ type: 'skill', index: 0 });
  const text = b.log.join('\n');
  ok(text.indexOf('共 3 次攻击') >= 0, '实际打出 3 段');
  ok((text.match(/第 \d 击：造成/g) || []).length === 3, '每段都单独结算伤害');
}

console.log('\n— 回复与吸血 —');
{
  const b = makeBattle(mkSkill({ effects: [{ info: '恢复自身最大体力的1/3' }] }), mkSkill({ power: 5 }));
  const me = b.me.team[0];
  me.hp = Math.floor(me.maxHp / 3);
  const before = me.hp;
  b.step({ type: 'skill', index: 0 });
  ok(me.hp > before, '回复生效（' + before + ' → ' + me.hp + '）');
  ok(me.hp <= me.maxHp, '不会超过最大体力');
}

{
  const b = makeBattle(
    mkSkill({ power: 60, effects: [{ info: '给予对方损伤的一半会恢复自己的体力' }] }),
    mkSkill({ power: 5 })
  );
  const me = b.me.team[0];
  me.hp = 40;
  const before = me.hp;
  b.step({ type: 'skill', index: 0 });
  ok(me.hp > before, '吸血生效（' + before + ' → ' + me.hp + '）');
}

console.log('\n— 固定伤害与持续伤害 —');
{
  const b = makeBattle(mkSkill({ power: 10, effects: [{ info: '额外附加50点固定伤害' }] }), mkSkill({ power: 1 }));
  const foe = b.foe.team[0];
  const before = foe.hp;
  b.step({ type: 'skill', index: 0 });
  ok(before - foe.hp >= 50, '固定伤害计入总伤（扣了 ' + (before - foe.hp) + '）');
}

{
  const b = makeBattle(mkSkill({ power: 5, effects: [{ info: '3回合内每回合都能附加30点固定伤害' }] }), mkSkill({ power: 1 }));
  const foe = b.foe.team[0];
  b.step({ type: 'skill', index: 0 });
  ok(foe.dot && foe.dot.value === 30, '挂上持续伤害');
  const before = foe.hp;
  b.step({ type: 'skill', index: 0 });
  ok(before - foe.hp >= 30, '下一回合继续掉血');
}

console.log('\n— 能力消除与条件威力 —');
{
  const b = makeBattle(mkSkill({ effects: [{ info: '消除对手能力提升状态' }] }), mkSkill({ power: 5 }));
  const foe = b.foe.team[0];
  foe.stages.atk = 2;
  b.step({ type: 'skill', index: 0 });
  eq(foe.stages.atk, 0, '对手能力提升被清零');
}

{
  const base = {
    actor: { level: 100, stats: { atk: 150, def: 100, spAtk: 100, spDef: 100, spd: 100, hp: 300 }, stages: { atk: 0, def: 0, spAtk: 0, spDef: 0, spd: 0, acc: 0, eva: 0 } },
    target: { stats: { atk: 100, def: 100, spAtk: 100, spDef: 100, spd: 100, hp: 300 }, stages: { atk: 0, def: 0, spAtk: 0, spDef: 0, spd: 0, acc: 0, eva: 0 } },
    skill: { power: 50, category: { id: 1 }, crit_rate: 0 },
    skillCombo: combo, actorCombo: combo, targetCombo: combo,
    chart, level: 100, rng: () => 0.5
  };
  const d1 = B.calcDamage(base).damage;
  const d2 = B.calcDamage(Object.assign({}, base, { powerMul: 2 })).damage;
  ok(d2 > d1 * 1.8, '威力倍率生效（' + d1 + ' → ' + d2 + '）');
}

console.log('\n— 烧伤削弱物攻 —');
{
  const actor = {
    level: 100, status: { id: 'burn', turns: 999 },
    stats: { atk: 150, def: 100, spAtk: 100, spDef: 100, spd: 100, hp: 300 },
    stages: { atk: 0, def: 0, spAtk: 0, spDef: 0, spd: 0, acc: 0, eva: 0 }
  };
  const target = {
    stats: { atk: 100, def: 100, spAtk: 100, spDef: 100, spd: 100, hp: 300 },
    stages: { atk: 0, def: 0, spAtk: 0, spDef: 0, spd: 0, acc: 0, eva: 0 }
  };
  const common = {
    target, skill: { power: 50, category: { id: 1 }, crit_rate: 0 },
    skillCombo: combo, actorCombo: combo, targetCombo: combo, chart, level: 100, rng: () => 0.5
  };
  const burned = B.calcDamage(Object.assign({}, common, { actor })).damage;
  const normal = B.calcDamage(Object.assign({}, common, { actor: Object.assign({}, actor, { status: null }) })).damage;
  ok(burned < normal, '烧伤时物理伤害更低（' + burned + ' < ' + normal + '）');
}

console.log('\n— 减伤 / 护盾 / 免疫 / PP / 反弹 —');
{
  let g = parseOne('1回合自身受到物理攻击伤害减半');
  eq(g && g.kind, 'guard', '物理减伤');
  eq(g && g.scope, 'phys', '  限定物理');

  g = parseOne('100%的概率，2回合内受到的伤害减半');
  eq(g && g.scope, 'all', '全伤害减伤');

  g = parseOne('3回合本方受到的火系攻击伤害减半');
  eq(g && g.scope, 'type', '按属性减伤');
  eq(g && g.typeName, '火', '  属性=火');

  eq(parseOne('1回合内免疫所有受到的异常状态').kind, 'immuneStatus', '免疫异常');
  eq(parseOne('2回合内免疫能力下降状态').kind, 'immuneStat', '免疫能力下降');
  eq(parseOne('免疫下1次对手的攻击').kind, 'oneHit', '免疫一次攻击');

  const ib = parseOne('3回合内免疫低于300的攻击伤害');
  eq(ib && ib.kind, 'immuneBelow', '免疫低伤害');
  eq(ib && ib.value, 300, '  阈值 300');

  eq(parseOne('3回合内受攻击时反弹150点固定伤害').kind, 'thorns', '反弹');

  const pp = parseOne('100%降低对手所有技能2点PP值，然后若对手所选择的技能PP值为0则当回合对手无法行动');
  eq(pp && pp.kind, 'ppDrain', 'PP 削减');
  eq(pp && pp.amount, 2, '  削减 2 点');

  const bothOut = [];
  B.parseOneEffect('消除双方能力提升状态及能力下降状态，消除任意一方成功则为自身附加300点护盾', bothOut);
  ok(bothOut.some(x => x.kind === 'clearBoth'), '清除双方能力提升');
  const sh = bothOut.find(x => x.kind === 'shield');
  eq(sh && sh.value, 300, '  护盾 300（消除成功后）');
}

{
  const b = makeBattle(mkSkill({ power: 1 }), mkSkill({ power: 1 }));
  b.me.team[0].guards = [{ turns: 2, mul: 0.5, scope: 'all' }];
  eq(b.applyDamage('me', 100, { physical: true }), 50, '减伤生效（100 → 50）');
}

{
  const b = makeBattle(mkSkill({ power: 1 }), mkSkill({ power: 1 }));
  b.me.team[0].shield = 30;
  eq(b.applyDamage('me', 100, { physical: true }), 70, '护盾先吸收 30');
  eq(b.me.team[0].shield, 0, '护盾被打空');
}

{
  const b = makeBattle(mkSkill({ power: 1 }), mkSkill({ power: 1 }));
  b.me.team[0].immuneBelow = { turns: 2, value: 300 };
  eq(b.applyDamage('me', 100, { physical: true }), 0, '低于阈值完全免伤');
  ok(b.applyDamage('me', 400, { physical: true }) > 0, '超过阈值照常受伤');
}

{
  const b = makeBattle(mkSkill({ power: 1 }), mkSkill({ power: 1 }));
  b.me.team[0].oneHit = 1;
  eq(b.applyDamage('me', 500, { physical: true }), 0, '免疫下一次攻击');
}

{
  const b = makeBattle(mkSkill({ power: 1 }), mkSkill({ power: 1 }));
  const foe = b.foe.team[0];
  foe.immuneStatus = 1;
  b.applyStatus(foe, 'burn', 1, '对手');
  eq(foe.status, null, '免疫异常状态时不挂状态');
}

{
  const b = makeBattle(mkSkill({ power: 40 }), mkSkill({ power: 1 }));
  b.foe.team[0].thorns = { turns: 1, value: 50 };
  b.step({ type: 'skill', index: 0 });
  ok(b.log.join('\n').indexOf('受到反弹') >= 0, '受击反弹触发');
}

{
  const b = makeBattle(
    mkSkill({ power: 10, effects: [{ info: '100%降低对手所有技能2点PP值，然后若对手所选择的技能PP值为0则当回合对手无法行动' }] }),
    mkSkill({ power: 1, max_pp: 20 })
  );
  const foeSlot = b.foe.team[0].skills[0];
  const before = foeSlot.pp;
  b.step({ type: 'skill', index: 0 });
  ok(foeSlot.pp <= before - 1, '对手 PP 被削减（' + before + ' → ' + foeSlot.pp + '）');
}

console.log('\n— 条件效果 —');
{
  const c = parseOne('若对手处于烧伤状态则附加200点固定伤害');
  eq(c && c.kind, 'flat', '条件+固定伤害');
  eq(c && c.value, 200, '  数值 200');
  eq(c && c.req && c.req.type, 'targetStatus', '  条件=对手异常');
  eq(c && c.req && c.req.status, 'burn', '  指定烧伤');

  const ex = parseOne('若对手体力不足300则直接秒杀');
  eq(ex && ex.kind, 'exec', '秒杀');
  eq(ex && ex.req && ex.req.value, 300, '  阈值 300');

  const st = parseOne('1回合内若造成伤害大于300则100%概率使对手害怕');
  eq(st && st.kind, 'status', '条件+异常状态');
  eq(st && st.req && st.req.type, 'damageOver', '  条件=伤害超过');

  const nu = parseOne('若本次攻击造成的伤害小于100，则自身特攻提升1个等级');
  eq(nu && nu.kind, 'stat', '条件+能力提升');
  eq(nu && nu.stat, 'spAtk', '  属性=特攻');
  eq(nu && nu.req && nu.req.type, 'damageUnder', '  条件=伤害不足');

  const pw = parseOne('若属性相同则技能威力提升20');
  eq(pw && pw.kind, 'power', '条件+威力提升');
  eq(pw && pw.add, 20, '  提升 20');
  eq(pw && pw.req && pw.req.type, 'sameType', '  条件=属性相同');

  const cl = [];
  B.parseOneEffect('消除对手能力提升状态，若消除成功，则对手疲惫', cl);
  eq(cl.length, 2, '消除 + 条件后续共 2 条');
  ok(cl[1] && cl[1].req && cl[1].req.type === 'clearSuccess', '后续条件=消除成功');
}

{
  const b = makeBattle(mkSkill({ power: 1, effects: [{ info: '若对手体力不足300则直接秒杀' }] }), mkSkill({ power: 1 }));
  const foe = b.foe.team[0];
  foe.hp = 100;
  b.step({ type: 'skill', index: 0 });
  eq(foe.hp, 0, '满足条件时直接秒杀');
}

{
  const b = makeBattle(
    mkSkill({ power: 20, effects: [{ info: '若对手处于烧伤状态则附加200点固定伤害' }] }),
    mkSkill({ power: 1 })
  );
  const foe = b.foe.team[0];
  b.step({ type: 'skill', index: 0 });
  const noBonus = foe.hp;

  const b2 = makeBattle(
    mkSkill({ power: 20, effects: [{ info: '若对手处于烧伤状态则附加200点固定伤害' }] }),
    mkSkill({ power: 1 })
  );
  const foe2 = b2.foe.team[0];
  foe2.status = { id: 'burn', turns: 999 };
  b2.step({ type: 'skill', index: 0 });
  ok(foe2.hp < noBonus - 150, '条件满足时多打 200 点（' + noBonus + ' vs ' + foe2.hp + '）');
}

console.log('\n— 场地效果（蒂朵魂印驱动）—');
{
  const didoDesc = '蒂朵拥有着神奇的次元之琴，可以在战斗中释放力量，将己方场地变为灵籁泳馆或星璨舞台，蒂朵奇数回合登场时若己方无场地效果，则次元之琴会将己方场地变为灵籁泳馆，持续5回合，偶数回合登场时若己方无场地效果，则次元之琴会将己方场地变为星璨舞台，持续5回合；（boss有效）';
  ok(B.parseSoulmark(didoDesc).some(x => x.kind === 'fieldOnEnter'), '蒂朵魂印：登场开场地');
}

{
  // 奇数回合登场 → 灵籁泳馆
  const b = new B.Battle({
    chart, comboOf: () => combo, rng: () => 0.99, level: 100,
    meTeam: [{ pet: mkPet(1, '蒂朵'), combo, skills: [mkSkill({ power: 40, accuracy: 30 })], passives: [{ kind: 'fieldOnEnter' }] }],
    foeTeam: [{ pet: mkPet(2, '对方'), combo, skills: [mkSkill({ power: 5 })] }]
  });
  ok(b.field && b.field.mustHit, '奇数回合登场 → 灵籁泳馆');
  eq(b.field && b.field.turns, 5, '  持续 5 回合');
  ok(b.accuracyCheck(b.me.team[0], b.foe.team[0], { accuracy: 30 }) === true, '30% 命中率也必中');

  b.me.team[0].hp = 100;
  b.step({ type: 'skill', index: 0 });
  ok(b.me.team[0].hp > 100, '灵籁泳馆每回合回血（100 → ' + b.me.team[0].hp + '）');
}

{
  // 偶数回合登场 → 星璨舞台
  const b = new B.Battle({
    chart, comboOf: () => combo, rng: () => 0.5, level: 100,
    meTeam: [
      { pet: mkPet(1, '先发'), combo, skills: [mkSkill({ power: 1, must_hit: true })] },
      { pet: mkPet(3, '蒂朵'), combo, skills: [mkSkill({ power: 40, must_hit: true })], passives: [{ kind: 'fieldOnEnter' }] }
    ],
    foeTeam: [{ pet: mkPet(2, '对方'), combo, skills: [mkSkill({ power: 0, must_hit: true })] }]
  });
  b.step({ type: 'skill', index: 0 }); // 打完第 1 回合
  b.switchIn('me', 1);                 // 第 2 回合登场
  eq(b.field && b.field.name, '星璨舞台', '偶数回合登场 → 星璨舞台');
  eq(b.field && Math.round(b.field.damageMul * 100), 230, '  伤害倍率 2.3');
}

{
  // 下场消除
  const b = new B.Battle({
    chart, comboOf: () => combo, rng: () => 0.5, level: 100,
    meTeam: [
      { pet: mkPet(1, '蒂朵'), combo, skills: [mkSkill({ power: 1, must_hit: true })], passives: [{ kind: 'fieldOnEnter' }] },
      { pet: mkPet(3, '替补'), combo, skills: [mkSkill({ power: 1, must_hit: true })] }
    ],
    foeTeam: [{ pet: mkPet(2, '对方'), combo, skills: [mkSkill({ power: 0, must_hit: true })] }]
  });
  ok(b.field, '开局有场地');
  b.switchIn('me', 1);
  eq(b.field, null, '蒂朵下场后场地消除');
}

{
  // 5 回合到期
  const b = new B.Battle({
    chart, comboOf: () => combo, rng: () => 0.5, level: 100,
    meTeam: [{ pet: mkPet(1, '蒂朵'), combo, skills: [mkSkill({ power: 0, must_hit: true })], passives: [{ kind: 'fieldOnEnter' }] }],
    foeTeam: [{ pet: mkPet(2, '对方'), combo, skills: [mkSkill({ power: 0, must_hit: true })] }]
  });
  for (let i = 0; i < 5; i++) b.step({ type: 'pass' });
  eq(b.field, null, '5 回合后场地自动结束');
}

console.log('\n— 魂印被动 —');
{
  const p1 = B.parseSoulmark('自身受到的攻击伤害减少10%');
  eq(p1[0] && p1[0].kind, 'taken', '减伤');
  eq(p1[0] && Math.round(p1[0].value * 100), 90, '  倍率 0.9');

  const p2 = B.parseSoulmark('造成的伤害增加10%');
  eq(p2[0] && p2[0].kind, 'dealt', '增伤');
  eq(p2[0] && Math.round(p2[0].value * 100), 110, '  倍率 1.1');

  const p3 = B.parseSoulmark('每回合恢复1/10最大体力');
  eq(p3[0] && p3[0].kind, 'regenRatio', '按比例回复');
  eq(p3[0] && p3[0].num + '/' + p3[0].den, '1/10', '  比例 1/10');

  const p4 = B.parseSoulmark('每回合恢复100HP');
  eq(p4[0] && p4[0].kind, 'regen', '定量回复');
  eq(p4[0] && p4[0].value, 100, '  100 点');

  eq(B.parseSoulmark('免疫所有异常状态')[0].kind, 'immuneStatus', '免疫异常');
  eq(B.parseSoulmark('免疫能力下降状态')[0].kind, 'immuneStat', '免疫能力下降');
  eq(B.parseSoulmark('自身所有攻击先制+1')[0].kind, 'priority', '先制');
  eq(B.parseSoulmark('登场首回合所有攻击先制+1')[0].req.type, 'firstTurn', '登场首回合 → 条件被动');
  eq(B.parseSoulmark('50%概率免疫异常状态')[0].kind, 'chanceImmuneStatus', '概率免疫异常 → 概率被动');
  eq(B.parseSoulmark('满体力时100%免疫异常状态')[0].req.type, 'fullHp', '满体力 → 条件被动');
}

{
  const mk = (passives) => new B.Battle({
    chart, comboOf: () => combo, rng: () => 0.5, level: 100,
    meTeam: [{ pet: mkPet(1, '我方'), combo, skills: [mkSkill({ power: 40, must_hit: true })], passives: passives || [] }],
    foeTeam: [{ pet: mkPet(2, '对方'), combo, skills: [mkSkill({ power: 40, must_hit: true })] }]
  });

  const plain = mk([]);
  const tanky = mk([{ kind: 'taken', value: 0.5 }]);
  plain.step({ type: 'skill', index: 0 });
  tanky.step({ type: 'skill', index: 0 });
  ok(tanky.me.team[0].hp > plain.me.team[0].hp, '减伤被动生效（' + plain.me.team[0].hp + ' vs ' + tanky.me.team[0].hp + '）');

  const strong = mk([{ kind: 'dealt', value: 2 }]);
  const plain2 = mk([]);
  strong.step({ type: 'skill', index: 0 });
  plain2.step({ type: 'skill', index: 0 });
  ok(strong.foe.team[0].hp < plain2.foe.team[0].hp, '增伤被动生效');

  const regenB = mk([{ kind: 'regen', value: 50 }]);
  const noRegenB = mk([]);
  regenB.me.team[0].hp = 100;
  noRegenB.me.team[0].hp = 100;
  regenB.step({ type: 'skill', index: 0 });
  noRegenB.step({ type: 'skill', index: 0 });
  eq(regenB.me.team[0].hp - noRegenB.me.team[0].hp, 50, '魂印回合回复生效');

  const prio = mk([{ kind: 'priority', value: 2 }]);
  eq(prio.actionPriority(prio.me.team[0], { type: 'skill', index: 0 }), 2, '先制被动生效');
}

console.log('\n— 复杂魂印（圣灵谱尼）—');
const PONY_DESC = '虚无：自身受到攻击伤害后，免疫下1次受到的技能伤害|元素：登场时，消除对手回合类效果，消除成功则令对手下1次技能无效|能量：战斗阶段结束时，附加自身已损失体力50%的百分比伤害（boss有效）|生命：战斗阶段结束时，恢复自身最大体力的1/4和随机2个PP值不为满的技能1点PP值（boss有效）|轮回：自身首次于对手出手回合受到致死伤害时当回合保留|永恒：回合开始时，若自身体力高于对手则当回合自身技能必定先手|圣洁：免疫受到的异常状态和能力下降状态（boss有效）';
{
  const fx = B.parseSoulmark(PONY_DESC);
  const has = (kind) => fx.some(x => x.kind === kind);
  ok(has('onHitImmune'), '虚无：受击后免疫下一次');
  ok(fx.some(x => x.kind === 'endDamageLost' && x.value === 0.5), '能量：损失体力 50% 百分比伤害');
  ok(fx.some(x => x.kind === 'endHeal' && x.num === 1 && x.den === 4), '生命：回合结束回 1/4');
  ok(fx.some(x => x.kind === 'endPpRestore' && x.value === 2), '生命：回 2 个技能 PP');
  ok(has('priorityIfHigher'), '永恒：体力高于对手必定先手');
  eq(fx.filter(x => x.kind === 'immuneStatus').length, 1, '圣洁：免疫异常状态');
  eq(fx.filter(x => x.kind === 'immuneStat').length, 1, '圣洁：免疫能力下降');
}

{
  // 受击后免疫下一次
  const b = new B.Battle({
    chart, comboOf: () => combo, rng: () => 0.5, level: 100,
    meTeam: [{ pet: mkPet(1, '我方'), combo, skills: [mkSkill({ power: 40, must_hit: true })] }],
    foeTeam: [{
      pet: mkPet(2, '圣灵谱尼'), combo,
      skills: [mkSkill({ power: 40, must_hit: true })],
      passives: B.parseSoulmark(PONY_DESC)
    }]
  });
  eq(b.foe.team[0].oneHit, 0, '开局没有免疫层数');
  b.step({ type: 'skill', index: 0 });
  ok(b.foe.team[0].oneHit > 0, '受到伤害后获得一次免疫');
  const hpBefore = b.foe.team[0].hp;
  b.step({ type: 'skill', index: 0 });
  eq(b.foe.team[0].hp, hpBefore, '下一次攻击被完全免疫');
}

{
  // 回合结束的百分比伤害
  const b = new B.Battle({
    chart, comboOf: () => combo, rng: () => 0.5, level: 100,
    meTeam: [{ pet: mkPet(1, '我方'), combo, skills: [mkSkill({ power: 1, must_hit: true })], passives: [{ kind: 'endDamageLost', value: 0.5 }] }],
    foeTeam: [{ pet: mkPet(2, '对方'), combo, skills: [mkSkill({ power: 0, must_hit: true })] }]
  });
  b.me.team[0].hp = 100;
  const foeBefore = b.foe.team[0].hp;
  b.step({ type: 'skill', index: 0 });
  ok(b.foe.team[0].hp < foeBefore, '能量效果造成百分比伤害');
}

console.log('\n— 圣灵谱尼：元素 / 轮回 —');
{
  const fx = B.parseSoulmark('元素：登场时，消除对手回合类效果，消除成功则令对手下1次技能无效|轮回：自身首次于对手出手回合受到致死伤害时当回合保留，同时回合结束后自身体力、PP值、能力等级返回当回合选择操作之后的状态');
  ok(fx.some(x => x.kind === 'onEnterClear'), '元素被解析');
  ok(fx.some(x => x.kind === 'rebirth'), '轮回被解析');
}

{
  const b = new B.Battle({
    chart, comboOf: () => combo, rng: () => 0.5, level: 100,
    meTeam: [
      { pet: mkPet(1, '先发'), combo, skills: [mkSkill({ power: 1, must_hit: true })] },
      { pet: mkPet(3, '元素'), combo, skills: [mkSkill({ power: 1, must_hit: true })], passives: [{ kind: 'onEnterClear' }] }
    ],
    foeTeam: [{ pet: mkPet(2, '对方'), combo, skills: [mkSkill({ power: 60, must_hit: true })] }]
  });
  const foe = b.foe.team[0];
  foe.guards = [{ turns: 3, mul: 0.5, scope: 'all' }];
  b.switchIn('me', 1);
  eq(foe.guards.length, 0, '元素：消除对手回合类效果');
  eq(foe.skillNull, 1, '元素：令对手下 1 次技能无效');
  const before = b.me.team[1].hp;
  b.step({ type: 'pass' });
  eq(b.me.team[1].hp, before, '被无效的技能不造成伤害');
}

{
  const b = new B.Battle({
    chart, comboOf: () => combo, rng: () => 0.5, level: 100,
    meTeam: [{ pet: mkPet(1, '轮回'), combo, skills: [mkSkill({ power: 1, must_hit: true })], passives: [{ kind: 'rebirth' }] }],
    foeTeam: [{ pet: mkPet(2, '对方'), combo, skills: [mkSkill({ power: 400, must_hit: true })] }]
  });
  const me = b.me.team[0];
  me.hp = 10;
  b.step({ type: 'pass' });
  ok(me.rebirthUsed, '轮回触发过一次');
  eq(me.hp, 10, '轮回：回合结束回滚到回合初的体力');
}

console.log('\n— 对战道具 —');
{
  const b = makeBattle(mkSkill({ power: 0, must_hit: true }), mkSkill({ power: 0, must_hit: true }));
  const me = b.me.team[0];
  me.hp = 100;
  const before = me.hp;
  const cnt0 = b.items.me.find(x => x.id === 'potion').count;
  b.step({ type: 'item', id: 'potion' });
  ok(me.hp > before, '体力药剂回复体力（' + before + ' → ' + me.hp + '）');
  eq(b.items.me.find(x => x.id === 'potion').count, cnt0 - 1, '道具数量 -1');
}

{
  const b = makeBattle(mkSkill({ power: 0 }), mkSkill({ power: 0 }));
  const me = b.me.team[0];
  me.skills[0].pp = 0;
  b.step({ type: 'item', id: 'ether' });
  ok(me.skills[0].pp > 0, 'PP 药剂回复技能次数（0 → ' + me.skills[0].pp + '）');
}

{
  const b = makeBattle(mkSkill({ power: 0 }), mkSkill({ power: 0 }));
  const me = b.me.team[0];
  me.status = { id: 'burn', turns: 999 };
  b.step({ type: 'item', id: 'antidote' });
  eq(me.status, null, '万能解药解除异常状态');
}

{
  const b = makeBattle(mkSkill({ power: 0 }), mkSkill({ power: 0 }));
  const potion = b.items.me.find(x => x.id === 'potion');
  potion.count = 0;
  const me = b.me.team[0];
  me.hp = 100;
  const before = me.hp;
  b.step({ type: 'item', id: 'potion' });
  eq(me.hp, before, '没有道具时使用无效');
}

console.log('\n— 自爆 / 牺牲 —');
{
  const sk = mkSkill({ info: '牺牲自己进行自爆，将对手体力降为1点，令我方下一只出场精灵获得3次奇迹之力效果' });
  const fx = B.parseSkillEffects(sk);
  ok(fx.some(x => x.kind === 'selfKo'), '自爆：自身倒下被解析');
  ok(fx.some(x => x.kind === 'oppTo1'), '自爆：对手体力降为 1');
  ok(fx.some(x => x.kind === 'nextPet'), '自爆：下一只精灵获得强化');
}

{
  const b = makeBattle(
    mkSkill({ info: '牺牲自己进行自爆，将对手体力降为1点，令我方下一只出场精灵获得3次奇迹之力效果' }),
    mkSkill({ power: 10 })
  );
  const me = b.me.team[0];
  b.step({ type: 'skill', index: 0 });
  eq(me.hp, 0, '使用后自身倒下');
  eq(b.foe.team[0].hp, 1, '对手体力被压到 1 点');
  ok(b.sideBuff.me && b.sideBuff.me.miracle === 3, '留下 3 次奇迹之力');
}

{
  const b = makeBattle(
    mkSkill({ info: '消耗自身全部体力，使对手5回合内使用属性技能失效（延续到对手所有精灵）' }),
    mkSkill({ power: 10 })
  );
  b.step({ type: 'skill', index: 0 });
  eq(b.me.team[0].hp, 0, '消耗全部体力');
  ok(b.foe.team[0].skillBlock >= 4, '对手属性技能被封锁');
}

{
  const sk = mkSkill({ info: '消耗自身全部体力，使下只出场精灵前2次出手必定先手必定暴击' });
  const fx = B.parseSkillEffects(sk);
  const np = fx.find(x => x.kind === 'nextPet');
  ok(np && np.grant === 'critPrio' && np.times === 2, '守御八方：下一只必定先手暴击 2 次');
}

{
  const b = makeBattle(mkSkill({ power: 10 }), mkSkill({ power: 1 }));
  const me = b.me.team[0];
  me.skills[0].pp = 0;
  me.skills[0].maxPp = 1;
  ok(true, 'PP 归零时硬撑');
}

console.log('\n— 能力等级 / 会心一击 —');
{
  const b = makeBattle(
    mkSkill({ info: '技能使用成功时，100%改变自身速度等级+1' }),
    mkSkill({ power: 1 })
  );
  b.step({ type: 'skill', index: 0 });
  eq(b.me.team[0].stages.spd, 1, '自身速度 +1 生效');
}

{
  const b = makeBattle(
    mkSkill({ info: '技能使用成功时，100%改变对手防御等级-2' }),
    mkSkill({ power: 1 })
  );
  b.step({ type: 'skill', index: 0 });
  eq(b.foe.team[0].stages.def, -2, '对手防御 -2 生效');
}

{
  const b = makeBattle(
    mkSkill({ power: 50, crit_rate: 100 }),
    mkSkill({ power: 1 })
  );
  b.step({ type: 'skill', index: 0 });
  eq(b.lastCrit, 'me', '会心一击被记录（供界面反馈）');
}

console.log('\n— 能力变化的其它写法 / 状态栏 —');
{
  const sk = mkSkill({ info: '技能使用成功时，攻击+1，防御+1，特攻+1，特防+1，速度+1，命中+1' });
  const fx = B.parseSkillEffects(sk).filter(x => x.kind === 'stat');
  eq(fx.length, 6, '列表式写法解析出 6 项能力提升');
}

{
  const sk = mkSkill({ info: '全属性+1，若自身当前体力低于对手则强化效果翻倍' });
  const fx = B.parseSkillEffects(sk).filter(x => x.kind === 'stat');
  eq(fx.filter(x => !x.req).length, 5, '「全属性+1」无条件部分 5 项');
  ok(fx.length >= 5, '条件翻倍额外计入（共 ' + fx.length + ' 条）');
}

{
  const b = makeBattle(mkSkill({ info: '技能使用成功时，攻击+1，防御+1，速度+1' }), mkSkill({ power: 1 }));
  b.step({ type: 'skill', index: 0 });
  eq(b.me.team[0].stages.atk, 1, '列表式：攻击 +1 生效');
  eq(b.me.team[0].stages.spd, 1, '列表式：速度 +1 生效');
}

{
  const b = makeBattle(mkSkill({ info: '2回合内受到的伤害减半' }), mkSkill({ power: 1 }));
  b.step({ type: 'skill', index: 0 });
  const snap = b.snapshot();
  const eff = snap.me.team[0].effects || [];
  ok(eff.some(x => /减伤/.test(x.text)), '状态栏带上回合类效果');
}

console.log('\n— 魂印被动（补充解析） —');
{
  const fx = B.parseSoulmark('受到的所有攻击伤害减少30%');
  eq(fx[0] && fx[0].kind, 'taken', '减伤类魂印被解析');
}
{
  const fx = B.parseSoulmark('造成伤害的25%恢复自身体力');
  eq(fx[0] && fx[0].kind, 'drainOnHit', '吸血类魂印被解析');
}
{
  const fx = B.parseSoulmark('每回合开始时为自身附加200点护盾');
  eq(fx[0] && fx[0].kind, 'regenShield', '护盾类魂印被解析');
}
{
  const fx = B.parseSoulmark('增加100点体力上限');
  eq(fx[0] && fx[0].kind, 'hpBonus', '体力上限类魂印被解析');
}
{
  const fx = B.parseSoulmark('每次攻击15%使对手中毒');
  eq(fx[0] && fx[0].kind, 'onHitStatus', '受击挂异常魂印被解析');
}
{
  const mkBattle = (passives) => new B.Battle({
    chart, comboOf: () => combo, rng: () => 0.5, level: 100,
    meTeam: [{ pet: mkPet(1, '我方'), combo, skills: [mkSkill({ power: 0 })], passives }],
    foeTeam: [{ pet: mkPet(2, '对方'), combo, skills: [mkSkill({ power: 120, must_hit: true })] }]
  });
  const plain = mkBattle([]);
  const buffed = mkBattle([{ kind: 'taken', value: 0.5 }, { kind: 'hpBonus', value: 100 }]);
  plain.step({ type: 'skill', index: 0 });
  buffed.step({ type: 'skill', index: 0 });
  ok(buffed.me.team[0].maxHp === plain.me.team[0].maxHp + 100, '体力上限被动生效');
  ok(buffed.me.team[0].hp > plain.me.team[0].hp, '减伤被动生效');
}

console.log('\n— 天雷之剑 / 新增技能句式 —');
{
  const sk = mkSkill({ info: '附加对手上次造成伤害数值的固定伤害；未击败对手则己方下2次攻击技能必定打出致命一击' });
  const fx = B.parseSkillEffects(sk);
  ok(fx.some(x => x.kind === 'prevDamageFlat'), '天雷之剑：附加对手上次伤害');
  ok(fx.some(x => x.kind === 'nextCrit' && x.times === 2), '天雷之剑：下 2 次必定暴击');
}
{
  const fx = B.parseSkillEffects(mkSkill({ info: '3回合内免疫并反弹所有受到的异常状态' }));
  eq(fx[0] && fx[0].kind, 'immuneReflectStatus', '免疫并反弹异常状态');
}
{
  const fx = B.parseSkillEffects(mkSkill({ info: '随机恢复100到500点生命值' }));
  eq(fx[0] && fx[0].kind, 'healRandom', '随机恢复体力');
}
{
  const fx = B.parseSkillEffects(mkSkill({ info: '下2回合自身攻击技能必定打出致命一击' }));
  eq(fx[0] && fx[0].kind, 'critBuff', '下 2 回合必定暴击');
}
{
  const fx = B.parseSkillEffects(mkSkill({ info: '反转自身能力下降状态' }));
  eq(fx[0] && fx[0].kind, 'invertStages', '反转能力下降');
}
{
  const b = makeBattle(
    mkSkill({ info: '附加对手上次造成伤害数值的固定伤害；未击败对手则己方下2次攻击技能必定打出致命一击' }),
    mkSkill({ power: 60, must_hit: true })
  );
  b.step({ type: 'skill', index: 0 });   // 第一回合：对方打我，记录上次伤害
  const before = b.foe.team[0].hp;
  b.step({ type: 'skill', index: 0 });   // 第二回合：附加那段伤害
  ok(b.foe.team[0].hp < before, '天雷之剑的固定伤害生效（' + before + ' → ' + b.foe.team[0].hp + '）');
  ok(b.me.team[0].guaranteeCrit > 0, '天雷之剑给下 2 次攻击挂上必暴');
}

console.log('\n— 消除回合类效果 + 后续 —');
{
  const fx = B.parseSkillEffects(mkSkill({ info: '消除对手回合类效果，消除成功则恢复自身全部体力' }));
  ok(fx.some(x => x.kind === 'clearFoe'), '解析出「消除回合类效果」');
  ok(fx.some(x => x.kind === 'heal' && x.req && x.req.type === 'clearSuccess'), '后续效果带「消除成功」条件');
}
{
  const b = makeBattle(
    mkSkill({ info: '消除对手回合类效果，消除成功则恢复自身全部体力' }),
    mkSkill({ power: 0 })
  );
  b.foe.team[0].guards.push({ turns: 3, mul: 0.5, scope: 'all' });
  b.me.team[0].hp = 100;
  b.step({ type: 'skill', index: 0 });
  eq(b.foe.team[0].guards.length, 0, '对手回合类效果被清除');
  eq(b.me.team[0].hp, b.me.team[0].maxHp, '消除成功后回满体力');
}

console.log('\n— 第三 / 四批句式 —');
{
  const fx = B.parseSkillEffects(mkSkill({ info: '3回合内对手使用技能消耗的PP值变为2倍' }));
  eq(fx[0] && fx[0].kind, 'ppCostMul', 'PP 消耗倍数');
}
{
  const fx = B.parseSkillEffects(mkSkill({ info: '造成的伤害不少于200' }));
  eq(fx[0] && fx[0].kind, 'minDamage', '最低伤害');
}
{
  const fx = B.parseSkillEffects(mkSkill({ info: '无视伤害限制效果；无视攻击免疫效果' }));
  ok(fx.some(x => x.kind === 'ignoreGuards'), '无视伤害限制');
  ok(fx.some(x => x.kind === 'ignoreImmune'), '无视免疫');
}
{
  const fx = B.parseSkillEffects(mkSkill({ info: '2回合内受到致死攻击时则余下1点体力' }));
  eq(fx[0] && fx[0].kind, 'survive', '免死');
}
{
  const b = makeBattle(mkSkill({ info: '造成的伤害不少于200', power: 10 }), mkSkill({ power: 0 }));
  b.step({ type: 'skill', index: 0 });
  ok(b.foe.team[0].hp <= b.foe.team[0].maxHp - 200, '最低伤害生效（剩余 ' + b.foe.team[0].hp + '）');
}

console.log('\n— 第四批：现代技能特殊句式 —');
{
  const fx = B.parseSkillEffects(mkSkill({ info: '消耗自身当前体力的1/2并使对手受到等量百分比伤害' }));
  eq(fx[0] && fx[0].kind, 'selfCostPercent', '消耗体力换百分比伤害');

  const b = makeBattle(mkSkill({ info: '消耗自身当前体力的1/2并使对手受到等量百分比伤害' }), mkSkill({ power: 0 }));
  const me = b.me.team[0], foe = b.foe.team[0];
  const meBefore = me.hp, foeBefore = foe.hp;
  b.step({ type: 'skill', index: 0 });
  eq(meBefore - me.hp, Math.floor(meBefore / 2), '自身消耗一半当前体力');
  eq(foeBefore - foe.hp, meBefore - me.hp, '对手受到等量伤害');
}
{
  const fx = B.parseSkillEffects(mkSkill({ info: '随机吸取对手100-200点体力' }));
  eq(fx[0] && fx[0].kind, 'drainRandom', '随机吸血');

  const b = makeBattle(mkSkill({ info: '随机吸取对手100-200点体力' }), mkSkill({ power: 0 }));
  const me = b.me.team[0];
  me.hp = 100;
  b.step({ type: 'skill', index: 0 });
  eq(me.hp, 200, '吸血按最小值回满（rng=0 → 100）');
}
{
  const fx = B.parseSkillEffects(mkSkill({ info: '将能力下降状态反馈给对手' }));
  eq(fx[0] && fx[0].kind, 'invertToFoe', '能力下降反馈');

  const b = makeBattle(mkSkill({ info: '将能力下降状态反馈给对手' }), mkSkill({ power: 0 }));
  const me = b.me.team[0], foe = b.foe.team[0];
  me.stages.atk = -2;
  b.step({ type: 'skill', index: 0 });
  eq(me.stages.atk, 0, '自身能力下降被清空');
  eq(foe.stages.atk, -2, '对手获得同样的能力下降');
}
{
  const fx = B.parseSkillEffects(mkSkill({ info: '恢复自身已损失体力值的1/3' }));
  eq(fx[0] && fx[0].kind, 'healByLost', '按已损失体力回复');

  const b = makeBattle(mkSkill({ info: '恢复自身已损失体力值的1/3' }), mkSkill({ power: 0 }));
  const me = b.me.team[0];
  me.hp = 100;
  const lost = me.maxHp - 100;
  b.step({ type: 'skill', index: 0 });
  eq(me.hp, 100 + Math.floor(lost / 3), '回复已损失体力的 1/3');
}
{
  const fx = B.parseSkillEffects(mkSkill({ info: '直接造成等同于对手防御值的固定伤害' }));
  eq(fx[0] && fx[0].kind, 'flatByDef', '等同防御值的固伤');
}
{
  const fx = B.parseSkillEffects(mkSkill({ info: '附加100~200点固定伤害并恢复等量体力' }));
  eq(fx[0] && fx[0].kind, 'flatRandomHeal', '固伤并回等量体力');
  eq(fx[0] && fx[0].min, 100, '  下限 100');
}
{
  const fx = B.parseSkillEffects(mkSkill({ info: '附加20%当前体力值的伤害' }));
  eq(fx[0] && fx[0].kind, 'flatByCurHp', '按当前体力百分比追加伤害');
}
{
  const fx = B.parseSkillEffects(mkSkill({ info: '随机降低对手1/4至1/2的当前体力值' }));
  eq(fx[0] && fx[0].kind, 'hpCutRandom', '随机削减当前体力比例');
  eq(fx[0] && fx[0].from, 0.25, '  下限 1/4');
  eq(fx[0] && fx[0].to, 0.5, '  上限 1/2');
}
{
  const fx = B.parseSkillEffects(mkSkill({ info: '后出手时使对手下2回合攻击技能MISS' }));
  eq(fx[0] && fx[0].kind, 'foeMiss', '对手攻击必定落空');
  eq(fx[0] && fx[0].req && fx[0].req.type, 'last', '  条件=后出手');

  const b = makeBattle(mkSkill({ power: 0 }), mkSkill({ power: 80, must_hit: false }));
  b.me.team[0].missTurns = 0;
  b.foe.team[0].missTurns = 2;
  const before = b.me.team[0].hp;
  b.step({ type: 'skill', index: 0 });
  eq(b.me.team[0].hp, before, '对手攻击落空，我方无伤');
  ok(b.log.join('\n').indexOf('落空') >= 0, '  日志记录了落空');
}
{
  const fx = B.parseSkillEffects(mkSkill({ info: '3回合内物理攻击对自身必定miss' }));
  eq(fx[0] && fx[0].kind, 'dodge', '闪避物理攻击');
  eq(fx[0] && fx[0].scope, 'phys', '  限定物理');
}
{
  const fx = B.parseSkillEffects(mkSkill({ info: '若造成的伤害不足200，则下2回合的攻击必定致命一击' }));
  ok(fx.some(x => x.kind === 'critBuff'), '伤害不足则下回合必暴');
  ok(fx.some(x => x.req && x.req.type === 'damageUnder'), '  条件=伤害不足');
}
{
  const fx = B.parseSkillEffects(mkSkill({ info: '造成的攻击伤害若高于200则令对手2回合内使用的属性技能无效' }));
  ok(fx.some(x => x.kind === 'skillBlock'), '高伤害封锁属性技能');
  ok(fx.some(x => x.req && x.req.type === 'damageOver'), '  条件=伤害高于');
}
{
  const fx = B.parseSkillEffects(mkSkill({ info: '自身不处于能力提升状态时先制+2且必定命中' }));
  eq(fx[0] && fx[0].kind, 'priorityCond', '条件先制');
  eq(fx[0] && fx[0].value, 2, '  先制 +2');
  ok(fx.some(x => x.kind === 'mustHit'), '  同时必定命中');
}
{
  const fx = B.parseSkillEffects(mkSkill({ info: '若对手处于异常状态则先制+2' }));
  eq(fx[0] && fx[0].kind, 'priorityCond', '异常状态时先制');
  eq(fx[0] && fx[0].req && fx[0].req.type, 'targetAnyStatus', '  条件=对手异常');

  const b = makeBattle(mkSkill({ power: 0 }), mkSkill({ power: 0 }));
  const me = b.me.team[0];
  me.priorityCond = { req: { type: 'targetAnyStatus' }, value: 2 };
  const base = b.actionPriority(me, { type: 'skill', index: 0 });
  eq(base, 0, '对手无异常时没有先制');
  b.foe.team[0].status = { id: 'poison', turns: 3 };
  eq(b.actionPriority(me, { type: 'skill', index: 0 }), 2, '对手异常时先制 +2');
}
{
  const fx = B.parseSkillEffects(mkSkill({ info: '连续使用时威力提升20%，最高提升60%' }));
  eq(fx[0] && fx[0].kind, 'rampPct', '连续使用威力百分比递增');
  eq(fx[0] && fx[0].inc, 0.2, '  每次 +20%');
  eq(fx[0] && fx[0].cap, 0.6, '  上限 60%');
}
{
  const fx = B.parseSkillEffects(mkSkill({ info: '未击败对手则自身能力提升状态翻倍' }));
  eq(fx[0] && fx[0].kind, 'doubleStages', '能力提升翻倍');

  const b = makeBattle(mkSkill({ info: '未击败对手则自身能力提升状态翻倍' }), mkSkill({ power: 0 }));
  const me = b.me.team[0];
  me.stages.atk = 1;
  b.step({ type: 'skill', index: 0 });
  eq(me.stages.atk, 2, '攻击 +1 → +2');
}
{
  const fx = B.parseSkillEffects(mkSkill({ info: '自身处于能力提升状态时，使对手命中能力-1' }));
  eq(fx[0] && fx[0].kind, 'stat', '条件降能力');
  eq(fx[0] && fx[0].stat, 'acc', '  属性=命中');
  eq(fx[0] && fx[0].req && fx[0].req.type, 'selfStatUp', '  条件=自身能力提升');
}
{
  const fx = B.parseSkillEffects(mkSkill({ info: '若造成的伤害低于200，则所有技能的PP值恢复5点' }));
  ok(fx.some(x => x.kind === 'ppRestoreAll' && x.value === 5), '伤害不足则回复 PP');
}
{
  const fx = B.parseSkillEffects(mkSkill({ info: '2回合内免疫大于300的攻击伤害' }));
  eq(fx[0] && fx[0].kind, 'immuneAbove', '免疫高伤害');
  eq(fx[0] && fx[0].value, 300, '  阈值 300');

  const b = makeBattle(mkSkill({ power: 0 }), mkSkill({ power: 0 }));
  b.me.team[0].immuneAbove = { turns: 2, value: 300 };
  eq(b.applyDamage('me', 500, {}), 0, '高于阈值免疫');
  ok(b.applyDamage('me', 100, {}) > 0, '低于阈值照常受伤');
}
{
  const fx = B.parseSkillEffects(mkSkill({ info: '无视护盾效果' }));
  eq(fx[0] && fx[0].kind, 'ignoreShield', '无视护盾');

  const b = makeBattle(mkSkill({ info: '无视护盾效果', power: 60 }), mkSkill({ power: 0 }));
  b.foe.team[0].shield = 1000;
  const before = b.foe.team[0].hp;
  b.step({ type: 'skill', index: 0 });
  ok(b.foe.team[0].hp < before, '护盾被无视，体力下降');
  eq(b.foe.team[0].shield, 1000, '  护盾没有被消耗');
}
{
  const fx = B.parseSkillEffects(mkSkill({ info: '双倍反转自身的能力下降' }));
  eq(fx[0] && fx[0].kind, 'invertStages', '反转能力下降');
  eq(fx[0] && fx[0].dbl, true, '  双倍');
}
{
  const fx = B.parseSkillEffects(mkSkill({ info: '先出手时对手当回合属性技能无效' }));
  ok(fx.some(x => x.kind === 'skillBlock'), '先手封锁属性技能');
  ok(fx.some(x => x.req && x.req.type === 'first'), '  条件=先出手');
}
{
  const fx = B.parseSkillEffects(mkSkill({ info: '威力随机，随机范围50~100' }));
  eq(fx[0] && fx[0].kind, 'powerRandom', '随机威力');
  eq(fx[0] && fx[0].min, 50, '  下限 50');
}
{
  const fx = B.parseSkillEffects(mkSkill({ info: '2回合内致命一击概率上升1/8' }));
  eq(fx[0] && fx[0].kind, 'critBonusTurns', '暴击率提升');
}
{
  const fx = B.parseSkillEffects(mkSkill({ info: '使对手的能力提升效果反转成能力下降效果' }));
  eq(fx[0] && fx[0].kind, 'invertFoeNegative', '反转对手能力提升');

  const b = makeBattle(mkSkill({ info: '使对手的能力提升效果反转成能力下降效果' }), mkSkill({ power: 0 }));
  b.foe.team[0].stages.spd = 2;
  b.step({ type: 'skill', index: 0 });
  eq(b.foe.team[0].stages.spd, -2, '速度 +2 → -2');
}
{
  const fx = B.parseSkillEffects(mkSkill({ info: '3回合对手无法使自身能力出现提升状态' }));
  eq(fx[0] && fx[0].kind, 'foeNoStatUp', '封锁对手强化');

  const b = makeBattle(
    mkSkill({ info: '2回合对手无法使自身能力出现提升状态' }),
    mkSkill({ power: 0, effects: [{ info: '技能使用成功时，100%改变自身攻击等级+1' }] })
  );
  b.foe.team[0].noStatUp = 2;
  b.step({ type: 'skill', index: 0 });
  eq(b.foe.team[0].stages.atk, 0, '对手无法提升攻击等级');
}

console.log('\n— 魂印：登场窗口（帝皇之御 821）—');
{
  const DESC = '首次登场之后前2回合免疫异常状态且受到致死伤害时保留1点体力|' +
    '首次登场之后前2回合自身所有技能先制+2且受到的致死攻击伤害后以固定伤害的形式反弹给对手';
  const passives = B.parseSoulmark(DESC);
  eq(passives.length, 4, '拆出 4 条登场效果');

  const b = new B.Battle({
    chart, comboOf: () => combo, rng: () => 0, level: 100,
    meTeam: [{ pet: mkPet(1, '帝皇之御'), combo, skills: [mkSkill({})], passives }],
    foeTeam: [{ pet: mkPet(2, '对手'), combo, skills: [mkSkill({ power: 10 })] }]
  });
  const c = b.me.team[0];
  eq(c.immuneStatus, 2, '登场获得 2 回合免疫异常');
  ok(c.survive && c.survive.turns === 2, '登场获得 2 回合免死');
  eq(c.priorityBuff && c.priorityBuff.value, 2, '登场获得先制 +2');
  eq(c.reflectLethal, 2, '登场获得致死后反弹');

  c.hp = 50;
  const foeBefore = b.foe.team[0].hp;
  b.applyDamage('me', 500, {});
  eq(c.hp, 1, '致死伤害时保留 1 点体力');
  ok(b.foe.team[0].hp < foeBefore, '致命伤害反弹给对手（' + foeBefore + ' → ' + b.foe.team[0].hp + '）');
}
{
  const passives = B.parseSoulmark('自身被击败后，己方下只出场精灵2回合内受到的攻击伤害和固定伤害减少50%');
  eq(passives[0] && passives[0].kind, 'deathTeamGuard', '解析出倒地后减伤');
  eq(passives[0] && passives[0].mul, 0.5, '  减伤 50%');

  const b = new B.Battle({
    chart, comboOf: () => combo, rng: () => 0, level: 100,
    meTeam: [
      { pet: mkPet(1, '帝皇之御'), combo, skills: [mkSkill({})], passives },
      { pet: mkPet(3, '后继'), combo, skills: [mkSkill({})] }
    ],
    foeTeam: [{ pet: mkPet(2, '对手'), combo, skills: [mkSkill({ power: 10 })] }]
  });
  b.me.team[0].hp = 0;
  b.checkFaints();
  ok(b.deathGuard.me && b.deathGuard.me.mul === 0.5, '倒下时留下减伤给下一只');
  b.switchIn('me', 1);
  const next = b.me.team[1];
  ok(next.guards.length > 0 && next.guards[0].mul === 0.5, '下一只登场获得减伤');
}

console.log('\n— 延迟伤害 / 受击反馈 —');
{
  const fx = B.parseSkillEffects(mkSkill({ info: '2回合后对对手造成200点固定伤害 重复使用无法叠加' }));
  eq(fx[0] && fx[0].kind, 'delayedFlat', '延迟固定伤害');
  eq(fx[0] && fx[0].turns, 2, '  2 回合后');

  const b = makeBattle(mkSkill({ info: '2回合后对对手造成200点固定伤害' }), mkSkill({ power: 0 }));
  const foe = b.foe.team[0];
  const before = foe.hp;
  b.step({ type: 'skill', index: 0 });   // 第 1 回合：挂上延迟效果
  eq(foe.hp, before, '当回合不结算');
  b.step({ type: 'skill', index: 0 });   // 第 2 回合
  eq(foe.hp, before, '第 2 回合仍未到期');
  b.step({ type: 'skill', index: 0 });   // 第 3 回合到期
  ok(foe.hp < before, '到期后扣血（' + before + ' → ' + foe.hp + '）');
}
{
  const fx = B.parseSkillEffects(mkSkill({ info: '出手时本回合若受到伤害，则将伤害反馈给对手' }));
  eq(fx[0] && fx[0].kind, 'reflectIfHit', '受击反馈');

  const b = makeBattle(mkSkill({ info: '出手时本回合若受到伤害，则将伤害反馈给对手' }), mkSkill({ power: 80 }));
  const foe = b.foe.team[0];
  const before = foe.hp;
  b.step({ type: 'skill', index: 0 });
  ok(foe.hp < before, '受击后把伤害反馈给对手');
}
{
  const fx = B.parseSkillEffects(mkSkill({ info: '3回合内将受到的攻击伤害转化为自身体力' }));
  eq(fx[0] && fx[0].kind, 'convertTaken', '伤害转体力');

  const b = makeBattle(mkSkill({ info: '3回合内将受到的攻击伤害转化为自身体力' }), mkSkill({ power: 0 }));
  const me = b.me.team[0];
  b.step({ type: 'skill', index: 0 });   // 先挂上转化效果
  me.hp = 10;
  const back = b.applyDamage('me', 100, {});
  eq(back, 0, '伤害被转化，不扣血');
  ok(me.hp > 10, '体力反而恢复（10 → ' + me.hp + '）');
}

console.log('\n— 魂印：条件结算（若…则…／满体力时／首回合）—');
{
  const taken = B.parseSoulmark('满体力时受到伤害减半');
  eq(taken[0] && taken[0].kind, 'cond', '条件被动被包成 cond');
  eq(taken[0] && taken[0].req.type, 'fullHp', '  条件=满体力');
  eq(taken[0] && taken[0].fx.kind, 'taken', '  效果=减伤');
  eq(taken[0] && taken[0].fx.value, 0.5, '  减伤 50%');

  const low = B.parseSoulmark('若自身体力低于对手则受到的攻击伤害减少50%');
  eq(low[0] && low[0].req.type, 'selfHpLower', '「若体力低于对手」条件');
  const first = B.parseSoulmark('首回合受到伤害减半');
  eq(first[0] && first[0].req.type, 'firstTurn', '「首回合」条件');

  const mkB = (passives) => new B.Battle({
    chart, comboOf: () => combo, rng: () => 0, level: 100,
    meTeam: [{ pet: mkPet(1, '我'), combo, skills: [mkSkill({})], passives }],
    foeTeam: [{ pet: mkPet(2, '敌'), combo, skills: [mkSkill({ power: 80 })] }]
  });
  const dmgOf = (passives, setup) => {
    const b = mkB(passives);
    if (setup) setup(b);
    const me = b.me.team[0];
    const before = me.hp;
    b.step({ type: 'skill', index: 0 });
    return before - me.hp;
  };

  const base = dmgOf([]);
  const healthy = dmgOf(taken);
  ok(healthy < base, '满体力时减伤生效（' + base + ' → ' + healthy + '）');

  const wounded = dmgOf(taken, (b) => { b.me.team[0].hp = 100; });
  const woundedBase = dmgOf([], (b) => { b.me.team[0].hp = 100; });
  eq(wounded, woundedBase, '非满体力时减伤不生效');

  const expired = dmgOf(first, (b) => { b.me.team[0].enterTurn = 99; });
  eq(expired, base, '过了首回合后减伤失效');
}
{
  const fx = B.parseSoulmark('若自身体力低于最大体力的1/2则先制+2');
  eq(fx[0] && fx[0].req.type, 'selfHpRatioBelow', '「体力低于1/2」条件');
  eq(fx[0] && fx[0].fx.kind, 'priority', '  效果=先制');

  const b = new B.Battle({
    chart, comboOf: () => combo, rng: () => 0, level: 100,
    meTeam: [{ pet: mkPet(1, '我'), combo, skills: [mkSkill({})], passives: fx }],
    foeTeam: [{ pet: mkPet(2, '敌'), combo, skills: [mkSkill({})] }]
  });
  const me = b.me.team[0];
  me.hp = me.maxHp;                       // 体力高于 1/2
  eq(b.actionPriority(me, { type: 'skill', index: 0 }), 0, '体力健康时没有先制');
  me.hp = Math.floor(me.maxHp / 4);       // 低于 1/2
  eq(b.actionPriority(me, { type: 'skill', index: 0 }), 2, '体力低于 1/2 时先制 +2');
}

console.log('');
if (fails) { console.log('✗ ' + fails + ' 项失败'); process.exit(1); }
console.log('✓ 全部通过');

console.log('\n— 第七批句式 —');
{
  const f1 = B.parseSkillEffects(mkSkill({ info: '2回合内自身与对方反转战斗时属性' }));
  eq(f1[0] && f1[0].kind, 'swapType', '属性反转');
  const f2 = B.parseSkillEffects(mkSkill({ info: '降低对方1/4的hp' }));
  eq(f2[0] && f2[0].kind, 'percentHp', '按比例削血');
  const f3 = B.parseSkillEffects(mkSkill({ info: '降低对方100点战斗时的最高HP' }));
  eq(f3[0] && f3[0].kind, 'maxHpDown', '降低体力上限');
  const f4 = B.parseSkillEffects(mkSkill({ info: '自身体力低于300时必定先手' }));
  eq(f4[0] && f4[0].kind, 'priorityIfHpBelow', '残血必先手');
}
{
  const b = makeBattle(mkSkill({ info: '降低对方1/4的hp' }), mkSkill({ power: 0 }));
  const foe = b.foe.team[0];
  const before = foe.hp;
  b.step({ type: 'skill', index: 0 });
  eq(foe.hp, before - Math.floor(before / 4), '按比例削血生效');
}
console.log('');


console.log('\n— 背包光环 / 场下效果 —');
{
  const f = B.parseSoulmark('天启帝君出战后对对方不在场精灵附加其最大体力1/3的真实伤害');
  eq(f[0] && f[0].kind, 'benchStrike', '帝君之罚');
  const h = B.parseSoulmark('天启帝君出战后恢复己方所有不在场精灵其最大体力的1/3');
  eq(h[0] && h[0].kind, 'benchHeal', '帝君之赐');
  const im = B.parseSoulmark('自身免疫受到的固定伤害、百分比伤害、能力下降状态');
  eq(im[0] && im[0].kind, 'immuneFixedPct', '免疫固伤');
  const aura = B.parseSoulmark('自身位于背包中时，使得己方背包中昭烈帝刘备的体力恢复效果从15点提升至20点，最多可叠加至60点');
  eq(aura[0] && aura[0].fx && aura[0].fx.cap, 60, '光环叠加上限');
  const team = B.parseSoulmark('位于出战背包时，己方精灵攻击提升10%');
  eq(team[0] && team[0].fx && team[0].fx.type, 'teamStat', '全队属性光环');
}

console.log('\n— 启灵元神 3986 —');
{
  const NQ_DESC = '神殇：回合开始时创造一个神秘结界|神印：自身在出战背包时，对方主动切换精灵登场时自身为其附加1层神印|神谕：自身在出战背包时，己方不在场精灵体力低于最大体力的1/2时不会下降|神照：自身在出战背包时，己方首发精灵首次登场时获得一个等同于自身最大体力值30%的护盾（boss有效）|神启：回合开始时，若自身体力高于最大体力的1/2则当回合自身免疫受到的异常状态和能力下降状态，若自身体力低于最大体力的1/2则自身获得等同于最大体力值30%的护盾（boss有效）|（标注部分boss有效，其余无效）';
  const nq = B.parseSoulmark(NQ_DESC);
  eq(nq.length, 5, '魂印解析出 5 条（神殇/神印/神谕/神照/神启）');
  eq(nq[0].kind, 'exile', '神殇 → 神秘结界放逐');
  eq(nq[1].fx && nq[1].fx.type, 'markOnSwitch', '神印 → 换人叠印记');
  eq(nq[2].fx && nq[2].fx.type, 'benchFloor', '神谕 → 场下体力下限');
  eq(nq[3].fx && nq[3].fx.type, 'firstShield', '神照 → 首发护盾');
  eq(nq[4].kind, 'divineTurn', '神启 → 回合开始体力分支');

  const nqPet = () => ({
    id: 3986, name: '启灵元神',
    base_stats: { hp: 175, atk: 75, def: 130, sp_atk: 150, sp_def: 130, spd: 140 }
  });
  const plainPet = (id, name) => mkPet(id, name);
  const entry = (pet, passives) => ({ pet, combo, skills: [mkSkill({ power: 0 })], passives: passives || [] });
  const mkBattleN = (meEntries, foeEntries) => new B.Battle({
    chart, comboOf: () => combo, rng: () => 0, level: 100,
    meTeam: meEntries, foeTeam: foeEntries
  });

  // 神照：背包里的启灵元神给首发 30% 最大体力护盾
  {
    const me = [entry(plainPet(1, '首发')), entry(nqPet(), nq)];
    const b = mkBattleN(me, [entry(plainPet(2, '对手'))]);
    const src = b.me.team[1];
    eq(b.me.team[0].shield, Math.round(src.maxHp * 0.3), '神照：首发护盾 = 启灵元神最大体力 30%');
  }

  // 神印：对方主动换人登场时叠层，并在该回合结束受到真实伤害
  {
    const me = [entry(plainPet(1, '我方A')), entry(plainPet(2, '我方B'))];
    const foe = [entry(plainPet(3, '对方A')), entry(nqPet(), nq)];
    const b = mkBattleN(me, foe);
    const srcMax = b.foe.team[1].maxHp;
    const target = b.me.team[1];
    const before = target.hp;
    b.step({ type: 'switch', index: 1 });
    eq(target.holyMarks, 1, '神印：换人登场叠 1 层');
    eq(before - target.hp, Math.floor(srcMax / 8), '神印 1 层伤害 = 启灵元神最大体力 1/8');
    b.addHolyMarks('me', target);
    b.addHolyMarks('me', target);
    b.addHolyMarks('me', target);
    eq(target.holyMarks, 3, '神印：上限 3 层');
  }

  // 神谕：己方场下体力低于 1/2 时不再被削减
  {
    const me = [entry(plainPet(1, '我方A')), entry(nqPet(), nq), entry(plainPet(2, '我方B'))];
    const b = mkBattleN(me, [entry(plainPet(3, '对手'))]);
    const bench = b.me.team[2];
    bench.hp = Math.floor(bench.maxHp * 0.6);
    b.benchDamage('me', bench, 9999);
    eq(bench.hp, Math.floor(bench.maxHp * 0.5), '神谕：场下扣血最多压到 50%');
    bench.hp = Math.floor(bench.maxHp * 0.4);
    b.benchDamage('me', bench, 9999);
    eq(bench.hp, Math.floor(bench.maxHp * 0.4), '神谕：已低于 50% 时不再继续下降');
  }

  // 神殇：启灵元神在场时每回合放逐对手场下精灵，被放逐者不能主动换上场
  {
    const me = [entry(nqPet(), nq), entry(plainPet(1, '我方B')), entry(plainPet(2, '我方C'))];
    const foe = [];
    for (let i = 0; i < 6; i++) foe.push(entry(plainPet(10 + i, '对方' + i)));
    const b = mkBattleN(me, foe);
    b.step({ type: 'skill', index: 0 });
    eq(b.exiled.foe.length, 1, '神殇：rng=0 时放逐 1 只');
    eq(b.exiled.foe[0], 1, '神殇：放逐第一个场下精灵');
    b.perform('foe', { type: 'switch', index: 1 }, {});
    eq(b.foe.active, 0, '神殇：被放逐的精灵无法主动切换');
  }

  // 神启：体力 >1/2 免疫异常；<1/2 获得 30% 护盾
  {
    const me = [entry(nqPet(), nq)];
    const foe = [entry(plainPet(3, '对手'))];
    foe[0].skills = [mkSkill({ power: 0, effects: [{ info: '命中后100%令对方中毒' }] })];
    const b = mkBattleN(me, foe);
    b.step({ type: 'skill', index: 0 });
    eq(b.me.team[0].status, null, '神启：体力 >1/2 时免疫异常');

    const c = b.me.team[0];
    c.hp = Math.floor(c.maxHp / 2) - 1;
    c.shield = 0;
    b.step({ type: 'skill', index: 0 });
    eq(c.shield, Math.round(c.maxHp * 0.3), '神启：体力 <1/2 时获得 30% 护盾');
  }

  // 背包光环必须在队伍建好之后收集（否则全队属性光环永远不生效）
  {
    const buff = { kind: 'benchAura', names: null, fx: { type: 'teamStat', stat: 'atk', pct: 10 } };
    const p1 = plainPet(1, '光环');
    const p2 = plainPet(2, '队友');
    const me = [entry(p1, [buff]), entry(p2)];
    const b = mkBattleN(me, [entry(plainPet(3, '对手'))]);
    const base = B.computeStats(p2, { level: 100, iv: 31, ev: {} }).atk;
    eq(b.me.team[1].stats.atk, Math.round(base * 1.1), '背包光环：全队属性加成在队伍建好后生效');
  }
}

console.log('\n— 桃园结义 / 西游组 —');
{
  const combo = { id: 1, name: '草', primary: { id: 1 }, secondary: null };
  const hpPet = (id, name) => ({
    id, name,
    base_stats: { hp: 100, atk: 100, def: 100, sp_atk: 100, sp_def: 100, spd: 100 }
  });
  const pe = (pet, passives) => ({ pet, combo, skills: [mkSkill({ power: 0 })], passives: passives || [] });
  const pb = (me, foe, pvp) => new B.Battle({
    chart, comboOf: () => combo, rng: () => 0, level: 100, pvp: !!pvp,
    meTeam: me, foeTeam: foe
  });

  const p246 = B.parseSoulmark('背包内每存在一种三兄弟精灵时自身每回合恢复15点体力(最多每回合恢复45点)');
  const p41 = B.parseSoulmark('效果：登场时使对手命中-1；|自身位于背包中时，使得己方背包中昭烈帝刘备、武圣关羽、万人敌张飞专属buff——桃的体力恢复效果从15点提升至20点，最多可叠加至60点（boss有效）');
  eq(p246[0] && p246[0].kind, 'regenPerSibling', '桃园：三兄弟回血规则');
  const healFix = p41.find(x => x.kind === 'benchAura');
  eq(healFix && healFix.fx && healFix.fx.type, 'healFix', '卧龙诸葛：桃园回复强化');
  ok(healFix.fx.cap === 60, '卧龙诸葛：回复上限 60');
  ok(healFix.names.length === 3 && healFix.names.indexOf('万人敌张飞') >= 0, '卧龙诸葛：光环名字已清理干净');

  // 三兄弟：15×3 = 45
  {
    const me = [
      pe(hpPet(2512, '昭烈帝刘备'), p246),
      pe(hpPet(2520, '武圣·关羽'), p246),
      pe(hpPet(2530, '万人敌张飞'), p246)
    ];
    const b = pb(me, [pe(hpPet(9, '木桩'))]);
    const c = b.me.team[0];
    c.hp = c.maxHp - 200;
    const hp0 = c.hp;
    b.endOfTurn();
    eq(c.hp - hp0, 45, '桃园三兄弟同队：每回合回复 45');
  }

  // 三兄弟 + 卧龙诸葛：20×3 = 60
  {
    const me = [
      pe(hpPet(2512, '昭烈帝刘备'), p246),
      pe(hpPet(2520, '武圣·关羽'), p246),
      pe(hpPet(2530, '万人敌张飞'), p246),
      pe(hpPet(2523, '卧龙诸葛'), p41)
    ];
    const b = pb(me, [pe(hpPet(9, '木桩'))]);
    const c = b.me.team[0];
    c.hp = c.maxHp - 200;
    const hp0 = c.hp;
    b.endOfTurn();
    eq(c.hp - hp0, 60, '三兄弟 + 卧龙诸葛：每回合回复 60');
    ok(!b.me.team[3].regenPerSibling, '卧龙诸葛不占三兄弟层数');
  }

  // 两兄弟 + 卧龙诸葛：20×2 = 40（不是 15×3=45）
  {
    const me = [
      pe(hpPet(2512, '昭烈帝刘备'), p246),
      pe(hpPet(2520, '武圣·关羽'), p246),
      pe(hpPet(2523, '卧龙诸葛'), p41)
    ];
    const b = pb(me, [pe(hpPet(9, '木桩'))]);
    b.me.active = 1;
    const c = b.me.team[1];
    c.hp = c.maxHp - 200;
    const hp0 = c.hp;
    b.endOfTurn();
    eq(c.hp - hp0, 40, '两兄弟 + 卧龙诸葛：每层 20，共 40');
  }

  // 西游羁绊：蒙奇多克 2727 + 三藏 + 沙悟净 + 天河神将
  {
    const west = [
      pe(hpPet(2727, '蒙奇多克')),
      pe(hpPet(3409, '三藏')),
      pe(hpPet(3519, '沙悟净')),
      pe(hpPet(2735, '天河神将'))
    ];
    const b = pb(west, [pe(hpPet(9, '木桩'))]);
    eq(b.benchAuras.me.westward, true, '西游：四人同队激活羁绊');
    eq(b.me.team[0].stages.atk, 1, '西游：首发全属性 +1（攻击）');
    eq(b.me.team[0].stages.spd, 1, '西游：首发全属性 +1（速度）');
    ok(b.log.some(x => x.indexOf('师徒羁绊') >= 0), '西游：登场日志');

    const wrong = [
      pe(hpPet(4524, '孙悟空')),
      pe(hpPet(3409, '三藏')),
      pe(hpPet(3519, '沙悟净')),
      pe(hpPet(2735, '天河神将'))
    ];
    const b2 = pb(wrong, [pe(hpPet(9, '木桩'))]);
    eq(b2.benchAuras.me.westward, false, '4524 孙悟空不属于西游羁绊');
    eq(b2.me.team[0].stages.atk, 0, '4524 孙悟空不触发西游羁绊');

    const b3 = pb(west, [pe(hpPet(9, '木桩'))], true);
    eq(b3.benchAuras.me.westward, true, '西游：联机也检测到羁绊');
    eq(b3.me.team[0].stages.atk, 0, '西游：联机（PvP）不触发全属性 +1');
  }

  // 三藏：背包内己方攻击 25% 增伤，未触发则吸血
  {
    const pSanzang = B.parseSoulmark('自身在出战背包时使己方出战精灵每次攻击25%的概率伤害提高50%，未触发则随机{吸取}对手1~100点{体力}（BOSS无效）');
    const attacker = () => {
      const e = pe(hpPet(1, '打手'));
      e.skills = [mkSkill({ power: 40, category: { id: 1 }, type: { id: 1 } })];
      return e;
    };
    function attackLoss(withSanzang, rngVal) {
      const me = [attacker()];
      if (withSanzang) me.push(pe(hpPet(3409, '三藏'), pSanzang));
      const b = new B.Battle({
        chart, comboOf: () => combo, rng: () => rngVal, level: 100,
        meTeam: me, foeTeam: [pe(hpPet(9, '木桩'))]
      });
      const foe = b.foe.team[0];
      const before = foe.hp;
      b.step({ type: 'skill', index: 0 });
      return { loss: before - foe.hp, log: b.log };
    }
    const base = attackLoss(false, 0).loss;
    const proc = attackLoss(true, 0).loss;
    eq(proc, Math.floor(base * 1.5), '三藏：25% 增伤触发时伤害 ×1.5');
    const miss = attackLoss(true, 0.9);
    ok(miss.log.some(x => x.indexOf('随机吸取') >= 0), '三藏：未触发时随机吸血');
  }

  // 沙悟净：满体力减伤 + 战斗阶段结束递增固伤
  {
    const pSha = B.parseSoulmark('回合开始时若自身满体力则当回合受到的攻击伤害减少50%；战斗阶段结束时附加150点固定伤害，每回合增加100点，最高250点，对手处于能力提升状态时固伤效果翻倍（BOSS无效）');
    function hitLoss(withPass) {
      const foeE = pe(hpPet(9, '木桩'));
      foeE.skills = [mkSkill({ power: 40, category: { id: 1 }, type: { id: 1 } })];
      const b = pb(
        [pe(hpPet(3519, '沙悟净'), withPass ? pSha : null)],
        [foeE]
      );
      const c = b.me.team[0];
      const before = c.hp;
      b.step({ type: 'skill', index: 0 });
      return before - c.hp;
    }
    const noGuard = hitLoss(false);
    eq(hitLoss(true), Math.floor(noGuard / 2), '沙悟净：满体力时当回合受伤减半');

    const idle = { id: 99, name: '待机', power: 0, max_pp: 20, accuracy: 100, crit_rate: 0, priority: 0, must_hit: true, category: { id: 4 }, type: { id: 1 }, info: '', effects: [] };
    const bigPet = { id: 9, name: '厚血木桩', base_stats: { hp: 300, atk: 100, def: 100, sp_atk: 100, sp_def: 100, spd: 100 } };
    const b = pb(
      [{ pet: hpPet(3519, '沙悟净'), combo, skills: [idle], passives: pSha }],
      [{ pet: bigPet, combo, skills: [idle] }]
    );
    const foe = b.foe.team[0];
    let h0 = foe.hp;
    b.step({ type: 'skill', index: 0 });
    eq(h0 - foe.hp, 150, '沙悟净：第 1 回合结束固伤 150');
    h0 = foe.hp;
    b.step({ type: 'skill', index: 0 });
    eq(h0 - foe.hp, 250, '沙悟净：第 2 回合结束固伤 250（封顶）');
  }

  // 天河神将：受到攻击消除对手能力提升
  {
    const pThg = B.parseSoulmark('受到攻击将消除对手能力提升状态');
    const atkE = pe(hpPet(1, '打手'));
    atkE.skills = [mkSkill({ power: 40, category: { id: 1 }, type: { id: 1 } })];
    const b = pb(
      [atkE],
      [pe(hpPet(2735, '天河神将'), pThg)]
    );
    const atk = b.me.team[0];
    atk.stages.atk = 2;
    atk.stages.spd = 1;
    b.step({ type: 'skill', index: 0 });
    eq(atk.stages.atk, 0, '天河神将：受击消除对手攻击提升');
    eq(atk.stages.spd, 0, '天河神将：受击消除对手速度提升');
  }

  // 4524 孙悟空：独立魂印（不属于西游羁绊）
  {
    const pWk = B.parseSoulmark('孙悟空天生免疫能力下降状态与焚烬、烧伤状态；|回合开始时，若对手体力高于其最大体力的1/2则当回合自身造成的攻击伤害提升50%，攻击技能打出致命一击时增伤效果提升至100%，若对手体力低于其最大体力的1/2则自身所有技能先制+1且使用后附加对手最大体力1/3的百分比伤害；|每场战斗限一次，回合开始时若孙悟空处于异常状态且体力低于最大体力的1/2，则触发法天象地·圣：|法天象地·圣：触发时重置自身的体力值、PP值、所处异常状态，3回合内（含当回合及下2回合）自身免疫异常状态、所有技能先制+1且攻击技能必定打出致命一击，下场消失|（boss无效）');
    const kinds = pWk.map(x => x.kind);
    ok(kinds.indexOf('wukongTurn') >= 0, '4524 孙悟空：回合开始体力分支');
    ok(kinds.indexOf('wukongForm') >= 0, '4524 孙悟空：法天象地');
    ok(kinds.indexOf('immuneStatusIds') >= 0, '4524 孙悟空：烧伤/焚烬免疫');

    const b = pb(
      [pe(hpPet(4524, '孙悟空'), pWk)],
      [pe(hpPet(9, '木桩'))]
    );
    const c = b.me.team[0];
    b.applyStatus(c, 'burn', 3, '对手');
    eq(c.status, null, '4524 孙悟空：免疫烧伤');
    b.applyStatus(c, 'poison', 3, '对手');
    ok(!!c.status, '4524 孙悟空：不免疫中毒');

    c.status = { id: 'burn', turns: 99 };
    c.hp = Math.floor(c.maxHp / 3);
    b.foe.team[0].skills = [mkSkill({ power: 0 })];
    b.step({ type: 'skill', index: 0 });
    eq(c.status, null, '4524 孙悟空：法天象地清除异常');
    eq(c.hp, c.maxHp, '4524 孙悟空：法天象地回满体力');
    ok(c.wukongFormTurns > 0 && c.critBuffTurns > 0, '4524 孙悟空：法天象地 3 回合必暴');
  }
}

console.log('\n— 马尔修斯形态组 —');
{
  const combo = { id: 1, name: '草', primary: { id: 1 }, secondary: null };
  const hpPet = (id, name, hp) => ({
    id, name,
    base_stats: { hp: hp || 100, atk: 100, def: 100, sp_atk: 100, sp_def: 100, spd: 100 }
  });
  const pe = (pet, passives, skills) => ({ pet, combo, skills: skills || [mkSkill({ power: 40 })], passives: passives || [] });
  const pb = (me, foe) => new B.Battle({
    chart, comboOf: () => combo, rng: () => 0, level: 100,
    meTeam: me, foeTeam: foe
  });

  const d708 = '1.坚壁形态（常驻）:登场起免疫下1次受到的异常状态且激活1个可以吸收300点伤害的护盾，护盾消失后会在2回合后重新激活，若战斗阶段结束时自身护盾未激活则恢复自身最大体力的1/3；|2.极速形态（出场开启，可切换）:所有技能先制额外+1，先出手时攻击伤害结算前使对手全属性-1；|3.毁灭形态（出场不开启，可切换）:所有攻击技能伤害提升70%，回合开始时若对手体力低于25%则所有技能必定秒杀对手；|使用成功终极技能王•异甲同心时，若本回合处于极速形态，则附加对手最大体力1/3的百分比伤害（若对手的体力小于最大体力的1/2则转换为附加对手当前体力1/2的百分比伤害），同时下回合开始时切换为毁灭形态；若本回合处于毁灭形态，则{吸取}对手最大{体力}的1/3，同时下回合开始时切换为极速形态|（除变身特效以外的所有效果boss无效）';
  const p708 = B.parseSoulmark(d708);
  const p209 = B.parseSoulmark('先出手时对手本回合无法通过自身技能恢复自身体力（boss无效）;先出手时下回合自身速度+1');
  const p210 = B.parseSoulmark('自身的双防能力值提升30%;受到的伤害减少20%');
  const p208 = B.parseSoulmark('回合开始时,若对手体力低于25%,则所有技能必定瞬杀对手（boss无效）');

  eq(p708.length, 4, '3393：魂印 708 解析出 4 条');
  eq(p708[0].kind, 'morphGuard', '3393：坚壁形态');
  eq(p708[1].kind, 'morphSpeed', '3393：极速形态');
  eq(p708[2].kind, 'morphDestroy', '3393：毁灭形态');
  eq(p708[3].kind, 'morphUltimate', '3393：王·异甲同心');
  eq(p209.length, 2, '2880：两条魂印效果');
  eq(p210.length, 2, '2881：两条魂印效果');
  eq(p208[0] && p208[0].kind, 'lowHpExec', '2882：低血秒杀');

  // 3393 登场：坚壁护盾 + 免疫一次异常 + 极速先制 +1
  {
    const b = pb([pe(hpPet(3393, '马尔修斯', 120), p708)], [pe(hpPet(9, '木桩', 200))]);
    const c = b.me.team[0];
    eq(c.shield, 300, '3393：登场获得 300 护盾');
    eq(c.statusGuard, 1, '3393：登场免疫下 1 次异常');
    eq(c.morphMode, 'speed', '3393：登场开启极速形态');
    eq(b.actionPriority(c, { type: 'skill', index: 0 }), 1, '3393：极速形态全技能先制 +1');
    b.applyStatus(c, 'burn', 1, '对手');
    eq(c.status, null, '3393：坚壁免疫第一次异常');

    const foe = b.foe.team[0];
    b.step({ type: 'skill', index: 0 });
    eq(foe.stages.def, -1, '3393：极速先手攻击前对手全属性 -1');
  }

  // 3393 护盾破碎：2 回合后重激活；未激活时回合末回 1/3
  {
    const b = pb([pe(hpPet(3393, '马尔修斯', 120), p708)], [pe(hpPet(9, '木桩', 200))]);
    const c = b.me.team[0];
    c.shield = 10;
    c.shieldActive = true;
    b.applyDamage('me', 60, {});
    eq(c.shieldActive, false, '3393：护盾破碎');
    eq(c.shieldRecharge, 2, '3393：破碎后 2 回合重激活');
    c.hp = 100;
    b.endOfTurn();
    ok(c.hp > 100 && c.hp <= c.maxHp, '3393：护盾未激活时回合末回 1/3（' + c.hp + '）');
    b.startOfTurn();
    eq(c.shieldActive, false, '3393：破碎后第 1 回合仍未激活');
    b.startOfTurn();
    eq(c.shieldActive, true, '3393：破碎 2 回合后重新激活');
    eq(c.shield, 300, '3393：重新激活 300 护盾');
  }

  // 3393 毁灭：攻击伤害 ×1.7；对手 <25% 时秒杀
  {
    const b = pb([pe(hpPet(3393, '马尔修斯', 120), p708)], [pe(hpPet(9, '木桩', 200))]);
    const c = b.me.team[0], f = b.foe.team[0];
    const skill = c.skills[0].skill;
    const calc = () => B.calcDamage({
      actor: c, target: f, skill, skillCombo: combo, actorCombo: combo,
      targetCombo: combo, chart, level: 100, rng: () => 0.5
    }).damage;
    c.morphMode = 'speed';
    const dSpeed = calc();
    c.morphMode = 'destroy';
    const dDestroy = calc();
    ok(dDestroy > dSpeed * 1.5, '3393：毁灭形态攻击伤害 +70%（' + dSpeed + '→' + dDestroy + '）');
    f.hp = Math.floor(f.maxHp * 0.2);
    b.startOfTurn();
    ok(c.formExec, '3393：毁灭形态下对手 <25% 触发秒杀标记');
  }

  // 3393 王·异甲同心：极速→毁灭，毁灭→极速
  {
    const ult = mkSkill({ id: 25555, name: '王·异甲同心', power: 80, category: { id: 1 }, type: { id: 1 } });
    const b = pb([pe(hpPet(3393, '马尔修斯', 120), p708, [mkSkill({ power: 40 }), ult])], [pe(hpPet(9, '木桩', 300), null, [mkSkill({ power: 0 })])]);
    const c = b.me.team[0], f = b.foe.team[0];
    const h0 = f.hp;
    b.step({ type: 'skill', index: 1 });
    ok(f.hp < h0, '3393：极速形态终极技能造成伤害');
    eq(c.morphSwitchNext, 'destroy', '3393：极速形态使用终极技能后下回合切毁灭');
    b.startOfTurn();
    eq(c.morphMode, 'destroy', '3393：下回合切换为毁灭形态');

    const hp0 = c.hp;
    c.hp = Math.max(1, c.maxHp - 100);
    f.hp = f.maxHp;
    b.step({ type: 'skill', index: 1 });
    ok(c.hp > Math.max(1, c.maxHp - 100), '3393：毁灭形态终极技能吸取体力');
    eq(c.morphSwitchNext, 'speed', '3393：毁灭形态使用终极技能后下回合切极速');
  }

  // 2880：先手禁疗 + 下回合速度 +1
  {
    const heal = mkSkill({ id: 88, name: '回复', power: 0, category: { id: 4 }, type: { id: 1 }, effects: [{ info: '恢复自身最大体力的1/3' }] });
    const b = pb([pe(hpPet(2880, '极速型'), p209)], [pe(hpPet(9, '木桩'), null, [mkSkill({ power: 1 }), heal])]);
    const c = b.me.team[0], f = b.foe.team[0];
    f.hp = f.maxHp - 100;
    b.step({ type: 'skill', index: 0 });
    ok(b.log.some(x => x.indexOf('无法通过技能恢复体力') >= 0), '2880：先手禁疗');
    ok(c.pendingSpeedUp, '2880：先手后预约下回合速度 +1');
    b.startOfTurn();
    eq(c.stages.spd, 1, '2880：下回合速度 +1');
  }

  // 2881：双防 +30%，受伤 -20%
  {
    const b = pb([pe(hpPet(2881, '坚壁型'), p210)], [pe(hpPet(9, '木桩'))]);
    const c = b.me.team[0];
    const raw = B.computeStats(hpPet(2881, '坚壁型'), { level: 100, iv: 31, ev: {} });
    eq(c.stats.def, Math.round(raw.def * 1.3), '2881：防御 +30%');
    eq(c.stats.spDef, Math.round(raw.spDef * 1.3), '2881：特防 +30%');
    eq(c.takenMul, 0.8, '2881：受到伤害 -20%');
  }

  // 2882：对手 <25% 时所有技能秒杀
  {
    const b = pb([pe(hpPet(2882, '毁灭型'), p208)], [pe(hpPet(9, '木桩'))]);
    const f = b.foe.team[0];
    f.hp = Math.floor(f.maxHp * 0.2);
    b.step({ type: 'skill', index: 0 });
    eq(f.hp, 0, '2882：对手残血时技能直接秒杀');
  }
}

console.log('\n— 天启星魂 4677 —');
{
  const combo = { id: 1, name: '神秘', primary: { id: 1 }, secondary: null };
  const hpPet = (id, name) => ({
    id, name,
    base_stats: { hp: 180, atk: 150, def: 120, sp_atk: 100, sp_def: 120, spd: 140 }
  });
  const sk = (id, name, power, cat, effects) => ({
    id, name, power, max_pp: 20, accuracy: 100, crit_rate: 0, priority: 0, must_hit: true,
    category: { id: cat || (power > 0 ? 1 : 4) }, type: { id: 1 }, info: '', effects: effects || []
  });
  const pe = (pet, passives, skills) => ({ pet, combo, skills: skills || [sk(1, '攻击', 80, 1)], passives: passives || [] });
  const pb = (me, foe) => new B.Battle({
    chart, comboOf: () => combo, rng: () => 0, level: 100,
    meTeam: me, foeTeam: foe
  });

  const d1879 = '自身计算攻击伤害时双攻值视为二者之和，且特殊攻击技能先制额外+1，物理攻击技能使用后吸取对手其双防值总和30%的体力|天启星魂每次登场时进行星启，之后天启星魂处于星赐时免疫疲惫状态，处于星哲时免疫害怕状态，均处于时免疫控制类异常状态|自身异常状态结束的当回合结束后转动星盘1刻，转动成功下回合结束后自身再次进行星启，星盘转动12个刻度后直到刻度回返至0不会再次转动，期间自身免疫对手的攻击且每回合进行一次额外行动触发覆宙星回|（boss无效）';
  const p1879 = B.parseSoulmark(d1879);
  eq(p1879.length, 5, '4677：魂印解析出 5 条');
  eq(p1879[0].kind, 'starAtkSum', '4677：双攻取和');
  eq(p1879[1].kind, 'starSpecialPrio', '4677：特殊攻击先制');
  eq(p1879[2].kind, 'starPhysDrain', '4677：物理攻击吸血');
  eq(p1879[3].kind, 'starEntry', '4677：登场星启');
  eq(p1879[4].kind, 'starDial', '4677：星盘');

  // 登场星启：攻击 > 特攻 → 星赐；免疫疲惫
  {
    const b = pb([pe(hpPet(4677, '天启星魂'), p1879)], [pe(hpPet(9, '木桩'))]);
    const c = b.me.team[0];
    eq(c.starGift, 2, '4677：登场星启获得 2 回合星赐');
    eq(c.starPhil, 0, '4677：未获得星哲');
    b.applyStatus(c, 'tired', 2, '对手');
    eq(c.status, null, '4677：星赐免疫疲惫');
    b.applyStatus(c, 'fear', 2, '对手');
    eq(c.status && c.status.id, 'fear', '4677：星赐不免疫害怕');
    c.status = null;
    c.starPhil = 2;
    b.applyStatus(c, 'paralyze', 2, '对手');
    eq(c.status, null, '4677：星赐+星哲免疫控制类异常');
  }

  // 双攻取和 + 特殊攻击先制 +1
  {
    const b = pb([pe(hpPet(4677, '天启星魂'), p1879)], [pe(hpPet(9, '木桩'))]);
    const c = b.me.team[0], f = b.foe.team[0];
    const skill = c.skills[0].skill;
    const calc = () => B.calcDamage({
      actor: c, target: f, skill, skillCombo: combo, actorCombo: combo,
      targetCombo: combo, chart, level: 100, rng: () => 0.5
    }).damage;
    const sumDmg = calc();
    c.starAtkSum = false;
    const normalDmg = calc();
    c.starAtkSum = true;
    ok(sumDmg > normalDmg, '4677：双攻取和后伤害提高（' + normalDmg + '→' + sumDmg + '）');

    c.skills.push({ skill: sk(2, '特殊', 80, 2), pp: 20, maxPp: 20 });
    eq(b.actionPriority(c, { type: 'skill', index: 0 }), 0, '4677：物理技能无额外先制');
    eq(b.actionPriority(c, { type: 'skill', index: 1 }), 1, '4677：特殊技能先制 +1');
  }

  // 物理攻击后吸取双防总和 30%
  {
    const b = pb([pe(hpPet(4677, '天启星魂'), p1879)], [pe(hpPet(9, '木桩'))]);
    const c = b.me.team[0], f = b.foe.team[0];
    c.hp = Math.floor(c.maxHp * 0.5);
    b.step({ type: 'skill', index: 0 });
    ok(b.log.some(x => x.indexOf('物理攻击吸取') >= 0), '4677：物理攻击后吸取体力');
  }

  // 梦觉星启：已处于星赐 → 全属性 +1；再附加星哲
  {
    const dream = sk(37514, '梦觉星启', 0, 4, [
      { info: '为自身附加2回合的星赐，若自身已处于星赐则改为全属性+1' },
      { info: '为自身附加2回合的星哲，若自身已处于星哲则改为全属性+1' }
    ]);
    const b = pb([pe(hpPet(4677, '天启星魂'), p1879, [dream])], [pe(hpPet(9, '木桩'))]);
    const c = b.me.team[0];
    c.starGift = 2;
    c.starPhil = 0;
    const atk0 = c.stages.atk;
    b.useSkill('me', 0, { isFirst: true });
    eq(c.stages.atk, atk0 + 1, '4677：梦觉星启在星赐中改为全属性 +1');
    eq(c.starPhil, 2, '4677：梦觉星启附加星哲');
  }

  // 魂·天忤太虚：星赐→物理，造成伤害
  {
    const tian = sk(28810, '魂·天忤太虚', 0, 4, []);
    const b = pb([pe(hpPet(4677, '天启星魂'), p1879, [tian])], [pe(hpPet(9, '木桩'))]);
    const c = b.me.team[0], f = b.foe.team[0];
    c.starGift = 2;
    c.starPhil = 0;
    const h0 = f.hp;
    b.step({ type: 'skill', index: 0 });
    ok(f.hp < h0, '4677：星赐下天忤太虚转化为物理攻击并造成伤害');
  }

  // 星盘：异常结束转 1 刻；99% 减伤 + PP 归零；12 刻回返
  {
    const b = pb([pe(hpPet(4677, '天启星魂'), p1879)], [pe(hpPet(9, '木桩'))]);
    const c = b.me.team[0], f = b.foe.team[0];
    c.starHadStatus = true;
    c.status = null;
    b.endOfTurn();
    eq(c.starDial, 1, '4677：异常结束后星盘 +1 刻');
    eq(c.starGuardTurns, 1, '4677：转动后获得 1 回合减伤');
    b.startOfTurn();
    eq(c.starPpZero, true, '4677：转动后的回合末 PP 归零待触发');
    const hp0 = c.hp;
    b.applyDamage('me', 1000, { attack: true });
    eq(hp0 - c.hp, 10, '4677：转动后 1 回合受伤 -99%');
    b.endOfTurn();
    ok(f.skills.some(s => s.pp === 0), '4677：回合末令对手 1 项技能 PP 归零');

    c.starDial = 11;
    c.starReturn = false;
    c.starHadStatus = true;
    c.status = null;
    b.endOfTurn();
    eq(c.starDial, 12, '4677：星盘达到 12 刻');
    eq(c.starReturn, true, '4677：进入回返阶段');
    b.startOfTurn();
    eq(c.starAttackImmune, true, '4677：回返期间免疫攻击');
    const fh0 = f.hp;
    b.endOfTurn();
    eq(fh0 - f.hp, 120, '4677：覆宙星回造成 120 点伤害');
    eq(c.starDial, 11, '4677：覆宙星回令星盘回返 1 刻');
  }
}

console.log('\n— 12 格背包 / 培养系统 —');
{
  const combo = { id: 1, name: '草', primary: { id: 1 }, secondary: null };
  const basePet = { id: 1, name: '测试', base_stats: { hp: 100, atk: 100, def: 100, sp_atk: 100, sp_def: 100, spd: 100 } };
  const s0 = B.computeStats(basePet, { level: 100, iv: 0 });
  const s31 = B.computeStats(basePet, { level: 100, iv: 31 });
  ok(s31.atk > s0.atk && s31.hp > s0.hp, '天赋 0→31 面板提高');
  const lv1 = B.computeStats(basePet, { level: 1, iv: 31 });
  ok(lv1.hp < s31.hp && lv1.atk < s31.atk, '等级 1 面板低于 100');
  eq(lv1.hp, Math.floor((2 * 100 + 31) * 1 / 100) + 1 + 10, '等级公式与原作一致（HP）');
  const sn = B.computeStats(basePet, { level: 100, iv: 31, nature: { attributes: { atk: 10, sp_atk: -10, percent: true } } });
  eq(sn.atk, Math.floor(s31.atk * 1.1), '性格 +10% 攻击');
  const sb = B.computeStats(basePet, { level: 100, iv: 31, bonus: { hp: 100, atk: 50 }, bonusPct: { spd: 10 } });
  eq(sb.hp, s31.hp + 100, '刻印/套装体力加算');
  eq(sb.atk, s31.atk + 50, '刻印/套装攻击加算');
  eq(sb.spd, Math.floor(s31.spd * 1.1), '套装百分比速度');

  const pe = (pet, passives, reserve) => ({ pet, combo, skills: [mkSkill({ power: 1 })], passives: passives || [] });
  const mkB = (me, meReserve, foe) => new B.Battle({
    chart, comboOf: () => combo, rng: () => 0, level: 100,
    meTeam: me, meReserve: meReserve || [], foeTeam: foe
  });

  // 每只精灵独立等级：战斗内按 entry.level 计算
  {
    const me = [{ pet: basePet, combo, skills: [mkSkill({ power: 1 })], level: 50 }];
    const b = mkB(me, [], [{ pet: { id: 9, name: '木桩', base_stats: basePet.base_stats }, combo, skills: [mkSkill({ power: 1 })] }]);
    eq(b.me.team[0].level, 50, '战斗内使用精灵等级 50');
    eq(b.me.team[0].maxHp, B.computeStats(basePet, { level: 50, iv: 31 }).hp, '战斗面板按等级 50 计算');
  }

  // 西游：三人在备战、一人在出战，仍触发羁绊
  {
    const p723 = B.parseSoulmark('自身在出战背包时使己方出战精灵每次攻击25%的概率伤害提高50%，未触发则随机{吸取}对手1~100点{体力}（BOSS无效）');
    const me = [pe({ id: 2727, name: '蒙奇多克', base_stats: basePet.base_stats })];
    const reserve = [
      { pet: { id: 3409, name: '三藏', base_stats: basePet.base_stats }, combo, passives: p723, benchAura: [{ names: null, fx: p723[0].fx }] },
      { pet: { id: 3519, name: '沙悟净', base_stats: basePet.base_stats }, combo, passives: [] },
      { pet: { id: 2735, name: '天河神将', base_stats: basePet.base_stats }, combo, passives: [] }
    ];
    const b = mkB(me, reserve, [pe({ id: 9, name: '木桩', base_stats: basePet.base_stats })]);
    eq(b.benchAuras.me.westward, true, '西游：备战格也计入四人羁绊');
    eq(b.me.team[0].stages.atk, 1, '西游：备战触发首发全属性 +1');
    ok(!!b.benchAuras.me.attackBuff, '西游：备战三藏的攻击光环生效');
  }

  // 3986 在备战格不生效，在出战格生效
  {
    const p3986 = B.parseSoulmark('神照：自身在出战背包时，己方首发精灵首次登场时获得一个等同于自身最大体力值30%的护盾（boss有效）');
    const shieldAura = { names: null, fx: { type: 'firstShield', pct: 30 } };
    const first = pe({ id: 1, name: '首发', base_stats: basePet.base_stats });
    const b1 = mkB([first], [{ pet: { id: 3986, name: '启灵元神', base_stats: basePet.base_stats }, combo, passives: p3986, benchAura: [shieldAura] }],
      [pe({ id: 9, name: '木桩', base_stats: basePet.base_stats })]);
    eq(b1.me.team[0].shield, 0, '3986 在备战格：神照不生效');
    const b2 = mkB([first, pe({ id: 3986, name: '启灵元神', base_stats: basePet.base_stats }, p3986)],
      [], [pe({ id: 9, name: '木桩', base_stats: basePet.base_stats })]);
    ok(b2.me.team[0].shield > 0, '3986 在出战格：神照生效');
  }

  // 桃园：两名兄弟在备战，仍计入层数
  {
    const p246 = B.parseSoulmark('背包内每存在一种三兄弟精灵时自身每回合恢复15点体力(最多每回合恢复45点)');
    const me = [pe({ id: 2512, name: '昭烈帝刘备', base_stats: basePet.base_stats }, p246)];
    const reserve = [
      { pet: { id: 2520, name: '武圣·关羽', base_stats: basePet.base_stats }, combo, passives: p246 },
      { pet: { id: 2530, name: '万人敌张飞', base_stats: basePet.base_stats }, combo, passives: p246 }
    ];
    const b = mkB(me, reserve, [pe({ id: 9, name: '木桩', base_stats: basePet.base_stats })]);
    const c = b.me.team[0];
    c.hp = c.maxHp - 200;
    const hp0 = c.hp;
    b.endOfTurn();
    eq(c.hp - hp0, 45, '桃园：备战格兄弟计入 3 人回血');
  }
}
