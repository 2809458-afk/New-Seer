global.self = global;
const B = require('../js/battle.js');
let fails = 0;
function ok(cond, msg) { if (cond) console.log('  ok  ' + msg); else { fails++; console.error('  FAIL ' + msg); } }
function eq(a, b, msg) { ok(a === b, msg + ' (期望 ' + b + '，实际 ' + a + ')'); }
const combo = { id: 110, name: '混沌次元', primary: { id: 110 }, secondary: { id: 30 } };
const chart = { 110: { 110: 1 } };
const SOUL = '神殇：回合开始时创造一个神秘结界|神印：自身在出战背包时，对方主动切换精灵登场时自身为其附加1层神印|神谕：自身在出战背包时，己方不在场精灵体力低于最大体力的1/2时不会下降|神照：自身在出战背包时，己方首发精灵首次登场时获得一个等同于自身最大体力值30%的护盾（boss有效）|神启：回合开始时，若自身体力高于最大体力的1/2则当回合自身免疫受到的异常状态和能力下降状态，若自身体力低于最大体力的1/2则自身获得等同于最大体力值30%的护盾（boss有效）|（标注部分boss有效，其余无效）';
function pet(id, name, stats) {
  return { id, name, base_stats: Object.assign({ hp: 1200, atk: 150, def: 130, sp_atk: 150, sp_def: 130, spd: 140 }, stats || {}) };
}
function skill(over) {
  return Object.assign({ id: 1, name: '测试技能', power: 0, max_pp: 10, accuracy: 100, crit_rate: 0,
    priority: 0, must_hit: true, category: { id: 4 }, type: { id: 110 }, info: '', effects: [] }, over || {});
}
const ATK = skill({ id: 900, name: '普通攻击', power: 60, category: { id: 1 }, effects: [] });
const S = {
  star: skill({ id: 33888, name: '星辉幻尘', power: 0, category: { id: 2 }, effects: [{ id: 1528, args: [50], info: '附加50点真实伤害' }] }),
  paradise: skill({ id: 14623, name: '天堂圣光', power: 110, category: { id: 2 }, effects: [{ id: 64, args: [], info: '自身在烧伤、冻伤、中毒状态下造成的伤害反而加倍' }] }),
  pure: skill({ id: 33889, name: '涤罪', power: 20, category: { id: 2 }, effects: [
    { id: 1500, args: [3, 5, 8], info: '1回合做3-5次攻击，自身处于护盾状态下连击上限为8' },
    { id: 1114, args: [2], info: '消除对手回合类效果，消除成功则令对手随机2项技能PP值归零' },
    { id: 1529, args: [200], info: '消除对手能力提升状态，消除成功则附加200点真实伤害' }] }),
  flash: skill({ id: 33890, name: '虚灵一闪', power: 0, category: { id: 1 }, effects: [{ id: 1530, args: [200], info: '遇到天敌时附加200点真实伤害' }] }),
  bless: skill({ id: 27019, name: '神之佑', category: { id: 4 }, effects: [
    { id: 847, args: [300], info: '为自身附加300点护盾' },
    { id: 1346, args: [3, 50, 1, 1], info: '3回合内每回合50%令自身全属性+1，未触发则令对手全属性-1' }] }),
  faith: skill({ id: 33891, name: '真神信仰', power: 130, category: { id: 2 }, effects: [{ id: 600, args: [1, 100, 50, 7], info: '若对手是雄性则造成伤害提升100%,若对手不是雄性，则有50%概率使对手疲惫' }] }),
  bind: skill({ id: 27020, name: '神之束缚', category: { id: 4 }, effects: [
    { id: 1440, args: [2], info: '免疫下2次自身受到的异常状态' },
    { id: 936, args: [100, 7, 2], info: '100%令对手疲惫，未触发则令对手2回合内使用的属性技能无效' },
    { id: 1531, args: [3, 300, 0], info: '3回合内每回合使用技能附加300点固定伤害，若对手未受到固定伤害则额外附加等量的真实伤害' },
    { id: 843, args: [2, 2], info: '下2回合自身所有技能先制+2' }] }),
  dawn: skill({ id: 33892, name: '破晓圣痕', power: 150, category: { id: 1 }, effects: [{ id: 1129, args: [25, 2], info: '25%概率伤害为2倍，自身处于能力提升状态时概率翻倍' }] }),
  declare: skill({ id: 27021, name: '神之宣告', category: { id: 4 }, effects: [
    { id: 1536, args: [1], info: '全属性+1，对手存在神印时强化效果翻倍' },
    { id: 971, args: [4, 3, 2], info: '4回合内每回合使用技能吸取对手最大体力的1/3，吸取体力时若自身体力低于最大体力的1/2则吸取效果翻倍' },
    { id: 1475, args: [3, 30], info: '3回合内自身受到的固定伤害和百分比伤害减少30%' },
    { id: 821, args: [2], info: '2回合内自身的回合类效果无法被消除，后出手时回合数+1' }] }),
  galaxy: skill({ id: 33893, name: '神游·浩渺星河', power: 150, category: { id: 2 }, effects: [{ id: 1532, args: [], info: '对手不存在神印则攻击必定打出致命一击，对手每存在1层神印则100%使对手随机1项技能PP值归零' }, { id: 984, args: [2], info: '未击败对手则下回合自身所有技能先制+2' }] }),
  all: skill({ id: 33894, name: '神游·众生归渺', power: 0, category: { id: 2 }, effects: [
    { id: 1208, args: [1], info: '反转自身能力下降状态，反转成功则令对手下1次使用的攻击技能无效' },
    { id: 1533, args: [350], info: '造成的攻击伤害低于350时附加大量真实伤害' },
    { id: 1534, args: [], info: '100%令对手随机1个被放逐的精灵所有技能PP值-1，若对手不存在被放逐的精灵则令对手当前精灵所有技能PP值-1' }] }),
};
const ALL = [S.star, S.paradise, S.pure, S.flash, S.bless, S.faith, S.bind, S.dawn, S.declare, S.galaxy, S.all, ATK];
function battle(opts) {
  opts = opts || {};
  const meTeam = opts.meTeam || [{ pet: pet(3986, '启灵元神'), combo, skills: ALL, passives: B.parseSoulmark(SOUL) }];
  const foeTeam = opts.foeTeam || [{ pet: pet(2, '木桩'), combo, skills: [skill({ id: 21, name: '撞击', power: 35, category: { id: 1 } })] }];
  return new B.Battle({ chart: opts.chart || chart, comboOf: () => combo, rng: opts.rng || (() => 0.99), level: 100, meTeam, foeTeam });
}
function idx(skillId) { for (let i = 0; i < ALL.length; i++) if (ALL[i].id === skillId) return i; return -1; }
function logHas(b, s) { return (b.log || []).some(function (x) { return String(x).indexOf(s) >= 0; }); }

