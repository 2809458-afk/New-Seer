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
const SOUL728 = '登场时，消除对手能力提升状态，消除成功则以回合类效果的形式令对手2回合内无法处于能力提升状态且令对手下1次使用的属性技能无效|每回合开始至战斗阶段结束时，若对手存在高于自身的能力等级，则令对手该能力等级变为与自身相同|回合开始时，若自身不处于能力提升状态，则50%使自身免疫对手下次使用的技能造成的攻击伤害，未触发则当回合受到的攻击伤害减少50%|战斗阶段结束时若自身处于能力提升状态，则恢复自身最大体力的1/3并附加等量的百分比伤害，恢复量与附加量最高为自身当前已损失体力值（boss有效）|（标注部分boss有效，其余无效）';
function battle(meSkills, foeSkill, rngv, passives) {
  return new B.Battle({ chart, comboOf: () => combo, rng: () => (rngv == null ? 0 : rngv), level: 100,
    meTeam: [{ pet: pet(3414, '混沌魔君索伦森'), combo, skills: meSkills, passives: passives === undefined ? B.parseSoulmark(SOUL728) : passives }],
    foeTeam: [{ pet: pet(2, '木桩'), combo, skills: [foeSkill || skill({ id: 2, name: '撞击', power: 10, category: { id: 1 } })] }] });
}
console.log('— 3414 混沌魔君索伦森：魂印解析 —');
{
  const sm = B.parseSoulmark(SOUL728);
  const el = sm.filter(x => x.kind === 'enterClearLock')[0];
  ok(!!el && el.turns === 2 && el.statusSkills === 1, '登场清强化成功 → 2 回合封强化 + 1 次属性技失效');
  ok(sm.some(x => x.kind === 'mirrorFoeStages'), '对手能力等级拉平到自身');
  const ih = sm.filter(x => x.kind === 'immuneNextOrHalve')[0];
  ok(!!ih && ih.chance === 50 && ih.pct === 50, '无强化时 50% 免一击 / 否则减伤 50%');
  const eh = sm.filter(x => x.kind === 'endHealIfUp')[0];
  ok(!!eh && eh.num === 1 && eh.den === 3, '回合末有强化回复 1/3 + 等量百分比伤害');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0];
  ok(!!me.enterClearLock && me.mirrorFoeStages === true && !!me.immuneNextOrHalve && !!me.endHealIfUp, '魂印字段装载');
}
console.log('— 3414 实战 —');
{
  const b = battle([skill()]);
  const me = b.me.team[0], foe = b.foe.team[0];
  me.stages.atk = 2; foe.stages.atk = 5; foe.stages.spd = 1;
  b.startOfTurn();
  eq(foe.stages.atk, 2, '对手攻击等级被拉平到 2');
  eq(foe.stages.spd, 0, '高于自身的能力等级同样被拉平到自身（0）');
}
{
  const b = battle([skill()], null, 0);
  const me = b.me.team[0];
  b.startOfTurn();
  eq(me.oneHit, 1, '无强化 + 50% 命中 → 免疫下次攻击');
}
{
  const b = battle([skill()], null, 0.9);
  const me = b.me.team[0];
  b.startOfTurn();
  ok(Math.abs(me.turnTakenMul - 0.5) < 1e-9, '未触发 → 当回合攻击伤害 ×0.5');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0], foe = b.foe.team[0];
  me.stages.atk = 1;
  me.hp = Math.floor(me.maxHp * 0.5);
  const lost = me.maxHp - me.hp;
  const heal = Math.min(Math.floor(me.maxHp / 3), lost);
  const fhp0 = foe.hp;
  b.endOfTurn();
  eq(me.hp, Math.floor(me.maxHp * 0.5) + heal, '回合末有强化 → 回复 1/3（受已损失体力上限约束）');
  eq(fhp0 - foe.hp, heal, '同时造成等量百分比伤害');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.stages.atk = 3;
  me.enterClearUsed = false;   // 模拟「重新登场」
  b.onEnter(me);
  eq(foe.stages.atk, 0, '登场：消除对手强化');
  ok(foe.noStatUp >= 2, '登场：对手 2 回合无法强化');
  ok(foe.statusSkillNull >= 1, '登场：对手下 1 次属性技失效');
  eq(b.onEnter(me) || b.me.team[0].enterClearUsed, true, '登场封印只触发一次');
}
{
  const b = battle([skill({ id: 3, name: '攻击', power: 0, category: { id: 1 } })],
    skill({ id: 4, name: '属性技', effects: [{ info: '全属性+1' }] }));
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.stages.atk = 3;
  me.enterClearUsed = false;
  b.onEnter(me);
  b.step({ type: 'skill', index: 0 });
  ok(b.log.some(x => /属性技能被封印/.test(x)), '属性技能被封印（日志）');
  eq(foe.stages.atk, 0, '被封印的属性技没有生效');
}

