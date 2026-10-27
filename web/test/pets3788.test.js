global.self = global;
const B = require('../js/battle.js');
let fails = 0;
function ok(cond, msg) { if (cond) console.log('  ok  ' + msg); else { fails++; console.error('  FAIL ' + msg); } }
function eq(a, b, msg) { ok(a === b, msg + ' (期望 ' + b + '，实际 ' + a + ')'); }
const combo = { id: 110, name: '混沌次元', primary: { id: 110 }, secondary: { id: 30 } };
const chart = { 110: { 110: 1 } };
const SOUL = '自身作为首发精灵首次出战时，令对手当回合无法主动切换精灵且50%驱逐对手|自身首次出战后召唤辛，辛的初始体力等同于自身的最大体力|回合开始时，若辛存活则自身依次执行以下效果：|    辛每损失20%的体力当回合自身造成的攻击伤害提升10%（boss有效）|    若自身处于异常状态，则令对手随机1个技能PP值归零|    若自身处于能力下降状态，则当回合战斗阶段结束时附加对手最大体力1/4的百分比伤害|自身被击败后，己方获得3回合的辛之印记|己方每阵亡1只精灵自身6%闪避对手的技能，对手为英雄圣殿成员时闪避率翻倍|（标注部分boss有效，其余无效）';

function pet(id, name, stats) {
  return { id, name, base_stats: Object.assign({ hp: 1000, atk: 150, def: 125, sp_atk: 80, sp_def: 125, spd: 140 }, stats || {}) };
}
function skill(over) {
  return Object.assign({ id: 1, name: '测试技能', power: 0, max_pp: 10, accuracy: 100, crit_rate: 0,
    priority: 0, must_hit: true, category: { id: 4 }, type: { id: 110 }, info: '', effects: [] }, over || {});
}
const ATK = skill({ id: 900, name: '普通攻击', power: 60, category: { id: 1 }, effects: [] });
const S = {
  shenqi: skill({ id: 32907, name: '神泣', power: 85, category: { id: 1 }, priority: 3, effects: [
    { info: '消除对手回合类效果，消除成功对手下2回合受到的伤害翻倍' },
    { info: '消除对手能力提升状态，消除成功则令对手疲惫' }] }),
  moduan: skill({ id: 32910, name: '末世丧钟', power: 140, category: { id: 2 }, effects: [
    { info: '5%的概率秒杀对手，未触发则令对手全属性-1' }] }),
  duanshi: skill({ id: 32911, name: '天尊堕世斩', power: 150, category: { id: 1 }, must_hit: true, effects: [
    { info: '造成的攻击伤害高于300则吸取对手最大体力的1/3' },
    { info: '造成的伤害低于300时令对手疲惫，未触发则自身下1次攻击造成的伤害额外提升100%' },
    { info: '“辛”存活时反转自身能力下降状态，反转成功则2回合内令对手使用的属性技能无效' }] }),
  shengsi: skill({ id: 32912, name: '混沌·生死判', power: 160, category: { id: 1 }, must_hit: true, effects: [
    { info: '当回合击败对手则50%恢复自身全部体力，未触发则全属性+1' },
    { info: '未击败对手则下2回合自身先制+2' },
    { info: '“辛”存活时造成攻击伤害的50%恢复自身体力，“辛”死亡后造成的攻击伤害额外提升50%' }] }),
  vk: skill({ id: 26542, name: '虚空桎梏', category: { id: 4 }, must_hit: true, effects: [
    { info: '免疫下2次自身受到的异常状态' },
    { info: '3回合内若对手使用攻击技能则命中前令自身吸取对手最大体力的1/3' },
    { info: '3回合内若对手使用攻击技能，则使用攻击技能后的下2回合属性技能命中效果失效' },
    { id: 861, args: [3, 2], info: '3回合内若对手使用属性技能则令对手所有技能降低2点PP值' },
    { info: '“辛”存活时50%的概率令自身2回合内回合类效果无法被消除（后出手则延续至下2回合），“辛”死亡后概率翻倍' }] }),
  tzc: skill({ id: 26543, name: '天造草昧', category: { id: 4 }, must_hit: true, effects: [
    { info: '全属性+1，自身体力低于1/2时强化效果翻倍' },
    { info: '4回合内每回合使用技能吸取对手最大体力的1/3，吸取体力时若自身体力低于最大体力的1/2则吸取效果翻倍' },
    { info: '下2回合令自身所有技能先制+2' },
    { info: '下2回合造成的攻击伤害额外提升50%' },
    { info: '“辛”死亡后令自身下1次受到的攻击伤害减少50%' }] }),
  fuling: skill({ id: 26541, name: '缚灵之翼', category: { id: 4 }, effects: [
    { id: 749, args: [100, 1], info: '100%令对手全属性-1' },
    { id: 1215, args: [1], info: '消除对手所有护盾效果，消除成功则使对手全属性-1，自身体力低于对手时弱化效果翻倍' }] }),
};
const ALL = [S.shenqi, S.moduan, S.duanshi, S.shengsi, S.vk, S.tzc, S.fuling, ATK];

