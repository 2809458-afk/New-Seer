/* 确定性战斗轨迹：同一脚本分别跑「旧 Web」与「新 Web」引擎，产出可比对的 JSON。
 *
 * 用法：
 *   node tools/battle-trace.js --engine=../js/battle.js --data=./data --seeds=12 --out=spec/trace-old.json
 *   node tools/battle-trace.js --engine=../../js/battle.js --data=./data --seeds=12 --out=spec/trace-old.json
 *
 * 设计约束：唯一随机源是种子化 RNG；双方队伍、技能 PP、AI 决策都由该 RNG 驱动，
 * 因此同一种子在同一引擎上必须完全可复现，跨引擎差异即可作为行为差异证据。
 */
'use strict';
global.self = global;
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function arg(name, def) {
  const hit = process.argv.slice(2).find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : def;
}

const enginePath = path.resolve(arg('engine', path.join(__dirname, '..', 'js', 'battle.js')));
const dataDir = path.resolve(arg('data', path.join(__dirname, '..', 'data')));
const outPath = path.resolve(arg('out', path.join(__dirname, '..', 'spec', 'trace-new.json')));
const seedCount = Number(arg('seeds', '12'));
const maxTurns = Number(arg('turns', '40'));
const teamSize = Number(arg('team', '6'));

const B = require(enginePath);
const read = (n) => JSON.parse(fs.readFileSync(path.join(dataDir, n + '.json'), 'utf8'));
const petsDoc = read('pets');
const skillsDoc = read('skills');
const combosDoc = read('combos');
const marksDoc = read('soulmarks');
const typesDoc = read('types');

const combos = new Map(combosDoc.items.map((c) => [c.id, c]));
const skills = new Map(skillsDoc.items.map((s) => [s.id, s]));
const marks = new Map(marksDoc.items.map((m) => [m.id, m]));
const { apiTypes } = require('./lib/data-shape.js');
const chart = B.buildChart(apiTypes(typesDoc.items));

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

function entry(pet) {
  const ids = [...new Set([...(pet.skills || []).map((s) => s.id), ...(pet.fifth || [])])];
  const chosen = ids.map((i) => skills.get(i)).filter(Boolean).sort((a, b) => a.id - b.id).slice(0, 5).map(combatSkill);
  if (!chosen.length) {
    chosen.push({
      id: -1, name: '撞击', power: 35, max_pp: 35, accuracy: 100, crit_rate: 0, priority: 0,
      must_hit: false, category: { id: 1 }, type: { id: pet.type }, info: '', effects: []
    });
  }
  const soulmarks = (pet.soulmarks || []).map((i) => marks.get(i)).filter(Boolean);
  const passives = [];
  soulmarks.forEach((m) => { passives.push(...B.parseSoulmark(m.desc || '')); });
  return {
    pet: { id: pet.id, name: pet.name, base_stats: Object.assign({}, pet.stats) },
    combo: comboOf(pet.type), skills: chosen, soulmarks: soulmarks, passives: passives
  };
}

/* 候选池：有面板、技能足够、有魂印的精灵，按 id 排序保证确定性 */
const pool = petsDoc.items
  .filter((p) => p.stats && p.skills && p.skills.length >= 4 && (p.soulmarks || []).length)
  .filter((p) => p.skills.some((s) => skills.has(s.id)))
  .sort((a, b) => a.id - b.id);

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickTeam(rng, used, size) {
  const picked = [];
  let guard = 0;
  while (picked.length < size && guard < 100000) {
    guard++;
    const p = pool[Math.floor(rng() * pool.length)];
    if (!p || used.has(p.id)) continue;
    used.add(p.id);
    picked.push(entry(p));
  }
  return picked;
}

function aliveBench(b) {
  const me = b.activeOf('me');
  return (b.me.team || []).map((c, i) => ({ c, i })).filter((x) => x.c !== me && x.c.hp > 0);
}

function shimState(c) {
  return {
    hp: c.hp, max_hp: c.maxHp, shield: c.shield || 0, ward: c.ward || 0,
    stages: Object.assign({}, c.stages), pp: c.skills.map((s) => s.pp),
    status: (c.status && c.status.id) || ''
  };
}

function runBattle(seed) {
  const rng = mulberry32(seed);
  const used = new Set();
  const meTeam = pickTeam(rng, used, teamSize);
  const foeTeam = pickTeam(rng, used, teamSize);
  const b = new B.Battle({ chart: chart, comboOf: comboOf, level: 100, rng: rng, meTeam: meTeam, foeTeam: foeTeam });
  const log = [];
  const turns = [];
  for (let t = 0; t < maxTurns && !b.over; t++) {
    if (b.needPlayerSwitch) {
      const bench = aliveBench(b);
      if (!bench.length) break;
      b.step({ type: 'switch', index: bench[0].i });
      turns.push({ t: t, action: { type: 'switch', index: bench[0].i }, forced: true });
      continue;
    }
    const me = b.activeOf('me');
    let action;
    const bench = aliveBench(b);
    if (bench.length && rng() < 0.08) {
      action = { type: 'switch', index: bench[Math.floor(rng() * bench.length)].i };
    } else {
      const usable = me.skills.map((s, i) => ({ i, pp: s.pp })).filter((x) => x.pp > 0);
      action = usable.length ? { type: 'skill', index: usable[Math.floor(rng() * usable.length)].i } : { type: 'pass' };
    }
    const before = b.log.length;
    b.step(action);
    const added = b.log.slice(before);
    log.push(...added);
    turns.push({ t: t, action: action, log: added.length });
  }
  const winner = b.winner || null;
  return {
    seed: seed, meIds: meTeam.map((e) => e.pet.id), foeIds: foeTeam.map((e) => e.pet.id),
    winner: winner, turns: turns.length, log: log,
    final: {
      me: b.me.team.map(shimState), foe: b.foe.team.map(shimState),
      over: !!b.over
    }
  };
}

const battles = [];
for (let i = 1; i <= seedCount; i++) battles.push(runBattle(i * 7919));

const doc = {
  schema: 1, kind: 'web-battle-trace',
  engine: path.relative(path.join(__dirname, '..', '..'), enginePath),
  engineSHA256: crypto.createHash('sha256').update(fs.readFileSync(enginePath)).digest('hex'),
  data: path.relative(path.join(__dirname, '..', '..'), dataDir),
  dataSHA256: crypto.createHash('sha256').update(fs.readFileSync(path.join(dataDir, 'pets.json'))).digest('hex'),
  seedCount: seedCount, maxTurns: maxTurns, teamSize: teamSize,
  pool: pool.length,
  battles: battles
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(doc, null, 1), 'utf8');
const summary = battles.map((b) => b.seed + ':' + (b.winner || 'draw') + '/' + b.turns + 't').join(' ');
console.log('trace ' + path.basename(outPath) + ' battles=' + battles.length + ' pool=' + pool.length + ' ' + summary);
