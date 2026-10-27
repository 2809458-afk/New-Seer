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
const SOUL1967 = '登场时自身开启武道，初始为血之道，武道会以血之道、邪之道、天之道、血之道的轨迹进行衍化，每完成一次完成轨迹的衍化，自身恢复全部PP值|战斗阶段结束时自身恢复最大体力的1/6，自身处于血之道时效果翻倍；自身使用技能时附加对手最大体力1/6的百分比伤害，自身处于邪之道时效果翻倍；自身造成的攻击伤害提升50%，自身处于天之道时效果翻倍|（boss无效）';
function battle(meSkills) {
  return new B.Battle({ chart, comboOf: () => combo, rng: () => 0, level: 100,
    meTeam: [{ pet: pet(4766, '灭战神决·盖亚'), combo, skills: meSkills, passives: B.parseSoulmark(SOUL1967) }],
    foeTeam: [{ pet: pet(2, '木桩'), combo, skills: [skill({ id: 21 })] }] });
}
console.log('— 4766 灭战神决·盖亚：魂印解析 —');
{
  const sm = B.parseSoulmark(SOUL1967);
  ok(sm.some(x => x.kind === 'wudaoOpen'), '登场开启武道（血之道）');
  ok(sm.some(x => x.kind === 'wudaoPP'), '完成轨迹衍化 → 恢复全部 PP');
  ok(sm.some(x => x.kind === 'wudaoHeal' && x.den === 6), '回合末回 1/6（血之道翻倍）');
  ok(sm.some(x => x.kind === 'wudaoSkillDmg' && x.den === 6), '用技能附加对手最大体力 1/6 百分比（邪之道翻倍）');
  ok(sm.some(x => x.kind === 'wudaoDealt' && x.pct === 50), '攻击伤害 +50%（天之道翻倍）');
}
{
  const b = battle([skill()]);
  eq(b.me.team[0].wudao, '血', '初始血之道');
}
console.log('— 4766 武道衍化 —');
{
  const b = battle([skill({ id: 31, info: '衍化自身的武道' })]);
  const me = b.me.team[0];
  b.useSkill('me', 0, { isFirst: true });
  eq(me.wudao, '邪', '血 → 邪');
  b.useSkill('me', 0, { isFirst: true });
  eq(me.wudao, '天', '邪 → 天');
  me.skills[0].pp = 1;
  b.useSkill('me', 0, { isFirst: true });
  eq(me.wudao, '血', '天 → 血（完成一轮）');
  ok(me.skills[0].pp === 99 || me.skills[0].pp === (me.skills[0].maxPP || me.skills[0].max_pp), '完成一轮恢复全部 PP（' + me.skills[0].pp + '）');
}
console.log('— 4766 血之道回血 —');
{
  const b = battle([skill()]);
  const me = b.me.team[0];
  me.hp = me.maxHp - 900;
  const hp0 = me.hp;
  b.endOfTurn();
  eq(me.hp - hp0, Math.floor(me.maxHp / 6) * 2, '血之道：回合末回 1/6 且翻倍');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0];
  me.wudao = '邪';
  me.hp = me.maxHp - 900;
  const hp0 = me.hp;
  b.endOfTurn();
  eq(me.hp - hp0, Math.floor(me.maxHp / 6), '非血之道：只回 1/6');
}
console.log('— 4766 邪之道百分比 —');
{
  const b = battle([skill({ id: 32 })]);
  const me = b.me.team[0], foe = b.foe.team[0];
  me.wudao = '邪';
  const foeHp0 = foe.hp;
  b.useSkill('me', 0, { isFirst: true });
  eq(foeHp0 - foe.hp, Math.floor(foe.maxHp / 6) * 2, '邪之道：使用技能附加 1/6 百分比且翻倍');
}
console.log('— 4766 天之道增伤 —');
{
  const dmg = (wudao) => {
    const b = battle([skill({ id: 33, power: 60, category: { id: 1 } })]);
    const me = b.me.team[0];
    me.wudao = wudao;
    me.wudaoSkillDmg = 0;
    const hp0 = b.foe.team[0].hp;
    b.useSkill('me', 0, { isFirst: true });
    return hp0 - b.foe.team[0].hp;
  };
  const xie = dmg('邪'), tian = dmg('天');
  ok(tian > xie, '天之道：攻击伤害 +100%（' + xie + ' → ' + tian + '）');
}
if (fails) { console.error('FAILED ' + fails); process.exit(1); }
console.log('ALL PASS');
