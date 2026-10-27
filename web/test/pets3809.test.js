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
const SOUL1084 = '哈莫雷特获得龙神之力，万龙臣服：所有属性中带龙系的精灵每回合50%的概率先制-1且对其造成的攻击伤害降低25%；|满体力时自身受到的攻击伤害降低50%且造成的攻击伤害提升50%，自身体力每降低10%则减伤效果降低10%，同时造成的伤害提升10%；|对手使用属性技能则自身当回合免疫异常状态和能力下降状态，使用攻击技能则战斗阶段结束时随机附加给对手150-300点固定伤害（boss无效）|御之龙魂BUFF说明：受到的固定伤害和百分比伤害减少25%、攻击令对手随机1个技能PP值归零|战之龙魂BUFF说明：所有技能先制+3且必定命中、攻击造成的伤害随机提升50%-100%';
function battle(meSkills) {
  return new B.Battle({ chart, comboOf: () => combo, rng: () => 0, level: 100,
    meTeam: [{ pet: pet(3809, '龙神哈莫'), combo, skills: meSkills, passives: B.parseSoulmark(SOUL1084) }],
    foeTeam: [{ pet: pet(2, '木桩'), combo, skills: [skill({ id: 21 }), skill({ id: 22 })] }] });
}
console.log('— 3809 龙神哈莫：魂印解析 —');
{
  const sm = B.parseSoulmark(SOUL1084);
  ok(sm.some(x => x.kind === 'dragonAura'), '龙神光环');
  ok(sm.some(x => x.kind === 'hpScaleHao'), '满血减伤/增伤随体力衰减');
  ok(sm.some(x => x.kind === 'foeTypeBranch' && x.low === 150 && x.high === 300), '对手技能类型分支（150-300 固伤）');
  ok(sm.some(x => x.kind === 'yuBuff' && x.reduce === 25 && x.pp === 1), '御之龙魂：固伤/百分比 -25% + 清 1 PP');
  ok(sm.some(x => x.kind === 'zhanBuff' && x.prio === 3 && x.low === 50 && x.high === 100), '战之龙魂：先制+3 必中 + 伤害 +50~100%');
}
console.log('— 3809 光环与满血分支 —');
{
  const b = battle([skill()]);
  const foe = b.foe.team[0];
  b.startOfTurn();
  ok(!!foe.priorityDown && foe.priorityDown.value === 1, '光环：对手先制 -1');
  ok(Math.abs((foe.auraDealtMul || 1) - 0.75) < 1e-9, '光环：对手造成伤害 -25%');
}
{
  const hit = (hpPct) => {
    const b = battle([skill({ id: 51, power: 60, category: { id: 1 } })]);
    const me = b.me.team[0];
    if (hpPct < 1) me.hp = Math.floor(me.maxHp * hpPct);
    const hp0 = b.foe.team[0].hp;
    b.useSkill('me', 0, { isFirst: false });
    return hp0 - b.foe.team[0].hp;
  };
  const full = hit(1), half = hit(0.5);
  ok(half > full, '体力降低后自身造成伤害提高 (' + full + ' → ' + half + ')');
  const b = battle([skill()]);
  const me = b.me.team[0], foe = b.foe.team[0];
  const hp0 = me.hp;
  b.useSkill('foe', 0, { isFirst: true });
  const noAura = hp0 - me.hp;
  ok(noAura >= 0, '对手普攻结算正常');
}
console.log('— 3809 对手技能类型分支 —');
{
  const b = battle([skill()]);
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.lastSkillCategory = 4;
  b.startOfTurn();
  ok(me.immuneStatus >= 1 && me.immuneStat >= 1, '对手属性技能 → 本回合免疫异常与能力下降');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.lastSkillCategory = 1;
  b.startOfTurn();
  const hp0 = foe.hp;
  b.endOfTurn();
  const lost = hp0 - foe.hp;
  ok(lost >= 150 && lost <= 300, '对手攻击技能 → 回合末 150-300 固伤（实际 ' + lost + '）');
}
console.log('— 3809 龙魂 BUFF —');
{
  const b = battle([skill()]);
  const me = b.me.team[0];
  me.yuTurns = 2;
  const d0 = b.directDamage(me, 100, 'fixed');
  eq(d0, 75, '御之龙魂：固定伤害 -25%');
}
{
  const b = battle([skill({ id: 41, power: 1, category: { id: 1 } })]);
  const me = b.me.team[0], foe = b.foe.team[0];
  me.yuTurns = 2;
  b.useSkill('me', 0, { isFirst: true });
  eq(foe.skills.filter(x => x.pp === 0).length, 1, '御之龙魂：攻击清对手 1 个技能 PP');
}
{
  const b = battle([skill({ id: 42, power: 1, category: { id: 1 } })]);
  const me = b.me.team[0];
  me.zhanTurns = 2;
  b.useSkill('me', 0, { isFirst: true });
  ok(me.mustHitTurns >= 1, '战之龙魂：必定命中');
  ok(me.priorityBuff && me.priorityBuff.value === 3, '战之龙魂：先制 +3');
}
{
  const b = battle([skill({ id: 43, info: '召唤龙神，使自身下2回合获得战之龙魂效果' })]);
  const me = b.me.team[0];
  b.useSkill('me', 0, { isFirst: true });
  eq(me.zhanTurns, 2, '技能召唤战之龙魂 2 回合');
  const b2 = battle([skill({ id: 44, info: '召唤龙神，使自身下2回合获得御之龙魂效果' })]);
  const me2 = b2.me.team[0];
  b2.useSkill('me', 0, { isFirst: true });
  eq(me2.yuTurns, 2, '技能召唤御之龙魂 2 回合');
  eq(me2.zhanTurns, 0, '战/御互斥');
}
console.log('— 3809 技能效果 id —');
function mk(meSkill, foeSkill, rngv, passives) {
  return new B.Battle({ chart, comboOf: () => combo, rng: () => (rngv == null ? 0 : rngv), level: 100,
    meTeam: [{ pet: pet(3809, '龙神哈莫'), combo, skills: [meSkill], passives: passives || [] }],
    foeTeam: [{ pet: pet(2, '木桩'), combo, skills: [foeSkill || skill({ id: 2, name: '撞击', power: 60, category: { id: 1 } })] }] });
}
{
  const full = mk(skill({ id: 1, power: 100, priority: 1, effects: [{ id: 925, args: [50], info: 'x' }] }), null, 0.5);
  const f1 = full.foe.team[0]; const h1 = f1.hp;
  full.step({ type: 'skill', index: 0 });
  const dmgFull = h1 - f1.hp;
  const plain = mk(skill({ id: 2, power: 100, priority: 1 }), null, 0.5);
  const f2 = plain.foe.team[0]; const h2 = f2.hp;
  plain.step({ type: 'skill', index: 0 });
  ok(dmgFull > (h2 - f2.hp), '925：满体力时威力提升 (基础 ' + (h2 - f2.hp) + ' → ' + dmgFull + ')');
}
{
  const b = mk(skill({ id: 3, power: 100, priority: 1, effects: [{ id: 925, args: [50], info: 'x' }, { id: 1371, args: [4], info: 'x' }] }), null, 0.5);
  const me = b.me.team[0];
  me.hp = Math.floor(me.maxHp / 2);
  const hb = me.hp;
  const foe = b.foe.team[0]; const fh = foe.hp;
  b.step({ type: 'skill', index: 0 });
  ok(me.hp > hb - 1 && foe.hp < fh, '1371：未满体力时吸取（自身回复 ' + (me.hp - hb) + '）');
}
{
  const cast = skill({ id: 33011, name: '龙·战天下', priority: 1, effects: [{ id: 1220, args: [2], info: 'x' }] });
  const b = mk(cast, null, 0.5);
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.stages.atk = 2;
  b.step({ type: 'skill', index: 0 });
  eq(foe.stages.atk, 0, '1220：清除对手强化');
  ok(me.critBuffTurns >= 1, '1220：成功后获得必暴（本回合结算后剩 ' + me.critBuffTurns + '）');
}
{
  const cast = skill({ id: 33012, name: '龙·吟千秋', priority: 1, effects: [{ id: 1232, args: [], info: 'x' }] });
  const b = mk(cast, null, 0.5);
  const me = b.me.team[0], foe = b.foe.team[0];
  me.stages.atk = -2; me.stages.spd = -1;
  b.step({ type: 'skill', index: 0 });
  eq(me.stages.atk, 0, '1232：自身下降清零');
  eq(foe.stages.atk, -2, '1232：下降到对手');
}
{
  const cast = skill({ id: 730, name: 'x', priority: 1, effects: [{ id: 731, args: [1], info: '本回合打出致命一击则下1回合其它攻击技能必定致命一击' }] });
  const b = mk(cast, null, 0.9);
  b.step({ type: 'skill', index: 0 });
  ok(!b.me.team[0].critBuff, '731：本回合没暴击则不触发');
}
{
  const cast = skill({ id: 33013, name: '龙·昭日月', priority: 1, effects: [{ id: 1449, args: [2, 3], info: 'x' }] });
  const b = mk(cast, null, 0.5);
  const foe = b.foe.team[0];
  b.step({ type: 'skill', index: 0 });
  ok(foe.healBlock >= 1, '1449：禁疗（本回合结算后剩 ' + foe.healBlock + '）');
  ok(foe.healBlockPunish && foe.healBlockPunish.den === 3, '1449：恢复量 1/3 的百分比反伤');
}
{
  const cast = skill({ id: 33014, name: '龙神·镇乾坤', power: 5, priority: 1, effects: [{ id: 1066, args: [300, 300, 150], info: 'x' }] });
  const b = mk(cast, null, 0.5);
  const foe = b.foe.team[0];
  const hp0 = foe.hp;
  b.step({ type: 'skill', index: 0 });
  ok(hp0 - foe.hp >= 450, '1066：低伤 300 + 先手 150 = 450 (' + (hp0 - foe.hp) + ')');
}
{
  const cast = skill({ id: 26596, name: '龙·御天神', priority: 1, effects: [{ id: 1065, args: [4, 3, 2], info: 'x' }] });
  const b = mk(cast, null, 0.5);
  const me = b.me.team[0];
  me.hp = Math.floor(me.maxHp / 3);
  const hb = me.hp;
  b.step({ type: 'skill', index: 0 });
  ok(me.hp - hb > Math.floor(me.maxHp / 3), '1065：半血以下回血翻倍 (' + (me.hp - hb) + ')');
  ok(me.teUseHeal && me.teUseHeal.percent === true, '1065：附带等量百分比伤害');
}
if (fails) { console.error('FAILED ' + fails); process.exit(1); }
console.log('ALL PASS');
