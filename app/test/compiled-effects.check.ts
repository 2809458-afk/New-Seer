import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { battleConfig, seededRng } from '../src/core/session';
import { parseCombos } from '../src/data/tables';
import { isEffectKind } from '../src/data/effects';
import type { Pack } from '../src/data/pack';
// @ts-ignore Node-only source overlay
import { readEffectiveOracle } from '../config/oracle.mjs';

const read = (path: string) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const source = read('data/skills.json');
const oracleSource = readEffectiveOracle(), templates = read('web/js/effect-ids.js');
const compiled = JSON.parse(read('app/public/skill-effects.json'));
assert.equal(compiled.sourceHash, sha(source), 'skills changed: npm run assets');
assert.equal(compiled.oracleHash, sha(oracleSource), 'oracle changed: npm run assets');
assert.equal(compiled.templatesHash, sha(templates), 'effect templates changed: npm run assets');
assert.equal(compiled.contentHash, sha(JSON.stringify(compiled.items)));
const context: Record<string, any> = {};
runInNewContext(templates + '\n' + oracleSource, context);
const oracle = context.SeerBattle;
const skills = JSON.parse(source).items;
const pack: Pack = { skills,
  pets: JSON.parse(read('data/pets.json')).items,
  types: JSON.parse(read('data/types.json')).items,
  soulmarks: JSON.parse(read('data/soulmarks.json')).items,
  combos: parseCombos(JSON.parse(read('data/combos.json'))).value };
const groups = new Set<string>();
const baseConfig = battleConfig(pack, [pack.pets[0]], [pack.pets[2]], seededRng(7919));
let battles = 0;
for (const skill of skills) {
  const fx = compiled.items[String(skill.id)];
  const expected = JSON.parse(JSON.stringify(oracle.parseSkillEffects(structuredClone(skill))));
  assert.deepEqual(fx, expected, `skill ${skill.id} full effects`);
  for (const effect of fx) assert(isEffectKind(effect.kind), `unknown kind ${effect.kind}`);
  const key = JSON.stringify(fx);
  if (groups.has(key)) continue;
  groups.add(key);
  const make = (effects: unknown[]) => {
    const cfg = { ...baseConfig, rng: seededRng(7919), meTeam: structuredClone(baseConfig.meTeam), foeTeam: structuredClone(baseConfig.foeTeam) };
    cfg.meTeam[0].skills = [{ ...skill, max_pp: skill.pp, category: { id: skill.category }, type: { id: skill.type }, _fx: structuredClone(effects) }];
    return new oracle.Battle(cfg);
  };
  const a = make(fx), b = make(expected);
  for (let t = 0; t < 3 && !a.over; t++) {
    a.step({ type: 'skill', index: 0 }); b.step({ type: 'skill', index: 0 });
    assert.equal(JSON.stringify(a.log), JSON.stringify(b.log), `skill ${skill.id} event diff`);
    assert.equal(JSON.stringify(a.snapshot()), JSON.stringify(b.snapshot()), `skill ${skill.id} state diff`);
  }
  battles++;
}
assert.equal(Object.keys(compiled.items).length, skills.length);
mkdirSync(new URL('../../docs/maintenance/', import.meta.url), { recursive: true });
writeFileSync(new URL('../../docs/maintenance/app-compiled-effects.json', import.meta.url), JSON.stringify({ pass: true, skills: skills.length, effectGroups: groups.size, seededBattlePairs: battles, sourceHash: compiled.sourceHash }, null, 2));
console.log(`${skills.length} skills full-array parity / ${groups.size} unique effect groups / ${battles} seeded battle pairs PASS`);
