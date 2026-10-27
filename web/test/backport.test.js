/* 阶段 2 补回项：B01 清强→回血顺序、B02 随机威力前置（PORT_NOTES D005 / D007） */
global.self = global;
const B = require('../js/battle.js');

let fails = 0;
function ok(cond, msg) {
  if (cond) console.log('  ok  ' + msg);
  else { fails++; console.error('  FAIL ' + msg); }
}

const combo = { id: 1, name: '草', primary: { id: 1 }, secondary: null };
const chart = { 1: { 1: 1 } };

function pet(id, name) {
  return { id: id, name: name, base_stats: { hp: 1000, atk: 140, def: 100, sp_atk: 100, sp_def: 100, spd: 100 } };
}
function skill(over) {
  return Object.assign({
    id: 1, name: '测试技能', power: 0, max_pp: 10, accuracy: 100, crit_rate: 0,
    priority: 0, must_hit: true, category: { id: 4 }, type: { id: 1 }, info: '', effects: []
  }, over || {});
}
function battle(meSkills, foeSkill) {
  return new B.Battle({
    chart: chart, comboOf: function () { return combo; }, rng: function () { return 0.9; }, level: 100,
    meTeam: [{ pet: pet(1, '我方'), combo: combo, skills: meSkills }],
    foeTeam: [{ pet: pet(2, '木桩'), combo: combo, skills: [foeSkill || skill({ id: 99, name: '木桩技能' })] }]
  });
}

console.log('— B01 消除对手能力提升，消除成功则恢复自身全部体力（D005）—');
{
  const sk = skill({ id: 201, name: '清强回血', info: '消除对手能力提升状态，消除成功则恢复自身全部体力' });
  const b = battle([sk, skill({ id: 202, name: '待机' })]);
  const me = b.activeOf('me'), foe = b.activeOf('foe');
  me.hp = 400;
  foe.stages.atk = 2;
  foe.stages.spd = 1;
  b.useSkill('me', 0, { isFirst: true });
  ok(foe.stages.atk === 0, '对手攻击提升被清除');
  ok(me.hp === me.maxHp, '清强成功后回满体力（400 → ' + me.hp + ' / ' + me.maxHp + '）');
}
{
  // 反例：对手没有能力提升时不应回血，防止把 heal 改成无条件
  const sk = skill({ id: 203, name: '清强回血2', info: '消除对手能力提升状态，消除成功则恢复自身全部体力' });
  const b = battle([sk]);
  const me = b.activeOf('me');
  me.hp = 400;
  b.useSkill('me', 0, { isFirst: true });
  ok(me.hp === 400, '对手没有强化时不回血（保持 ' + me.hp + '）');
}

console.log('— B02 随机威力必须在伤害前选定（D007）—');
const RAMP_TEXT = '威力随机，随机范围150-300，连续使用每次威力提升30，最高提升至300';
{
  const randomSkill = skill({ id: 301, name: '随机威力', power: 40, category: { id: 1 }, info: RAMP_TEXT });
  const plainSkill = skill({ id: 302, name: '定值威力', power: 40, category: { id: 1 }, info: '' });
  function damageOf(sk) {
    const b = battle([sk]);
    const me = b.activeOf('me'), foe = b.activeOf('foe');
    me.hp = 100000; me.maxHp = 100000;
    foe.hp = 100000; foe.maxHp = 100000;
    b.useSkill('me', 0, { isFirst: true });
    return 100000 - foe.hp;
  }
  const randomDamage = damageOf(randomSkill);
  const plainDamage = damageOf(plainSkill);
  ok(randomDamage > plainDamage * 4, '随机威力生效：285 威力打出 ' + randomDamage + '，40 威力打出 ' + plainDamage);
  ok(randomDamage > 300, '随机威力伤害量级正确（> 300）');
}

