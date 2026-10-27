// 将现有技能的完整解析结果编译成数据；执行器继续用原判定核。
// 包含旧浏览器自动效果模板，编号优先级与 web/index.html 相同。
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { readEffectiveOracle } from '../app/config/oracle.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(resolve(root, 'data/skills.json'));
const oracle = readEffectiveOracle();
const templates = readFileSync(resolve(root, 'web/js/effect-ids.js'), 'utf8');
const context = {};
runInNewContext(templates + '\n' + oracle, context);
const sha = (value) => createHash('sha256').update(value).digest('hex');
const items = {};
for (const skill of JSON.parse(source).items) {
  items[skill.id] = context.SeerBattle.parseSkillEffects(structuredClone(skill));
}
const contentHash = sha(JSON.stringify(items));
const output = resolve(root, 'app/public/skill-effects.json');
writeFileSync(output, JSON.stringify({ schema: 1, kind: 'skill-effects',
  dataVersion: contentHash.slice(0, 16), contentHash,
  sourceHash: sha(source), oracleHash: sha(oracle), templatesHash: sha(templates),
  count: Object.keys(items).length, items }));
const manifestFile = resolve(root, 'app/public/data-manifest.json');
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
const bytes = readFileSync(output);
manifest.items.skillEffects = { url: '/skill-effects.json', contentHash: sha(bytes), size: bytes.length };
manifest.contentHash = sha(JSON.stringify(manifest.items));
manifest.dataVersion = manifest.contentHash.slice(0, 16);
writeFileSync(manifestFile, JSON.stringify(manifest));
console.log(`compiled ${Object.keys(items).length} skills / ${(bytes.length / 1024).toFixed(0)} KB / ${manifest.dataVersion}`);