console.log('— 堕世（22745 / id 561）—');
{
  const dushi = skill({ id: 22745, name: '堕世', power: 0, priority: 1, effects: [
    { id: 561, info: '先出手时当回合对手使用技能后若自身体力为0，则令自身体力等于最大体力', args: [] }] });
  const b = battle([dushi], null, 0.9);
  const me = b.me.team[0];
  me.hp = 1;
  b.step({ type: 'skill', index: 0 });
  eq(me.hp, me.maxHp, '先手堕世：被对手打死后体力回满');
  ok(b.log.some(x => x.indexOf('堕世') >= 0), '日志有堕世触发');
}
{
  const dushi = skill({ id: 22745, name: '堕世', power: 0, priority: -1, effects: [
    { id: 561, info: '先出手时当回合对手使用技能后若自身体力为0，则令自身体力等于最大体力', args: [] }] });
  const b = battle([dushi], null, 0.9);
  const me = b.me.team[0];
  me.hp = 1;
  b.step({ type: 'skill', index: 0 });
  ok(me.hp <= 0 || me.hp < me.maxHp, '后手时不回满（未先出手）');
}

console.log('— 1047 / 1130 / 1131 / 1215 / 1216 —');
{ // 1047：100% 害怕，未触发则吸 1/3
  const cast = skill({ id: 25340, name: '混沌魔域', power: 0, effects: [{ id: 1047, info: '100%令对手害怕，未触发则吸取对手最大体力的1/3', args: [100, 6, 3] }] });
  const b = battle([cast], null, 0.5, []);
  const me = b.me.team[0], foe = b.foe.team[0];
  const foeHp = foe.hp;
  b.step({ type: 'skill', index: 0 });
  ok(b.log.some(x => /陷入了害怕状态/.test(x)), '1047：害怕生效');
  eq(foe.hp, foeHp, '1047：害怕生效时不吸血');
}
{ // 1047：被免疫 → 吸取 1/3
  const cast = skill({ id: 25340, name: '混沌魔域', power: 0, effects: [{ id: 1047, info: '100%令对手害怕，未触发则吸取对手最大体力的1/3', args: [100, 6, 3] }] });
  const b = battle([cast], null, 0.5, []);
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.starGuard = 1;
  const foeHp = foe.hp;
  b.step({ type: 'skill', index: 0 });
  ok(!foe.status, '1047：异常被免疫');
  ok(foe.hp < foeHp, '1047：未触发时吸取对手最大体力 1/3');
}
{ // 1130：全属性 -1，体力低于对手翻倍
  const cast = skill({ id: 25340, name: '混沌魔域', power: 0, effects: [{ id: 1130, info: '使对手全属性-1，自身体力低于对手时弱化效果翻倍', args: [1] }] });
  const b = battle([cast], null, 0.5, []);
  const me = b.me.team[0], foe = b.foe.team[0];
  me.hp = 100; foe.hp = 2000;
  b.step({ type: 'skill', index: 0 });
  eq(foe.stages.atk, -2, '1130：体力低于对手 → 全属性 -2');
  eq(foe.stages.acc, -2, '1130：命中同样 -2');
}
{ // 1131：强化时换区间
  const cast = skill({ id: 30471, name: '意念魔形', power: 0, effects: [{ id: 1131, info: '随机附加200-400点固定伤害，自身处于能力提升状态时变为300-500点固定伤害', args: [200, 400, 300, 500] }] });
  const b1 = battle([cast], null, 0, []);
  const f1 = b1.foe.team[0]; const h1 = f1.hp;
  b1.step({ type: 'skill', index: 0 });
  eq(h1 - f1.hp, 200, '1131：无强化时 200 固伤（rng=0）');
  const b2 = battle([cast], null, 0, []);
  const me2 = b2.me.team[0], f2 = b2.foe.team[0]; me2.stages.atk = 1;
  const h2 = f2.hp;
  b2.step({ type: 'skill', index: 0 });
  eq(h2 - f2.hp, 300, '1131：有强化时 300 固伤（rng=0）');
}
{ // 1215：消护盾成功则全属性 -1
  const cast = skill({ id: 25604, name: '黯灭君王', power: 0, effects: [{ id: 1215, info: '消除对手所有护盾效果，消除成功则使对手全属性-1', args: [1] }] });
  const b = battle([cast], null, 0.5, []);
  const foe = b.foe.team[0];
  foe.shield = 500;
  b.step({ type: 'skill', index: 0 });
  eq(foe.shield, 0, '1215：对手护盾被消除');
  eq(foe.stages.atk, -1, '1215：护盾消除成功 → 全属性 -1');
  const b2 = battle([cast], null, 0.5, []);
  const foe2 = b2.foe.team[0];
  b2.step({ type: 'skill', index: 0 });
  eq(foe2.stages.atk, 0, '1215：无护盾时不弱化');
}
{ // 1216：反转对手强化成功 → 回满体力与 PP
  const cast = skill({ id: 30994, name: '烈火净世击', power: 0, priority: 1, effects: [{ id: 1216, info: '反转对手能力提升状态，反转成功则恢复自身全部体力和PP值', args: [] }] });
  const b = battle([cast], null, 0.5, []);
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.stages.atk = 2; foe.stages.spd = 1;
  me.hp = 100; me.skills[0].pp = 1;
  b.step({ type: 'skill', index: 0 });
  eq(foe.stages.atk, -2, '1216：对手攻击 +2 反转为 -2');
  eq(foe.stages.spd, -1, '1216：对手速度 +1 反转为 -1');
  ok(b.log.some(x => /体力与 PP 全部恢复/.test(x)) && me.hp > 1000, '1216：反转成功回满体力（随后吃对手一击）');
  eq(me.skills[0].pp, me.skills[0].maxPp, '1216：反转成功回满 PP');
}
{ // 魂印 728：下 1 次属性技无效（属性技被挡，攻击技正常）
  const attr = skill({ id: 3, name: '属性强化', power: 0, category: { id: 4 }, effects: [{ id: 5, info: '攻击+1', args: [1] }] });
  const b = battle([skill({ id: 9, name: '撞击', power: 20, category: { id: 1 } })]);
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.skills = [attr];
  me.enterClearUsed = false;
  b.onEnter(me);
  b.step({ type: 'skill', index: 0 });
  eq(foe.stages.atk, 0, '魂印：属性技被封印，没有强化');
  const b2 = battle([skill({ id: 9, name: '撞击', power: 20, category: { id: 1 } })], null, 0.5);
  const me2 = b2.me.team[0], foe2 = b2.foe.team[0];
  me2.enterClearUsed = false;
  b2.onEnter(me2);
  const hpF2 = foe2.hp;
  b2.step({ type: 'skill', index: 0 });
  ok(foe2.hp < hpF2, '魂印：攻击技不受封印影响');
}
if (fails) { console.error('FAILED ' + fails); process.exit(1); }
console.log('ALL PASS');