console.log('— 启灵元神 3986：魂印 —');
{
  const sm = B.parseSoulmark(SOUL);
  eq(sm.length, 5, '魂印 5 条');
  ok(sm.some(e => e.kind === 'exile'), '神殇结界');
  ok(sm.some(e => e.fx && e.fx.type === 'markOnSwitch'), '神印叠层');
  ok(sm.some(e => e.fx && e.fx.type === 'benchFloor'), '神谕场下下限');
  ok(sm.some(e => e.fx && e.fx.type === 'firstShield'), '神照首发盾');
  ok(sm.some(e => e.kind === 'divineTurn'), '神启体力分支');
}

console.log('— 星辉幻尘 / 虚灵一闪：真实伤害 —');
{
  const b = battle({ rng: () => 0.99 });
  const foe = b.foe.team[0];
  b.useSkill('me', idx(33888), { isFirst: true });
  eq(foe.hp, foe.maxHp - 50, '星辉幻尘附加 50 真实伤害');
  const b2 = battle({ rng: () => 0.99 });
  const foe2 = b2.foe.team[0];
  b2.useSkill('me', idx(33890), { isFirst: true });
  eq(foe2.hp, foe2.maxHp, '虚灵一闪未遇天敌不附加真实伤害');
  const b3 = battle({ rng: () => 0.99, chart: { 110: { 110: 2 } } });
  const foe3 = b3.foe.team[0];
  b3.useSkill('me', idx(33890), { isFirst: true });
  eq(foe3.hp, foe3.maxHp - 200, '遇天敌附加 200 真实伤害');
}