function battle(opts) {
  opts = opts || {};
  const meTeam = opts.meTeam || [{ pet: pet(3788, '混元天尊'), combo, skills: opts.skills || ALL,
    passives: B.parseSoulmark(SOUL) }];
  const foeTeam = opts.foeTeam || [{ pet: pet(2, '木桩'), combo, skills: [skill({ id: 21, name: '撞击', power: 35, category: { id: 1 } })] }];
  const b = new B.Battle({ chart, comboOf: () => combo, rng: opts.rng || (() => 0.99), level: 100,
    meTeam, foeTeam });
  return b;
}
function idx(skillId) {
  for (let i = 0; i < ALL.length; i++) if (ALL[i].id === skillId) return i;
  return -1;
}

console.log('— 3788 混元天尊：魂印解析 / 辛契约 —');
{
  const sm = B.parseSoulmark(SOUL);
  ok(sm.length === 1 && sm[0].kind === 'hunyuan', '魂印整段识别为 hunyuan');
  const b = battle();
  const me = b.me.team[0];
  ok(me.hySoul, 'hySoul 生效');
  ok(me.xinSummoned && me.xinAlive, '登场召唤辛');
  eq(me.xinMax, me.maxHp, '辛初始体力 = 自身最大体力');
  eq(me.xinHp, me.maxHp, '辛满体力');
}

console.log('— 首发：禁止换人 + 50% 驱逐 —');
{
  const b = battle({ foeTeam: [
    { pet: pet(2, '木桩'), combo, skills: [skill({ id: 21, power: 35, category: { id: 1 } })] },
    { pet: pet(3, '木桩二'), combo, skills: [skill({ id: 22, power: 35, category: { id: 1 } })] }
  ], rng: () => 0 });
  b.startOfTurn();
  eq(b.foe.active, 1, '50% 驱逐：换上后备精灵');
  eq(b.activeOf('foe').blockSwitch, 1, '被驱逐后本回合仍无法主动换人');
}

console.log('— 辛抵挡 60%（攻击 / 固定 / 百分比） —');
{
  const b = battle();
  const me = b.me.team[0];
  b.applyDamage('me', 100, { attack: true });
  eq(me.hp, me.maxHp - 40, '攻击伤害：自身承受 40%');
  eq(me.xinHp, me.xinMax - 60, '攻击伤害：辛承受 60%');
  me.hp = me.maxHp; me.xinHp = me.xinMax;
  b.directDamage(me, 100, 'fixed');
  eq(me.hp, me.maxHp - 40, '固定伤害同样 60/40 分摊');
  eq(me.xinHp, me.xinMax - 60, '固定伤害：辛 -60');
}

console.log('— 辛消散：驱逐 + 免疫固定/百分比/能力下降 —');
{
  const b = battle({ foeTeam: [
    { pet: pet(2, '木桩'), combo, skills: [skill({ id: 21, power: 35, category: { id: 1 } })] },
    { pet: pet(3, '木桩二'), combo, skills: [skill({ id: 22, power: 35, category: { id: 1 } })] }
  ], rng: () => 0 });
  const me = b.me.team[0];
  me.xinHp = 5;
  b.applyDamage('me', 100, { attack: true });
  ok(!me.xinAlive && me.xinDead, '辛消散');
  eq(b.foe.active, 1, '辛消散：100% 驱逐对手');
  ok(me.xinImmuneFixedPct, '免疫固定/百分比伤害');
  ok(me.permImmuneStat, '免疫能力下降');
  eq(b.directDamage(me, 500, 'percent'), 0, '百分比伤害被免疫');
  eq(b.directDamage(me, 500, 'fixed'), 0, '固定伤害被免疫');
}

