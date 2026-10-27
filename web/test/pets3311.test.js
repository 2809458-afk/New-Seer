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
const SOUL638 = '[固伤效果]:|每次使用攻击技能附加对手上次造成伤害数值一半的固定伤害（BOSS无效); |[拦截效果]:|自身死亡后100%重生一次，重生时消除对手能力提升状态和回合类效果，消除任意一项成功则自身免疫下1次受到的异常状态; |[触发效果]:|重生后自身2回合所有技能威力提升100%';
function battle(meSkills, foeSkill) {
  return new B.Battle({ chart, comboOf: () => combo, rng: () => 0, level: 100,
    meTeam: [{ pet: pet(3311, '圣光灵神'), combo, skills: meSkills, passives: B.parseSoulmark(SOUL638) }],
    foeTeam: [{ pet: pet(2, '木桩'), combo, skills: [foeSkill || skill({ id: 2, name: '撞击', power: 10, category: { id: 1 } })] }] });
}
console.log('— 3311 圣光灵神：魂印解析 —');
{
  const sm = B.parseSoulmark(SOUL638);
  ok(sm.some(x => x.kind === 'prevDamageHalfAttack'), '攻击技能附加对手上次伤害一半固伤');
  const rv = sm.filter(x => x.kind === 'reviveOnce')[0];
  ok(!!rv && rv.clear === true && rv.immune === true, '死亡后重生 + 清强化/断回合 + 免疫下次异常');
  const rp = sm.filter(x => x.kind === 'revivePowerBuff')[0];
  ok(!!rp && rp.turns === 2 && rp.mul === 2, '重生后 2 回合技能威力翻倍');
}
{
  const b = battle([skill({ id: 3, name: '攻击', power: 0, category: { id: 1 } })]);
  const me = b.me.team[0];
  ok(me.prevDamageHalf === true && !!me.reviveOnce, '魂印字段装载');
}
console.log('— 3311 实战 —');
{
  const b = battle([skill({ id: 3, name: '攻击', power: 0, category: { id: 1 } })]);
  const foe = b.foe.team[0];
  foe.lastDealt = 200;
  b.step({ type: 'skill', index: 0 });
  ok(foe.maxHp - foe.hp >= 100, '对手上次伤害 200 → 附加 100 固伤（实际 ' + (foe.maxHp - foe.hp) + '）');
}
{
  const b = battle([skill()]);
  const foe = b.foe.team[0];
  const hp0 = foe.hp;
  b.step({ type: 'skill', index: 0 });
  eq(hp0 - foe.hp, 0, '对手无上次伤害 → 不附加');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.stages.atk = 3;
  foe.damageBuff = { turns: 3, mul: 2 };
  me.hp = 0;
  b.checkFaints();
  eq(me.hp, me.maxHp, '重生：满血复活');
  ok(me.reviveUsed === true, '重生：只触发一次');
  eq(foe.stages.atk, 0, '重生：清除对手强化');
  ok(!foe.damageBuff, '重生：清除对手回合类效果');
  ok(me.immuneStatus >= 1, '重生：免疫下次异常');
  ok(!!me.damageBuff && me.damageBuff.turns === 2 && me.damageBuff.mul === 2, '重生后 2 回合威力 ×2');
  ok(b.log.some(x => /重生/.test(x)), '重生日志');
  me.hp = 0;
  b.checkFaints();
  eq(me.hp, 0, '第二次阵亡不再重生');
  ok(b.log.some(x => /倒下了/.test(x)), '正常阵亡日志');
}