console.log('— 涤罪：连击上限 / 破强化真伤 —');
{
  const b = battle({ rng: () => 0.99 });
  const me = b.me.team[0], foe = b.foe.team[0];
  me.shield = 300;
  foe.stages.atk = 2;
  foe.hp = 20000; foe.maxHp = 20000;
  b.useSkill('me', idx(33889), { isFirst: true });
  eq(foe.stages.atk, 0, '消除对手能力提升');
  ok(logHas(b, '真实伤害'), '消除成功附加 200 真实伤害');
  ok(logHas(b, '共 8 次攻击'), '护盾状态下连击上限 8');
}

console.log('— 天堂圣光：自身异常时伤害翻倍 —');
{
  const b = battle({ rng: () => 0.99 });
  const me = b.me.team[0], foe = b.foe.team[0];
  const mk = () => Object.assign({}, B.calcDamage({ actor: me, target: foe, skill: S.paradise, rng: () => 0.99, turn: 1 }));
  const before = mk().damage;
  me.status = { id: 'burn', turns: 2 };
  const after = mk().damage;
  ok(Math.abs(after - before * 2) <= 2, '自身烧伤时伤害翻倍 (' + before + '→' + after + ')');
}

console.log('— 神之佑：护盾 + 逐回合全属性 —');
{
  const b = battle({ rng: () => 0 });
  const me = b.me.team[0];
  const shieldBefore = me.shield;
  b.useSkill('me', idx(27019), { isFirst: true });
  eq(me.shield - shieldBefore, 300, '获得 300 护盾');
  ok(me.qyBless && me.qyBless.turns === 3, '3 回合祝福');
  b.endOfTurn();
  eq(me.stages.atk, 1, '50% 触发：自身全属性 +1');
  const b2 = battle({ rng: () => 0.99 });
  const me2 = b2.me.team[0], foe2 = b2.foe.team[0];
  b2.useSkill('me', idx(27019), { isFirst: true });
  b2.endOfTurn();
  eq(foe2.stages.atk, -1, '未触发：对手全属性 -1');
}

console.log('— 真神信仰：雄性增伤暂不生效 —');
{
  const fx = B.parseSkillEffects(S.faith);
  ok(!fx.some(e => e.kind === 'damageBuff'), '没有雄性增伤 buff');
  eq(fx[0].kind, 'status', '只保留 50% 疲惫');
}

console.log('— 神之束缚：疲劳失败封属 + 每回合固伤 —');
{
  const b = battle({ rng: () => 0.99 });
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.immuneStatus = 1;
  const hpCast0 = foe.hp;
  b.useSkill('me', idx(27020), { isFirst: true });
  ok(!foe.status, '疲惫被免疫');
  eq(hpCast0 - foe.hp, 300, '施放当回合也附加 300 固定伤害');
  eq(foe.skillBlock, 2, '未触发疲惫 → 对手 2 回合属性技能无效');
  ok(me.teFixedUse && me.teFixedUse.turns === 3, '3 回合使用技能附加固伤');
  const hp0 = foe.hp;
  b.useSkill('me', idx(900), { isFirst: true });
  eq(hp0 - foe.hp >= 300, true, '使用技能附加 300 固定伤害');
}

