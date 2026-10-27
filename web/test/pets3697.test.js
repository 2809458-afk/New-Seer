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
const SOUL976 = '所有对于速度的强化同时应用于体力（刻印，学习力）；自身背包内每死亡一只精灵则自身技能先制+1，最高先制+5；回合开始时，若自身体力高于对手则当回合免疫异常状态且50%使对手全属性-1，若自身体力低于对手则当回合受到的伤害减少50%（包括攻击伤害和固定伤害）且100%使对手全属性-1（boss无效）';
function battle(meSkills, withBench) {
  const meTeam = [{ pet: pet(3697, '擎空·凡尔斯'), combo, skills: meSkills, passives: B.parseSoulmark(SOUL976) }];
  if (withBench) meTeam.push({ pet: pet(9999, '替补'), combo, skills: [skill()] });
  return new B.Battle({ chart, comboOf: () => combo, rng: () => 0, level: 100, meTeam,
    foeTeam: [{ pet: pet(2, '木桩'), combo, skills: [skill({ id: 2, name: '撞击', power: 10, category: { id: 1 } })] }] });
}
console.log('— 3697 擎空·凡尔斯：魂印解析 —');
{
  const sm = B.parseSoulmark(SOUL976);
  ok(sm.some(x => x.kind === 'speedToHp'), '速度强化同时加体力（仅记录）');
  ok(sm.some(x => x.kind === 'deadAllyPriority' && x.cap === 5), '队友阵亡 → 技能先制+1，上限 +5');
  ok(sm.some(x => x.kind === 'highHpImmuneAllDown' && x.chance === 50), '体力高 → 免疫异常 + 50% 对手全属性-1');
  ok(sm.some(x => x.kind === 'lowHpReduceAllDown' && x.pct === 50 && x.chance === 100), '体力低 → 减伤 50%（含固伤）+ 对手全属性-1');
}
{
  const b = battle([skill()]);
  ok(!!b.me.team[0].deadAllyPriority && !!b.me.team[0].lowHpReduceAllDown, '魂印字段装载');
}
console.log('— 3697 实战 —');
{
  const b = battle([skill()], true);
  const me = b.me.team[0];
  b.me.team[1].hp = 0;
  b.startOfTurn();
  ok(!!me.priorityBuff && me.priorityBuff.value === 1, '队友阵亡 1 只 → 先制 +1');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.hp = Math.floor(foe.maxHp * 0.4);
  b.startOfTurn();
  ok(me.immuneStatus >= 1, '体力高 → 免疫异常');
  eq(foe.stages.atk, -1, '体力高 → 对手全属性 -1（攻击）');
  eq(foe.stages.spd, -1, '体力高 → 对手全属性 -1（速度）');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0], foe = b.foe.team[0];
  me.hp = Math.floor(me.maxHp * 0.3);
  b.startOfTurn();
  ok(Math.abs((me.turnTakenMul || 1) - 0.5) < 1e-9, '体力低 → 攻击伤害 ×0.5');
  eq(b.directDamage(me, 100, 'fixed'), 50, '体力低 → 固定伤害 ×0.5');
}
if (fails) { console.error('FAILED ' + fails); process.exit(1); }
console.log('ALL PASS');
