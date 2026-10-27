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
const SOUL968 = '首次登场100%令对手随机进入1种控制类异常状态，之后每次登场100%令对手随机进入1种异常状态；自身攻击造成伤害高于280则100%令对手随机进入1种异常状态，自身攻击造成伤害低于280则下回合攻击先制+1且必定致命（boss无效）';
function battle(meSkills, rngv) {
  return new B.Battle({ chart, comboOf: () => combo, rng: () => (rngv == null ? 0 : rngv), level: 100,
    meTeam: [{ pet: pet(3683, '混沌魔尊'), combo, skills: meSkills, passives: B.parseSoulmark(SOUL968) }],
    foeTeam: [{ pet: pet(2, '木桩'), combo, skills: [skill({ id: 2, name: '撞击', power: 10, category: { id: 1 } })] }] });
}
console.log('— 3683 混沌魔尊：魂印解析 —');
{
  const sm = B.parseSoulmark(SOUL968);
  ok(sm.some(x => x.kind === 'enterRandomStatus' && x.first === true), '首次登场：随机控制类异常');
  const th = sm.filter(x => x.kind === 'atkThreshStatus')[0];
  ok(!!th && th.high === 280 && th.low === 280 && th.prio === 1, '伤害阈值 280：高→异常，低→先制+1+必暴');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0];
  ok(!!me.enterRandomStatus && !!me.atkThreshStatus, '魂印字段装载');
}
console.log('— 3683 实战 —');
{
  const b = battle([skill()], 0.5);
  const me = b.me.team[0], foe = b.foe.team[0];
  me.enterStatusUsed = false;
  b.onEnter(me);
  ok(!!foe.status && foe.status.id === 'paralyze', '首次登场 → 控制类异常（选中麻痹）');
}
{
  const b = battle([skill()], 0.5);
  const me = b.me.team[0], foe = b.foe.team[0];
  me.enterRandomStatus = { first: false };
  me.enterStatusUsed = false;
  foe.status = null;
  b.onEnter(me);
  ok(!!foe.status && foe.status.id === 'petrify', '非首次登场 → 任意异常（选中石化）');
}
{
  const b = battle([skill({ id: 3, name: '重击', power: 260, category: { id: 1 } })], 0.5);
  const me = b.me.team[0], foe = b.foe.team[0];
  me.stages.atk = 6;
  b.step({ type: 'skill', index: 0 });
  ok(b.log.some(x => /伤害高于 280/.test(x)) && !!foe.status, '伤害 > 280 → 对手随机异常');
}
{
  const b = battle([skill({ id: 4, name: '轻击', power: 1, category: { id: 1 } })], 0.5);
  const me = b.me.team[0];
  b.step({ type: 'skill', index: 0 });
  ok(!!me.priorityBuff && me.priorityBuff.value === 1, '伤害 < 280 → 下回合先制 +1');
  ok(b.log.some(x => /必定致命/.test(x)) || me.critBuffTurns === 1 || me.critBonus > 0, '伤害 < 280 → 下回合必定致命');
}
if (fails) { console.error('FAILED ' + fails); process.exit(1); }
console.log('ALL PASS');