console.log('— 神之宣告：神印翻倍 / 持续吸取 / 固伤减伤 —');
{
  const b = battle({ rng: () => 0.99 });
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.holyMarks = 2;
  b.useSkill('me', idx(27021), { isFirst: true });
  eq(me.stages.atk, 2, '对手有神印：全属性 +1 翻倍为 +2');
  ok(me.teDrain && me.teDrain.turns === 4 && me.teDrain.den === 3, '4 回合吸取 1/3');
  ok(me.fixedPctReduce && me.fixedPctReduce.pct === 30, '固伤/百分比 -30%');
  const fd = b.directDamage(me, 1000, 'fixed');
  eq(fd, 700, '固定伤害减少 30%');
  const atkDmg = B.calcDamage({ actor: foe, target: me, skill: ATK, rng: () => 0.99, turn: 1 }).damage;
  ok(atkDmg > 0, '普通攻击伤害不受该减伤影响');
}

console.log('— 破晓圣痕：能力提升时概率翻倍 —');
{
  const b = battle({ rng: () => 0.4 });
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.hp = 99999; foe.maxHp = 99999;
  me.stages.atk = 1;
  b.useSkill('me', idx(33892), { isFirst: true });
  ok(logHas(b, '威力提升发动'), '25%→50%：0.4 触发双倍伤害');
}

console.log('— 神游·浩渺星河：无神印必暴 / 每层印归零 PP —');
{
  const b = battle({ rng: () => 0.99, foeTeam: [{
    pet: pet(2, '木桩'), combo, skills: [
      skill({ id: 21, name: '撞击', power: 35, category: { id: 1 } }),
      skill({ id: 22, name: '撞击2', power: 35, category: { id: 1 } }),
      skill({ id: 23, name: '撞击3', power: 35, category: { id: 1 } }),
      skill({ id: 24, name: '撞击4', power: 35, category: { id: 1 } })]
  }] });
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.hp = 99999; foe.maxHp = 99999;
  const r0 = B.calcDamage({ actor: me, target: foe, skill: S.galaxy, rng: () => 0.99, turn: 1 });
  eq(r0.crit, true, '对手无神印：必定致命一击');
  foe.holyMarks = 2;
  foe.skills.forEach(sl => { sl.pp = 5; });
  me.stages.spAtk = 0;
  b.useSkill('me', idx(33893), { isFirst: true });
  const zero = foe.skills.filter(sl => sl.pp === 0).length;
  eq(zero, 2, '2 层神印：随机 2 项技能 PP 归零');
  eq(me.priorityBuff.turns, 2, '未击败：先制 buff 持续到下一回合');
  b.endOfTurn();
  eq(me.priorityBuff.turns, 1, '回合末仍剩 1 回合，下回合先制 +2');
}

console.log('— 神游·众生归渺：反转 + 低伤真伤 + 放逐扣 PP —');
{
  const b = battle({ rng: () => 0.99 });
  const me = b.me.team[0], foe = b.foe.team[0];
  me.stages.atk = -2;
  foe.def = 99999; foe.stats.def = 99999;
  foe.hp = 5000; foe.maxHp = 5000;
  b.useSkill('me', idx(33894), { isFirst: true });
  eq(me.stages.atk, 2, '反转自身能力下降');
  eq(foe.attackBlock, 1, '反转成功：对手下次攻击技能无效');
  ok(logHas(b, '真实伤害'), '伤害低于 350 附加真实伤害');
}

console.log('— 放逐精灵扣 PP —');
{
  const b = battle({ rng: () => 0, foeTeam: [
    { pet: pet(2, '木桩'), combo, skills: [skill({ id: 21, power: 35, category: { id: 1 } })] },
    { pet: pet(3, '木桩二'), combo, skills: [skill({ id: 22, power: 35, category: { id: 1 } })] }
  ] });
  const bench = b.foe.team[1];
  b.exiled.foe = [1];
  b.useSkill('me', idx(33894), { isFirst: true });
  ok(bench.skills[0].pp < 10, '被放逐精灵全部技能 PP -1');
}

if (fails) { console.error('FAILED ' + fails); process.exit(1); } else { console.log('ALL PASS'); }