console.log('— B04 命中/闪避负等级用独立倍率表（D006）—');
{
  const expect = { 0: 1, 1: 1.5, 2: 2, 3: 2.5, 4: 3, 5: 3.5, 6: 4, '-1': 0.85, '-2': 0.70, '-3': 0.55, '-4': 0.45, '-5': 0.35, '-6': 0.25 };
  let tableOk = true;
  Object.keys(expect).forEach(function (k) {
    const got = B.accuracyMul(Number(k));
    if (Math.abs(got - expect[k]) > 1e-9) { tableOk = false; console.error('   等级 ' + k + ' 期望 ' + expect[k] + ' 实际 ' + got); }
  });
  ok(tableOk, '命中倍率表 -6..+6 与 Godot battle_math.accuracy_mul 一致');

  // 旧公式会把 -2 当 0.5；新表为 0.70，用固定 rng 区分
  const b = battle([skill({ id: 401, name: '命中测试' })]);
  const me = b.activeOf('me'), foe = b.activeOf('foe');
  me.stages.acc = -2;
  b.rng = function () { return 0.6; };
  const hit = b.accuracyCheck(me, foe, { id: 401, accuracy: 100, must_hit: false, category: { id: 1 } });
  ok(hit === true, '命中 -2 时 0.6 的掷点应命中（旧公式 0.5 会 Miss）');
  ok(B.stageMul(-2) === 0.5, '普通能力仍用倒数倍率（stageMul(-2)=0.5），两套不混用');
}

console.log('— B08 属性系直伤走克制与护盾，不吃固百抗性/护罩（D006）—');
function attrBattle(chart, typeByName, text) {
  const sk = skill({ id: 501, name: '属性直伤', info: text });
  return new B.Battle({
    chart: chart, typeByName: typeByName, comboOf: function () { return combo; },
    rng: function () { return 0.9; }, level: 100,
    meTeam: [{ pet: pet(1, '我方'), combo: combo, skills: [sk] }],
    foeTeam: [{ pet: pet(2, '木桩'), combo: combo, skills: [skill({ id: 99, name: '木桩技能' })] }]
  });
}
{
  const b = attrBattle({ 1: { 1: 1 } }, { '草': 1 }, '直接造成100点草系伤害，自身每处于一种能力提升状态则造成的伤害提高10%');
  const foe = b.activeOf('foe');
  foe.fixedResist = 100;
  foe.ward = 500;
  foe.shield = 100;
  foe.hp = 1000;
  b.useSkill('me', 0, { isFirst: true });
  ok(foe.shield === 0, '护盾吸收属性直伤（护盾 100 → ' + foe.shield + '）');
  ok(foe.ward === 500, '护罩不参与属性直伤（保持 ' + foe.ward + '）');
  ok(foe.hp === 1000, '固伤抗性 100 不影响属性直伤（HP 保持 ' + foe.hp + '）');
}
{
  const b = attrBattle({ 8: { 1: 2 } }, { '龙': 8 }, '直接造成100点龙系伤害，自身每处于一种能力提升状态则造成的伤害提高10%');
  const foe = b.activeOf('foe');
  foe.shield = 30;
  foe.hp = 1000;
  b.useSkill('me', 0, { isFirst: true });
  ok(foe.shield === 0, '护盾先被扣光（保持 ' + foe.shield + '）');
  ok(foe.hp === 830, '龙打草克制 ×2：200 点伤害扣掉护盾后为 170（HP → ' + foe.hp + '）');
}

