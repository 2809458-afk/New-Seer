/* 数据分级：A=魂印+技能完整可竞技；B=有魂印但半成品；C=无魂印收藏
 *
 * 用法：
 *   node tools/grade-data.js
 *   node tools/grade-data.js --data 交接-20261022/data --out data/grades.json
 *   node tools/grade-data.js --top 20
 *   node tools/grade-data.js --ids 5000,4377
 *
 * 分级只读 data-pack，不联网、不写浏览器 localStorage。
 * v2 的 A 级 = 魂印按分段逐段可解析 + 每个技能效果条目可单独解析；
 * 运行时结算/逐项测试仍以 test/effects.test.js 为准，后续再引入 settled 字段。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_DATA = path.join(ROOT, '交接-20261022', 'data');
const DEFAULT_OUT = path.join(ROOT, 'data', 'grades.json');

// battle.js 在浏览器里挂 self；Node 下补一个，避免加载异常
global.self = global;
const B = require(path.join(ROOT, 'js', 'battle.js'));

function parseArgs() {
  const a = { data: DEFAULT_DATA, out: DEFAULT_OUT, top: 15, ids: [] };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--data') a.data = path.resolve(argv[++i]);
    else if (k === '--out') a.out = path.resolve(argv[++i]);
    else if (k === '--top') a.top = Math.max(1, parseInt(argv[++i], 10) || 15);
    else if (k === '--ids') a.ids = String(argv[++i] || '').split(',').map(s => parseInt(s.trim(), 10)).filter(Boolean);
    else if (k === '--help' || k === '-h') a.help = true;
  }
  return a;
}

function readItems(dir, name) {
  const file = path.join(dir, name + '.json');
  if (!fs.existsSync(file)) throw new Error('缺少数据文件：' + file);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const items = raw && raw.items ? raw.items : raw;
  if (!Array.isArray(items)) throw new Error(name + '.json 不是数组');
  return { items, raw };
}

function readMeta(dir) {
  const file = path.join(dir, 'meta.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

/** 技能里真正带效果文本的片段 */
function effectTexts(skill) {
  if (!skill) return [];
  const out = [];
  (skill.effects || []).forEach(e => {
    const t = e && (e.info || e.analyze_info);
    if (t && String(t).trim()) out.push(String(t));
  });
  if (!out.length && skill.info && String(skill.info).trim()) {
    String(skill.info).split(/[；;|]|\s\/\s/).forEach(p => {
      if (p && p.trim()) out.push(p.trim());
    });
  }
  return out;
}

function parseOne(text) {
  try {
    const out = [];
    B.parseOneEffect(String(text), out);
    return out.length;
  } catch (e) {
    return 0;
  }
}

/** 魂印按原解析器的分隔方式拆段，逐段检查，避免“只解析了第一段就算 A” */
function soulParts(desc) {
  return String(desc || '')
    .split(/[；;|①②③④⑤。\n]/)
    .map(s => s.trim().replace(/^[^：:]{1,10}[：:]\s*/, ''))
    .filter(Boolean)
    .filter(s => !/^[（(]?\s*boss\s*(有效|无效)\s*[）)]?$/i.test(s));
}

function parseSoulPart(text) {
  try {
    return B.parseSoulmark(text).length;
  } catch (e) {
    return 0;
  }
}

/**
 * @param {object} pet
 * @param {Map<number,object>} skillById
 * @param {Map<number,object>} soulById
 */
function gradePet(pet, skillById, soulById) {
  const smIds = Array.isArray(pet.soulmarks) ? pet.soulmarks.slice() : [];
  const flags = [];
  const badSoul = [];
  const badSkills = [];

  if (!smIds.length) {
    return {
      id: pet.id, name: pet.name, grade: 'C',
      reasons: ['no_soulmark'], flags: ['collection'],
      soulmarks: [], skills: (pet.skills || []).length,
      badSoulmarks: [], badSkills: []
    };
  }

  const validSoul = [];
  smIds.forEach(id => {
    const sm = soulById.get(id);
    if (!sm) {
      flags.push('dangling_soulmark:' + id);
      badSoul.push({ id, reason: 'missing' });
      return;
    }
    validSoul.push(id);
    const text = (sm.analyze || sm.desc || '').trim();
    const parts = soulParts(text);
    if (!parts.length) {
      badSoul.push({ id, reason: 'empty' });
      return;
    }
    const bad = parts.filter(p => !parseSoulPart(p));
    if (bad.length) {
      badSoul.push({ id, reason: 'unparsed', text: bad.slice(0, 2).join(' / ').slice(0, 160) });
    }
  });

  if (!validSoul.length) {
    return {
      id: pet.id, name: pet.name, grade: 'C',
      reasons: ['no_valid_soulmark'], flags: flags.concat('collection'),
      soulmarks: smIds, skills: (pet.skills || []).length,
      badSoulmarks: badSoul, badSkills: []
    };
  }

  (pet.skills || []).forEach(s => {
    const sk = skillById.get(s.id);
    if (!sk) {
      badSkills.push({ id: s.id, reason: 'missing' });
      return;
    }
    const texts = effectTexts(sk);
    if (!texts.length) return;
    const bad = texts.filter(t => !parseOne(t));
    if (bad.length) badSkills.push({ id: s.id, reason: 'unparsed', text: bad.slice(0, 2).join(' / ') });
  });

  if (badSoul.length || badSkills.length) {
    const reasons = [];
    if (badSoul.length) reasons.push('soulmark_partial');
    if (badSkills.length) reasons.push('skill_partial');
    if (flags.some(f => f.startsWith('dangling_soulmark'))) reasons.push('dangling_soulmark');
    return {
      id: pet.id, name: pet.name, grade: 'B',
      reasons, flags,
      soulmarks: smIds, skills: (pet.skills || []).length,
      badSoulmarks: badSoul, badSkills
    };
  }

  return {
    id: pet.id, name: pet.name, grade: 'A',
    reasons: [], flags,
    soulmarks: smIds, skills: (pet.skills || []).length,
    badSoulmarks: [], badSkills: []
  };
}

