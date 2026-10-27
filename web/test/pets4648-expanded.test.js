global.self = global;
const B = require('../js/battle.js');
let fails = 0;
function ok(cond, msg) { if (cond) console.log('  ok  ' + msg); else { fails++; console.error('  FAIL ' + msg); } }
function eq(a, b, msg) { ok(a === b, msg + ' (期望 ' + b + '，实际 ' + a + ')'); }
const combo = { id: 2, name: '水', primary: { id: 2 }, secondary: { id: 30 } };
const chart = { 2: { 2: 1 } };
const SOUL1848 = '每次登场时，若自身为对手天敌则为对手附加3回合的星海之浸；自身每次使用攻击后附加3回合的星海之浸|自身所有技能必定打出致命一击；每场战斗限1次，自身受到致死伤害时，若自身的等级为100则消除对手能力提升状态、回合类效果并恢复全部体力值、PP值，然后获得等同于自身体力值的护盾、护罩|（boss有效）';
const pet = (id, name) => ({ id, name, base_stats: { hp: 2000, atk: 150, def: 130, sp_atk: 150, sp_def: 130, spd: 140 } });
const sk = (over) => Object.assign({ id: 1, name: '测试技能', power: 0, max_pp: 10, accuracy: 100, crit_rate: 0, priority: 0, must_hit: true, category: { id: 4 }, type: { id: 2 }, info: '', effects: [] }, over || {});
const ATK = sk({ id: 900, name: '普通攻击', power: 60, category: { id: 1 } });
const S = {
  flash: sk({ id: 37383, name: '星光·闪击', power: 90, priority: 3, category: { id: 1 }, effects: [{ id: 1897, args: [2, 200, 2, 50], info: '消除对手能力提升状态，消除成功则2回合内对手造成的攻击伤害不超过200点，若对手不处于能力提升状态则2回合内对手所有体力恢复效果减少50%' }, { id: 48, args: [2], info: '2回合内免疫所有受到的异常状态' }, { id: 47, args: [2], info: '2回合内免疫能力下降状态' }] }),
  baseK: sk({ id: 10020, name: '克制', priority: -6, category: { id: 1 }, effects: [{ id: 34, args: [2], info: '将所受的伤害2倍反馈给对手' }] }),
  restraint: sk({ id: 37385, name: '星光·克制', priority: -6, category: { id: 1 }, effects: [{ id: 929, args: [2], info: '反弹2倍的伤害给对手并使自身恢复等量体力' }, { id: 1202, args: [200, 1, 300], info: '造成的伤害低于200则自身下1次受到的攻击伤害降低300点' }] }),
  waterSky: sk({ id: 28737, name: '星光·水天一色', effects: [{ id: 191, args: [4], info: '4回合内免疫并反弹所有受到的异常状态' }, { id: 1166, args: [2, 2], info: '解除自身能力下降效果，解除成功则下2回合先制+2' }, { id: 1239, args: [1, 2], info: '恢复自身最大体力的1/1，自身体力低于1/2时造成等量百分比伤害' }, { id: 817, args: [3], info: '3回合内受到攻击则对手下回合受到的伤害翻倍' }] }),
  wave: sk({ id: 37386, name: '星光·惊涛骇浪', power: 140, category: { id: 2 }, effects: [{ id: 2158, args: [15], info: '解除自身所处的异常状态，解除成功令对手冰封' }] }),
  wind: sk({ id: 28738, name: '星光·随风逐浪', effects: [{ id: 1014, args: [1, 2], info: '全属性+1，自身当前体力高于最大体力的1/2时强化效果翻倍' }, { id: 776, args: [2], info: '下2回合自身造成的攻击伤害翻倍' }] }),
  sea: sk({ id: 37387, name: '星光·排山倒海', power: 150, category: { id: 1 }, effects: [{ id: 699, args: [], info: '无视攻击免疫效果' }, { id: 1568, args: [], info: '无视护盾效果' }, { id: 937, args: [50, 15, 2, 2], info: '命中后50%使对手冰封，未触发则对手下2回合先制-2' }, { id: 101, args: [50], info: '给对手造成伤害时，伤害数值的50%恢复自身体力' }] }),
  waves: sk({ id: 37381, name: '星光·浪打千击', power: 30, category: { id: 1 }, effects: [{ id: 1172, args: [1, 5, 10, 20, 1, 0, 0, 0, 1, 1], info: '1回合做5~10次攻击，每次攻击都有20%的概率令自身攻击+1，速度+1，命中+1' }, { id: 950, args: [2], info: '消除对手回合类效果，消除成功则对手2回合内攻击技能MISS' }, { id: 2179, args: [75], info: '对手处于星火之灼时造成的攻击伤害提升75%，若自身体力低于对手则效果翻倍' }, { id: 1206, args: [20, 10, 40], info: '附加自身最大体力20%的百分比伤害，每次使用增加10%，最高40%' }] }),
};
const ALL = [S.flash, S.baseK, S.restraint, S.waterSky, S.wave, S.wind, S.sea, S.waves, ATK];
function battle(opts) {
  opts = opts || {};
  const meTeam = opts.meTeam || [{ pet: pet(4648, '星光·鲁斯王'), combo, skills: opts.skills || ALL, passives: B.parseSoulmark(SOUL1848) }];
  const foeTeam = opts.foeTeam || [{ pet: pet(2, '木桩'), combo, skills: [ATK, sk({ id: 21, name: '撞击2', power: 60, category: { id: 1 } })] }];
  return new B.Battle({ chart, comboOf: () => combo, rng: opts.rng || (() => 0.99), level: opts.level == null ? 100 : opts.level, meTeam, foeTeam });
}
const idx = (id) => ALL.findIndex(s => s.id === id);
const logHas = (b, s) => (b.log || []).some(x => String(x).indexOf(s) >= 0);

