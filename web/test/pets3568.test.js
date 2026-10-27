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
const SOUL870 = '每次登场时为自身附加等同于自身最大体力值1/2的护盾且当回合开始起自身免疫异常状态直到自身的下个回合开始；回合开始时若自身存在护盾则自身使用攻击技能先制+1；自身护盾消失时消除对手回合类效果和能力提升状态，同时使对手随机2个技能的PP值归零（boss无效）';
function battle(meSkills) {
  return new B.Battle({ chart, comboOf: () => combo, rng: () => 0, level: 100,
    meTeam: [{ pet: pet(3568, '圣地卡修斯'), combo, skills: meSkills, passives: B.parseSoulmark(SOUL870) }],
    foeTeam: [{ pet: pet(2, '木桩'), combo, skills: [skill({ id: 2, name: '撞击', power: 10, category: { id: 1 } }), skill({ id: 3, name: '第二技', power: 0, category: { id: 4 } })] }] });
}
console.log('— 3568 圣地卡修斯：魂印解析 —');
{
  const sm = B.parseSoulmark(SOUL870);
  const es = sm.filter(x => x.kind === 'enterShieldImmune')[0];
  ok(!!es && es.num === 1 && es.den === 2, '登场获得 1/2 最大体力护盾');
  ok(sm.some(x => x.kind === 'shieldPriority' && x.value === 1), '有护盾时攻击先制 +1');
  ok(sm.some(x => x.kind === 'shieldBreakClear' && x.ppCount === 2), '护盾消失：断回合 + 清强化 + 随机 2 技能 PP 归零');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0];
  eq(me.shield, Math.floor(me.maxHp / 2), '登场护盾 = 1/2 最大体力');
  ok(me.shieldBreakArmed === true, '护盾破碎标记已就绪');
  ok(me.immuneStatus >= 1, '登场免疫异常');
}
console.log('— 3568 实战 —');
{
  const b = battle([skill()]);
  const me = b.me.team[0];
  b.startOfTurn();
  ok(!!me.priorityBuff && me.priorityBuff.value === 1, '有护盾 → 本回合先制 +1');
  me.shield = 0;
  me.priorityBuff = null;
  b.startOfTurn();
  ok(!me.priorityBuff, '无护盾 → 没有先制加成');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.stages.atk = 3;
  foe.damageBuff = { turns: 2, mul: 2 };
  me.shield = 30;
  const hp0 = me.hp;
  b.applyDamage('me', 200, { attack: true });
  eq(me.shield, 0, '护盾被打穿');
  eq(me.hp, hp0 - 170, '护盾只吸收 30 点');
  eq(foe.stages.atk, 0, '护盾消失 → 清除对手强化');
  ok(!foe.damageBuff, '护盾消失 → 消除对手回合类效果');
  ok(foe.skills.some(x => x.pp === 0), '护盾消失 → 对手随机 2 个技能 PP 归零');
  ok(b.log.some(x => /护盾破碎/.test(x)), '护盾破碎日志');
}
if (fails) { console.error('FAILED ' + fails); process.exit(1); }
console.log('ALL PASS');