function gradeData(pack) {
  const skillById = new Map();
  const soulById = new Map();
  pack.skills.forEach(s => skillById.set(s.id, s));
  pack.soulmarks.forEach(s => soulById.set(s.id, s));

  const pets = {};
  const summary = {
    total: 0, A: 0, B: 0, C: 0,
    reasons: {}, examples: { A: [], B: [], C: [] }
  };

  pack.pets.forEach(p => {
    const g = gradePet(p, skillById, soulById);
    pets[p.id] = g;
    summary.total++;
    summary[g.grade]++;
    g.reasons.forEach(r => { summary.reasons[r] = (summary.reasons[r] || 0) + 1; });
    if (summary.examples[g.grade].length < 8) summary.examples[g.grade].push({ id: p.id, name: p.name });
  });

  summary.aPct = summary.total ? +(summary.A / summary.total * 100).toFixed(2) : 0;
  summary.aPool = summary.A;
  return { summary, pets };
}

function loadPack(dir) {
  const pets = readItems(dir, 'pets').items;
  const skills = readItems(dir, 'skills').items;
  const soulmarks = readItems(dir, 'soulmarks').items;
  return { pets, skills, soulmarks, meta: readMeta(dir) };
}

function main() {
  const opt = parseArgs();
  if (opt.help) {
    console.log('node tools/grade-data.js [--data DIR] [--out FILE] [--top N] [--ids 1,2]');
    return;
  }
  if (!fs.existsSync(opt.data)) throw new Error('数据目录不存在：' + opt.data + '（默认读交接-20261022/data）');
  const pack = loadPack(opt.data);
  const meta = pack.meta || {};
  const result = gradeData(pack);

  const out = {
    schema: 1,
    generatedAt: new Date().toISOString(),
    basis: 'parser-entry-v2',
    note: 'A=魂印按分段逐段可解析，且每个技能效果条目都能单独解析；偏保守，运行时逐项结算与测试仍以 test/effects.test.js 为准。',
    source: {
      path: path.relative(ROOT, opt.data).replace(/\\/g, '/'),
      pack: meta.pack || null,
      generatedAt: meta.generatedAt || null,
      counts: { pets: pack.pets.length, skills: pack.skills.length, soulmarks: pack.soulmarks.length }
    },
    summary: result.summary,
    pets: result.pets
  };

  fs.mkdirSync(path.dirname(opt.out), { recursive: true });
  fs.writeFileSync(opt.out, JSON.stringify(out, null, 2));

  const s = result.summary;
  console.log(`[数据分级] ${s.total} 只：A ${s.A} / B ${s.B} / C ${s.C}（A ${s.aPct}%）`);
  const reasons = Object.entries(s.reasons).sort((a, b) => b[1] - a[1]);
  console.log('原因 TOP：' + reasons.slice(0, opt.top).map(x => `${x[0]} ${x[1]}`).join(' / '));
  ['A', 'B', 'C'].forEach(g => {
    console.log(`${g} 样例：` + s.examples[g].map(x => `${x.id} ${x.name}`).join('、'));
  });
  if (opt.ids.length) {
    console.log('\n指定精灵：');
    opt.ids.forEach(id => {
      const p = result.pets[id];
      console.log(p ? `${id} ${p.name} → ${p.grade}  ${p.reasons.join(',') || ''}` : `${id} 不存在`);
    });
  }
  console.log(`JSON → ${path.relative(ROOT, opt.out)}`);
  console.log(`GRADE_JSON=${path.relative(ROOT, opt.out).replace(/\\/g, '/')}`);
}

if (require.main === module) {
  try { main(); } catch (e) { console.error('失败：' + e.message); process.exit(1); }
}

module.exports = { gradePet, gradeData, loadPack, effectTexts, soulParts, parseOne, parseSoulPart };
