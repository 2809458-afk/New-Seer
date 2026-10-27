/* 3142 王·雷伊：node test/pets3142.test.js */
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
const SOUL484 = '每回合开始和结束时吸取对手能力提升状态；回合开始时对手所有回合类效果的回合数变为1回合；|回合开始时若自身体力高于对手则战斗阶段结束时自身攻击+2，回合开始时若自身体力低于对手，则当回合自身回合类效果无法被消除（BOSS无效）';
const SOUL527 = '每回合开始和结束时吸取对手能力提升状态；回合开始时对手所有回合类效果的回合数变为1回合；回合开始时若自身体力高于对手则战斗阶段结束时自身攻击+2、速度+1、命中+1，回合开始时若自身体力低于对手，则当回合自身回合类效果无法被消除（BOSS无效）';
function fxOf(info) { return B.parseSkillEffects(skill({ info, effects: [{ info }] })); }
function battle(meSkills, foeSkill, sm) {
  return new B.Battle({
    chart, comboOf: () => combo, rng: () => 0, level: 100,
    meTeam: [{ pet: pet(3142, '王·雷伊'), combo, skills: meSkills, passives: B.parseSoulmark(sm || SOUL484) }],
    foeTeam: [{ pet: pet(2, '木桩'), combo, skills: [foeSkill || skill({ id: 2, name: '撞击', power: 10, category: { id: 1 } })] }]
  });
}

