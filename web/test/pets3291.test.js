/* 3291 瀚宇星皇 / 4676 神觉·米斯蒂克：node test/pets3291.test.js */
global.self = global;
const B = require('../js/battle.js');

let fails = 0;
function ok(cond, msg) {
  if (cond) console.log('  ok  ' + msg);
  else { fails++; console.error('  FAIL ' + msg); }
}
function eq(a, b, msg) {
  ok(a === b, msg + ' (期望 ' + b + '，实际 ' + a + ')');
}
const combo = { id: 1, name: '草', primary: { id: 1 }, secondary: null };
const chart = { 1: { 1: 1 } };

function pet(id, name) {
  return { id, name, base_stats: { hp: 1000, atk: 140, def: 100, sp_atk: 100, sp_def: 100, spd: 100 } };
}
function skill(over) {
  return Object.assign({
    id: 1, name: '测试技能', power: 0, max_pp: 10, accuracy: 100, crit_rate: 0,
    priority: 0, must_hit: true, category: { id: 4 }, type: { id: 1 }, info: '', effects: []
  }, over || {});
}
function battle(meSkill, foeSkill) {
  return new B.Battle({
    chart, comboOf: () => combo, rng: () => 0, level: 100,
    meTeam: [{ pet: pet(3291, '瀚宇星皇'), combo, skills: [meSkill] }],
    foeTeam: [{ pet: pet(2, '木桩'), combo, skills: [foeSkill] }]
  });
}

console.log('— 3291 瀚宇星皇 —');
{
  const sm = B.parseSoulmark(
    '自身免疫受到的固定伤害、百分比伤害、能力下降状态且固定伤害和百分比伤害抗性始终视为100%|' +
    '自身技能无效时，若本次技能结束后对手体力值高于0，则50%进行一次额外行动以触发星皇之怒|' +
    '自身位于出战背包时，己方精灵拥有星皇之赐，己方精灵首发精灵拥有星皇之佑'
  );
  ok(sm.some(x => x.kind === 'starImmunity'), '魂印①：免疫固定/百分比/能力下降');
  ok(sm.some(x => x.kind === 'starRageOnNull'), '魂印②：技能无效后的额外行动');
  ok(sm.some(x => x.kind === 'starAura'), '魂印③：星皇之赐/星皇之佑');
}
{
  const b = battle(
    skill({ id: 30376, name: '圣世惩杀', power: 85, category: { id: 1 }, effects: [{ info: '消除对手回合类效果，消除成功则令对手随机2项技能PP值归零；技能结束后对手体力值高于0，则50%进行一次额外行动以触发星皇之怒（星皇之怒：若对手不处于能力提升状态则附加对手最大体力1/3的百分比伤害）' }] }),
    skill({ id: 2, name: '撞击', power: 10, category: { id: 1 } })
  );
  const me = b.me.team[0];
  const foe = b.foe.team[0];
  ok(me.starBless === true, '星皇之赐：己方精灵获得');
  ok(me.starGuard === 3, '星皇之佑：首发 3 回合');
  ok(me.fixedResist === 100 && me.percentResist === 100, '3291 固定/百分比抗性视为 100%');
  eq(b.resistDamage(me, 100, 'fixed'), 0, '100% 固伤抗性 → 0');
  eq(b.resistDamage(me, 100, 'percent'), 0, '100% 百分比抗性 → 0');
  const hp0 = foe.hp;
  b.step({ type: 'skill', index: 0 });
  ok(foe.hp < hp0, '圣世惩杀造成伤害');
  ok(b.log.some(x => /星皇之怒/.test(x)), '星皇之怒触发');
  ok(b.log.some(x => /百分比伤害/.test(x)), '星怒附加 1/3 百分比伤害');
}
{
  const b = battle(
    skill({ id: 25295, name: '命宇轮回', power: 0, effects: [{ id: 1096, info: '全属性+1，自身当前体力低于最大体力的1/2时强化效果翻倍；4回合内每回合使用技能吸取对手最大体力的1/3；自身下2次使用技能触发星皇之怒的概率翻倍' }] }),
    skill({ id: 2, name: '撞击', power: 10, category: { id: 1 } })
  );
  const me = b.me.team[0];
  me.hp = Math.floor(me.maxHp * 0.4);
  b.step({ type: 'skill', index: 0 });
  ok(me.stages.atk >= 2, '命宇轮回低血强化翻倍');
  ok(me.teDrain && me.teDrain.turns >= 3, '命宇轮回吸取窗口 4 回合（回合末已递减）');
  ok(me.starRageDouble >= 1, '下 2 次星怒概率翻倍（本次已消耗 1 次）');
}