console.log('— 魂印解析 / 星海之浸 / 致死复活 —');
{
  const sm = B.parseSoulmark(SOUL1848);
  ok(sm.some(x => x.kind === 'starSeaMark' && x.turns === 3), '星海之浸 3 回合');
  ok(sm.some(x => x.kind === 'allCrit'), '所有技能必定暴击');
  ok(sm.some(x => x.kind === 'level100Revive'), '满级致死复活');
  const b = battle({ rng: () => 0.99 });
  const foe = b.foe.team[0];
  ok(foe.starSea && foe.starSea.turns === 3, '登场附加星海之浸');
  foe.starSea = null;
  b.useSkill('me', idx(900), { isFirst: true });
  ok(foe.starSea && foe.starSea.turns === 3, '攻击后附加星海之浸');
  const b2 = battle({ rng: () => 0.99 });
  const me2 = b2.me.team[0], foe2 = b2.foe.team[0];
  foe2.stages.atk = 3;
  me2.hp = 0;
  b2.checkFaints();
  eq(me2.hp, me2.maxHp, '满级致死复活回满');
  eq(me2.shield, me2.maxHp, '获得等量护盾');
  eq(foe2.stages.atk, 0, '清除对手强化');
}

console.log('— 克制 / 星光·克制：先受伤才反弹（攻击伤害） —');
{
  const b = battle({ rng: () => 0.99 });
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.hp = 99999; foe.maxHp = 99999;
  b.applyDamage('me', 300, { attack: true });
  const hp0 = me.hp, fhp0 = foe.hp;
  b.useSkill('me', idx(37385), { isFirst: true });
  eq(fhp0 - foe.hp, 600, '反弹所受 300 伤害的 200%');
  ok(me.hp > hp0, '星光·克制恢复等量体力');
  const b2 = battle({ rng: () => 0.99 });
  const me2 = b2.me.team[0], foe2 = b2.foe.team[0];
  foe2.hp = 99999; foe2.maxHp = 99999;
  b2.applyDamage('me', 250, { attack: true });
  const f2 = foe2.hp;
  b2.useSkill('me', idx(10020), { isFirst: true });
  eq(f2 - foe2.hp, 500, '普通克制同样反弹 200%');
  const b3 = battle({ rng: () => 0.99 });
  const foe3 = b3.foe.team[0];
  foe3.hp = 99999; foe3.maxHp = 99999;
  const f3 = foe3.hp;
  b3.useSkill('me', idx(37385), { isFirst: true });
  eq(foe3.hp, f3, '未受伤先手使用：不造成反弹伤害');
  ok(logHas(b3, '不产生反弹伤害'), '日志说明未受伤');
  const b4 = battle({ rng: () => 0.99 });
  const foe4 = b4.foe.team[0];
  foe4.hp = 99999; foe4.maxHp = 99999; foe4.ward = 1000;
  b4.applyDamage('me', 300, { attack: true });
  const f4 = foe4.hp;
  b4.useSkill('me', idx(37385), { isFirst: true });
  eq(f4 - foe4.hp, 600, '按攻击伤害结算');
  eq(foe4.ward, 1000, '不经固伤护罩吸收');
}