console.log('— 3142 王·雷伊：魂印「雷」解析 —');
{
  const sm = B.parseSoulmark(SOUL484);
  ok(sm.some(x => x.kind === 'leiSteal'), '魂印 484：每回合吸强');
  ok(sm.some(x => x.kind === 'leiRoundToOne'), '魂印 484：对手回合数变 1');
  const eb = sm.filter(x => x.kind === 'leiEndBoost')[0];
  ok(!!eb && eb.atk === 2 && eb.spd === 0 && eb.acc === 0, '魂印 484：体力高回合末攻击+2');
  ok(sm.some(x => x.kind === 'leiRoundLock'), '魂印 484：体力低自身回合效果不可消');
  const eb2 = B.parseSoulmark(SOUL527).filter(x => x.kind === 'leiEndBoost')[0];
  ok(!!eb2 && eb2.atk === 2 && eb2.spd === 1 && eb2.acc === 1, '魂印 527：攻击+2/速度+1/命中+1');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0];
  ok(me.leiSteal === true && me.leiRoundToOne === true && me.leiRoundLock === true, '魂印字段已装载');
  ok(!!me.leiEndBoost && me.leiEndBoost.atk === 2, '魂印回合末强化字段');
}
console.log('— 魂印「雷」回合开始 —');
{
  const b = battle([skill()]);
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.hp = 900;
  foe.stages.atk = 3; foe.stages.spd = 2;
  me.stages.atk = 1;
  b.leiTurnStart();
  eq(me.stages.atk, 4, '回合开始吸取对手 3 级攻击');
  eq(foe.stages.atk, 0, '对手攻击归 0');
  eq(foe.stages.spd, 0, '对手速度归 0');
  ok(me.leiEndBoostLead === true, '体力高于对手 → 回合末强化待发');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0];
  b.foe.team[0].hp = 900;
  b.leiTurnStart();
  const a0 = me.stages.atk;
  b.endOfTurn();
  eq(me.stages.atk, a0 + 2, '回合末攻击+2');
}
{
  const b = battle([skill()]);
  const foe = b.foe.team[0];
  foe.damageBuff = { turns: 4, mul: 2 };
  foe.guards = [{ turns: 3, value: 100 }];
  b.leiTurnStart();
  eq(foe.damageBuff.turns, 1, '对手回合类效果压到 1 回合');
  eq(foe.guards[0].turns, 1, '护盾类回合数也压到 1');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0], foe = b.foe.team[0];
  me.hp = 100; foe.hp = 900;
  b.leiTurnStart();
  ok(me.starRoundLock >= 1, '体力低于对手 → 本回合回合效果不可消');
  ok(me.leiEndBoostLead === false, '体力低时不发回合末强化');
}
console.log('— 3142 相关技能解析 —');
{
  const rl = fxOf('2回合内自身的回合类效果无法被消除，后出手时回合数+1');
  const r1 = rl.filter(x => x.kind === 'roundLock')[0];
  ok(!!r1 && r1.turns === 2 && r1.slowAdd === 1, '技能回合锁：2 回合，后手 +1');
  const cs = fxOf('3回合内若对手使用属性技能，则下2回合自身受到的伤害不超过250').filter(x => x.kind === 'capOnStatus')[0];
  ok(!!cs && cs.turns === 3 && cs.capTurns === 2 && cs.value === 250, '属性技受伤上限：3 回合观察 / 2 回合 250');
  const td = fxOf('直接造成260点电系伤害，自身每处于一种能力提升状态则造成的伤害提高10%').filter(x => x.kind === 'typeFixedDamage')[0];
  ok(!!td && td.value === 260 && td.perUp === 10 && td.typeName === '电', '直接造成 260 点电系伤害（每项强化 +10%）');
  const lh = fxOf('全属性+1，若自身当前体力低于对手则强化效果翻倍');
  eq(lh.filter(x => x.kind === 'stat').length, 5, '低体力翻倍：只出 5 条强化（无重复）');
  ok(lh.every(x => x.lowHpDouble === true), '低体力翻倍：全部带标记');
  const cu = fxOf('50%使对手麻痹，自身每处于一种能力提升状态则概率提高8%').filter(x => x.kind === 'status')[0];
  ok(!!cu && cu.chance === 50 && cu.chancePerUp === 8, '麻痹概率随强化提高 8%');
  const oh = fxOf('3回合内若受到攻击则有100%概率令对手麻痹').filter(x => x.kind === 'onHitStatusTimed')[0];
  ok(!!oh && oh.turns === 3 && oh.chance === 100 && oh.statusId === 'paralyze', '3 回合受击麻痹');
}
console.log('— 技能实战 —');
{
  const b = battle([skill({ id: 24970, name: '万鸣齐闪', effects: [{ info: '反转自身能力下降状态' }, { info: '直接造成260点电系伤害，自身每处于一种能力提升状态则造成的伤害提高10%' }] })]);
  const me = b.me.team[0], foe = b.foe.team[0];
  me.stages.atk = 2; me.stages.spd = 1;
  b.step({ type: 'skill', index: 0 });
  eq(foe.maxHp - foe.hp, 312, '万鸣齐闪：260 × (1+2×10%) = 312');
}
{
  const b = battle([skill({ id: 24971, name: '传承王意', effects: [{ info: '全属性+1，若自身当前体力低于对手则强化效果翻倍' }] })]);
  const me = b.me.team[0], foe = b.foe.team[0];
  me.hp = 200; foe.hp = 900;
  b.step({ type: 'skill', index: 0 });
  eq(me.stages.atk, 2, '传承王意：低体力 → 攻击+2');
  eq(me.stages.spd, 2, '传承王意：低体力 → 速度+2');
}
{
  const b = battle([skill({ id: 24971, name: '传承王意', effects: [{ info: '全属性+1，若自身当前体力低于对手则强化效果翻倍' }] })]);
  const me = b.me.team[0], foe = b.foe.team[0];
  me.hp = 900; foe.hp = 200;
  b.step({ type: 'skill', index: 0 });
  eq(me.stages.atk, 3, '传承王意：体力高基础 +1，回合末魂印再 +2（共 3）');
  eq(me.stages.spd, 1, '传承王意：体力高 → 速度只 +1');
}
{
  const b = battle([
    skill({ id: 24376, name: '天雷断绝', effects: [{ info: '3回合内若对手使用属性技能，则下2回合自身受到的伤害不超过250' }] }),
    skill({ id: 3, name: '撞击', power: 90, category: { id: 1 }, must_hit: true })
  ], skill({ id: 4, name: '属性技', category: { id: 4 }, effects: [] }));
  const me = b.me.team[0], foe = b.foe.team[0];
  b.step({ type: 'skill', index: 0 });
  ok(!!me.capOnStatus && me.capOnStatus.value === 250, '天雷断绝：受伤上限记录');
  b.step({ type: 'skill', index: 1 });
  ok(!!me.damageCap && me.damageCap.value === 250 && me.damageCap.turns >= 1, '对手用属性技 → 受伤上限生效（' + (me.damageCap ? me.damageCap.turns : 0) + ' 回合）');
  eq(me.damageCap.value, 250, '受伤上限数值 250');
  ok(me.damageCap.turns >= 1, '受伤上限仍在生效（' + me.damageCap.turns + ' 回合）');
}
{
  const b = battle([skill({ id: 24377, name: '霹雳风暴', effects: [{ info: '2回合内自身的回合类效果无法被消除，后出手时回合数+1' }] })]);
  const me = b.me.team[0];
  b.step({ type: 'skill', index: 0 });
  ok(me.starRoundLock >= 1 && b.log.some(x => /回合类效果无法被消除/.test(x)), '霹雳风暴：回合锁生效（' + me.starRoundLock + ' 回合）');
}
{
  const b = battle([skill({ id: 19733, name: '寰宇雷神断', effects: [{ info: '50%使对手麻痹，自身每处于一种能力提升状态则概率提高8%' }] })]);
  const me = b.me.team[0], foe = b.foe.team[0];
  me.stages.atk = 1; me.stages.spd = 1; me.stages.acc = 1;
  b.step({ type: 'skill', index: 0 });
  ok(!!foe.status && foe.status.id === 'paralyze', '寰宇雷神断：3 项强化后麻痹对手');
}
{
  const b = battle([skill({ id: 23244, name: '充电身躯', effects: [{ info: '3回合内若受到攻击则有100%概率令对手麻痹' }] })]);
  const me = b.me.team[0];
  b.step({ type: 'skill', index: 0 });
  ok(!!me.onHitStatus && me.onHitStatus.chance === 100, '充电身躯：受击麻痹记录');
  ok(!!b.foe.team[0].status && b.foe.team[0].status.id === 'paralyze', '受击后攻击者被麻痹');
  const t1 = me.onHitStatus ? me.onHitStatus.turns : 0;
  b.endOfTurn();
  eq(me.onHitStatus ? me.onHitStatus.turns : 0, t1 - 1, '受击麻痹回合数递减');
}
if (fails) { console.error('FAILED ' + fails); process.exit(1); }
console.log('ALL PASS');
