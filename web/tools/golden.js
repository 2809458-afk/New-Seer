/* 用 spec/battle-golden.json（旧 Web 引擎生成的对拍基线）校验新 Web 的数值口径
 *
 * 用法：node tools/golden.js [--cases=../../spec/battle-golden.json] [--data=./data]
 * 覆盖：20 个用例 —— 6 个能力值（computeStats）、14 个伤害（calcDamage 的 damage/effectiveness/crit/stab）
 */
'use strict';
global.self = global;
const fs = require('fs');
const path = require('path');

function arg(name, def) {
  const hit = process.argv.slice(2).find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : def;
}

const WEB = path.join(__dirname, '..');
const B = require(path.join(WEB, 'js', 'battle.js'));
const casesPath = path.resolve(arg('cases', path.join(WEB, '..', 'spec', 'battle-golden.json')));
const dataDir = path.resolve(arg('data', path.join(WEB, 'data')));
const read = (n) => JSON.parse(fs.readFileSync(path.join(dataDir, n + '.json'), 'utf8'));

const pets = new Map(read('pets').items.map((p) => [p.id, p]));
const skills = new Map(read('skills').items.map((s) => [s.id, s]));
const combos = new Map(read('combos').items.map((c) => [c.id, c]));
const { apiTypes } = require('./lib/data-shape.js');
const chart = B.buildChart(apiTypes(read('types').items));

function comboOf(id) {
  const c = combos.get(id);
  if (!c) return { id: id, name: String(id), primary: { id: id }, secondary: null };
  return { id: c.id, name: c.name, primary: { id: c.primary }, secondary: c.secondary == null ? null : { id: c.secondary } };
}

function combatSkill(s) {
  return {
    id: s.id, name: s.name, power: s.power || 0, max_pp: s.pp || 10,
    accuracy: s.accuracy == null ? 100 : s.accuracy, crit_rate: s.crit_rate || 0,
    priority: s.priority || 0, must_hit: !!s.must_hit,
    category: { id: s.category }, type: { id: s.type },
    info: s.info || '', effects: s.effects || []
  };
}

function petOf(id) {
  const p = pets.get(id);
  if (!p) throw new Error('数据里没有精灵 ' + id);
  // data/pets.json 用 stats 存种族值；computeStats 期望 base_stats
  return Object.assign({}, p, { base_stats: p.base_stats || p.stats });
}
function combosOf(pet) {
  return comboOf(pet.type != null ? pet.type : pet.id);
}

const golden = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
let pass = 0, fail = 0;
const failures = [];

function eq(id, field, want, got) {
  if (want === got || (typeof want === 'number' && typeof got === 'number' && Math.abs(want - got) < 1e-9)) { pass++; return; }
  fail++;
  failures.push(id + ' ' + field + '：期望 ' + want + '，实际 ' + got);
}

const natures = read('natures').items;
function natureOf(v) {
  if (v == null) return null;
  if (typeof v === 'number') return natures[v] || natures.find((n) => n.id === v) || null;
  return natures.find((n) => n.id === v) || null;
}
function statsOf(pet, build) {
  return B.computeStats(petOf(pet), Object.assign({}, build, { nature: natureOf(build.nature) }));
}

const STAT_KEYS = [['hp', 'hp'], ['atk', 'atk'], ['def', 'def'], ['spAtk', 'sp_atk'], ['spDef', 'sp_def'], ['spd', 'spd']];

golden.cases.forEach(function (c) {
  if (c.kind === 'stats') {
    const got = statsOf(c.pet, c.build);
    STAT_KEYS.forEach(function (pair) { if (c.expect[pair[0]] != null) eq(c.id, pair[0], c.expect[pair[0]], got[pair[0]]); });
    return;
  }
  if (c.kind !== 'damage') return;

  const atkPet = petOf(c.attacker.pet);
  const defPet = petOf(c.defender.pet);
  const skill = combatSkill(skills.get(c.skill));
  const atkLevel = c.attacker.level || 100;
  const b = new B.Battle({
    chart: chart, comboOf: comboOf, rng: function () { return 0.5; }, level: atkLevel,
    meTeam: [{ pet: atkPet, combo: combosOf(atkPet), skills: [skill], level: atkLevel }],
    foeTeam: [{ pet: defPet, combo: combosOf(defPet), skills: [combatSkill(skills.get(c.skill))], level: c.defender.level || 100 }]
  });
  const actor = b.activeOf('me'), target = b.activeOf('foe');
  let idx = 0;
  const rng = function () { const v = (c.rng && c.rng[idx] != null) ? c.rng[idx] : 0.5; idx++; return v; };
  const r = B.calcDamage({
    actor: actor, target: target, skill: skill,
    skillCombo: comboOf(skill.type.id), actorCombo: actor.combo, targetCombo: target.combo,
    chart: chart, level: atkLevel, rng: rng
  });
  if (c.expect.attackerStats) STAT_KEYS.forEach(function (p) { if (c.expect.attackerStats[p[0]] != null) eq(c.id, 'atk.' + p[0], c.expect.attackerStats[p[0]], actor.stats[p[0]]); });
  if (c.expect.defenderStats) STAT_KEYS.forEach(function (p) { if (c.expect.defenderStats[p[0]] != null) eq(c.id, 'def.' + p[0], c.expect.defenderStats[p[0]], target.stats[p[0]]); });
  if (c.expect.damage != null) eq(c.id, 'damage', c.expect.damage, r.damage);
  if (c.expect.effectiveness != null) eq(c.id, 'effectiveness', c.expect.effectiveness, r.effectiveness);
  if (c.expect.crit != null) eq(c.id, 'crit', c.expect.crit, r.crit);
  if (c.expect.stab != null) eq(c.id, 'stab', c.expect.stab, r.stab);
});

console.log('对拍 ' + (pass + fail) + ' 项：通过 ' + pass + '，失败 ' + fail);
if (fail) {
  failures.slice(0, 15).forEach((f) => console.log('  ' + f));
  process.exit(1);
}
console.log('全部通过');
