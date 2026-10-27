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
const SOUL2149 = '帝皇之戎为团体精灵；战斗开始时，若帝皇之戎为首发精灵，则帝皇之钺担任帝皇之戎的主位，若帝皇之戎所在的位置不为首发精灵，则帝皇之御担任帝皇之戎主位，然后未担任主位的一方担任副位|帝皇之钺担任主位时，自身攻击值提升100点、自身攻击技能先制+1且造成的伤害提升50%；帝皇之钺担任副位时，帝皇之戎每造成300点伤害，回合结束时令对手进入1种非限制类的控制类异常状态|帝皇之御担任主位时，自身速度值提升100点、自身受到攻击伤害后附加伤害值100%的真实伤害；帝皇之御担任副位时，帝皇之戎登场时，解除双方所处的异常状态、2回合内免疫受到的异常状态且所有技能先制+2|自身的副位没有空缺时，自身免疫受到的致命一击伤害且攻击技能无视对手护盾效果并于命中后为对手附加讨|（boss无效）';
function battle(meSkills, isLead) {
  return new B.Battle({ chart, comboOf: () => combo, rng: () => 0, level: 100,
    meTeam: [{ pet: pet(4950, '帝皇之戎'), combo, skills: meSkills, passives: B.parseSoulmark(SOUL2149), isLead: isLead !== false }],
    foeTeam: [{ pet: pet(2, '木桩'), combo, skills: [skill({ id: 21, power: 50, category: { id: 1 } })] }] });
}
console.log('— 4950 帝皇之戎：魂印解析 —');
{
  const sm = B.parseSoulmark(SOUL2149);
  ok(sm.some(x => x.kind === 'twinCorps'), '团体精灵 / 主副位');
  ok(sm.some(x => x.kind === 'yueMain'), '钺主位：攻击+100、攻击先制+1、伤害+50%');
  ok(sm.some(x => x.kind === 'yueSub' && x.threshold === 300), '钺副位：累计 300 伤害 → 控制异常');
  ok(sm.some(x => x.kind === 'yuMain'), '御主位：速度+100、受击反真伤');
  ok(sm.some(x => x.kind === 'yuSub'), '御副位：登场解异常+免疫2回合+先制+2');
  ok(sm.some(x => x.kind === 'subFull'), '副位无空缺：免疫致命一击 + 无视护盾');
}
console.log('— 4950 主副位 —');
{
  const b = battle([skill()], true);
  const me = b.me.team[0];
  eq(me.mainPos, '钺', '首发 → 钺主位');
  eq(me.subPos, '御', '御副位');
  const b2 = battle([skill()], true);
  b2.me.team.unshift({ pet: pet(9997, '替补'), combo, skills: [skill()], passives: [] });
  b2.me.active = 1;
  b2.me.team[1].posChosen = false;
  b2.onEnter(b2.me.team[1]);
  eq(b2.me.team[1].mainPos, '御', '非首发（2 号位）→ 御主位');
}
console.log('— 4950 钺主位 —');
{
  const b = battle([skill({ id: 31, power: 60, category: { id: 1 } })]);
  const me = b.me.team[0], foe = b.foe.team[0];
  me.mainPos = '钺'; me.yueMain = true;
  b.useSkill('me', 0, { isFirst: true });
  ok(me.priorityBuff && me.priorityBuff.value >= 1, '钺主位：攻击技能先制 +1');
}
console.log('— 4950 御主位反弹 —');
{
  const b = battle([skill()]);
  const me = b.me.team[0], foe = b.foe.team[0];
  me.mainPos = '御'; me.subPos = '钺'; me.yuMain = true;
  const foeHp0 = foe.hp;
  b.applyDamage('me', 100, { attack: true });
  ok(foe.hp < foeHp0, '御主位：受到攻击伤害后反弹真实伤害（' + (foeHp0 - foe.hp) + '）');
}
console.log('— 4950 副位免疫暴击 —');
{
  const b = battle([skill()]);
  const me = b.me.team[0];
  me.subFull = true; me.subPos = '御';
  const hp0 = me.hp;
  const dealt = b.applyDamage('me', 500, { attack: true, crit: true });
  eq(dealt, 0, '副位无空缺：免疫致命一击伤害');
  eq(me.hp, hp0, '体力未损失');
}
console.log('— 4950 钺副位累计 —');
{
  const b = battle([skill({ id: 32, power: 60, category: { id: 1 } })]);
  const me = b.me.team[0], foe = b.foe.team[0];
  me.mainPos = '御'; me.subPos = '钺'; me.yueSub = { threshold: 300 };
  b.useSkill('me', 0, { isFirst: true });
  ok(me.dmgCounter > 0, '钺副位：累计造成伤害 ' + me.dmgCounter);
  me.dmgCounter = 300;
  b.endOfTurn();
  ok(!!foe.status, '累计达 300 → 回合末对手陷入控制异常');
}
console.log('— 4950 交换主副位 —');
{
  const b = battle([skill({ id: 33, info: '交换自身主位、副位的担任精灵' })]);
  const me = b.me.team[0];
  const main0 = me.mainPos;
  b.useSkill('me', 0, { isFirst: true });
  ok(me.mainPos !== main0, '交换主副位（' + main0 + ' → ' + me.mainPos + '）');
}
if (fails) { console.error('FAILED ' + fails); process.exit(1); }
console.log('ALL PASS');