console.log('— 37385 星光·克制：低伤后下次受攻击 -300 —');
{
  const b = battle({ rng: () => 0.99 });
  const me = b.me.team[0];
  b.useSkill('me', idx(37385), { isFirst: true });
  eq(me.nextFlatReduce, 300, '造成伤害 <200 获得 300 点减伤');
  const hp0 = me.hp;
  b.applyDamage('me', 500, { attack: true });
  eq(hp0 - me.hp, 200, '下次攻击伤害降低 300');
  eq(me.nextFlatReduce, 0, '减伤只生效 1 次');
}

console.log('— 28737 星光·水天一色：解弱先制 / 低血百分比 —');
{
  const b = battle({ rng: () => 0.99 });
  const me = b.me.team[0], foe = b.foe.team[0];
  me.stages.atk = -2; me.stages.spd = -1; me.hp = 100;
  foe.hp = 99999; foe.maxHp = 99999;
  b.useSkill('me', idx(28737), { isFirst: true });
  eq(me.stages.atk, 0, '解除攻击下降');
  eq(me.stages.spd, 0, '解除速度下降');
  eq(me.priorityBuff && me.priorityBuff.value, 2, '解除成功下 2 回合先制 +2');
  eq(me.hp, me.maxHp, '恢复全部体力');
  ok(logHas(b, '造成等量百分比伤害'), '体力低于 1/2 造成等量百分比伤害');
}

console.log('— 37386 星光·惊涛骇浪：解异常才冰封 —');
{
  const b = battle({ rng: () => 0.99 });
  const me = b.me.team[0], foe = b.foe.team[0];
  me.status = { id: 'burn', turns: 2 };
  b.useSkill('me', idx(37386), { isFirst: true });
  eq(me.status, null, '解除自身异常');
  ok(foe.status && foe.status.id === 'freeze', '解除成功令对手冰封');
  const b2 = battle({ rng: () => 0.99 });
  b2.useSkill('me', idx(37386), { isFirst: true });
  ok(!b2.foe.team[0].status, '自身无异常时不冰封');
}

console.log('— 37383 星光·闪击：消强封伤害 / 无强封回血 —');
{
  const b = battle({ rng: () => 0.99 });
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.stages.atk = 1;
  b.useSkill('me', idx(37383), { isFirst: true });
  eq(foe.stages.atk, 0, '消除对手能力提升');
  ok(foe.dealtCap && foe.dealtCap.value === 200, '对手 2 回合造成攻击伤害不超过 200');
  const hp0 = me.hp;
  b.applyDamage('me', B.calcDamage({ actor: foe, target: me, skill: ATK, rng: () => 0.99, turn: 1 }).damage, { attack: true });
  ok(hp0 - me.hp <= 200, '对手攻击伤害被限制在 200 以内');
  const b2 = battle({ rng: () => 0.99 });
  const foe2 = b2.foe.team[0];
  b2.useSkill('me', idx(37383), { isFirst: true });
  ok(foe2.healDown && foe2.healDown.pct === 50, '对手无强化：2 回合恢复效果 -50%');
  foe2.hp = 100; foe2.teUseHeal = { turns: 3, num: 1, den: 2, last: -1 };
  b2.turn = 2;
  const healed = b2.applyTeUseHeal('foe', foe2);
  ok(healed <= Math.floor(foe2.maxHp / 2) * 0.51, '回血被削减 50%');
}

