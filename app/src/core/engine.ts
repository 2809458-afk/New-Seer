// 黑盒接入行为基准，迁移期不改判定核。Vite 只转换 UMD 外壳。
import legacy from '../../../web/js/battle.js';
import * as formula from './formula';
import * as effects from './effect-parser';

// P1 简化伤害公式未包含全部魂印钩子；实战保留完整 oracle 直到逐项对拍迁移。
export const engine: typeof legacy & typeof formula = { ...legacy, ...formula, ...effects, calcDamage: legacy.calcDamage };
export default engine;
