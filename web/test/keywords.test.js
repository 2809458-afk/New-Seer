global.self = global;
const B = require('../js/battle.js');
let fails = 0;
function ok(cond, msg) { if (cond) console.log('  ok  ' + msg); else { fails++; console.error('  FAIL ' + msg); } }
const combo = { id: 1, name: '草', primary: { id: 1 }, secondary: null };
const chart = { 1: { 1: 1 } };
function pet(id, name) { return { id, name, base_stats: { hp: 1000, atk: 140, def: 100, sp_atk: 100, sp_def: 100, spd: 100 } }; }
function skill(over) {
  return Object.assign({ id: 1, name: '测试技能', power: 0, max_pp: 10, accuracy: 100, crit_rate: 0,
    priority: 0, must_hit: true, category: { id: 4 }, type: { id: 1 }, info: '', effects: [] }, over || {});
}
function battle() {
  return new B.Battle({ chart, comboOf: () => combo, rng: () => 0, level: 100,
    meTeam: [{ pet: pet(6, '我方'), combo, skills: [skill()], passives: [] }],
    foeTeam: [{ pet: pet(7, '对方'), combo, skills: [skill({ id: 2, power: 10, category: { id: 1 } })], passives: [] }] });
}

console.log('— 名词解释 —');
ok(!!B.KEYWORD_DEFS && !!B.KEYWORD_DEFS['蚩庸之锁'], '蚩庸之锁 有名词解释');
ok(/上限 3 道/.test(B.KEYWORD_DEFS['蚩庸之锁']), '解释里写明上限 3 道');
ok(/PP 归零/.test(B.KEYWORD_DEFS['蚩庸之锁']), '解释里写明清零攻击技能 PP');
const hits = B.keywordHits('为对手附加2道蚩庸之锁，并获得1回合星赐');
ok(hits.length === 2 && hits[0].term === '蚩庸之锁' && hits[1].term === '星赐', '文本里能检出多个名词');
ok(B.keywordHits('普通的描述文字').length === 0, '无名词时不误报');
ok(!!B.KEYWORD_DEFS['神圣印记'] && !!B.KEYWORD_DEFS['星盘'] && !!B.KEYWORD_DEFS['星皇之怒'], '其它专有名词也有解释');

console.log('— 血条下方 buff 显示 —');
{
  const b = battle();
  const foe = b.foe.team[0];
  foe.lockStacks = 3;
  const snap = b.snapshot();
  const foeFx = snap.foe.team[snap.foe.active].effects || [];
  const chip = foeFx.filter(x => /蚩庸之锁/.test(x.text))[0];
  ok(!!chip, '对手 3 道锁 → 血条下方显示「蚩庸之锁×3」（' + JSON.stringify(foeFx.map(x => x.text)) + '）');
  ok(chip && chip.text === '蚩庸之锁×3', '层数正确显示');
  ok(chip && !!chip.tip && /上限 3 道/.test(chip.tip), '标签带名词解释 tip');
}
{
  const b = battle();
  const me = b.me.team[0];
  me.starGift = 2;
  me.starDialCfg = { maxTicks: 12 };
  me.starDial = 5;
  me.starRageChanceBonus = 20;
  me.starRageChanceTurns = 2;
  const snap = b.snapshot();
  const texts = (snap.me.team[snap.me.active].effects || []).map(x => x.text).join(' | ');
  ok(/星赐\(2\)/.test(texts), '星赐剩余回合显示（' + texts + '）');
  ok(/星盘 5\/12/.test(texts), '星盘刻度显示');
  ok(/星怒概率\+20%/.test(texts), '星皇之怒概率加成显示');
}
if (fails) { console.error('FAILED ' + fails); process.exit(1); }
console.log('ALL PASS');
