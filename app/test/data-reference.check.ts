import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const read = (name: string) => JSON.parse(readFileSync(new URL('../../data/' + name + '.json', import.meta.url), 'utf8')).items;
const pets = read('pets'), skills = new Set(read('skills').map((s: { id: number }) => s.id));
const marks = new Set(read('soulmarks').map((m: { id: number }) => m.id));
const combos = new Set(read('combos').map((c: { id: number }) => c.id));
const manifest = JSON.parse(readFileSync(new URL('../public/assets-manifest.json', import.meta.url), 'utf8'));
const missing: { art: number[]; skills: string[]; marks: string[]; combos: number[] } = { art: [], skills: [], marks: [], combos: [] };
for (const pet of pets) {
  if (!manifest.items[pet.id]) missing.art.push(pet.id);
  if (!combos.has(pet.type)) missing.combos.push(pet.id);
  for (const id of [...(pet.skills || []).map((s: { id: number }) => s.id), ...(pet.fifth || [])]) {
    if (!skills.has(id)) missing.skills.push(`${pet.id}->${id}`);
  }
  for (const id of pet.soulmarks || []) if (!marks.has(id)) missing.marks.push(`${pet.id}->${id}`);
}
mkdirSync(new URL('../../docs/maintenance/', import.meta.url), { recursive: true });
writeFileSync(new URL('../../docs/maintenance/app-data-references.json', import.meta.url), JSON.stringify({ pets: pets.length, art: manifest.count, missing }, null, 2));
assert.deepEqual(missing.skills, []); assert.deepEqual(missing.marks, []); assert.deepEqual(missing.combos, []);
console.log(`pet->skill/soulmark/combo references PASS; missing portraits (UI placeholder): ${missing.art.join(', ')}`);