console.log('\n— 抗性 / 学习力 —');
{
  const b = battle(skill({ id: 3, name: '撞击', power: 10, category: { id: 1 } }), skill({ id: 4, name: '撞击', power: 10, category: { id: 1 } }));
  const me = b.me.team[0];
  me.immuneFixedPct = false;
  me.fixedResist = 50;
  me.percentResist = 25;
  eq(b.resistDamage(me, 100, 'fixed'), 50, '50% 固伤抗性');
  eq(b.resistDamage(me, 100, 'percent'), 75, '25% 百分比抗性');
  b.foe.team[0].statusResist = 50;
  b.applyStatus(b.foe.team[0], 'burn', 1, '测试');
  ok(!b.foe.team[0].status, '50% 异常抗性 + rng=0 → 免疫异常');

  const fx = B.parseSkillEffects({ effects: [{ info: '令对手陷入衰弱' }] });
  ok(fx.some(x => x.kind === 'status' && x.statusId === 'weak'), '衰弱状态可解析');
  const fx2 = B.parseSkillEffects({ effects: [{ info: '令对手焚烬' }] });
  ok(fx2.some(x => x.kind === 'status' && x.statusId === 'cinder'), '焚烬状态可解析');

  const pet0 = pet(9, '学习力测试');
  const base = B.computeStats(pet0, { level: 100, iv: 31, ev: {} });
  const ev = B.computeStats(pet0, { level: 100, iv: 31, ev: { atk: 252, hp: 252 } });
  ok(ev.atk - base.atk === 63, '252 攻击学习力 → 面板 +63');
  ok(ev.hp - base.hp === 63, '252 体力学习力 → 面板 +63');
}

console.log('\n— 4676 神觉·米斯蒂克 —');
{
  const b = new B.Battle({
    chart, comboOf: () => combo, rng: () => 0, level: 100,
    meTeam: [{
      pet: pet(4676, '神觉·米斯蒂克'), combo,
      skills: [skill({ id: 28809, name: '魂劫骇咒', effects: [{ info: '全属性+1，对手处于能力下降状态时强化效果翻倍；4回合内使用技能吸取对手最大体力的1/3；为对手附加1层蚩庸之锁，若附加的蚩庸之锁超出了上限则对手下2回合先制-1' }] })]
    }],
    foeTeam: [{ pet: pet(2, '木桩'), combo, skills: [skill({ id: 2, name: '撞击', power: 10, category: { id: 1 } })] }]
  });
  const me = b.me.team[0];
  const foe = b.foe.team[0];
  ok(foe.skillBlock >= 2, '秘①：对手 2 回合属性技能无效');
  ok(me.mistikeNoDebuff >= 2, '秘①：对手攻击无法附加异常/下降');
  b.step({ type: 'skill', index: 0 });
  ok(foe.lockStacks >= 1, '魂劫骇咒附加蚩庸之锁');
  ok(b.log.some(x => /秘：.*随机 2 项能力下降/.test(x)), '秘③：对手出手随机 2 项 -1');
  ok(b.log.some(x => /秘：对手使用攻击技能/.test(x)), '秘③：攻击分支给先制/必中');
}


