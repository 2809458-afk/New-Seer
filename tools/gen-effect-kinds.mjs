/* 从旧解析器提取效果 kind 词汇，生成 app/src/data/effects.ts
 * 用法：node tools/gen-effect-kinds.mjs
 */
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEffectiveOracle } from '../app/config/oracle.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'app/src/data/effects.ts');

const text = readEffectiveOracle();
const kinds = [...new Set([...text.matchAll(/kind:\s*'([a-zA-Z0-9_]+)'/g)].map((m) => m[1]))].sort();

const q = (k) => `'${k}'`;

const out = `/* P2：效果类型词汇表（自动生成，勿手改）
 * 生成脚本：node tools/gen-effect-kinds.mjs（来源冻结判定核 + app/src/core/expansions 增量的 kind 字面量）
 * 目的：让数据表 / 规则原语有统一类型，逐步替代硬编码 if/else。
 */

export type EffectKind =
  | ${kinds.map(q).join('\n  | ')};

export const EFFECT_KINDS: readonly EffectKind[] = [
${kinds.map((k) => `  ${q(k)}`).join(',\n')}
];

export const isEffectKind = (v: unknown): v is EffectKind =>
  typeof v === 'string' && EFFECT_KINDS.indexOf(v as EffectKind) >= 0;

export interface EffectRule {
  kind: EffectKind;
  [param: string]: unknown;
}

/** 一条解析规则：正则 → 效果模板（P2 的表格形态，逐步替换 if/else） */
export interface RuleEntry {
  name: string;
  pattern: RegExp;
  build: (m: RegExpExecArray) => EffectRule | EffectRule[] | null;
}
`;

writeFileSync(OUT, out, 'utf8');
console.log(`写入 ${OUT}，kind 数 = ${kinds.length}`);