console.log('— 辛损失体力 → 增伤 / 异常清 PP / 能力下降附伤 —');
{
  const hit = (ratio) => {
    const b = battle({ rng: () => 0.99 });
    const me = b.me.team[0], foe = b.foe.team[0];
    me.xinHp = Math.floor(me.xinMax * ratio);
    const hp0 = foe.hp;
    b.useSkill('me', idx(900), { isFirst: true });
    return hp0 - foe.hp;
  };
  ok(hit(0.5) > hit(1.0), '辛损失 50% → 攻击伤害 +20%（' + hit(1.0) + ' → ' + hit(0.5) + '）');
  const b = battle();
  const me = b.me.team[0], foe = b.foe.team[0];
  me.status = { id: 'poison', turns: 2 };
  b.startOfTurn();
  ok(foe.skills.some(s => s.pp === 0), '自身异常 → 对手随机技能 PP 归零');
  const b2 = battle();
  const me2 = b2.me.team[0], foe2 = b2.foe.team[0];
  me2.stages.atk = -1;
  b2.startOfTurn();
  ok(me2.xinEndPct, '自身能力下降 → 标记回合末百分比伤害');
  const foeHp0 = foe2.hp;
  b2.endOfTurn();
  eq(foeHp0 - foe2.hp, Math.floor(foe2.maxHp / 4), '回合末 1/4 百分比伤害');
}

console.log('— 己方阵亡闪避（英雄圣殿翻倍） —');
{
  const b = battle({ meTeam: [
    { pet: pet(3788, '混元天尊'), combo, skills: ALL, passives: B.parseSoulmark(SOUL) },
    { pet: pet(4, '队友'), combo, skills: [ATK] }
  ] });
  b.me.team[1].hp = 0;
  b.startOfTurn();
  eq(b.me.team[0].xinDodgePct, 6, '阵亡 1 只 → 6% 闪避');
  const b2 = battle({ meTeam: [
    { pet: pet(3788, '混元天尊'), combo, skills: ALL, passives: B.parseSoulmark(SOUL) },
    { pet: pet(4, '队友'), combo, skills: [ATK] }
  ], foeTeam: [{ pet: pet(3291, '瀚宇星皇'), combo, skills: [ATK] }] });
  b2.me.team[1].hp = 0;
  b2.startOfTurn();
  eq(b2.me.team[0].xinDodgePct, 12, '对手为英雄圣殿 → 12% 闪避');
}

console.log('— 辛之印记：死亡后己方 3 回合 —');
{
  const b = battle({ meTeam: [
    { pet: pet(3788, '混元天尊'), combo, skills: ALL, passives: B.parseSoulmark(SOUL) },
    { pet: pet(4, '队友'), combo, skills: [ATK] }
  ] });
  b.me.team[0].hp = 0;
  b.checkFaints();
  eq(b.xinMark.me.turns, 3, '己方获得 3 回合辛之印记');
  const ally = b.me.team[1];
  b.applyXinMark(ally, 'me');
  ok(ally.xinMarkActive, '印记对己方精灵生效');
  eq(ally.immuneStatus, 1, '印记：免疫异常');
  eq(ally.immuneStat, 1, '印记：免疫能力下降');
  ally.xinMarkActive = false;
  const d = B.calcDamage({ actor: ally, target: b.foe.team[0], skill: ATK, skillCombo: combo, actorCombo: combo,
    targetCombo: combo, chart, level: 100, rng: () => 0.99 });
  ok(d.crit === false, '无印记时 99% 不暴击');
  ally.xinMarkActive = true;
  const d2 = B.calcDamage({ actor: ally, target: b.foe.team[0], skill: ATK, skillCombo: combo, actorCombo: combo,
    targetCombo: combo, chart, level: 100, rng: () => 0.99 });
  ok(d2.crit === true, '印记：暴击率 +100%');
}

console.log('— 神泣 —');
{
  const b = battle();
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.guards.push({ turns: 3, mul: 0.5, scope: 'all' });
  foe.stages.atk = 1;
  b.useSkill('me', idx(32907), { isFirst: true });
  eq(foe.vulnTaken && foe.vulnTaken.mul, 2, '断回合成功 → 下 2 回合受伤翻倍');
  eq(foe.status && foe.status.id, 'tired', '清除强化成功 → 疲惫');
  me.xinDead = true;
  ok(b.actionPriority(me, { type: 'skill', index: idx(32907) }) === 4, '辛消散后神泣先制 +1（3→4）');
}

console.log('— 末世丧钟 —');
{
  const b = battle({ rng: () => 0 });
  const foe = b.foe.team[0];
  b.useSkill('me', idx(32910), { isFirst: true });
  eq(foe.hp, 0, '5% 秒杀触发（rng=0）');
}