console.log('— 37387 星光·排山倒海：50% 冰封 / 未触发先制 -2 —');
{
  const b = battle({ rng: () => 0.4 });
  const foe = b.foe.team[0];
  b.useSkill('me', idx(37387), { isFirst: true });
  ok(foe.status && foe.status.id === 'freeze', '50% 触发冰封');
  const b2 = battle({ rng: () => 0.6 });
  const foe2 = b2.foe.team[0];
  b2.useSkill('me', idx(37387), { isFirst: true });
  ok(!foe2.status, '未触发冰封');
  eq(foe2.priorityDown && foe2.priorityDown.value, 2, '未触发：对手下 2 回合先制 -2');
}

console.log('— 37381 星光·浪打千击：连击 / MISS / 递增百分比 —');
{
  const b = battle({ rng: () => 0.1 });
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.hp = 99999; foe.maxHp = 99999;
  foe.guards.push({ turns: 2, mul: 0.5, scope: 'all' });
  b.useSkill('me', idx(37381), { isFirst: true });
  ok(b.lastHits >= 5 && b.lastHits <= 10, '5~10 段连击 (' + b.lastHits + ')');
  ok(me.stages.atk >= 1 && me.stages.spd >= 1 && me.stages.acc >= 1, '每段概率提升攻击/速度/命中');
  eq(foe.missTurns, 2, '消除回合效果成功：对手 2 回合攻击 MISS');
  ok(logHas(b, '自身最大体力 20% 的百分比伤害'), '第 1 次附加 20% 百分比伤害');
  b.useSkill('me', idx(37381), { isFirst: true });
  ok(logHas(b, '自身最大体力 30% 的百分比伤害'), '第 2 次递增到 30%');
  eq(b.accuracyCheck(foe, me, sk({ id: 901, power: 60, category: { id: 1 }, must_hit: false })), false, '攻击 MISS 生效');
}

console.log('— 星火之灼增伤 / 28738 高血翻倍 —');
{
  const b = battle({ rng: () => 0.99 });
  const me = b.me.team[0], foe = b.foe.team[0];
  const base = B.calcDamage({ actor: me, target: foe, skill: S.waves, rng: () => 0.99, turn: 1 }).damage;
  foe.status = { id: 'starFire', turns: 2 };
  const buffed = B.calcDamage({ actor: me, target: foe, skill: S.waves, rng: () => 0.99, turn: 1 }).damage;
  ok(buffed >= base * 1.7, '星火之灼：伤害 +75% (' + base + '→' + buffed + ')');
  me.hp = 1000; foe.hp = 3000;
  const low = B.calcDamage({ actor: me, target: foe, skill: S.waves, rng: () => 0.99, turn: 1 }).damage;
  ok(low >= base * 2.4, '体力低于对手：增伤翻倍为 +150% (' + base + '→' + low + ')');
  const b2 = battle({ rng: () => 0.99 });
  const me2 = b2.me.team[0];
  b2.useSkill('me', idx(28738), { isFirst: true });
  eq(me2.stages.atk, 2, '体力高于 1/2：全属性 +2');
  const b3 = battle({ rng: () => 0.99 });
  const me3 = b3.me.team[0];
  me3.hp = 100;
  b3.useSkill('me', idx(28738), { isFirst: true });
  eq(me3.stages.atk, 1, '体力低于 1/2：全属性 +1');
}

if (fails) { console.error('FAILED ' + fails); process.exit(1); } else { console.log('ALL PASS'); }