console.log('\n— 失明（30380）/ 37510 自爆护盾 / 抗性 —');
{
  // 失明（官方口径）：50% 概率令攻击技能失效；必中技能也失效但显示 -0，普通技能显示 Miss
  function blindBattle(mustHit, rngVal) {
    const b2 = new B.Battle({
      chart, comboOf: () => combo, rng: () => rngVal, level: 100,
      meTeam: [{ pet: pet(3, '测试精灵'), combo, skills: [skill({ id: 6001, name: '攻击', power: 40, category: { id: 1 }, must_hit: !!mustHit })] }],
      foeTeam: [{ pet: pet(2, '木桩'), combo, skills: [skill({ power: 1 })] }]
    });
    const me2 = b2.me.team[0];
    b2.applyStatus(me2, 'blind', 3, '我方');
    return { b: b2, me: me2, foe: b2.foe.team[0] };
  }
  {
    const t = blindBattle(false, 0);              // rng 0 < 50 ⇒ 必落空
    const hp0 = t.foe.hp;
    t.b.step({ type: 'skill', index: 0 });
    eq(t.foe.hp, hp0, '失明：非必中攻击技能落空（不掉血）');
    ok(t.b.log.some(x => /Miss/.test(x)), '失明：非必中技能显示 Miss');
  }
  {
    const t = blindBattle(true, 0);               // 必中技能同样失效
    const hp0 = t.foe.hp;
    t.b.step({ type: 'skill', index: 0 });
    eq(t.foe.hp, hp0, '失明：必中技能也会失效');
    ok(t.b.log.some(x => /-0/.test(x)), '失明：必中技能失效显示 -0');
  }
  {
    const t = blindBattle(false, 0.9);            // rng 90 ≥ 50 ⇒ 正常命中
    const hp0 = t.foe.hp;
    t.b.step({ type: 'skill', index: 0 });
    ok(t.foe.hp < hp0, '失明：50% 之外的场合照常命中');
  }
  {
    // 失明是异常状态：吃异常抗性 / 免疫异常 / 回合数递减
    const t = blindBattle(false, 0);
    t.me.status = null;
    t.me.statusResist = 100;
    t.b.applyStatus(t.me, 'blind', 3, '我方');
    eq(t.me.status, null, '失明走异常抗性（100% 免疫）');
  }
  {
    const t = blindBattle(false, 0);
    t.me.status = null;
    t.me.immuneStatus = 3;
    t.b.applyStatus(t.me, 'blind', 3, '我方');
    eq(t.me.status, null, '免疫异常状态时失明挂不上');
  }
  {
    const t = blindBattle(false, 0);
    t.me.status = { id: 'blind', turns: 1 };
    t.b.step({ type: 'skill', index: 0 });
    eq(t.me.status, null, '失明按回合数过期');
    const hp0 = t.foe.hp;
    t.b.step({ type: 'skill', index: 0 });
    ok(t.foe.hp < hp0, '失明过期后恢复正常命中');
  }
}
{
  // 37510 堕之盛响：消耗自身全部体力 → 己方下只登场精灵获得 50% 护盾与护罩
  const b = new B.Battle({
    chart, comboOf: () => combo, rng: () => 0, level: 100,
    meTeam: [
      { pet: pet(4676, '神觉·米斯蒂克'), combo, skills: [skill({ id: 37510, name: '堕之盛响', power: 120, category: { id: 2 } })] },
      { pet: pet(4, '替补'), combo, skills: [skill({ power: 10, category: { id: 1 } })] }
    ],
    foeTeam: [{ pet: pet(2, '木桩'), combo, skills: [skill({ power: 5, category: { id: 1 } })] }]
  });
  const me = b.me.team[0];
  const hp0 = me.hp;
  b.step({ type: 'skill', index: 0 });
  eq(me.hp, 0, '堕之盛响：消耗自身全部体力');
  eq(b.nextAllyShield && b.nextAllyShield.value, Math.max(1, Math.floor(hp0 / 2)), '留下消耗值 50% 的护盾');
  const sub = b.me.team[1];
  b.playerSwitch(1);
  ok(sub.shield > 0, '下一只登场精灵获得护盾（' + sub.shield + '）');
  ok(sub.ward > 0, '下一只登场精灵同时获得护罩（' + sub.ward + '）');
}
{
  // 直接扣血统一走抗性
  const b = battle(skill({ power: 0, effects: [{ info: '额外附加100点固定伤害' }] }), skill({ power: 0 }));
  const foe = b.foe.team[0];
  foe.fixedResist = 50;
  const hp0 = foe.hp;
  b.step({ type: 'skill', index: 0 });
  eq(hp0 - foe.hp, 50, '固定伤害走 50% 固伤抗性');
}
{
  const b = battle(skill(), skill());
  const foe = b.foe.team[0];
  foe.percentResist = 50;
  eq(b.directDamage(foe, 100, 'percent'), 50, '百分比伤害走 50% 百分比抗性');
  foe.percentResist = 100;
  eq(b.directDamage(foe, 100, 'percent'), 0, '100% 百分比抗性 → 免疫');
  foe.fixedResist = 42;
  eq(b.directDamage(foe, 100, 'fixed'), 58, '固定伤害按抗性比例减免');
}
{
  // 护盾只挡攻击伤害；护罩只挡固定/百分比伤害
  const b = battle(skill(), skill());
  const foe = b.foe.team[0];
  foe.shield = 100;
  foe.ward = 100;
  const hp0 = foe.hp;
  b.applyDamage('foe', 60, { attack: true, physical: true });
  eq(foe.shield, 40, '护盾抵挡攻击伤害');
  eq(foe.ward, 100, '攻击伤害不动护罩');
  eq(foe.hp, hp0, '攻击被护盾全额吸收');
  eq(b.directDamage(foe, 30, 'fixed'), 0, '护罩抵挡固定伤害');
  eq(foe.ward, 70, '护罩按点数吸收');
  eq(foe.hp, hp0, '固定伤害没有落到体力上');
  eq(b.directDamage(foe, 50, 'percent'), 0, '护罩抵挡百分比伤害');
  eq(foe.ward, 20, '护罩继续吸收百分比伤害');
  b.directDamage(foe, 80, 'fixed');
  ok(foe.hp < hp0, '护罩打空后才扣体力');
}