console.log('— 天尊堕世斩 —');
{
  const b = battle({ rng: () => 0.99 });
  const me = b.me.team[0], foe = b.foe.team[0];
  me.hp = 100; me.stages.atk = 0;
  foe.maxHp = 50000; foe.hp = 50000;
  foe.stats.def = 200;
  me.stages.spDef = -1;
  b.useSkill('me', idx(32911), { isFirst: true });
  ok(me.stages.spDef > 0, '辛存活：反转自身能力下降');
  eq(foe.skillBlock, 2, '反转成功：对手 2 回合属性技能失效');
  ok(me.hp > 100, '伤害高于 300 → 吸取对手最大体力 1/3 回血');
  const ctrl = skill({ id: 99999, name: '对照', power: 150, category: { id: 1 }, must_hit: true });
  const bc = battle({ rng: () => 0.99, skills: ALL.concat([ctrl]) });
  const mec = bc.me.team[0], foec = bc.foe.team[0];
  mec.hp = 100; mec.stages.atk = 0; mec.stages.spDef = -1;
  foec.maxHp = 50000; foec.hp = 50000; foec.stats.def = 200;
  bc.useSkill('me', ALL.length, { isFirst: true });
  eq(foe.hp, foec.hp - Math.floor(50000 / 3), '吸取同时扣除对手最大体力 1/3');
  const b2 = battle({ rng: () => 0.99 });
  const me2 = b2.me.team[0], foe2 = b2.foe.team[0];
  foe2.stages.def = 6;
  b2.useSkill('me', idx(32911), { isFirst: true });
  ok(foe2.status && foe2.status.id === 'tired', '伤害低于 300 → 令对手疲惫');
  const b3 = battle({ rng: () => 0.99 });
  const me3 = b3.me.team[0];
  me3.xinDead = true;
  b3.foe.team[0].immuneStatus = 3;
  b3.useSkill('me', idx(32911), { isFirst: true });
  eq(me3.hyNextAtkMul, 2, '未令对手疲惫 → 下 1 次攻击 +100%');
}

console.log('— 技能面板结算说明 —');
{
  [S.shenqi, S.moduan, S.duanshi, S.shengsi, S.vk, S.tzc, S.fuling].forEach(function (s) {
    ok(B.skillImplNotes(s).length > 0, s.name + ' 有完整「已接入结算」说明');
  });
  ok(B.skillImplNotes(S.duanshi)[0].indexOf('对手失去') >= 0, '天尊堕世斩说明写明吸取会扣对手体力');
}

console.log('— 混沌·生死判 —');
{
  const b = battle({ rng: () => 0 });
  const me = b.me.team[0], foe = b.foe.team[0];
  me.hp = 50; foe.hp = 1;
  b.useSkill('me', idx(32912), { isFirst: true });
  eq(me.hp, me.maxHp, '击败对手且 50% 触发 → 回满体力');
  const b2 = battle({ rng: () => 0.99 });
  const me2 = b2.me.team[0], foe2 = b2.foe.team[0];
  me2.hp = 100;
  b2.useSkill('me', idx(32912), { isFirst: true });
  ok(me2.hp > 100, '辛存活：攻击伤害 50% 回血');
  ok(foe2.priorityBuff === null || !foe2.priorityBuff, '对手无先制');
  ok(me2.priorityBuff && me2.priorityBuff.value === 2, '未击败对手 → 下 2 回合先制 +2');
  const b3 = battle({ rng: () => 0.99 });
  const me3 = b3.me.team[0], foe3 = b3.foe.team[0];
  const hp0 = foe3.hp;
  b3.useSkill('me', idx(32912), { isFirst: true });
  const aliveDmg = hp0 - foe3.hp;
  const b4 = battle({ rng: () => 0.99 });
  const me4 = b4.me.team[0], foe4 = b4.foe.team[0];
  me4.xinAlive = false; me4.xinDead = true;
  const hp1 = foe4.hp;
  b4.useSkill('me', idx(32912), { isFirst: true });
  ok((hp1 - foe4.hp) > aliveDmg, '辛消散后：攻击伤害 +50%（' + aliveDmg + ' → ' + (hp1 - foe4.hp) + '）');
}

