import legacy from '../../../web/js/battle.js';
import { parseRuleList } from '../data/rules';
import { parseComposite } from '../data/composite';
import type { EffectRule } from '../data/effects';

export interface SkillEffectsInput {
  info?: string | null;
  effects?: unknown[];
  skill_effect?: unknown[];
  _fx?: EffectRule[];
}

export function parseOneEffect(text: string, out: EffectRule[]): void {
  const parsed = parseRuleList(text) || parseComposite(text);
  if (parsed) out.push(...parsed);
  else legacy.parseOneEffect(text, out);
}

/** 编号效果优先；只有全部文本段均覆盖时接管，否则整个技能交回 oracle。 */
export function parseSkillEffects(skill: SkillEffectsInput): EffectRule[] {
  if (skill._fx) return skill._fx;
  if (skill.effects?.length || skill.skill_effect?.length || !skill.info) return legacy.parseSkillEffects(skill);
  const out: EffectRule[] = [];
  for (const part of skill.info.split(/[；;|]|\s\/\s/).map((s) => s.trim()).filter(Boolean)) {
    const parsed = parseRuleList(part) || parseComposite(part);
    if (!parsed) return legacy.parseSkillEffects(skill);
    out.push(...parsed);
  }
  const seen = new Set<string>();
  skill._fx = out.filter((f) => {
    const key = f.kind + '|' + JSON.stringify(f);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  return skill._fx;
}
