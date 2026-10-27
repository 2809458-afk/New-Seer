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
const SOUL1727 = '自身拥有北冥之刃，每次击败对手后，3回合内自身的北冥之刃升级为北冥狂刃|自身拥有强击形态、无罔形态、威破形态三种形态，自身首次出战时，进入强击形态|（boss无效）';
function battle(meSkills) {
  return new B.Battle({ chart, comboOf: () => combo, rng: () => 0, level: 100,
    meTeam: [{ pet: pet(4515, '霍光'), combo, skills: meSkills, passives: B.parseSoulmark(SOUL1727) }],
    foeTeam: [{ pet: pet(2, '木桩'), combo, skills: [skill({ id: 21 })] }] });
}
console.log('— 4515 霍光：魂印解析 —');
{
  const sm = B.parseSoulmark(SOUL1727);
  ok(sm.some(x => x.kind === 'beimingBlade' && x.turns === 3), '击败对手 → 北冥狂刃 3 回合');
  ok(sm.some(x => x.kind === 'formSystem'), '三形态系统 + 首次出战强击形态');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0];
  eq(me.form, '强击', '首次出战：强击形态');
  eq(me.blade, '北冥之刃', '初始武器：北冥之刃');
}
console.log('— 4515 击败升级狂刃 —');
{
  const b = battle([skill({ id: 31, power: 200, category: { id: 1 } })]);
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.hp = 1;
  b.useSkill('me', 0, { isFirst: true });
  ok(foe.hp <= 0, '对手被击败');
  eq(me.blade, '北冥狂刃', '北冥之刃升级为北冥狂刃');
  eq(me.bladeTurns, 3, '持续 3 回合');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0];
  me.blade = '北冥狂刃';
  me.bladeTurns = 3;
  for (let i = 0; i < 3; i++) b.endOfTurn();
  eq(me.bladeTurns, 0, '3 回合后计数归零');
  eq(me.blade, '北冥之刃', '狂刃到期降回北冥之刃');
}
console.log('— 4515 狂刃增伤 —');
{
  const mk = (blade, turns) => {
    const b = battle([skill({ id: 32, power: 60, category: { id: 1 } })]);
    const me = b.me.team[0];
    me.blade = blade; me.bladeTurns = turns;
    const hp0 = b.foe.team[0].hp;
    b.useSkill('me', 0, { isFirst: true });
    return hp0 - b.foe.team[0].hp;
  };
  const normal = mk('北冥之刃', 0), blade = mk('北冥狂刃', 2);
  ok(blade > normal, '北冥狂刃期间伤害翻倍 (' + normal + ' → ' + blade + ')');
}
console.log('— 4515 形态切换 —');
{
  const b = battle([skill({ id: 41, info: '若自身当前不处于无罔形态则将自身转换为无罔形态，若自身当前处于无罔形态则将自身转换为强击形态' })]);
  const me = b.me.team[0];
  b.useSkill('me', 0, { isFirst: true });
  eq(me.form, '无罔', '技能 → 无罔形态');
  b.useSkill('me', 0, { isFirst: true });
  eq(me.form, '强击', '再次使用 → 回到强击形态');
}
{
  const b = battle([skill({ id: 42, info: '若自身当前不处于威破形态则将自身转换为威破形态，若自身当前处于威破形态则将自身转换为强击形态' })]);
  const me = b.me.team[0];
  b.useSkill('me', 0, { isFirst: true });
  eq(me.form, '威破', '技能 → 威破形态');
}
if (fails) { console.error('FAILED ' + fails); process.exit(1); }
console.log('ALL PASS');
