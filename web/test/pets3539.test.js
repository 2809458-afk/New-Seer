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
const SOUL846 = '自身首次死亡时100%的概率会残留1点体力，同时战斗阶段结束时100%令对手害怕；对手使用属性技能则自身免疫下1次受到的异常状态；对手使用攻击技能则自身有70%的概率闪避对手攻击，若该效果触发则下回合自身攻击造成的伤害提升50%，若该效果未触发则战斗阶段结束时附加自身攻击值50%的百分比伤害（boss无效）';
function battle(meSkills, foeSkill, rngv) {
  return new B.Battle({ chart, comboOf: () => combo, rng: () => (rngv == null ? 0 : rngv), level: 100,
    meTeam: [{ pet: pet(3539, '混沌·布莱克'), combo, skills: meSkills, passives: B.parseSoulmark(SOUL846) }],
    foeTeam: [{ pet: pet(2, '木桩'), combo, skills: [foeSkill || skill({ id: 2, name: '撞击', power: 10, category: { id: 1 } })] }] });
}
console.log('— 3539 混沌·布莱克：魂印解析 —');
{
  const sm = B.parseSoulmark(SOUL846);
  ok(sm.some(x => x.kind === 'firstDeathSurvive'), '首次死亡残留 1 点体力');
  ok(sm.some(x => x.kind === 'deathFear'), '同时回合末令对手害怕');
  ok(sm.some(x => x.kind === 'statusSkillImmuneNext'), '对手用属性技 → 免疫下次异常');
  const cd = sm.filter(x => x.kind === 'chanceDodge')[0];
  ok(!!cd && cd.pct === 70 && cd.buffPct === 50 && cd.counterPct === 50, '对手攻击 70% 闪避（成功+50% / 失败附伤 50%）');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0];
  ok(me.firstDeathSurvive === true && me.chanceDodgePct === 70 && me.statusSkillImmuneNext === true, '魂印字段装载');
}
console.log('— 3539 实战 —');
{
  const b = battle([skill()], skill({ id: 2, name: '撞击', power: 200, category: { id: 1 } }), 0);
  const me = b.me.team[0];
  const hp0 = me.hp;
  b.step({ type: 'skill', index: 0 });
  eq(me.hp, hp0, '70% 闪避 → 本次攻击完全没打中');
  ok(me.dodgeBuffPending === true, '闪避成功 → 下回合伤害提升待发');
  b.startOfTurn();
  ok(!!me.damageBuff && Math.abs(me.damageBuff.mul - 1.5) < 1e-9, '下回合攻击伤害 ×1.5');
}
{
  const b = battle([skill()], skill({ id: 2, name: '撞击', power: 200, category: { id: 1 } }), 0.99);
  const me = b.me.team[0], foe = b.foe.team[0];
  b.step({ type: 'skill', index: 0 });
  ok(me.dodgeFailedThisTurn === false, '回合末已结算未闪避附伤');
  ok(foe.hp < foe.maxHp || b.log.some(x => /未闪避，附加/.test(x)), '未闪避 → 附加攻击值 50% 百分比伤害');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0], foe = b.foe.team[0];
  me.hp = 0;
  b.checkFaints();
  eq(me.hp, 1, '首次死亡残留 1 点体力');
  ok(me.firstDeathUsed === true, '只触发一次');
  ok(me.endTurnFear === true, '标记回合末害怕');
  b.endOfTurn();
  ok(!!foe.status && foe.status.id === 'fear', '回合末令对手害怕');
  me.hp = 0;
  b.checkFaints();
  eq(me.hp, 0, '第二次死亡正常阵亡');
}
{
  const b = battle([skill({ id: 3, name: '攻击', power: 0, category: { id: 1 } })],
    skill({ id: 4, name: '属性技', effects: [] }));
  const me = b.me.team[0];
  b.useSkill('foe', 0, { isFirst: false });
  ok(me.immuneStatus >= 1, '对手用属性技 → 自身免疫下次异常');
  b.applyStatus(me, 'paralyze', 1, '对手');
  ok(!me.status, '免疫异常生效');
}
if (fails) { console.error('FAILED ' + fails); process.exit(1); }
console.log('ALL PASS');
