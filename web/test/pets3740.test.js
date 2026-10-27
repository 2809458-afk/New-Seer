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
const SOUL1014 = '登场时获得400点护盾，自身存在护盾时所有技能先制+1|战斗阶段结束时，若当回合自身未受到攻击伤害则恢复自身250点体力并造成恢复量的固定伤害，若受到了攻击伤害则自身免疫下1次受到的攻击伤害|自身每次使用攻击技能时本次在场造成的攻击伤害提升25%，最高提升100%|（boss无效）';
function battle(meSkills) {
  return new B.Battle({ chart, comboOf: () => combo, rng: () => 0, level: 100,
    meTeam: [{ pet: pet(3740, '怒涛·沧岚'), combo, skills: meSkills, passives: B.parseSoulmark(SOUL1014) }],
    foeTeam: [{ pet: pet(2, '木桩'), combo, skills: [skill({ id: 21 })] }] });
}
console.log('— 3740 怒涛·沧岚：魂印解析 —');
{
  const sm = B.parseSoulmark(SOUL1014);
  ok(sm.some(x => x.kind === 'entryShieldFlat' && x.value === 400 && x.prio === 1), '登场 400 护盾 + 有护盾先制 +1');
  ok(sm.some(x => x.kind === 'endShieldBranch' && x.heal === 250), '回合末分支：未挨打回血/挨打挡一次');
  ok(sm.some(x => x.kind === 'atkUseDealtStack' && x.per === 25 && x.cap === 100), '攻击伤害每次 +25%，上限 +100%');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0];
  eq(me.shield, 400, '登场获得 400 点护盾');
  b.startOfTurn();
  ok(!!me.priorityBuff && me.priorityBuff.value === 1, '有护盾 → 所有技能先制 +1');
}
console.log('— 3740 回合结束分支 —');
{
  const b = battle([skill()]);
  const me = b.me.team[0];
  me.hp = me.maxHp - 500;
  const hp0 = me.hp, foeHp = b.foe.team[0].hp;
  b.endOfTurn();
  eq(me.hp, hp0 + 250, '未受攻击伤害 → 恢复 250 体力');
  eq(b.foe.team[0].hp, foeHp - 250, '并造成等量固定伤害');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0];
  me.oneHit = 0;
  b.applyDamage('me', 100, { attack: true });
  b.endOfTurn();
  eq(me.oneHit, 1, '受到攻击伤害 → 免疫下 1 次攻击伤害');
}
console.log('— 3740 攻击伤害递增 —');
{
  const b = battle([skill({ id: 31, power: 1, category: { id: 1 } })]);
  const me = b.me.team[0];
  b.useSkill('me', 0, { isFirst: true });
  eq(me.atkDealtStack, 25, '第一次攻击后 +25%');
  ok(Math.abs((me.damageBuff ? me.damageBuff.mul : 1) - 1) < 1e-9, '第一次攻击按 +0% 结算');
  b.useSkill('me', 0, { isFirst: true });
  eq(me.atkDealtStack, 50, '第二次攻击后 +50%');
  ok(Math.abs(me.damageBuff.mul - 1.25) < 1e-9, '第二次攻击按 +25% 结算');
  b.useSkill('me', 0, { isFirst: true });
  b.useSkill('me', 0, { isFirst: true });
  eq(me.atkDealtStack, 100, '递增封顶 100%');
}
if (fails) { console.error('FAILED ' + fails); process.exit(1); }
console.log('ALL PASS');
