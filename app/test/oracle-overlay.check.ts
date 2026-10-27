import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// @ts-ignore Node-only build helper
import { applySourcePatch, readEffectiveOracle } from '../config/oracle.mjs';
assert.equal(applySourcePatch('a\nb\nc\n', '@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n'), 'a\nB\nc\n');
assert.equal(applySourcePatch('a\r\nb\r\nc\r\n', '@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n'), 'a\nB\nc\n');
assert.throws(() => applySourcePatch('a\nx\nc\n', '@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n'), /context changed/);
assert.throws(() => applySourcePatch('a', 'not a patch'), /Empty/);
const source = readEffectiveOracle();
assert(source.includes('hunyuanTurnStart'));
for (const feature of ['accuracyMul', 'pcEffectiveness', 'attributeDamage', 'typeByName']) assert(source.includes(feature), feature);
assert(!readFileSync(new URL('../../web/js/battle.js', import.meta.url), 'utf8').includes('hunyuanTurnStart'), 'frozen baseline must remain unchanged');
console.log('strict source overlay / all local backport helpers retained PASS');
