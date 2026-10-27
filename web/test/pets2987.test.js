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
const SOUL6 = '自身被击败后，复活出战背包内的1只阵亡且专属特性中没有此效果的精灵|自身可以拥有最多6层神耀能量并根据神耀能量所达到的层数获得以下效果：|1层：每有1层神耀能量自身受到的攻击伤害额外减少8%|2层：免疫受到的异常状态与能力下降状态|3层：自身使用技能之后每回合结束后恢复自身最大体力的1/3|4层：免疫并反弹自身受到的固定伤害|5层:攻击技能先制+1|6层:自身造成的攻击伤害提升60%且第五技能威力提升不再消耗神耀能量';
function battle(meSkills, foeSkill, mePassives) {
  return new B.Battle({ chart, comboOf: () => combo, rng: () => 0, level: 100,
    meTeam: [{ pet: pet(2987, '重生之翼'), combo, skills: meSkills, passives: mePassives || B.parseSoulmark(SOUL6) }],
    foeTeam: [{ pet: pet(2, '木桩'), combo, skills: [foeSkill || skill({ id: 2, name: '撞击', power: 10, category: { id: 1 } })], passives: [] }] });
}
console.log('— 2987 重生之翼：魂印 —');
{
  const sm = B.parseSoulmark(SOUL6);
  const sp = sm.filter(x => x.kind === 'stackPassive');
  ok(sp.length > 0 && Math.max.apply(null, sp.map(x => x.maxStacks)) >= 6, '神耀能量上限 6 层');
  ok(sm.some(x => x.kind === 'reviveTeammate' && x.chance === 100), '被击败后 100% 复活队友');
  ok(sm.some(x => x.kind === 'immuneStatus'), '2 层免疫异常');
  ok(sm.some(x => x.kind === 'endHeal' && x.den === 3), '3 层回合末回 1/3');
  ok(sm.some(x => x.kind === 'priority'), '5 层先制 +1');
  const b = battle([skill({ id: 3, name: '攻击', power: 10, category: { id: 1 } })]);
  const me = b.me.team[0];
  ok(me.stackPassive && me.stackPassive.maxStacks === 6, '战斗内神耀上限 6（合并重复魂印行）');
  ok(me.stackPassive.perStackReduce === 8, '每层减伤 8%');
}
console.log('— 魂印 372 已废弃 —');
{
  ok(B.soulmarkDisabled(2987, 372) === true, '2987 的魂印 372 已停用');
  ok(B.soulmarkDisabled(2987, 574) === false, '2987 的魂印 574 仍生效');
  ok(B.soulmarkDisabled(3311, 372) === false, '其它精灵不受影响');
  const b = battle([skill()]);
  const me = b.me.team[0];
  ok(me.stackPassive && me.stackPassive.maxStacks === 6, '只用 574 时神耀上限为 6');
}
console.log('— 层数效果 —');
{
  const mk = () => battle([skill({ id: 3, name: '攻击', power: 120, category: { id: 1 } })], skill({ id: 2, name: '撞击', power: 200, category: { id: 1 } }));
  const b0 = mk(), b5 = mk();
  b0.me.team[0].stacks = 0; b5.me.team[0].stacks = 5;
  const d0 = b0.me.team[0].maxHp - (function () { b0.useSkill('foe', 0, { isFirst: true }); return b0.me.team[0].hp; })();
  const d5 = b5.me.team[0].maxHp - (function () { b5.useSkill('foe', 0, { isFirst: true }); return b5.me.team[0].hp; })();
  ok(d5 < d0 * 0.75, '5 层神耀：受到攻击伤害 -40%（' + d0 + ' → ' + d5 + '）');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0];
  me.stacks = 2;
  b.applyStatus(me, 'poison', 1, '我方');
  ok(!me.status, '2 层：免疫异常状态');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0];
  me.stacks = 3;
  me.hp = Math.floor(me.maxHp / 2);
  const before = me.hp;
  b.endOfTurn();
  ok(me.hp > before, '3 层：回合结束回复 1/3（' + before + ' → ' + me.hp + '）');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0], foe = b.foe.team[0];
  me.stacks = 4;
  const raw = b.directDamage(me, 300, 'fixed');
  eq(raw, 0, '4 层：免疫固定伤害');
  ok(foe.maxHp - foe.hp === 300, '4 层：反弹等量固定伤害给对手（' + (foe.maxHp - foe.hp) + '）');
}
{
  const mk = () => battle([skill({ id: 3, name: '攻击', power: 100, category: { id: 1 } })]);
  const b0 = mk(), b6 = mk();
  b0.me.team[0].stacks = 0; b6.me.team[0].stacks = 6;
  const f0 = b0.foe.team[0], f6 = b6.foe.team[0];
  b0.useSkill('me', 0, { isFirst: true }); b6.useSkill('me', 0, { isFirst: true });
  const d0 = f0.maxHp - f0.hp, d6 = f6.maxHp - f6.hp;
  ok(d6 > d0 * 1.4, '6 层：攻击伤害 +60%（' + d0 + ' → ' + d6 + '）');
}
console.log('— 技能 —');
{
  const b = battle([skill({ id: 19103, name: '正义天启歌', power: 100, category: { id: 1 }, effects: [{ id: 862, args: [50], info: '消耗所有神耀能量，每层威力+50' }] })]);
  const me = b.me.team[0], foe = b.foe.team[0];
  me.stacks = 3;
  const log0 = b.log.length;
  b.useSkill('me', 0, { isFirst: true });
  eq(me.stacks, 0, '862：3 层全部消耗');
  ok(b.log.some(x => /神耀能量被消耗殆尽/.test(x)), '862：消耗有日志');
  me.stacks = 6;
  b.useSkill('me', 0, { isFirst: true });
  eq(me.stacks, 6, '862：6 层时第五技能不消耗能量');
}
{
  const b = battle([skill({ id: 19100, name: '银雾之翼', power: 50, category: { id: 1 }, effects: [{ id: 867, args: [2], info: '消除对手回合类效果，消除成功使对手下回合先制-2' }, { id: 868, args: [2], info: '消除对手能力提升状态，消除成功则令对手下回合先制-2' }, { id: 866, args: [2, 1], info: '致命一击+2层，否则+1层' }] })]);
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.stages.atk = 2;
  foe.guards = [{ mul: 0.5, turns: 2, scope: 'all' }];
  b.useSkill('me', 0, { isFirst: true });
  eq(foe.stages.atk, 0, '868：消除对手强化');
  ok(!!foe.priorityDown && foe.priorityDown.value === 2, '867/868：对手下回合先制 -2');
  eq(me.stacks, 1, '866：未暴击 +1 层');
}
{
  const b = battle([skill({ id: 19102, name: '无上天命剑', power: 9999, category: { id: 1 }, effects: [{ id: 865, args: [2], info: '击败对手获得2层神耀能量' }, { id: 864, args: [1, 2], info: '本回合未击败对手则下1回合反弹受到伤害的1/2' }] })]);
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.hp = 10;
  b.useSkill('me', 0, { isFirst: true });
  ok(foe.hp <= 0, '无上天命剑：击败对手');
  ok(me.stacks >= 2, '865：击败对手 +2 层（当前 ' + me.stacks + '）');
}
{
  const b = battle([skill({ id: 19102, name: '无上天命剑', power: 5, category: { id: 1 }, effects: [{ id: 864, args: [1, 2], info: '本回合未击败对手则下1回合反弹受到伤害的1/2' }] })]);
  const me = b.me.team[0], foe = b.foe.team[0];
  b.useSkill('me', 0, { isFirst: true });
  ok(!!me.reflectTakenPct && me.reflectTakenPct.turns === 1, '864：未击败 → 获得反弹窗口');
  const fh = foe.hp;
  b.useSkill('foe', 0, { isFirst: true });
  ok(foe.hp < fh, '864：受到攻击后反弹伤害（' + (fh - foe.hp) + '）');
}
{
  const b = battle([skill({ id: 24638, name: '挚金命轮', effects: [{ id: 861, args: [4, 2], info: '4回合内对手使用属性技能则全技能降2点PP' }] })]);
  const me = b.me.team[0], foe = b.foe.team[0];
  b.useSkill('me', 0, { isFirst: true });
  ok(!!me.attrPunishPP && me.attrPunishPP.turns === 4, '861：属性技惩罚窗口');
  const foePp0 = foe.skills[0].pp;
  foe.skills[0].skill.category = { id: 4 };
  b.useSkill('foe', 0, { isFirst: true });
  ok(foe.skills[0].pp <= foePp0 - 2, '861：对手使用属性技 → 全技能 PP -2（' + foe.skills[0].pp + '）');
}
{
  const b = battle([skill({ id: 19103, name: '正义天启歌', power: 10, category: { id: 1 }, effects: [{ id: 863, args: [1], info: '后出手则下1回合令对手使用的攻击技能无效' }] })]);
  const me = b.me.team[0], foe = b.foe.team[0];
  b.useSkill('me', 0, { isFirst: false });
  ok((foe.attackBlock || 0) >= 1, '863：后出手 → 对手下回合攻击技无效');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0];
  me.stacks = 1;
  const snap = b.snapshot();
  const fx = snap.me.team[snap.me.active].effects.filter(x => /神耀能量/.test(x.text))[0];
  ok(!!fx && /1\/6/.test(fx.text), '状态栏显示「神耀能量×1/6」（' + JSON.stringify(snap.me.team[snap.me.active].effects.map(x => x.text)) + '）');
  ok(!!fx && /上限 5 或 6 层/.test(fx.tip || ''), '神耀能量 chip 带名词解释');
}
console.log('— 复活队友 —');
{
  const b = new B.Battle({ chart, comboOf: () => combo, rng: () => 0, level: 100,
    meTeam: [
      { pet: pet(2987, '重生之翼'), combo, skills: [skill()], passives: B.parseSoulmark(SOUL6) },
      { pet: pet(3311, '圣光灵神'), combo, skills: [skill()], passives: [] }
    ],
    foeTeam: [{ pet: pet(2, '木桩'), combo, skills: [skill({ id: 2, power: 10, category: { id: 1 } })], passives: [] }] });
  const me = b.me.team[0], ally = b.me.team[1];
  ally.hp = 0;
  me.hp = 0;
  b.checkFaints();
  ok(ally.hp > 0, '被击败后复活 1 只阵亡队友（' + ally.hp + ' 体力）');
  ok(b.log.some(x => /复活/.test(x)), '复活有日志');
}
if (fails) { console.error('FAILED ' + fails); process.exit(1); }
console.log('ALL PASS');
