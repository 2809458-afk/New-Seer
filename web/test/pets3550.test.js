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
const SOUL = '帝君之罚：天启帝君出战后对对方不在场精灵附加其最大体力1/3的真实伤害，之后本场战斗此效果改为1/9|' +
  '帝君之赐：天启帝君出战后恢复己方所有不在场精灵其最大体力的1/3，之后本场战斗此效果改为1/9|' +
  '帝君之援：天启帝君位于出战背包时，己方精灵登场时，若其为满体力，则当回合所有技能先制+1|' +
  '帝君之御：天启帝君免疫受到的固定伤害、百分比伤害、异常状态，且固定伤害和百分比伤害抗性始终视为100%|' +
  '帝君之阵：己方每有一只阵亡精灵则自身受到的伤害降低10%，造成的伤害提高10%，对方每有一只不在场存活精灵自身使用技能后恢复1/10最大体力并附加恢复量的百分比伤害|' +
  '帝君之威：天启帝君为最后一只存活精灵时自身回合类效果无法被消除，对手为最后一只存活精灵时使对手无法通过自身技能恢复体力|' +
  '帝君之殒：天启帝君被击败后，30%令对方1只不在场精灵死亡';
function battle(meSkills, foeSkill) {
  return new B.Battle({ chart, comboOf: () => combo, rng: () => 0, level: 100,
    meTeam: [{ pet: pet(3550, '天启帝君'), combo, skills: meSkills, passives: B.parseSoulmark(SOUL) }],
    foeTeam: [{ pet: pet(2, '木桩'), combo, skills: [foeSkill || skill({ id: 2, name: '撞击', power: 10, category: { id: 1 } })], passives: [] }] });
}
console.log('— 3550 天启帝君：魂印 —');
{
  const sm = B.parseSoulmark(SOUL);
  ok(sm.some(x => x.kind === 'benchStrike' && x.den === 3), '帝君之罚：场下真伤 1/3');
  ok(sm.some(x => x.kind === 'benchHeal' && x.den === 3), '帝君之赐：场下回血 1/3');
  ok(sm.some(x => x.kind === 'junYuan'), '帝君之援');
  ok(sm.some(x => x.kind === 'junYu'), '帝君之御');
  ok(sm.some(x => x.kind === 'junZhen'), '帝君之阵');
  ok(sm.some(x => x.kind === 'junWei'), '帝君之威');
  ok(sm.some(x => x.kind === 'junYun' && x.chance === 30), '帝君之殒：30%');
  const b = battle([skill()]);
  const me = b.me.team[0];
  ok(me.junYu === true && me.immuneFixedPct === true, '御：免疫固定/百分比伤害');
  b.applyStatus(me, 'poison', 1, '我方');
  ok(!me.status, '御：免疫异常状态');
  eq(b.directDamage(me, 300, 'fixed'), 0, '御：固定伤害为 0');
}
console.log('— 终焉时刻 1302 —');
{
  const mk = (rng) => new B.Battle({ chart, comboOf: () => combo, rng: () => rng, level: 100,
    meTeam: [{ pet: pet(3550, '天启帝君'), combo, skills: [skill({ id: 25899, name: '终焉时刻', effects: [{ id: 1302, args: [1, 50], info: '全属性+1，50%概率翻倍，未触发则吸取对手能力提升' }] })], passives: [] }],
    foeTeam: [{ pet: pet(2, '木桩'), combo, skills: [skill({ id: 2, name: '撞击', power: 10, category: { id: 1 } })], passives: [] }] });
  const bD = mk(0);
  bD.useSkill('me', 0, { isFirst: true });
  const meD = bD.me.team[0];
  ok(meD.stages.atk === 2, '1302：50% 触发 → 全属性 +2（实际 atk ' + meD.stages.atk + '）');
  const bS = mk(0.9);
  const meS = bS.me.team[0], foeS = bS.foe.team[0];
  foeS.stages.atk = 3;
  foeS.stages.spd = 1;
  bS.useSkill('me', 0, { isFirst: true });
  ok(meS.stages.atk === 4, '1302：未翻倍时基础 +1 并吸取对手攻击 +3（实际 ' + meS.stages.atk + '）');
  eq(foeS.stages.atk, 0, '1302：吸取后对手强化清零');
  ok(bS.log.some(x => /吸取了对手/.test(x)), '1302：吸取有日志');
}
console.log('— 帝君之阵 —');
{
  const mk = () => battle([skill({ id: 3, name: '攻击', power: 100, category: { id: 1 } })]);
  const b0 = mk(), b2 = mk();
  b0.me.team[0].deadAllies = 0;
  b2.me.team[0].deadAllies = 2;
  const f0 = b0.foe.team[0], f2 = b2.foe.team[0];
  const h0 = f0.hp, h2 = f2.hp;
  b0.useSkill('me', 0, { isFirst: true });
  b2.useSkill('me', 0, { isFirst: true });
  const d0 = h0 - f0.hp, d2 = h2 - f2.hp;
  ok(d2 > d0, '阵：每阵亡 1 只增伤 10%（' + d0 + ' → ' + d2 + '）');
}
console.log('— 技能 —');
{
  const b = battle([skill({ id: 31580, name: '灵魂救赎', power: 200, category: { id: 1 }, effects: [{ id: 1316, args: [3], info: '先出手时令自身随机3项属性+1' }, { id: 1317, args: [], info: '后出手时恢复自身最大体力的1/4' }] })]);
  const me = b.me.team[0];
  me.hp = Math.floor(me.maxHp / 2);
  b.useSkill('me', 0, { isFirst: true });
  const ups = Object.keys(me.stages).filter(k => me.stages[k] > 0).length;
  ok(ups >= 3, '1316：先手随机 3 项 +1（实际 ' + ups + '）');
  const b2 = battle([skill({ id: 31580, name: '灵魂救赎', power: 200, category: { id: 1 }, effects: [{ id: 1316, args: [3], info: 'x' }, { id: 1317, args: [], info: '后出手时恢复自身最大体力的1/4' }] })]);
  const me2 = b2.me.team[0];
  me2.hp = Math.floor(me2.maxHp / 2);
  const h0 = me2.hp;
  b2.useSkill('me', 0, { isFirst: false });
  ok(me2.hp > h0, '1317：后手回复 1/4（' + h0 + ' → ' + me2.hp + '）');
}
{
  const b = battle([skill({ id: 31581, name: '天君启示录', power: 150, category: { id: 1 }, effects: [{ id: 1208, args: [], info: '反转自身能力下降状态，反转成功则令对手下1次使用的攻击技能无效' }, { id: 1305, args: [100, 100], info: '己方每有1只精灵存活则恢复100点体力，每有1只精灵死亡则附加100点固定伤害' }] })]);
  const me = b.me.team[0], foe = b.foe.team[0];
  me.stages.atk = -2;
  me.hp = Math.floor(me.maxHp / 2);
  const fh = foe.hp;
  b.useSkill('me', 0, { isFirst: true });
  eq(me.stages.atk, 2, '1208：反转能力下降');
  ok((foe.attackBlock || 0) >= 1, '1208：反转成功 → 对手攻击技无效');
  ok(me.hp > Math.floor(me.maxHp / 2), '1305：每存活 1 只回 100');
  ok(foe.hp < fh, '1305：阵亡数附加固伤');
}
{
  const b = battle([skill({ id: 25898, name: '轮回之狱', effects: [{ id: 1299, args: [300, 100], info: '3回合内对手攻击伤害低于300则减少其场下100体力' }, { id: 821, args: [], info: '3回合内自身回合类效果无法被消除' }, { id: 1300, args: [50, 280], info: '3回合内受伤减少50%，伤害高于280随机附加2种异常' }] })]);
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.skills.push({ skill: skill({ id: 22, name: '备用' }), pp: 10, maxPp: 10 });
  const fb = b.me.team.concat([]);
  b.useSkill('me', 0, { isFirst: true });
  ok(!!me.junPunish && me.junPunish.turns === 3, '1299：惩罚窗口');
  ok(!!me.junGuard && me.junGuard.turns === 3, '1300：减伤窗口');
  ok((me.starRoundLock || 0) >= 3, '821：回合类效果无法被消除');
  const benchP = foe.skills;
  ok(!!me.guards && me.guards.length > 0, '1300：全伤害减伤 50%');
}
{
  const b = battle([skill({ id: 31582, name: '纵横三千界', power: 160, category: { id: 1 }, effects: [{ id: 1306, args: [350, 100], info: '伤害低于350则减少对手场下100体力' }, { id: 1307, args: [100], info: '未击败对手则恢复己方场下100体力' }, { id: 1308, args: [], info: '击败对手则下次登场不削弱' }] })]);
  const me = b.me.team[0], foe = b.foe.team[0];
  // 加一个场下对手精灵
  const benchPet = { pet: pet(3, '木桩二号'), combo, skills: [], passives: [] };
  b.foe.team.push(new (Object.getPrototypeOf(foe).constructor)(benchPet, 100));
  const benchHp = b.foe.team[1].hp;
  foe.hp = foe.maxHp = 5000;
  b.useSkill('me', 0, { isFirst: true, });
  ok(b.foe.team[1].hp < benchHp, '1306：伤害不足 350 → 对手场下 -100（' + benchHp + ' → ' + b.foe.team[1].hp + '）');
}

console.log('— 帝君之罚 / 之赐 日志与无目标 —');
{
  const b = battle([skill()]);
  const me = b.me.team[0];
  ok(!!me.benchStrike && !!me.benchHeal, '登场携带帝君之罚/之赐');
  ok(b.log.some(x => /帝君之罚/.test(x)), '帝君之罚有结算日志');
  ok(b.log.some(x => /没有场下精灵/.test(x)), '对手无场下时给出提示（技能测试页常见）');
}

if (fails) { console.error('FAILED ' + fails); process.exit(1); }
console.log('ALL PASS');