console.log('— 圣世惩杀 / 瀚空之门 / 命宇轮回 / 亘古圣辰决 —');
{
  const b = battle(
    skill({ id: 30376, name: '圣世惩杀', power: 85, category: { id: 1 }, effects: [{ id: 1094, info: '消除对手回合类效果，消除成功则令对手随机2项技能PP值归零' }] }),
    skill({ id: 2, name: '撞击', power: 10, category: { id: 1 } })
  );
  const foe = b.foe.team[0];
  foe.teHeal = { turns: 2, pct: 1 / 3 };
  foe.stages.atk = 2;
  foe.skills.push({ skill: skill({ id: 22, category: { id: 4 } }), pp: 10, maxPp: 10 });
  foe.skills.push({ skill: skill({ id: 23, category: { id: 4 } }), pp: 10, maxPp: 10 });
  foe.skills.forEach(s => { s.pp = 10; });
  b.step({ type: 'skill', index: 0 });
  ok(b.me.team[0].starRageChanceBonus === 20, '圣世惩杀：断回合/消强成功后 2 回合星怒概率 +20%');
  eq(foe.skills.filter(s => s.pp === 0).length, 2, '圣世惩杀：随机 2 项技能 PP 归零');
}
{
  const b = battle(
    skill({ id: 25294, name: '瀚空之门', effects: [{ id: 1095, info: '3回合内若对手使用攻击技能则使用后受到对手最大体力1/3的百分比伤害' }] }),
    skill({ id: 3, name: '重击', power: 60, category: { id: 1 } })
  );
  const foe = b.foe.team[0];
  const hp0 = foe.hp;
  b.step({ type: 'skill', index: 0 });
  ok(b.log.some(x => /瀚空之门/.test(x)) && foe.hp < hp0, '瀚空之门：对手攻击后吃 1/3 百分比伤害');
}
{
  const b = battle(
    skill({ id: 25294, name: '瀚空之门', effects: [{ id: 1095, info: '3回合内若对手使用属性技能则命中前令对手所有技能随机降低1-3点PP值' }] }),
    skill({ id: 4, name: '强化', category: { id: 4 }, effects: [{ info: '攻击+1' }] })
  );
  b.step({ type: 'skill', index: 0 });
  ok(b.log.some(x => /PP 减少了/.test(x)), '瀚空之门：对手属性技 → 随机扣 1-3 PP');
}
{
  const b = battle(
    skill({ id: 25295, name: '命宇轮回', effects: [{ id: 1096, info: '4回合内每回合使用技能吸取对手最大体力的1/3' }] }),
    skill({ id: 2, name: '撞击', power: 60, category: { id: 1 } })
  );
  const me = b.me.team[0], foe = b.foe.team[0];
  me.hp = Math.floor(me.maxHp / 3);
  const foeHp0 = foe.hp;
  b.step({ type: 'skill', index: 0 });
  const lost = foeHp0 - foe.hp;
  ok(lost >= Math.floor(foe.maxHp / 3), '命宇轮回：低血时吸取翻倍（对手掉 ' + lost + '）');
}
{
  const b = battle(
    skill({ id: 30380, name: '亘古圣辰决', power: 5, category: { id: 1 }, effects: [{ id: 1097, info: '造成的攻击伤害若低于280则令对手疲惫；未击败对手则令对手下1回合使用的攻击技能无效' }] }),
    skill({ id: 2, name: '撞击', power: 10, category: { id: 1 } })
  );
  const foe = b.foe.team[0];
  b.step({ type: 'skill', index: 0 });
  ok(b.log.some(x => /疲惫/.test(x)), '亘古圣辰决：伤害不足 280 → 疲惫');
  ok(b.log.some(x => /攻击技能无效/.test(x)), '亘古圣辰决：未击败 → 对手下回合攻击技无效');
}

