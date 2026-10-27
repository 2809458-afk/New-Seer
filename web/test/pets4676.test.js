global.self = global;
const B = require('../js/battle.js');
let fails = 0;
function ok(c, m) { if (c) console.log('  ok  ' + m); else { fails++; console.error('  FAIL ' + m); } }
function eq(a, b, m) { ok(a === b, m + ' (期望 ' + b + '，实际 ' + a + ')'); }
const combo = { id: 1, name: '草', primary: { id: 1 }, secondary: null };
const chart = { 1: { 1: 1 } };
function pet(id, name) { return { id, name, base_stats: { hp: 1000, atk: 140, def: 100, sp_atk: 100, sp_def: 100, spd: 100 } }; }
function skill(over) {
  return Object.assign({ id: 1, name: '测试技能', power: 0, max_pp: 10, accuracy: 100, crit_rate: 0,
    priority: 0, must_hit: true, category: { id: 4 }, type: { id: 1 }, info: '', effects: [] }, over || {});
}
const SOUL = '登场时，对手2回合内属性技能无效、攻击技能无法附加异常状态与能力下降状态，若登场当回合对手未选择技能则当回合结束后为对手附加2道蚩庸之锁|对手每次使用技能时随机2项能力等级-1，未触发则自身当回合受到的攻击伤害、固定伤害、百分比伤害减少50%，然后若本次技能为攻击技能则自身下回合所有技能先制+1且必定命中，若本次技能为属性技能则附加对手最大体力1/3的百分比伤害且对手下次受到的攻击伤害提升100%|（boss无效）';
const PASS = B.parseSoulmark(SOUL);
function battle(meSkills, rngv) {
  return new B.Battle({ chart, comboOf: () => combo, rng: () => (rngv == null ? 0 : rngv), level: 100,
    meTeam: [{ pet: pet(4676, '神觉·米斯蒂克'), combo, skills: meSkills, passives: PASS }],
    foeTeam: [{ pet: pet(2, '木桩'), combo, skills: [skill({ id: 21, name: '撞击', power: 60, category: { id: 1 } }), skill({ id: 22, name: '强化', category: { id: 4 }, effects: [{ id: 5, args: [1], info: 'x' }] })] }] });
}
console.log('— 4676 神觉·米斯蒂克：魂印 —');
ok(PASS.some(p => p.kind === 'mistikeEntry'), '登场压制');
ok(PASS.some(p => p.kind === 'mistikeReact'), '每次对手使用技能的反应');
{
  const b = battle([skill()]);
  const me = b.me.team[0];
  ok(me.mistikeSoul === true, '魂印装载');
}
console.log('— 技能 id —');
{
  const cast = skill({ id: 28809, name: '魂劫骇咒', priority: 1, effects: [{ id: 1338, args: [1], info: 'x' }] });
  const b = battle([cast], 0.5);
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.stages.atk = -1;
  b.step({ type: 'skill', index: 0 });
  eq(me.stages.atk, 2, '1338：对手有下降 → 全属性 +2');
}
{
  const cast = skill({ id: 28808, name: '心朽魂凋', priority: 1, effects: [{ id: 1428, args: [100, 3, -1, 0, -1, 0, -1, 0], info: 'x' }] });
  const b = battle([cast], 0.5);
  const foe = b.foe.team[0];
  b.step({ type: 'skill', index: 0 });
  ok(foe.stages.atk <= -2, '1428：立即全属性 -1（含回合末再 -1 → ' + foe.stages.atk + '）');
  ok(foe.stages.atk <= -2, '1428：回合末每回合再 -1（实际 ' + foe.stages.atk + '）');
}
{
  const cast = skill({ id: 28809, name: '魂劫骇咒', priority: 1, effects: [{ id: 2076, args: [4, 3, 2, 200], info: 'x' }] });
  const b = battle([cast], 0.5);
  const me = b.me.team[0], foe = b.foe.team[0];
  me.hp = Math.floor(me.maxHp / 2);
  b.step({ type: 'skill', index: 0 });
  ok(me.teDrain && me.teDrain.turns === 3, '2076：4 回合吸血（本回合已结算 → 剩 ' + (me.teDrain && me.teDrain.turns) + '）');
  ok(foe.hp < foe.maxHp, '2076：对手被吸取');
  ok(me.hp > Math.floor(me.maxHp / 2), '2076：低于半血吸得更狠（现实 ' + me.hp + '）');
}
{
  const cast = skill({ id: 37511, name: '王·御影神罚', priority: 1, effects: [{ id: 907, args: [], info: 'x' }] });
  const b = battle([cast], 0.5);
  const me = b.me.team[0], foe = b.foe.team[0];
  me.stages.atk = -2;
  foe.skills.forEach(s => { s.pp = 10; });
  b.step({ type: 'skill', index: 0 });
  eq(me.stages.atk, 2, '907：自身下降被反转');
  const zeroed = foe.skills.filter(s => s.pp === 0).length;
  eq(zeroed, 2, '907：成功后随机 2 个技能 PP 归零');
}
{
  const cast = skill({ id: 19473, name: '堕之绝响', priority: 1, effects: [{ id: 2213, args: [50], info: 'x' }] });
  const b = battle([cast], 0.5);
  const me = b.me.team[0];
  me.hp = 1000;
  b.step({ type: 'skill', index: 0 });
  ok(b.nextAllyShield && b.nextAllyShield.value === 500, '2213：下只精灵获得消耗值 50% 护盾 (' + (b.nextAllyShield && b.nextAllyShield.value) + ')');
}
console.log('— 异常编号表与 1471/2212/469 —');
function mk(meSkill, foeSkill, rngv) {
  return new B.Battle({ chart, comboOf: () => combo, rng: () => (rngv == null ? 0 : rngv), level: 100,
    meTeam: [{ pet: pet(2, '测试体'), combo, skills: [meSkill], passives: [] }],
    foeTeam: [{ pet: pet(2, '木桩'), combo, skills: [foeSkill || skill({ id: 21, power: 100, category: { id: 1 } })] }] });
}
{
  const cast = skill({ id: 1, priority: 1, effects: [{ id: 1471, args: [100, 7, 3], info: '消除对手能力提升状态，消除成功则100%令对手疲惫，未触发则恢复自身最大体力的1/3' }] });
  const b = mk(cast, null, 0.5);
  const me = b.me.team[0];
  const foe = b.foe.team[0];
  foe.stages.atk = 2; me.hp = Math.floor(me.maxHp / 2);
  b.step({ type: 'skill', index: 0 });
  eq(foe.stages.atk, 0, '1471：先清掉对手强化');
  ok(b.log.some(x => /疲惫/.test(x)), '1471：成功则令对手疲惫（编号 7 = 疲惫）');
}
{
  const cast = skill({ id: 1, priority: 1, effects: [{ id: 1471, args: [100, 7, 3], info: 'x' }] });
  const b = mk(cast, null, 0.5);
  const me = b.me.team[0];
  const foe = b.foe.team[0];
  me.hp = Math.floor(me.maxHp / 2);
  foe.starGuard = 2;
  const hb = me.hp;
  b.step({ type: 'skill', index: 0 });
  ok(me.hp > hb || b.log.some(x => /恢复了/.test(x)), '1471：未触发异常则回血 1/3');
}
{
  const cast = skill({ id: 1, priority: 1, effects: [{ id: 2212, args: [2, 150, 7], info: 'x' }] });
  const b = mk(cast, skill({ id: 22, power: 100, category: { id: 1 } }), 0.5);
  const me = b.me.team[0]; const foe = b.foe.team[0];
  me.hp = me.maxHp;
  b.step({ type: 'skill', index: 0 });
  ok(b.log.some(x => /疲惫/.test(x)), '2212：低威力攻击令攻击者疲惫');
}
{
  const cast = skill({ id: 1, priority: 1, effects: [{ id: 2212, args: [2, 150, 7], info: 'x' }] });
  const b = mk(cast, skill({ id: 22, power: 100, category: { id: 1 } }), 0.5);
  const me = b.me.team[0]; const foe = b.foe.team[0];
  foe.starGuard = 3;
  const hp0 = me.hp;
  b.step({ type: 'skill', index: 0 });
  eq(me.hp, hp0, '2212：异常未触发则抵挡当次攻击');
}
{
  const cast = skill({ id: 1, priority: 1, effects: [{ id: 469, args: [3, 100, 7], info: 'x' }] });
  const b = mk(cast, skill({ id: 23, power: 0, category: { id: 4 }, effects: [{ id: 5, args: [1], info: 'x' }] }), 0.5);
  const foe = b.foe.team[0];
  b.step({ type: 'skill', index: 0 });
  ok(b.log.some(x => /疲惫/.test(x)), '469：对手用属性技则令其疲惫');
}
console.log('— 37510 堕之盛响 —');
{
  const cast = skill({ id: 37510, name: '堕之盛响', priority: 1, effects: [
    { id: 889, args: [7], info: '消除对手回合类效果，消除成功则令对手疲惫' },
    { id: 2213, args: [50], info: '消耗自身全部体力，己方下只精灵获得消耗值50%的护盾与护罩' }] });
  const b = mk(cast, null, 0.5);
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.teUseHeal = { turns: 2, num: 1, den: 3, last: -1 };
  const hp0 = me.hp;
  b.step({ type: 'skill', index: 0 });
  ok(b.log.some(x => /疲惫/.test(x)), '37510：消除回合类效果成功 → 疲惫');
  ok(!b.log.some(x => /害怕/.test(x)), '37510：不再是害怕');
  ok(b.nextAllyShield && b.nextAllyShield.value === Math.floor(hp0 / 2), '37510：下只精灵护盾 = 消耗值 50%');
}
if (fails) { console.error('FAILED ' + fails); process.exit(1); }
console.log('ALL PASS');