import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const oraclePath = fileURLToPath(new URL('../../web/js/battle.js', import.meta.url));
const expansion = new URL('../src/core/expansions/pets-20261027.patch', import.meta.url);
const metadata = new URL('../src/core/expansions/pets-20261027.json', import.meta.url);
export const oracleWatchFiles = [oraclePath, fileURLToPath(expansion), fileURLToPath(metadata)];

/** 构建期应用标准 unified diff；严格逐行校验，不模糊匹配或修改基准文件。 */
export function applySourcePatch(source, patch) {
  const base = source.replace(/\r\n/g, '\n').split('\n');
  const output = [];
  let cursor = 0;
  const hunks = patch.replace(/\r\n/g, '\n').split(/(?=^@@ )/m).filter((h) => h.startsWith('@@'));
  if (!hunks.length) throw new Error('Empty oracle expansion patch');
  for (const hunk of hunks) {
    const [header, ...lines] = hunk.split('\n');
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(header);
    if (!match) throw new Error('Invalid patch header: ' + header);
    const start = Number(match[1]) - 1;
    if (start < cursor) throw new Error('Overlapping expansion hunks');
    output.push(...base.slice(cursor, start)); cursor = start;
    for (const line of lines) {
      if (!line || line.startsWith('\\')) continue;
      if (line[0] === ' ' || line[0] === '-') {
        if (base[cursor] !== line.slice(1)) throw new Error(`Expansion context changed at line ${cursor + 1}`);
        cursor++;
      }
      if (line[0] === ' ' || line[0] === '+') output.push(line.slice(1));
    }
  }
  output.push(...base.slice(cursor));
  return output.join('\n');
}

export function readEffectiveOracle() {
  const source = readFileSync(oraclePath, 'utf8');
  const meta = JSON.parse(readFileSync(metadata, 'utf8'));
  const hash = createHash('sha256').update(source.replace(/\r\n/g, '\n')).digest('hex');
  if (hash !== meta.baseNormalizedSha256) throw new Error('Oracle baseline changed; rebase pets-20261027.patch before building');
  return applySourcePatch(source, readFileSync(expansion, 'utf8'));
}

export function oracleEsbuildPlugin() {
  return { name: 'seer-pet-expansion', setup(build) {
    build.onLoad({ filter: /[\\/]web[\\/]js[\\/]battle\.js$/ }, () => ({ contents: readEffectiveOracle(), loader: 'js', watchFiles: oracleWatchFiles }));
  } };
}