console.log('— 3311 技能效果补全（v20261024v）—');
function battleRng(meSkills, rng) {
  return new B.Battle({ chart, comboOf: () => combo, rng: rng || (() => 0), level: 100,
    meTeam: [{ pet: pet(3311, '圣光灵神'), combo, skills: meSkills, passives: [] }],
    foeTeam: [{ pet: pet(2, '木桩'), combo, skills: [skill({ id: 2, name: '撞击', power: 10, category: { id: 1 } })] }] });
}
{
  const mk = () => [skill({ id: 12903, name: '正义之光', power: 80, category: { id: 1 }, effects: [{ id: 30, args: [2], info: '后出手的话威力为2倍' }] })];
  const bLast = battleRng(mk()), bFirst = battleRng(mk());
  const f1 = bLast.foe.team[0], f2 = bFirst.foe.team[0];
  const h1 = f1.hp, h2 = f2.hp;
  bLast.useSkill('me', 0, { isFirst: false });
  bFirst.useSkill('me', 0, { isFirst: true });
  const dLast = h1 - f1.hp, dFirst = h2 - f2.hp;
  ok(dLast > dFirst * 1.5, '正义之光：后手威力 2 倍（后手 ' + dLast + ' / 先手 ' + dFirst + '）');
  ok(dFirst > 0, '正义之光：先手正常伤害');
}
{
  const b10 = battleRng([skill({ id: 16687, name: '圣灵斩杀', power: 1, category: { id: 1 }, effects: [{ id: 93, args: [10, 200], info: '10%概率额外附加200点固定伤害' }] })], () => 0);
  const f10 = b10.foe.team[0];
  b10.useSkill('me', 0, { isFirst: true });
  ok(f10.maxHp - f10.hp >= 200, '圣灵斩杀：10% 触发附加 200 固伤（实际 ' + (f10.maxHp - f10.hp) + '）');
  const b90 = battleRng([skill({ id: 16687, name: '圣灵斩杀', power: 1, category: { id: 1 }, effects: [{ id: 93, args: [10, 200], info: '10%概率额外附加200点固定伤害' }] })], () => 0.5);
  const f90 = b90.foe.team[0];
  b90.useSkill('me', 0, { isFirst: true });
  ok(f90.maxHp - f90.hp < 200, '圣灵斩杀：未触发时不附加 200（实际 ' + (f90.maxHp - f90.hp) + '）');
}
{
  const mk = () => [skill({ id: 16688, name: '圣世锋芒斩', power: 80, category: { id: 1 }, effects: [{ id: 609, args: [2], info: '若对手疲惫，技能威力翻倍' }] })];
  const bT = battleRng(mk()), bN = battleRng(mk());
  const fT = bT.foe.team[0], fN = bN.foe.team[0];
  fT.status = { id: 'tired', turns: 2 };
  const h1 = fT.hp, h2 = fN.hp;
  bT.useSkill('me', 0, { isFirst: true });
  bN.useSkill('me', 0, { isFirst: true });
  const dT = h1 - fT.hp, dN = h2 - fN.hp;
  ok(dT > dN * 1.5, '圣世锋芒斩：对手疲惫时威力翻倍（' + dT + ' / ' + dN + '）');
}
{
  const b = battleRng([skill({ id: 25338, name: '寰宇纵横', effects: [{ id: 894, args: [200], info: '吸取对手200点体力' }, { id: 470, args: [70, 4], info: '4回合内若自身攻击技能命中则70%令对手疲惫' }, { id: 1125, args: [3, 2], info: '3回合内对手所有攻击必定Miss' }] })]);
  const me = b.me.team[0], foe = b.foe.team[0];
  b.useSkill('me', 0, { isFirst: true });
  eq(me.attackHitStatus && me.attackHitStatus.turns, 4, '寰宇纵横：4 回合命中附加疲惫窗口');
  eq(foe.missTurns, 3, '寰宇纵横：对手 3 回合必 Miss');
  ok(!!me.attrBlockIfHit, '寰宇纵横：命中后属性技封锁标记');
  ok(foe.maxHp - foe.hp >= 200, '寰宇纵横：吸取 200 体力');
}
{
  const b = battleRng([skill({ id: 23771, name: '神圣领域', effects: [{ id: 433, args: [1, 3], info: '3回合内每回合攻击+1，速度+1，命中+1' }, { id: 690, args: [3], info: '下3回合能力提升消失则对手属性技失效' }] })]);
  const me = b.me.team[0], foe = b.foe.team[0];
  b.useSkill('me', 0, { isFirst: true });
  ok(!!me.buffGoneAttr, '神圣领域：能力提升消失封锁标记');
  Object.keys(me.stages).forEach(k => { me.stages[k] = 0; });
  b.startOfTurn();
  ok((foe.skillBlock || 0) >= 2, '能力提升消失 → 对手属性技失效 2 回合');
}
{
  const b = battleRng([skill({ id: 30468, name: '圣光十字裂', power: 120, category: { id: 1 }, effects: [{ id: 1126, args: [2, 1], info: '使对手随机2项技能PP值归零，若当回合受到攻击则额外1项' }] })]);
  const foe = b.foe.team[0];
  foe.skills.push({ skill: skill({ id: 22, name: '额外' }), pp: 10, maxPp: 10 });
  foe.skills.forEach(x => { x.pp = 10; x.maxPp = 10; });
  b.useSkill('me', 0, { isFirst: true });
  const zero1 = foe.skills.filter(x => x.pp === 0).length;
  eq(zero1, 2, '圣光十字裂：清零 2 个技能 PP');
  foe.skills[0].pp = 10;   // 让对手还能出招，检验「受到攻击额外清零」
  const before = foe.skills.filter(x => x.pp === 0).length;
  b.useSkill('foe', 0, { isFirst: false });
  const after = foe.skills.filter(x => x.pp === 0).length;
  ok(after === before + 1, '受攻击后额外清零 1 个 PP（' + before + ' → ' + after + '）');
}
{
  const b = battleRng([skill({ id: 16686, name: '普照环宇', effects: [{ id: 39, args: [2], info: '降低对手所有技能2点PP值，然后若对手所选择的技能PP值为0则当回合对手无法行动' }] })]);
  const foe = b.foe.team[0];
  foe.skills.forEach(x => { x.pp = 1; });
  b.useSkill('me', 0, { isFirst: true });
  ok(foe.skills.every(x => x.pp === 0), '普照环宇：对手全技能 PP -2');
  ok(foe.status && foe.status.id === 'tired', '所选择技能 PP 归零 → 对手无法行动');
}
{
  const b = battleRng([skill({ id: 25339, name: '剑定天穹', effects: [{ id: 532, args: [3, 3, 5], info: '5回合内每回合使用技能恢复自身最大体力的1/3并造成等量百分比伤害' }] })]);
  const me = b.me.team[0], foe = b.foe.team[0];
  me.hp = Math.floor(me.maxHp / 2);
  const fh = foe.hp;
  b.useSkill('me', 0, { isFirst: true });
  ok(me.hp > Math.floor(me.maxHp / 2), '剑定天穹：使用技能回血');
  ok(fh - foe.hp > 0, '剑定天穹：造成等量百分比伤害（' + (fh - foe.hp) + '）');
}

if (fails) { console.error('FAILED ' + fails); process.exit(1); }
console.log('ALL PASS');