console.log('— 星皇之赐：背包效果（v20261024y）—');
{
  const b = new B.Battle({ chart, comboOf: () => combo, rng: () => 0, level: 100,
    meTeam: [
      { pet: pet(3311, '圣光灵神'), combo, skills: [skill({ id: 3, name: '攻击', power: 10, category: { id: 1 } })], passives: [] },
      { pet: pet(3291, '瀚宇星皇'), combo, skills: [skill({ id: 4, name: '备用' })], passives: [] }
    ],
    foeTeam: [{ pet: pet(2, '木桩'), combo, skills: [skill({ id: 2, name: '撞击', power: 10, category: { id: 1 } })], passives: [] }] });
  const active = b.me.team[0], bench = b.me.team[1];
  ok(active.starBless === true, '星皇在队伍中 → 首发获得星皇之赐');
  ok(bench.starBless === true, '场下的星皇同样获得星皇之赐');
  active.hp = active.maxHp - 600;
  const before = active.hp;
  b.useSkill('me', 0, { isFirst: true });
  const healed = active.hp - before;
  ok(healed === Math.floor(active.maxHp / 8), '非星皇精灵使用技能也回复 1/8（实际 ' + healed + '）');
  ok(b.log.some(x => /星皇之赐/.test(x)), '战斗日志出现星皇之赐');
  const snap = b.snapshot();
  const fx = snap.me.team[snap.me.active].effects.map(x => x.text).join(' | ');
  ok(/星皇之赐/.test(fx), '状态栏显示「星皇之赐」（' + fx + '）');
  ok(/星皇之佑/.test(fx), '状态栏显示「星皇之佑」层数');
  const chip = snap.me.team[snap.me.active].effects.filter(x => x.text === '星皇之赐')[0];
  ok(!!chip && /背包效果/.test(chip.tip || ''), 'chip 带名词解释');
}
{
  const b = new B.Battle({ chart, comboOf: () => combo, rng: () => 0, level: 100,
    meTeam: [{ pet: pet(3311, '圣光灵神'), combo, skills: [skill({ id: 3, name: '攻击', power: 10, category: { id: 1 } })], passives: [] }],
    foeTeam: [{ pet: pet(2, '木桩'), combo, skills: [skill({ id: 2, name: '撞击', power: 10, category: { id: 1 } })], passives: [] }] });
  const me = b.me.team[0];
  ok(!me.starBless, '无星皇队伍 → 没有标记');
  me.hp = me.maxHp - 100;
  b.useSkill('me', 0, { isFirst: true });
  ok(me.hp === me.maxHp - 100, '无星皇队伍 → 不触发星皇之赐');
}

console.log(fails ? `\n${fails} 项失败` : '\n全部通过');
process.exit(fails ? 1 : 0);