console.log('— 虚空桎梏 —');
{
  const parsed = B.parseSkillEffects(S.vk);
  ok(parsed.some(e => e.kind === 'drainOnFoeAtk'), '吸取解析为「对手使用攻击技能」窗口');
  ok(!parsed.some(e => e.kind === 'drainMax'), '不再解析为无条件吸取');
  ok(parsed.some(e => e.kind === 'statusGuardTimes' && e.times === 2), '免疫下 2 次异常解析为次数类 statusGuardTimes');
  const b = battle({ rng: () => 0 });
  const me = b.me.team[0];
  b.useSkill('me', idx(26542), { isFirst: true });
  eq(me.statusGuard, 2, '免疫下 2 次异常');
  b.useSkill('me', idx(26542), { isFirst: true });
  eq(me.statusGuard, 2, '同一技能重复使用不叠加（仍为 2）');
  eq(me.vkDrain, 3, '3 回合攻击前吸取');
  eq(me.vkGuard, 3, '3 回合属性技封锁');
  ok(me.starRoundLock >= 2, '辛存活 50% → 回合类效果不可消除');
  b.applyStatus(me, 'burn', 1, '我方');
  eq(me.statusGuard, 1, '消耗 1 次免疫');
  b.useSkill('me', idx(26542), { isFirst: true });
  eq(me.statusGuard, 2, '再次使用刷新回 2 次（不累加）');
  b.applyStatus(me, 'poison', 1, '我方');
  ok(!me.status, '剩余 1 次仍免疫异常');
  b.applyStatus(me, 'burn', 1, '我方');
  ok(!me.status && me.statusGuard === 0, '最后 1 次免疫被消耗，本次仍免疫');
  b.applyStatus(me, 'burn', 1, '我方');
  ok(me.status && me.status.id === 'burn', '次数用尽后下一次异常生效');

  const b2 = battle({ rng: () => 0.99, foeTeam: [{ pet: pet(2, '木桩'), combo, skills: [
    skill({ id: 23, category: { id: 4 } }),
    skill({ id: 21, power: 35, category: { id: 1 } })
  ] }] });
  const me2 = b2.me.team[0], foe2 = b2.foe.team[0];
  me2.hp = 500;
  b2.useSkill('me', idx(26542), { isFirst: true });
  eq(me2.hp, 500, '施放虚空桎梏本身不吸血');
  b2.useSkill('foe', 0, { isFirst: true });
  eq(me2.hp, 500, '对手使用属性技能不触发吸取');
  b2.useSkill('foe', 1, { isFirst: true });
  ok(me2.hp > 500, '仅对手使用攻击技能才吸取其最大体力 1/3');
  eq(foe2.skillBlock, 2, '对手攻击后属性技能失效 2 回合');

  const b3 = battle({ rng: () => 0.99, foeTeam: [{ pet: pet(2, '木桩'), combo, skills: [
    skill({ id: 21, power: 35, category: { id: 1 } }),
    skill({ id: 22, category: { id: 4 } })
  ] }] });
  const foe3 = b3.foe.team[0];
  b3.useSkill('me', idx(26542), { isFirst: true });
  const foePp = foe3.skills[0].pp;
  b3.useSkill('foe', 1, { isFirst: true });
  eq(foe3.skills[0].pp, Math.max(0, foePp - 2), '对手属性技 → 其所有 PP -2');
}

console.log('— 天造草昧 —');
{
  const b = battle({ rng: () => 0.99 });
  const me = b.me.team[0];
  me.hp = Math.floor(me.maxHp / 2) - 1;
  b.useSkill('me', idx(26543), { isFirst: true });
  eq(me.stages.atk, 2, '体力低于 1/2：全属性 +1 翻倍');
  eq(me.stages.spd, 2, '速度同样 +2');
  eq(me.teDrain && me.teDrain.den, 3, '4 回合吸取 1/3');
  eq(me.teDrain.lowHalf, 2, '低于 1/2 时吸取翻倍');
  ok(me.priorityBuff && me.priorityBuff.value === 2, '下 2 回合先制 +2');
  ok(me.damageBuff && me.damageBuff.mul === 1.5, '下 2 回合伤害 +50%');
  const b2 = battle({ rng: () => 0.99 });
  const me2 = b2.me.team[0];
  me2.xinDead = true;
  b2.useSkill('me', idx(26543), { isFirst: true });
  ok(me2.nextGuard && me2.nextGuard.pct === 50, '辛消散 → 下 1 次受攻击伤害 -50%');
}

console.log('— 缚灵之翼 —');
{
  const b = battle({ rng: () => 0.99 });
  const me = b.me.team[0], foe = b.foe.team[0];
  me.hp = 100;
  foe.shield = 100;
  b.useSkill('me', idx(26541), { isFirst: true });
  eq(foe.shield, 0, '消除护盾');
  eq(foe.stages.atk, -3, '消除成功且自身体力低于对手 → 追加弱化并翻倍（-1-2）');
}

if (fails) { console.error('FAILED ' + fails); process.exit(1); }
console.log('ALL PASS');