console.log('— B03 连续增伤不提前取整（D007）—');
{
  // 固定 rng=0：不暴击（crit_rate 0）、随机浮动取下界 0.85，便于用公式反推期望值
  function b03Battle() {
    const sk = skill({ id: 401, name: '连击增伤', power: 100, category: { id: 1 }, crit_rate: 0, must_hit: true });
    return new B.Battle({
      chart: chart, comboOf: function () { return combo; }, rng: function () { return 0; }, level: 100,
      meTeam: [{ pet: pet(1, '我方'), combo: combo, skills: [sk] }],
      foeTeam: [{ pet: pet(2, '木桩'), combo: combo, skills: [skill({ id: 99, name: '木桩技能' })] }]
    });
  }
  function damageWith(dealtMul) {
    const b = b03Battle();
    const me = b.activeOf('me'), foe = b.activeOf('foe');
    if (dealtMul != null) me.dealtMul = dealtMul;
    me.hp = 100000; me.maxHp = 100000;
    foe.hp = 100000; foe.maxHp = 100000;
    b.useSkill('me', 0, { isFirst: true });
    const lost = 100000 - foe.hp;
    // 用引擎公开的数值反推「未取整」基准：pow(1) 那一刀的整数结果无法还原小数，
    // 所以这里独立按公式算 baseDmg，再断言增伤是乘在小数上
    const A = me.stats.atk * B.stageMul(me.stages.atk);
    const D = foe.stats.def * B.stageMul(foe.stages.def);
    const baseDmg = Math.floor(Math.floor(Math.floor(2 * 100 / 5 + 2) * 100 * A / D) / 50) + 2;
    const expected = Math.max(1, Math.floor(baseDmg * 1.5 * 1 * 0.85 * (dealtMul || 1)));
    return { lost: lost, expected: expected };
  }
  const plain = damageWith(null);
  ok(plain.lost === plain.expected, '基准：无增伤时伤害 = floor(公式 × 0.85)（' + plain.lost + '）');

  const boosted = damageWith(1.9);
  // 用 1.9 放大小数误差：先取整再乘会得 floor(已取整值 × 1.9)，与正确结果差 1
  const earlyFloor = Math.floor(plain.lost * 1.9);
  ok(boosted.lost === boosted.expected,
    '增伤乘在未取整值上：期望 ' + boosted.expected + '，实际 ' + boosted.lost);
  ok(boosted.lost !== earlyFloor,
    '与「先取整再乘」区分：提前取整会得 ' + earlyFloor + '，实际 ' + boosted.lost);
}

console.log('— B06 致死判定按严格大于当前体力（D006 / godot battle_core.gd:714）—');
{
  function battleWith(over) {
    const b = battle([skill({ id: 501, name: '普通攻击', power: 40, category: { id: 1 } })]);
    const foe = b.activeOf('foe');
    foe.hp = over.hp; foe.maxHp = over.maxHp || over.hp;
    if (over.survive) foe.survive = over.survive;
    if (over.rebirth) foe.hasRebirth = true;
    return { b: b, foe: foe };
  }
  function hit(raw) {
    const ctx = battleWith({ hp: 200 });
    return ctx;
  }

  // 1) 伤害恰好等于体力：strict >，保命不触发
  {
    const { b, foe } = battleWith({ hp: 200, survive: { turns: 1, hp: 100 } });
    b.applyDamage('foe', 200, { attack: true, physical: true });
    ok(foe.hp === 0, '伤害 = 体力时不触发保命（HP ' + foe.hp + '）');
    ok(!b.log.some((l) => /撑住了这一击/.test(l)), '没有「撑住了这一击」日志');
  }
  // 2) 伤害超过体力 1 点：保命触发
  {
    const { b, foe } = battleWith({ hp: 200, survive: { turns: 1, hp: 100 } });
    b.applyDamage('foe', 201, { attack: true, physical: true });
    ok(foe.hp === 100, '伤害 > 体力时保命触发，保留 ' + foe.hp + ' 点');
  }
  // 3) 轮回类（首次致死保留 1）仍是 >=：等于体力也保留 1
  {
    const { b, foe } = battleWith({ hp: 200, rebirth: true });
    b.applyDamage('foe', 200, { attack: true, physical: true });
    ok(foe.hp === 1, '轮回魂印 >= 判定：伤害 = 体力仍保留 1 点（HP ' + foe.hp + '）');
  }
  // 4) 保命效果存在时，恰好致死的这一击不能落到轮回保留 1
  {
    const { b, foe } = battleWith({ hp: 200, survive: { turns: 1, hp: 100 }, rebirth: true });
    b.applyDamage('foe', 200, { attack: true, physical: true });
    ok(foe.hp === 0, 'survive 生效期间轮回不被「恰好致死」触发（HP ' + foe.hp + '）');
  }
}

if (fails) { console.error('失败 ' + fails + ' 项'); process.exit(1); }
console.log('全部通过');
