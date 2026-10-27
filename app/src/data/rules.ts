/* P2：规则表（正则 → 效果模板），替代硬编码 if/else 的第一批高频句式
 * 金标准：旧 web/js/battle.js 的 parseOneEffect；差分见 test/rules.compare.ts
 */
import type { RuleEntry, EffectRule } from './effects';

const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

const STAT: Record<string, string> = {
  攻击: 'atk', 防御: 'def', 特攻: 'spAtk', 特防: 'spDef', 速度: 'spd', 命中: 'acc', 闪避: 'eva'
};

const STATUS: Record<string, string> = {
  中毒: 'poison', 烧伤: 'burn', 冻伤: 'frost', 麻痹: 'paralyze',
  睡眠: 'sleep', 害怕: 'fear', 疲惫: 'tired',
  石化: 'petrify', 诅咒: 'curse'
};

export const RULES: RuleEntry[] = [
  // —— 直接伤害 / 回复 ——
  {
    name: 'flat-damage',
    pattern: /^(?:额外)?附加(\d+)点(?:固定)?伤害$/,
    build: (m) => ({ kind: 'flat', value: n(m[1]) })
  },
  {
    name: 'heal-ratio',
    pattern: /^恢复自身最大体力的(\d+)\/(\d+)$/,
    build: (m) => ({ kind: 'heal', num: n(m[1]), den: n(m[2]) })
  },
  {
    name: 'drain-ratio',
    pattern: /^造成(?:的)?(?:攻击)?伤害的(\d+)%\s*(?:会)?恢复自身体力$/,
    build: (m) => ({ kind: 'drain', num: n(m[1]), den: 100 })
  },
  {
    name: 'drain-half',
    pattern: /^(?:给予)?对方?损伤的一半会恢复自己的体力$/,
    build: () => ({ kind: 'drain', num: 1, den: 2 })
  },

  // —— 能力等级 ——
  {
    name: 'stat-change',
    pattern: /^(?:技能使用成功时[，,]?\s*)?(?:(\d+)%\s*)?(?:改变|降低|提升)(自身|对手|对方)(攻击|防御|特攻|特防|速度|命中|闪避)等级([+-]\d+)$/,
    build: (m) => ({
      kind: 'stat',
      target: m[2] === '自身' ? 'self' : 'foe',
      stat: STAT[m[3]],
      stages: n(m[4]),
      chance: m[1] ? n(m[1]) : 100
    })
  },

  // —— 异常状态 ——
  {
    name: 'status-apply',
    pattern: /^(?:命中后)?(\d+)?%?\s*(?:概率|几率)?\s*(?:令|使)?(?:对方|对手|自身)?(中毒|烧伤|冻伤|麻痹|睡眠|害怕|疲惫|石化|诅咒)(?:(\d+)回合)?$/,
    build: (m) => ({
      kind: 'status',
      statusId: STATUS[m[2]],
      chance: m[1] ? n(m[1]) : 100,
      turns: m[3] ? n(m[3]) : (m[2] === '睡眠' ? 2 : 1)
    })
  },

  // —— 伤害减免 ——
  {
    name: 'guard-phys-half',
    pattern: /^(\d+)回合内受到(物理|特殊)攻击伤害减半$/,
    build: (m) => ({
      kind: 'guard',
      turns: n(m[1]),
      mul: 0.5,
      scope: m[2] === '物理' ? 'phys' : 'spec'
    })
  },

  // —— 第二批：固定伤害家族 / 护盾 / 免控 / 连击 ——
  {
    name: 'flat-random',
    pattern: /^随机附加(\d+)[~\-](\d+)点固定伤害$/,
    build: (m) => ({ kind: 'flatRandom', min: n(m[1]), max: n(m[2]) })
  },
  {
    name: 'flat-by-max-hp',
    pattern: /^附加自身最大体力(\d+)%的百分比伤害$/,
    build: (m) => ({ kind: 'flatByMaxHp', pct: n(m[1]) })
  },
  {
    name: 'heal-flat',
    pattern: /^恢复(\d+)点(?:生命值|体力值|体力)$/,
    build: (m) => ({ kind: 'healFlat', value: n(m[1]) })
  },
  {
    name: 'dot',
    pattern: /^(\d+)回合内每回合都能附加(\d+)点固定伤害$/,
    build: (m) => ({ kind: 'dot', turns: n(m[1]), value: n(m[2]) })
  },
  {
    name: 'multi-hit',
    pattern: /^1回合做(\d+)(?:~(\d+))?次攻击$/,
    build: (m) => ({ kind: 'multiHit', min: n(m[1]), max: m[2] ? n(m[2]) : n(m[1]) })
  },
  {
    name: 'shield',
    pattern: /^(?:为自身附加|获得)(\d+)点护盾$/,
    build: (m) => ({ kind: 'shield', value: n(m[1]) })
  },
  {
    name: 'crit-buff',
    pattern: /^下(\d+)回合自身攻击技能必定打出致命一击$/,
    build: (m) => ({ kind: 'critBuff', turns: n(m[1]) })
  },
  {
    name: 'priority-buff',
    pattern: /^下(\d+)回合自身攻击先制\+(\d+)$/,
    build: (m) => ({ kind: 'priorityBuff', turns: n(m[1]), value: n(m[2]) })
  },
  {
    name: 'power-double',
    pattern: /^威力翻倍$/,
    build: () => ({ kind: 'power', mul: 2 })
  },
  {
    name: 'immune-status-turns',
    pattern: /^(\d+)回合内免疫(?:所有受到的)?异常状态$/,
    build: (m) => ({ kind: 'immuneStatus', turns: n(m[1]) })
  },
  {
    name: 'clear-positive',
    pattern: /^消除对手能力提升状态$/,
    build: () => ({ kind: 'clear', target: 'foe', which: 'positive' })
  },
  {
    name: 'clear-negative-self',
    pattern: /^解除自身的能力下降状态$/,
    build: () => ({ kind: 'clear', target: 'self', which: 'negative' })
  },
  {
    name: 'pp-zero',
    pattern: /^(?:令|使)对手随机(\d+)项技能?的?PP值?归零$/,
    build: (m) => ({ kind: 'ppZero', count: n(m[1]) })
  },

  // —— 第三批：条件威力 / 随机威力（按覆盖度量补充的高频未命中） ——
  {
    name: 'power-target-low',
    pattern: /^对方体力小于(\d+)\/(\d+)时威力(?:加倍|为([\d.]+)倍)$/,
    build: (m) => ({
      kind: 'power',
      cond: 'targetLow',
      threshold: n(m[1]) / n(m[2]),
      mul: m[3] ? Number(m[3]) : 2
    })
  },
  {
    name: 'power-first',
    pattern: /^先出手的话威力为2倍$/,
    build: () => ({ kind: 'power', cond: 'first', mul: 2 })
  },
  {
    name: 'power-last',
    pattern: /^后出手的话威力为2倍$/,
    build: () => ({ kind: 'power', cond: 'last', mul: 2 })
  },
  {
    name: 'power-random',
    pattern: /^威力随机[，,]\s*随机范围(\d+)[~\-](\d+)$/,
    build: (m) => ({ kind: 'powerRandom', min: n(m[1]), max: n(m[2]) })
  },
  {
    name: 'drain-max',
    pattern: /^吸取对手最大体力的(\d+)\/(\d+)$/,
    build: (m) => ({ kind: 'drainMax', num: n(m[1]), den: n(m[2]) })
  },

  // —— 第四批：段级覆盖 TOP（按覆盖度量排序取材） ——
  {
    name: 'clear-foe-effects',
    pattern: /^消除对手回合类效果$/,
    build: () => ({ kind: 'clearFoe' })
  },
  {
    name: 'heal-full',
    pattern: /^恢复自身全部体力$/,
    build: () => ({ kind: 'heal', num: 1, den: 1 })
  },
  {
    name: 'one-hit',
    pattern: /^免疫下1次对手的攻击$/,
    build: () => ({ kind: 'oneHit' })
  },
  {
    name: 'steal-positive',
    pattern: /^吸取对手能力提升状态$/,
    build: () => ({ kind: 'stealPositive' })
  },
  {
    name: 'invert-self-downs',
    pattern: /^反转自身能力下降状态$/,
    build: () => ({ kind: 'invertStages', dbl: false })
  },
  {
    // 全属性 ±N：一条规则产出 5 个效果（旧解析器同样返回 5 条）
    name: 'all-stats',
    pattern: /^(令|使)?(自身|对手|对方)?全属性([+-]\d+)$/,
    build: (m) => {
      // oracle 只在有「令/使」时识别对手目标，迁移期保留此行为。
      const target = m[1] && (m[2] === '对手' || m[2] === '对方') ? 'foe' : 'self';
      const stages = n(m[3]);
      return (['atk', 'def', 'spAtk', 'spDef', 'spd'] as const).map((stat) => ({
        kind: 'stat' as const,
        target,
        stat,
        stages,
        chance: 100
      }));
    }
  },
  {
    name: 'self-ko',
    pattern: /^消耗自身全部体力(?:[（(]体力降到0[）)])?$/,
    build: () => ({ kind: 'selfKo' })
  },
  {
    name: 'skill-block',
    pattern: /^(\d+)回合内令对手使用的属性技能无效$/,
    build: (m) => ({ kind: 'skillBlock', turns: n(m[1]) })
  },
  {
    name: 'priority-cond',
    pattern: /^先制\+(\d+)$/,
    build: (m) => ({ kind: 'priorityCond', value: n(m[1]) })
  },
  {
    name: 'skill-power-double',
    pattern: /^技能威力翻倍$/,
    build: () => ({ kind: 'power', mul: 2 })
  },
  {
    name: 'random-status',
    pattern: /^随机附加(\d+)种异常状态$/,
    build: (m) => ({ kind: 'randomStatus', count: n(m[1]) })
  },
  {
    name: 'clear-both-both',
    pattern: /^消除双方能力提升、下降状态$/,
    build: () => ({ kind: 'clearBothBoth' })
  }
];

/** 需要「一条规则产出多条效果」时用这个（如全属性 ±N） */
export function parseRuleList(text: string): EffectRule[] | null {
  const t = String(text || '').trim();
  if (!t) return null;
  for (const r of RULES) {
    const m = r.pattern.exec(t);
    if (!m) continue;
    const out = r.build(m);
    if (!out) continue;
    return Array.isArray(out) ? out : [out];
  }
  return null;
}

/** 用规则表解析一条文本；未命中返回 null（不回退到旧引擎） */
export function parseWithRules(text: string): EffectRule | null {
  const t = String(text || '').trim();
  if (!t) return null;
  for (const r of RULES) {
    const m = r.pattern.exec(t);
    if (!m) continue;
    const out = r.build(m);
    if (!out) continue;
    return Array.isArray(out) ? out[0] : out;
  }
  return null;
}
