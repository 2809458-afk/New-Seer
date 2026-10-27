import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { parseRuleList } from '../src/data/rules';
import { parseComposite } from '../src/data/composite';

const legacy = createRequire(import.meta.url)('../../web/js/battle.js');
const doc = JSON.parse(readFileSync(new URL('../../web/data/effect-ids.json', import.meta.url), 'utf8'));
const texts = new Set<string>();
for (const match of readFileSync(new URL('rules.compare.ts', import.meta.url), 'utf8').matchAll(/cmp\('([^']+)'/g)) texts.add(match[1]);
for (const entry of Object.values(doc.ids) as Array<{ sample?: string }>) {
  if (!entry.sample) continue;
  texts.add(entry.sample);
  for (const part of entry.sample.split(/[，,；;]/)) {
    const text = (part.match(/则(.+)$/)?.[1] || part).trim();
    if (text) texts.add(text);
  }
}
let hits = 0, failures = 0;
for (const text of texts) {
  const expected: unknown[] = [];
  legacy.parseOneEffect(text, expected);
  for (const [name, parse] of [['rules', parseRuleList], ['composite', parseComposite]] as const) {
    const got = parse(text);
    if (!got) continue;
    hits++;
    if (JSON.stringify(got) !== JSON.stringify(expected)) {
      failures++;
      console.error(`${name} FAIL ${text}\n  new ${JSON.stringify(got)}\n  old ${JSON.stringify(expected)}`);
    }
  }
}
console.log(`${texts.size} unique texts / ${hits} hits / ${failures} mismatches`);
process.exitCode = failures ? 1 : 0;
