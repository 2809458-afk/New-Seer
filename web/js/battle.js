/* 战斗引擎（纯逻辑，可在浏览器与 Node 中共用）
 *
 * 公式说明（同人规则，参考原作数值框架）：
 *   HP   = floor((2*种族 + 个体 + floor(学习力/4)) * 等级/100) + 等级 + 10
 *   其它 = floor((floor((2*种族 + 个体 + floor(学习力/4)) * 等级/100) + 5) * 性格修正)
 *   伤害 = (floor(floor(floor(2*等级/5+2) * 威力 * 攻击 / 防御) / 50) + 2)
 *          * 本系(1.5) * 属性克制 * 会心(1.5) * 随机(0.85~1.0)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SeerBattle = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STAT_LABEL = { atk: '攻击', def: '防御', spAtk: '特攻', spDef: '特防', spd: '速度', acc: '命中', eva: '闪避' };
  var STAT_WORD = { '攻击': 'atk', '防御': 'def', '特攻': 'spAtk', '特防': 'spDef', '速度': 'spd', '命中': 'acc', '闪避': 'eva' };

  function clampStage(n) {
    if (n > 6) return 6;
    if (n < -6) return -6;
    return n;
  }

  function stageMul(stage) {
    if (stage >= 0) return (2 + stage) / 2;
    return 2 / (2 - stage);
  }

  /* 命中/闪避等级倍率：负等级用独立表，不套普通能力倒数（B04 / PORT_NOTES D006，与 Godot battle_math.accuracy_mul 一致） */
  var ACC_DOWN_MUL = [1, 0.85, 0.70, 0.55, 0.45, 0.35, 0.25];
  function accuracyMul(stage) {
    stage = Math.max(-6, Math.min(6, stage || 0));
    if (stage >= 0) return 1 + stage * 0.5;
    return ACC_DOWN_MUL[-stage];
  }

  function freshStages() {
    return { atk: 0, def: 0, spAtk: 0, spDef: 0, spd: 0, acc: 0, eva: 0 };
  }

  function num(v) {
    return typeof v === 'number' && isFinite(v) ? v : 0;
  }

  /** 精灵名归一化：去掉「·」「-」等间隔符，便于魂印里的名字与图鉴名对齐 */
  function normName(s) {
    return String(s || '').replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '');
  }

  /** 按等级 / 个体值 / 学习力 / 性格计算面板数值 */
  function computeStats(pet, opts) {
    opts = opts || {};
    var level = opts.level || 100;
    var iv = opts.iv == null ? 31 : opts.iv;
    var ev = opts.ev || {};
    var nature = opts.nature || null;
    var bonus = opts.bonus || {};
    var bonusPct = opts.bonusPct || {};
    var b = pet.base_stats || {};

    function baseOf(k) { return num(b[k]); }
    function evOf(k) { return Math.max(0, Math.min(255, num(ev[k]))); }
    function natureMul(k) {
      if (!nature || !nature.attributes) return 1;
      var raw = nature.attributes[k];
      if (raw == null) return 1;
      if (nature.attributes.percent) return 1 + num(raw) / 100;
      return 1 + num(raw);
    }

    var hp = Math.floor((2 * baseOf('hp') + iv + Math.floor(evOf('hp') / 4)) * level / 100) + level + 10;
    hp = Math.floor((hp + num(bonus.hp)) * (1 + num(bonusPct.hp) / 100));

    function other(k) {
      var raw = Math.floor((2 * baseOf(k) + iv + Math.floor(evOf(k) / 4)) * level / 100) + 5;
      raw = Math.floor(raw * natureMul(k)) + num(bonus[k]);
      return Math.max(1, Math.floor(raw * (1 + num(bonusPct[k]) / 100)));
    }

    return {
      hp: Math.max(1, hp),
      atk: other('atk'),
      def: other('def'),
      spAtk: other('sp_atk'),
      spDef: other('sp_def'),
      spd: other('spd')
    };
  }

  /** 属性表 -> 克制倍率二维表 chart[攻击属性][防御属性] = 倍率 */
  function buildChart(types) {
    var chart = {};
    (types || []).forEach(function (t) {
      var m = {};
      (t.relations || []).forEach(function (r) {
        if (r && r.target_type && r.target_type.id != null) m[r.target_type.id] = num(r.multiple);
      });
      chart[t.id] = m;
    });
    return chart;
  }

  /** 属性组合 -> 基础属性 id 数组 */
  function comboElements(combo) {
    if (!combo) return [];
    var out = [];
    if (combo.primary && combo.primary.id != null) out.push(combo.primary.id);
    if (combo.secondary && combo.secondary.id != null) out.push(combo.secondary.id);
    return out;
  }

  function effectiveness(chart, atkElems, defElems) {
    if (!atkElems || !atkElems.length || !defElems || !defElems.length) return 1;
    var mul = 1;
    atkElems.forEach(function (a) {
      var row = chart[a] || {};
      defElems.forEach(function (d) {
        var v = row[d];
        mul *= (v == null ? 1 : v);
      });
    });
    return mul;
  }

  /** 双系克制（B10 / PORT_NOTES D008），与 godot/scripts/battle_math.gd 的 pc_effectiveness 对齐
   * 双→单：两系均克制取 4，有零取 (x+y)/4，其余取 (x+y)/2
   * 双→双：先按双→单求每个防守属性，再取平均
   * 默认关闭（pcRules=false），保持旧 Web 金标准的连乘口径。
   */
  var pcRules = false;

  function pcEffectiveness(chart, atkElems, defElems) {
    if (!atkElems || !atkElems.length || !defElems || !defElems.length) return 1;
    function atk(a, d) {
      var row = chart[a] || {};
      var v = row[d];
      return v == null ? 1 : v;
    }
    if (atkElems.length === 1) {
      var x = atk(atkElems[0], defElems[0]);
      if (defElems.length === 1) return x;
      var y = atk(atkElems[0], defElems[1]);
      return (x + y) / (x === 0 || y === 0 ? 4 : 2);
    }
    var sum = 0;
    defElems.forEach(function (d) {
      var a0 = atk(atkElems[0], d);
      var a1 = atk(atkElems[1], d);
      sum += (a0 === 2 && a1 === 2) ? 4 : (a0 + a1) / (a0 === 0 || a1 === 0 ? 4 : 2);
    });
    return sum / defElems.length;
  }

  /** 按当前口径取克制系数（pcRules 打开时走 B10） */
  function effMul(chart, atkElems, defElems) {
    return pcRules ? pcEffectiveness(chart, atkElems, defElems) : effectiveness(chart, atkElems, defElems);
  }

  /** 从技能描述里解析能力等级变化，例如「100%改变自身防御等级+1」 */
  function parseEffectInfo(info) {
    var out = [];
    if (!info) return out;
    var parts = String(info).split(/[，,。;；]/);
    parts.forEach(function (p) {
      var m = p.match(/(攻击|防御|特攻|特防|速度|命中|闪避)\s*等级\s*([+\-]?\d+)/);
      if (!m) return;
      var target = /对手|对方|敌方/.test(p) ? 'foe' : 'self';
      var chance = 100;
      var cm = p.match(/(\d+)\s*%/);
      if (cm) chance = parseInt(cm[1], 10);
      out.push({ target: target, stat: STAT_WORD[m[1]], stages: parseInt(m[2], 10), chance: chance });
    });
    return out;
  }

  // ---------- 异常状态 ----------
  var STATUS_DEF = {
    poison:   { name: '中毒', short: '毒', tick: 8, skip: 0 },
    burn:     { name: '烧伤', short: '烧', tick: 16, skip: 0, physHalf: true },
    blind:    { name: '失明', short: '盲', tick: 0, skip: 0, limited: true },
    frost:    { name: '冻伤', short: '冻', tick: 16, skip: 0.25 },
    paralyze: { name: '麻痹', short: '麻', tick: 0, skip: 0.25 },
    sleep:    { name: '睡眠', short: '睡', tick: 0, skip: 1, limited: true },
    fear:     { name: '害怕', short: '怕', tick: 0, skip: 1, limited: true },
    tired:    { name: '疲惫', short: '疲', tick: 0, skip: 1, limited: true },
    confuse:  { name: '混乱', short: '乱', tick: 0, skip: 0.5 },
    petrify:  { name: '石化', short: '石', tick: 0, skip: 0.5 },
    bleed:    { name: '流血', short: '血', tick: 8, skip: 0 },
    flammable:{ name: '易燃', short: '燃', tick: 16, skip: 0 },
    weak:     { name: '衰弱', short: '弱', tick: 0, skip: 0, takenPct: 25 },
    curse:    { name: '诅咒', short: '咒', tick: 8, skip: 0 },
    flameCurse: { name: '烈焰诅咒', short: '焰咒', tick: 8, skip: 0 },
    deathCurse: { name: '致命诅咒', short: '死咒', tick: 0, skip: 0, takenPct: 50 },
    weakCurse: { name: '虚弱诅咒', short: '虚咒', tick: 0, skip: 0, dealtMul: 0.5 },
    infect:   { name: '感染', short: '染', tick: 0, skip: 1, limited: true },
    bind:     { name: '束缚', short: '缚', tick: 8, skip: 0, noSwitch: true },
    lost:     { name: '失神', short: '失', tick: 0, skip: 1, limited: true },
    silence:  { name: '沉默', short: '默', tick: 8, skip: 0, noStatSkill: true },
    submit:   { name: '臣服', short: '臣', tick: 0, skip: 1, limited: true },
    stagnate: { name: '凝滞', short: '滞', tick: 0, skip: 1, limited: true },
    freeze:   { name: '冰封', short: '冰', tick: 0, skip: 1, limited: true },
    thunder:  { name: '雷解', short: '雷', tick: 0, skip: 1, limited: true },
    nightmare:{ name: '魇暝', short: '魇', tick: 8, skip: 0 },
    parasite: { name: '寄生', short: '寄', tick: 8, skip: 0 },
    palsy:    { name: '瘫痪', short: '瘫', tick: 0, skip: 1, limited: true },
    cinder:   { name: '焚烬', short: '烬', tick: 16, skip: 0 }
  };
  var STATUS_WORD = {
    '中毒': 'poison', '烧伤': 'burn', '失明': 'blind', '冻伤': 'frost', '麻痹': 'paralyze',
    '睡眠': 'sleep', '害怕': 'fear', '疲惫': 'tired', '混乱': 'confuse',
    '石化': 'petrify', '流血': 'bleed', '易燃': 'flammable',
    '衰弱': 'weak', '诅咒': 'curse', '烈焰诅咒': 'flameCurse',
    '致命诅咒': 'deathCurse', '虚弱诅咒': 'weakCurse', '感染': 'infect',
    '束缚': 'bind', '失神': 'lost', '沉默': 'silence', '臣服': 'submit',
    '凝滞': 'stagnate', '冰封': 'freeze', '雷解': 'thunder', '魇暝': 'nightmare',
    '寄生': 'parasite', '瘫痪': 'palsy', '焚烬': 'cinder'
  };
  // 异常状态编号（技能 effects.args 里的数字；用 1471/2212/469/1047 的文本反推核对过）
  var STATUS_BY_CODE = {
    0: 'paralyze', 1: 'poison', 2: 'burn', 3: 'bleed', 4: 'infect', 5: 'frost',
    6: 'fear', 7: 'tired', 8: 'sleep', 9: 'petrify', 10: 'confuse',
    11: 'bind', 12: 'weak', 13: 'nightmare', 14: 'parasite', 15: 'freeze',
    16: 'bleed', 17: 'submit', 18: 'stagnate', 19: 'palsy', 20: 'blind',
    21: 'flammable', 22: 'cinder', 23: 'curse', 24: 'flameCurse', 25: 'deathCurse',
    26: 'weakCurse', 27: 'infect', 28: 'bind', 29: 'lost', 30: 'silence'
  };
  function statusByCode(code) { return STATUS_BY_CODE[code] || null; }
  var STATUS_NAME_RE = '中毒|烧伤|失明|冻伤|麻痹|睡眠|害怕|疲惫|混乱|石化|流血|易燃|衰弱|烈焰诅咒|致命诅咒|虚弱诅咒|诅咒|感染|束缚|失神|沉默|臣服|凝滞|冰封|雷解|魇暝|寄生|瘫痪|焚烬';

  // 场地效果（来自 SeerAPI 的 field_effect，目前只有这两个是通用规则）
  var FIELD_PRESETS = {
    1: { id: 1, name: '灵籁泳馆', mustHit: true, healPerTurn: 300 },
    2: { id: 2, name: '星璨舞台', damageMul: 2.3, ppRestore: 1 }
  };

  // 对战道具（游戏内没有现成道具数据，这里给一套基础补给）
  var ITEM_DEFS = {
    potion: { id: 'potion', name: '体力药剂', desc: '回复最大体力的 1/3', kind: 'heal', value: 1 / 3, init: 3 },
    ether: { id: 'ether', name: 'PP 药剂', desc: '所有技能回复 5 点 PP', kind: 'pp', value: 5, init: 3 },
    antidote: { id: 'antidote', name: '万能解药', desc: '解除自身异常状态', kind: 'cure', init: 2 }
  };
  var DEFAULT_ITEMS = ['potion', 'ether', 'antidote'];


  /** 文本归一化：中文数字 → 阿拉伯数字、全角→半角、统一标点、去注解 */
  var CN_NUM = { 零: 0, 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  function normalizeText(s) {
    if (!s) return s;
    var o = String(s);
    o = o.replace(/（[^）]{0,12}）/g, '').replace(/\([^)]{0,12}\)/g, '');
    o = o.replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
    o = o.replace(/％/g, '%').replace(/[＋]/g, '+').replace(/[－—]/g, '-').replace(/[×xX]/g, '×');
    o = o.replace(/[　]/g, ' ');
    o = o.replace(/\s+/g, ' ').trim();
    o = o.replace(/([零一两二三四五六七八九十])回合/g, function (_, c) { return (CN_NUM[c] || 1) + '回合'; });
    o = o.replace(/([零一两二三四五六七八九十])个等级/g, function (_, c) { return (CN_NUM[c] || 1) + '个等级'; });
    o = o.replace(/([零一两二三四五六七八九十])倍/g, function (_, c) { return (CN_NUM[c] || 1) + '倍'; });
    o = o.replace(/([零一两二三四五六七八九十])次/g, function (_, c) { return (CN_NUM[c] || 1) + '次'; });
    return o;
  }

  /** 解析一条效果描述（接口里的 info 已代入参数，直接读文本最稳） */
  /** 解析条件文本 */
  function parseCond(t) {
    var m;
    if ((m = t.match(/对手处于(中毒|烧伤|冻伤|麻痹|睡眠|害怕|疲惫|混乱|石化|流血|易燃)状态/))) {
      return { type: 'targetStatus', status: STATUS_WORD[m[1]] };
    }
    if (/对手(?:不)?处于异常状态/.test(t)) {
      return /不处于/.test(t) ? { type: 'targetNoStatus' } : { type: 'targetAnyStatus' };
    }
    if ((m = t.match(/对手(?:的)?体力(?:不足|小于|低于)(\d+)/))) {
      return { type: 'targetHpBelow', value: parseInt(m[1], 10) };
    }
    if (/对手处于能力下降状态/.test(t)) return { type: 'targetStatDown' };
    if (/对手处于能力提升状态/.test(t)) return { type: 'targetStatUp' };
    if (/自身处于能力下降状态/.test(t)) return { type: 'selfStatDown' };
    if (/先出手/.test(t)) return { type: 'first' };
    if ((m = t.match(/造成(?:的)?伤害(?:大于|超过)(\d+)/))) return { type: 'damageOver', value: parseInt(m[1], 10) };
    if ((m = t.match(/造成(?:的)?伤害(?:小于|低于|不足|少于)(\d+)/))) return { type: 'damageUnder', value: parseInt(m[1], 10) };
    if (/致命一击/.test(t)) return { type: 'crit' };
    if (/属性相同/.test(t)) return { type: 'sameType' };
    if (/当前HP低于对手|体力低于对手/.test(t)) return { type: 'selfHpLower' };
    if (/消除.{0,8}成功/.test(t)) return { type: 'clearSuccess' };
    if (/对手不处于能力提升状态/.test(t)) return { type: 'targetStatNotUp' };
    if (/自身不处于能力提升状态/.test(t)) return { type: 'selfStatNotUp' };
    if (/自身处于护盾状态/.test(t)) return { type: 'selfHasShield' };
    if (/后出手/.test(t)) return { type: 'last' };
    if (/自身(?:当前)?体力高于对手/.test(t)) return { type: 'selfHpHigher' };
    if (/天敌|被克制/.test(t)) return { type: 'disadvantage' };
    if ((m = t.match(/对手体力低于最大体力的(\d+)\/(\d+)/))) {
      return { type: 'targetHpRatioBelow', threshold: parseInt(m[1], 10) / parseInt(m[2], 10) };
    }
    if (/解除.{0,6}成功|消除.{0,6}成功/.test(t)) return { type: 'clearSuccess' };
    if ((m = t.match(/自身(?:当前)?体力高于最大体力的(\d+)\/(\d+)/))) {
      return { type: 'selfHpRatioOver', threshold: parseInt(m[1], 10) / parseInt(m[2], 10) };
    }
    if ((m = t.match(/自身(?:当前)?体力低于最大体力的(\d+)\/(\d+)/))) {
      return { type: 'selfHpRatioBelow', threshold: parseInt(m[1], 10) / parseInt(m[2], 10) };
    }
    return null;
  }

  /** 把「若…则…」拆成 前缀 / 条件 / 结果 */
  function splitConditional(text) {
    var idx = text.indexOf('若');
    if (idx < 0) return null;
    var after = text.slice(idx + 1);
    var m = after.match(/^(.{1,40}?)[，,]?\s*则(.+)$/);
    if (!m) return null;
    var cond = parseCond(m[1]);
    if (!cond) return null;
    return {
      prefix: text.slice(0, idx).replace(/[，,]\s*$/, ''),
      cond: cond,
      thenText: m[2]
    };
  }

  /** 条件是否满足 */
  function checkCond(c, ctx) {
    if (!c) return true;
    if (c.first && !ctx.isFirst) return false;
    var actor = ctx.actor;
    var target = ctx.target;
    function anyStage(c2, down) {
      var keys = Object.keys(c2.stages);
      for (var i = 0; i < keys.length; i++) {
        if (down ? c2.stages[keys[i]] < 0 : c2.stages[keys[i]] > 0) return true;
      }
      return false;
    }
    switch (c.type) {
      case 'targetStatus': return !!(target.status && target.status.id === c.status);
      case 'targetAnyStatus': return !!target.status;
      case 'targetNoStatus': return !target.status;
      case 'targetStatUp': return anyStage(target, false);
      case 'targetStatDown': return anyStage(target, true);
      case 'selfStatDown': return anyStage(actor, true);
      case 'targetHpBelow': return target.hp < c.value;
      case 'selfHpLower': return actor.hp < target.hp;
      case 'first': return !!ctx.isFirst;
      case 'damageOver': return (ctx.dealt || 0) > c.value;
      case 'damageUnder': return (ctx.dealt || 0) < c.value;
      case 'crit': return !!ctx.crit;
      case 'clearSuccess': return !!ctx.clearSuccess;
      case 'statusFail': return ctx.statusApplied === false;
      case 'selfHpNotFull': return actor.hp < actor.maxHp;
      case 'targetAlive': return target.hp > 0;
      case 'selfHpFull': return actor.hp >= actor.maxHp;
      case 'noDamageLast': return !ctx.actor || !ctx.actor.tookDamageLastTurn;
      case 'selfStatUp': return anyStage(actor, false);
      case 'last': return !ctx.isFirst;
      case 'targetStatNotUp': return !anyStage(target, false);
      case 'selfStatNotUp': return !anyStage(actor, false);
      case 'selfHasShield': return (actor.shield || 0) > 0;
      case 'selfHpRatioOver': return actor.hp / actor.maxHp > c.threshold;
      case 'selfHpRatioBelow': return actor.hp / actor.maxHp < c.threshold;
      case 'selfHpHigher': return actor.hp > target.hp;
      case 'disadvantage': {
        if (!ctx.chart) return false;
        var back = effectiveness(ctx.chart, comboElements(target.combo), comboElements(actor.combo));
        return back > 1;
      }
      case 'targetHpRatioBelow': return target.hp / target.maxHp < c.threshold;
      case 'notFullHp': return actor.hp < actor.maxHp;
      case 'selfAnyStatus': return !!actor.status;
      case 'selfStatDownOrStatus': return hasStatDown(actor) || !!actor.status;
      case 'foeMiss': return !!(this.lastMissSide && this.lastMissSide === (actor.side === 'me' ? 'foe' : 'me'));
      case 'targetStatNotDown': return !hasStatDown(target);
      case 'foeNotType': {
        var tn = (target.combo && target.combo.name) || '';
        return tn.indexOf(c.name) < 0;
      }
      case 'fullHp': return actor.hp >= actor.maxHp;
      case 'firstTurn': return (ctx.turn || 1) === (actor.enterTurn || 1);
      case 'sameType': {
        var a = comboElements(actor.combo);
        var s = comboElements(ctx.skillCombo);
        for (var i = 0; i < s.length; i++) if (a.indexOf(s[i]) >= 0) return true;
        return false;
      }
      default: return true;
    }
  }

  /** 是否处于任何能力提升 */
  function hasStatUp(c) {
    if (!c) return false;
    return Object.keys(c.stages).some(function (k) { return c.stages[k] > 0; });
  }
  /** 是否处于任何能力下降 */
  function hasStatDown(c) {
    if (!c) return false;
    return Object.keys(c.stages).some(function (k) { return c.stages[k] < 0; });
  }
  /** 能力提升的项数 */
  function hasStack(c, n) {
    return !!(c && c.stackPassive && (c.stacks || 0) >= n);
  }
  function countStatUp(c) {    if (!c) return 0;
    var n = 0;
    Object.keys(c.stages).forEach(function (k) { if (c.stages[k] > 0) n++; });
    return n;
  }

  /** 条件效果 / 新增句式的解析入口（未命中则交给基础解析器） */
  function parseOneEffect(text, out, depth) {
    if (!text) return;
    depth = depth || 0;

    // 4950 帝皇之戎：交换主副位
    if (/^交换自身主位、副位的担任精灵/.test(text)) { out.push({ kind: 'swapPos' }); return; }

    // 4766 盖亚：衍化武道
    if (/^衍化自身的武道$/.test(text)) { out.push({ kind: 'wudaoAdvance' }); return; }

    // 4515 霍光：形态切换
    var mHgF = text.match(/^若自身当前不处于(无罔|威破)形态则将自身转换为\1形态，若自身当前处于\1形态则将自身转换为强击形态/);
    if (mHgF) { out.push({ kind: 'formSwitch', form: mHgF[1] }); return; }

    // 3809 龙神哈莫：召唤龙魂 / 令对手技能无效
    var mHmS1 = text.match(/^召唤龙神，使自身下(\d+)回合获得战之龙魂效果$/);
    if (mHmS1) { out.push({ kind: 'summonZhan', turns: parseInt(mHmS1[1], 10) }); return; }
    var mHmS2 = text.match(/^召唤龙神，使自身下(\d+)回合获得御之龙魂效果$/);
    if (mHmS2) { out.push({ kind: 'summonYu', turns: parseInt(mHmS2[1], 10) }); return; }
    if (/^令对手下次使用的技能无效$/.test(text)) { out.push({ kind: 'skillNullNext' }); return; }

    // 3711 圣光莫妮卡：自然祝福层数
    var mBl = text.match(/^命中后获得1层自然祝福[，,]?\s*若造成的伤害高于(\d+)则额外获得1层自然祝福$/);
    if (mBl) { out.push({ kind: 'blessGainOnHit', high: parseInt(mBl[1], 10) }); return; }
    var mBl2 = text.match(/^自身获得(\d+)层自然祝福$/);
    if (mBl2) { out.push({ kind: 'blessGain', n: parseInt(mBl2[1], 10) }); return; }
    if (/^消耗自身所有自然祝福[，,]?\s*每消耗1层则随机令对手1个技能PP值归零$/.test(text)) { out.push({ kind: 'blessConsumePp' }); return; }
    if (/^当回合击败对手则回合结束时损失1层自然祝福$/.test(text)) { out.push({ kind: 'blessKillCost' }); return; }

    // 天启星魂 4677：梦觉星启附加星赐/星哲
    // 「全属性+N，若自身当前体力低于对手则强化效果翻倍」—— 必须在条件拆段之前处理，否则前缀会先出一遍普通强化
    var allLow = /^全属性\+([0-9]+)[，,]\s*若自身当前体力低于对手则强化效果翻倍/.exec(text);
    if (allLow) {
      ['atk', 'def', 'spAtk', 'spDef', 'spd'].forEach(function (sL) {
        out.push({ kind: 'stat', target: 'self', stat: sL, stages: parseInt(allLow[1], 10), chance: 100, lowHpDouble: true });
      });
      return;
    }

    // 3308 圣灵之光：3 回合内对手使用攻击技能则随机技能 PP 归零
    var mPz9 = /^(\d+)回合内对手使用攻击技能[，,]?\s*则使对手随机(\d+)个技能(?:的)?PP值归零/.exec(text);
    if (mPz9) { out.push({ kind: 'ppZeroOnFoeAtk', turns: parseInt(mPz9[1], 10), count: parseInt(mPz9[2], 10) }); return; }

    var stG = /^为自身附加(\d+)回合的星赐/.exec(text);
    if (stG) { out.push({ kind: 'starGift', turns: parseInt(stG[1], 10) }); return; }
    var stP = /^为自身附加(\d+)回合的星哲/.exec(text);
    if (stP) { out.push({ kind: 'starPhil', turns: parseInt(stP[1], 10) }); return; }

    // 「消除对手回合类效果，消除成功则 …」：拆成“清除”+“条件生效”两段
    var cf = /^消除对手回合类效果[,，]?\s*(?:消除成功则)?(.*)$/.exec(text);
    if (cf) {
      out.push({ kind: 'clearFoe' });
      var restCf = (cf[1] || '').trim();
      if (restCf) {
        var innerCf = [];
        parseOneEffect(restCf, innerCf, depth + 1);
        innerCf.forEach(function (e) { e.req = { type: 'clearSuccess' }; });
        for (var ci = 0; ci < innerCf.length; ci++) out.push(innerCf[ci]);
      }
      return;
    }

    // 「消除对手能力提升，消除成功则 …」同理
    var cc = /^消除对手能力提升(?:状态)?[,，]?\s*(?:消除成功则)?(.*)$/.exec(text);
    if (cc) {
      out.push({ kind: 'clear', target: 'foe', which: 'positive' });
      var restCc = (cc[1] || '').trim();
      if (restCc) {
        var innerCc = [];
        parseOneEffect(restCc, innerCc, depth + 1);
        innerCc.forEach(function (e) { e.req = { type: 'clearSuccess' }; });
        for (var cj = 0; cj < innerCc.length; cj++) out.push(innerCc[cj]);
      }
      return;
    }

    if (depth < 2) {
      var sc = splitConditional(text);
      if (sc) {
        if (sc.prefix) parseOneEffect(sc.prefix, out, depth + 1);
        var inner = [];
        parseOneEffect(sc.thenText, inner, depth + 1);
        if (inner.length) {
          inner.forEach(function (e) { e.req = sc.cond; });
          for (var k = 0; k < inner.length; k++) out.push(inner[k]);
          return;
        }
      }
    }

    var m;

    // —— 自爆 / 牺牲类 ——
    if (/牺牲自己进行自爆|消耗自身全部体力|消耗自身体力至残留/.test(text)) {
      parseSelfDestruct(text, out);
      return;
    }

    if (/直接秒杀|即死/.test(text)) { out.push({ kind: 'exec' }); return; }
    if (/威力翻倍/.test(text)) { out.push({ kind: 'power', mul: 2 }); return; }
    m = text.match(/技能威力提升(\d+)/);
    if (m) { out.push({ kind: 'power', add: parseInt(m[1], 10) }); return; }

    m = text.match(/(\d+)回合内每回合都能附加(\d+)点固定伤害/);
    if (m) { out.push({ kind: 'dot', turns: parseInt(m[1], 10), value: parseInt(m[2], 10) }); return; }

    m = text.match(/(?:额外)?附加(\d+)点(?:固定)?伤害/);
    if (m) { out.push({ kind: 'flat', value: parseInt(m[1], 10) }); return; }

    m = text.match(/恢复(\d+)点(?:生命值|体力值|体力)/);
    if (m) { out.push({ kind: 'healFlat', value: parseInt(m[1], 10) }); return; }

    m = text.match(/造成(?:的)?(?:攻击)?伤害的(\d+)%\s*(?:会)?恢复自身体力/);
    if (m) { out.push({ kind: 'drain', num: parseInt(m[1], 10), den: 100 }); return; }
    m = text.match(/造成伤害的(\d+)\/(\d+)\s*(?:会)?恢复自身体力/);
    if (m) { out.push({ kind: 'drain', num: parseInt(m[1], 10), den: parseInt(m[2], 10) }); return; }

    m = text.match(/(自身|对手|对方)(攻击|防御|特攻|特防|速度|命中|闪避)提升(\d+)个?等级/);
    if (m) {
      out.push({
        kind: 'stat',
        target: m[1] === '自身' ? 'self' : 'foe',
        stat: STAT_WORD[m[2]],
        stages: parseInt(m[3], 10),
        chance: 100
      });
      return;
    }

    if (/解除能力下降状态/.test(text)) { out.push({ kind: 'clear', target: 'self', which: 'negative' }); return; }

    parseOneEffectBasic(text, out);
  }

  /** 自爆 / 牺牲类技能的专用解析 */
  function parseSelfDestruct(text, out) {
    var selfKo = /牺牲自己进行自爆|消耗自身全部体力/.test(text);
    var m;

    if (/将对手(?:的)?体力降为1点/.test(text)) out.push({ kind: 'oppTo1' });

    m = text.match(/令我方下一只出场精灵获得(\d+)次奇迹之力/);
    if (m) out.push({ kind: 'nextPet', grant: 'miracle', times: parseInt(m[1], 10) });

    m = text.match(/使对手(\d+)回合内使用属性技能失效/);
    if (m) out.push({ kind: 'skillBlock', turns: parseInt(m[1], 10) });

    m = text.match(/使下只出场精灵前(\d+)次出手必定先手必定暴击/);
    if (m) out.push({ kind: 'nextPet', grant: 'critPrio', times: parseInt(m[1], 10) });

    m = text.match(/给对手附加消耗体力(\d+)\/(\d+)等量的百分比伤害/);
    if (m) out.push({ kind: 'foePercentSelf', num: parseInt(m[1], 10), den: parseInt(m[2], 10) });

    // 神谕涤罪曲：按双方体力高低分两种打法
    if (/消耗自身体力至残留/.test(text)) {
      var lo = text.match(/消耗自身体力至残留(\d+)点HP给对手造成(\d+)-(\d+)点伤害/);
      var hi = text.match(/消耗自身全部体力给对手等同于消耗量的固定伤害并使对手瘫痪(\d+)回合/);
      out.push({
        kind: 'desperate',
        residual: lo ? parseInt(lo[1], 10) : 1,
        dmgMin: lo ? parseInt(lo[2], 10) : 0,
        dmgMax: lo ? parseInt(lo[3], 10) : 0,
        paraTurns: hi ? parseInt(hi[1], 10) : 2
      });
      selfKo = false;
    }

    if (selfKo) out.push({ kind: 'selfKo' });
  }

  /** 第四批：现代技能里高频、但基础解析器认不出的写法
   *  返回 true 表示已处理（调用方不要再走基础解析） */
  function parseModernBatch(text, out, depth) {
    depth = depth || 0;
    var m, inner, i;

    // —— 复合条件（条件夹在中间，不走「若…则」） ——
    m = /^造成的攻击伤害若高于(\d+)则(.+)$/.exec(text);
    if (m) {
      inner = [];
      parseOneEffect(m[2], inner, depth + 1);
      for (i = 0; i < inner.length; i++) {
        if (!inner[i].req) inner[i].req = { type: 'damageOver', value: parseInt(m[1], 10) };
        out.push(inner[i]);
      }
      if (inner.length) return true;
    }
    m = /^本回合打出致命一击则(.+)$/.exec(text);
    if (m) {
      inner = [];
      parseOneEffect(m[1], inner, depth + 1);
      for (i = 0; i < inner.length; i++) {
        if (!inner[i].req) inner[i].req = { type: 'crit' };
        out.push(inner[i]);
      }
      if (inner.length) return true;
    }

    // —— 「先出手时 X」「后出手时 X」统一拆成 条件 + 结果 ——
    if (depth < 2) {
      m = /^(先出手时|后出手时|先出手的话|后出手的话|先出手则|后出手则)(.+)$/.exec(text);
      if (m) {
        var cond = { type: m[1].indexOf('先') === 0 ? 'first' : 'last' };
        inner = [];
        parseOneEffect(m[2], inner, depth + 1);
        if (inner.length) {
          for (i = 0; i < inner.length; i++) {
            if (!inner[i].req) inner[i].req = cond;
            if (!inner[i].cond) inner[i].cond = cond.type;
            out.push(inner[i]);
          }
          return true;
        }
      }
    }

    // —— 伤害类 ——
    if ((m = /^消耗自身当前体力的(\d+)\/(\d+)并使对手受到等量百分比伤害$/.exec(text))) {
      out.push({ kind: 'selfCostPercent', num: parseInt(m[1], 10), den: parseInt(m[2], 10) });
      return true;
    }
    if (/^直接造成等同于对手防御值的固定伤害$/.test(text)) { out.push({ kind: 'flatByDef' }); return true; }
    if ((m = /^附加(\d+)[~\-～](\d+)点固定伤害并恢复等量体力$/.exec(text))) {
      out.push({ kind: 'flatRandomHeal', min: parseInt(m[1], 10), max: parseInt(m[2], 10) });
      return true;
    }
    if ((m = /^附加(\d+)%当前体力值的伤害$/.exec(text))) {
      out.push({ kind: 'flatByCurHp', pct: parseInt(m[1], 10) });
      return true;
    }
    if ((m = /^附加对手当前体力(?:值)?(\d+)%的(?:百分比)?伤害$/.exec(text))) {
      out.push({ kind: 'flatByTargetCurHp', pct: parseInt(m[1], 10) });
      return true;
    }
    if ((m = /^附加对手防御值(\d+)%的百分比伤害$/.exec(text))) {
      out.push({ kind: 'flatByTargetDefPct', pct: parseInt(m[1], 10) });
      return true;
    }
    if ((m = /^随机吸取对手(\d+)[~\-～](\d+)点体力$/.exec(text))) {
      out.push({ kind: 'drainRandom', min: parseInt(m[1], 10), max: parseInt(m[2], 10) });
      return true;
    }
    if ((m = /^对手处于异常状态则吸取对手(\d+)点体力$/.exec(text))) {
      out.push({ kind: 'drainFlat', value: parseInt(m[1], 10), req: { type: 'targetAnyStatus' } });
      return true;
    }
    if ((m = /^随机附加(\d+)[~\-～](\d+)点固伤[，,]\s*对手处于能力下降状态时固伤变为(\d+)[~\-～](\d+)点$/.exec(text))) {
      out.push({
        kind: 'flatRandomCond',
        min: parseInt(m[1], 10), max: parseInt(m[2], 10),
        min2: parseInt(m[3], 10), max2: parseInt(m[4], 10),
        req2: { type: 'targetStatDown' }
      });
      return true;
    }
    if ((m = /^随机降低对手(\d+)\/(\d+)至(\d+)\/(\d+)的当前体力值$/.exec(text))) {
      out.push({
        kind: 'hpCutRandom',
        from: parseInt(m[1], 10) / parseInt(m[2], 10),
        to: parseInt(m[3], 10) / parseInt(m[4], 10)
      });
      return true;
    }
    if (/^消耗自身所有护盾值[，,]?造成等量固定伤害$/.test(text)) { out.push({ kind: 'shieldToDamage' }); return true; }
    if ((m = /^先出手时附加自身双防值总和(\d+)%的百分比伤害$/.exec(text))) {
      out.push({ kind: 'flatByOwnDefs', pct: parseInt(m[1], 10), req: { type: 'first' } });
      return true;
    }
    if ((m = /^命中后(\d+)%秒杀对手$/.exec(text))) {
      out.push({ kind: 'execOnHit', chance: parseInt(m[1], 10) });
      return true;
    }

    // —— 回复类 ——
    if ((m = /^恢复自身已损失体力值的(\d+)\/(\d+)$/.exec(text))) {
      out.push({ kind: 'healByLost', num: parseInt(m[1], 10), den: parseInt(m[2], 10) });
      return true;
    }
    if (/^恢复双方全部体力$/.test(text)) { out.push({ kind: 'healBoth' }); return true; }
    if ((m = /^所有技能(?:的)?PP值?恢复(\d+)点$/.exec(text))) {
      out.push({ kind: 'ppRestoreAll', value: parseInt(m[1], 10) });
      return true;
    }

    // —— 能力等级类 ——
    if ((m = /^将(?:自身)?的?能力下降状态(双倍)?反馈给对手$/.exec(text))) {
      out.push({ kind: 'invertToFoe', dbl: !!m[1] });
      return true;
    }
    if ((m = /^双倍反转自身的?能力下降(?:状态)?$/.exec(text))) {
      out.push({ kind: 'invertStages', dbl: true });
      return true;
    }
    if ((m = /^未击败对手则自身能力提升状态翻倍$/.exec(text))) {
      out.push({ kind: 'doubleStages', needAlive: true });
      return true;
    }
    if ((m = /^自身处于能力提升状态时[，,]?\s*(?:使|令)对手(攻击|防御|特攻|特防|速度|命中|闪避)能力-(\d+)$/.exec(text))) {
      out.push({
        kind: 'stat', target: 'foe', stat: STAT_WORD[m[1]],
        stages: -parseInt(m[2], 10), chance: 100, req: { type: 'selfStatUp' }
      });
      return true;
    }
    if ((m = /^自身不处于能力提升状态时先制\+(\d+)且必定命中$/.exec(text))) {
      out.push({ kind: 'priorityCond', value: parseInt(m[1], 10), req: { type: 'selfStatNotUp' } });
      out.push({ kind: 'mustHit', turns: 1 });
      return true;
    }
    if ((m = /^自身处于护盾状态下先制\+(\d+)$/.exec(text))) {
      out.push({ kind: 'priorityCond', value: parseInt(m[1], 10), req: { type: 'selfHasShield' } });
      return true;
    }
    if ((m = /^(?:技能)?先制\+(\d+)$/.exec(text))) {
      out.push({ kind: 'priorityCond', value: parseInt(m[1], 10) });
      return true;
    }
    if ((m = /^连续使用时先制\+(\d+)$/.exec(text))) {
      out.push({ kind: 'priorityStreak', value: parseInt(m[1], 10) });
      return true;
    }

    // —— 威力 / 增伤类 ——
    if ((m = /^(\d+)%概率伤害为([\d.]+)倍(?:[，,]\s*自身处于能力提升状态时概率翻倍)?$/.exec(text))) {
      out.push({
        kind: 'powerChance', chance: parseInt(m[1], 10),
        mul: parseFloat(m[2]), statUpDouble: /概率翻倍/.test(text)
      });
      return true;
    }
    if ((m = /^连续使用时威力提升(\d+)%[，,]\s*最高提升(\d+)%$/.exec(text))) {
      out.push({ kind: 'rampPct', inc: parseInt(m[1], 10) / 100, cap: parseInt(m[2], 10) / 100 });
      return true;
    }
    if ((m = /^自身每处于(\d+)种能力提升状态[，,]\s*造成的伤害额外提升(\d+)%$/.exec(text))) {
      out.push({ kind: 'powerPerStatUp', per: parseInt(m[1], 10), pct: parseInt(m[2], 10) });
      return true;
    }
    if ((m = /^自身不处于能力提升状态则造成的伤害提升(\d+)%$/.exec(text))) {
      out.push({ kind: 'damageBuff', turns: 1, mul: 1 + parseInt(m[1], 10) / 100, req: { type: 'selfStatNotUp' } });
      return true;
    }
    if ((m = /^对手不处于能力提升状态时造成的伤害提高(\d+)%$/.exec(text))) {
      out.push({ kind: 'damageBuff', turns: 1, mul: 1 + parseInt(m[1], 10) / 100, req: { type: 'targetStatNotUp' } });
      return true;
    }
    if ((m = /^造成的伤害提高(\d+)%$/.exec(text))) {
      out.push({ kind: 'damageBuff', turns: 1, mul: 1 + parseInt(m[1], 10) / 100 });
      return true;
    }
    if ((m = /^下(\d+)回合自身造成的攻击伤害翻倍$/.exec(text))) {
      out.push({ kind: 'damageBuff', turns: parseInt(m[1], 10), mul: 2 });
      return true;
    }
    if ((m = /^(\d+)%的概率打出致命一击$/.exec(text))) {
      out.push({ kind: 'critChance', value: parseInt(m[1], 10) });
      return true;
    }
    if ((m = /^造成的伤害不会低于(\d+)$/.exec(text))) {
      out.push({ kind: 'minDamage', value: parseInt(m[1], 10) });
      return true;
    }
    if ((m = /^若打出致命一击[，,]?\s*则造成伤害值的(\d+)%恢复自身体力$/.exec(text))) {
      out.push({ kind: 'drainOnCrit', pct: parseInt(m[1], 10), req: { type: 'crit' } });
      return true;
    }
    if ((m = /^造成的伤害的(\d+)%恢复自身体力$/.exec(text))) {
      out.push({ kind: 'drain', num: parseInt(m[1], 10), den: 100, req: { type: 'crit' } });
      return true;
    }
    if ((m = /^附加所造成伤害值(\d+)%的固定伤害$/.exec(text))) {
      out.push({ kind: 'flatByDealt', pct: parseInt(m[1], 10) });
      return true;
    }

    // —— 防守 / 封锁类 ——
    if ((m = /^(\d+)回合内(物理|特殊)攻击对自身必定miss$/i.exec(text))) {
      out.push({ kind: 'dodge', turns: parseInt(m[1], 10), chance: 100, scope: m[2] === '物理' ? 'phys' : 'spec' });
      return true;
    }
    if ((m = /^(\d+)回合内对手所有攻击必定MISS[，,]?必中技能有效$/i.exec(text))) {
      out.push({ kind: 'foeMiss', turns: parseInt(m[1], 10) });
      return true;
    }
    if ((m = /^(?:使|令)对手下(\d+)回合攻击技能MISS$/i.exec(text))) {
      out.push({ kind: 'foeMiss', turns: parseInt(m[1], 10) });
      return true;
    }
    if (/^对手当回合属性技能无效$/.test(text)) { out.push({ kind: 'skillBlock', turns: 1 }); return true; }
    if ((m = /^(\d+)回合内免疫大于(\d+)的攻击伤害$/.exec(text))) {
      out.push({ kind: 'immuneAbove', turns: parseInt(m[1], 10), value: parseInt(m[2], 10) });
      return true;
    }
    if ((m = /^(\d+)回合内每回合所受的伤害减少(\d+)点$/.exec(text))) {
      out.push({ kind: 'damageFlat', turns: parseInt(m[1], 10), value: parseInt(m[2], 10) });
      return true;
    }
    if (/^无视护盾效果$/.test(text)) { out.push({ kind: 'ignoreShield' }); return true; }
    if ((m = /^下(\d+)回合(?:的)?攻击必定致命一击$/.exec(text))) {
      out.push({ kind: 'critBuff', turns: parseInt(m[1], 10) });
      return true;
    }
    if ((m = /^自身下(\d+)次攻击必定致命一击$/.exec(text))) {
      out.push({ kind: 'nextCrit', times: parseInt(m[1], 10) });
      return true;
    }
    if ((m = /^(?:令|使)对手(\d+)回合内使用的属性技能无效$/.exec(text))) {
      out.push({ kind: 'skillBlock', turns: parseInt(m[1], 10) });
      return true;
    }
    if ((m = /^令自身随机(\d+)项属性\+(\d+)$/.exec(text))) {
      out.push({ kind: 'randomStatUp', count: parseInt(m[1], 10), stages: parseInt(m[2], 10) });
      return true;
    }
    if ((m = /^(?:令|使)对手随机(\d+)个技能?PP值?归零$/.exec(text))) {
      out.push({ kind: 'ppZero', count: parseInt(m[1], 10) });
      return true;
    }
    if (/^当回合对手无法造成攻击伤害$/.test(text)) { out.push({ kind: 'attackBlock', turns: 1 }); return true; }
    if ((m = /^(\d+)回合内躲避所有攻击$/.exec(text))) {
      out.push({ kind: 'dodge', turns: parseInt(m[1], 10), chance: 100 });
      return true;
    }
    if ((m = /^(\d+)回合内有(\d+)%概率免疫对手的攻击伤害$/.exec(text))) {
      out.push({ kind: 'chanceImmune', turns: parseInt(m[1], 10), chance: parseInt(m[2], 10) });
      return true;
    }
    if ((m = /^(\d+)回合内免疫致命一击伤害$/.exec(text))) {
      out.push({ kind: 'immuneCrit', turns: parseInt(m[1], 10) });
      return true;
    }
    if ((m = /^(\d+)回合做(\d+)[~\-～](\d+)次攻击[，,]\s*对手处于异常状态时连击上限为(\d+)$/.exec(text))) {
      out.push({
        kind: 'multiHit', min: parseInt(m[2], 10), max: parseInt(m[3], 10),
        maxIfStatus: parseInt(m[4], 10)
      });
      return true;
    }
    if ((m = /^附加对手当前体力值(\d+)%的百分比伤害[，,]\s*连续使用每次增加(\d+)%[，,]\s*最高(\d+)%$/.exec(text))) {
      out.push({
        kind: 'flatByTargetCurHpRamp', pct: parseInt(m[1], 10),
        inc: parseInt(m[2], 10), cap: parseInt(m[3], 10)
      });
      return true;
    }
    if ((m = /^吸取对手(\d+)点固定体力[，,]\s*每次使用额外附加(\d+)点[，,]\s*最高(\d+)点$/.exec(text))) {
      out.push({ kind: 'drainFlatRamp', value: parseInt(m[1], 10), inc: parseInt(m[2], 10), cap: parseInt(m[3], 10) });
      return true;
    }
    if ((m = /^下次攻击忽略对手双防值的(\d+)%$/.exec(text))) {
      out.push({ kind: 'ignoreDefPct', pct: parseInt(m[1], 10) });
      return true;
    }
    if ((m = /^自身处于能力提升状态时造成的伤害翻倍$/.exec(text))) {
      out.push({ kind: 'damageBuff', turns: 1, mul: 2, req: { type: 'selfStatUp' } });
      return true;
    }
    if ((m = /^威力提升(\d+)%$/.exec(text))) {
      out.push({ kind: 'power', mul: 1 + parseInt(m[1], 10) / 100 });
      return true;
    }
    if ((m = /^威力随机[，,]\s*随机范围(\d+)[~\-～](\d+)$/.exec(text))) {
      out.push({ kind: 'powerRandom', min: parseInt(m[1], 10), max: parseInt(m[2], 10) });
      return true;
    }
    if ((m = /^下(\d+)回合其它攻击技能必定致命一击$/.exec(text))) {
      out.push({ kind: 'critBuff', turns: parseInt(m[1], 10) });
      return true;
    }
    if (/^必定打出致命一击$/.test(text)) { out.push({ kind: 'critThisHit' }); return true; }
    if (/^恢复自身所有PP值$/.test(text)) { out.push({ kind: 'ppRestoreAll', value: 99 }); return true; }
    if (/^使对手的能力提升效果反转成能力下降效果$/.test(text)) { out.push({ kind: 'invertFoeNegative' }); return true; }
    if ((m = /^(\d+)回合内致命一击概[率几率]上升(\d+)\/(\d+)$/.exec(text))) {
      out.push({ kind: 'critBonusTurns', turns: parseInt(m[1], 10), add: 100 * parseInt(m[2], 10) / parseInt(m[3], 10) });
      return true;
    }
    if ((m = /^(\d+)回合对手无法使自身能力出现提升状态$/.exec(text))) {
      out.push({ kind: 'foeNoStatUp', turns: parseInt(m[1], 10) });
      return true;
    }
    if ((m = /^(\d+)回合后对对手造成(\d+)点固定伤害/.exec(text))) {
      out.push({ kind: 'delayedFlat', turns: parseInt(m[1], 10), value: parseInt(m[2], 10) });
      return true;
    }
    if (/^出手时本回合若受到伤害[，,]?则将伤害反馈给对手$/.test(text)) {
      out.push({ kind: 'reflectIfHit' });
      return true;
    }
    if ((m = /^出手时若自身体力低于对手[，,]?则免疫下(\d+)次受到的攻击伤害$/.exec(text))) {
      out.push({ kind: 'oneHitIfLower', times: parseInt(m[1], 10) });
      return true;
    }
    if ((m = /^未击败对手则对方下(\d+)次攻击技能将(\d+)%被己方闪避$/.exec(text))) {
      out.push({ kind: 'dodgeTimes', times: parseInt(m[1], 10), chance: parseInt(m[2], 10), needAlive: true });
      return true;
    }
    if ((m = /^(\d+)回合内将受到的攻击伤害转化为自身体力$/.exec(text))) {
      out.push({ kind: 'convertTaken', turns: parseInt(m[1], 10) });
      return true;
    }
    // —— 第五批：低频但结构简单的句式 ——
    if ((m = /^连击(\d+)次[，,]\s*每次命中后连击数\+(\d+)[，,]\s*最高连击(\d+)次$/.exec(text))) {
      out.push({ kind: 'multiHit', min: parseInt(m[1], 10), max: parseInt(m[3], 10) });
      return true;
    }
    if ((m = /^恢复(\d+)\/(\d+)(?:点)?体力$/.exec(text))) {
      out.push({ kind: 'heal', num: parseInt(m[1], 10), den: parseInt(m[2], 10) });
      return true;
    }
    if ((m = /^下(\d+)回合自身攻击技能必定致命[、,，]?\s*必定命中$/.exec(text))) {
      out.push({ kind: 'critBuff', turns: parseInt(m[1], 10) });
      out.push({ kind: 'mustHit', turns: parseInt(m[1], 10) });
      return true;
    }
    if ((m = /^下(\d+)回合令对手所有技能先制-(\d+)$/.exec(text))) {
      out.push({ kind: 'priorityDown', turns: parseInt(m[1], 10), value: parseInt(m[2], 10) });
      return true;
    }
    if ((m = /^吸取对手(\d+)点体力$/.exec(text))) {
      out.push({ kind: 'drainFlat', value: parseInt(m[1], 10) });
      return true;
    }
    if ((m = /^减少(\d+)点下回合所受的伤害$/.exec(text))) {
      out.push({ kind: 'damageFlat', turns: 1, value: parseInt(m[1], 10) });
      return true;
    }
    if (/^吸取并反转对手能力提升状态$/.test(text)) { out.push({ kind: 'invertFoeNegative' }); return true; }
    if ((m = /^(\d+)回合内受到物理攻击和特殊攻击伤害减少(\d+)%$/.exec(text))) {
      out.push({ kind: 'guard', turns: parseInt(m[1], 10), mul: 1 - parseInt(m[2], 10) / 100, scope: 'all' });
      return true;
    }
    if ((m = /^自身体力高于对手时先制\+(\d+)$/.exec(text))) {
      out.push({ kind: 'priorityCond', value: parseInt(m[1], 10), req: { type: 'selfHpHigher' } });
      return true;
    }
    if ((m = /^当回合未击败对手则减少对方所有技能PP(\d+)点$/.exec(text))) {
      out.push({ kind: 'ppDrain', chance: 100, amount: parseInt(m[1], 10), needAlive: true });
      return true;
    }
    if ((m = /^每次命中对手后此技能威力下降(\d+)点$/.exec(text))) {
      out.push({ kind: 'power', add: -parseInt(m[1], 10), perUse: true });
      return true;
    }
    if ((m = /^随机使自身(\d+)项能力值\+(\d+)[，,]\s*先出手时提升效果翻倍$/.exec(text))) {
      out.push({ kind: 'randomStatUp', count: parseInt(m[1], 10), stages: parseInt(m[2], 10), firstDouble: true });
      return true;
    }
    if ((m = /^附加对手最大体力(?:值)?(\d+)\/(\d+)的百分比伤害$/.exec(text))) {
      out.push({ kind: 'flatByTargetMaxHp', num: parseInt(m[1], 10), den: parseInt(m[2], 10) });
      return true;
    }
    if ((m = /^附加对手最大体力(?:值)?(\d+)%的百分比伤害[，,]\s*每次使用增加(\d+)%[，,]\s*最高(\d+)%$/.exec(text))) {
      out.push({ kind: 'flatByTargetMaxHpRamp', pct: parseInt(m[1], 10), inc: parseInt(m[2], 10), cap: parseInt(m[3], 10) });
      return true;
    }
    if ((m = /^自身体力高于对手时附加自身当前体力(\d+)\/(\d+)的百分比伤害$/.exec(text))) {
      out.push({ kind: 'flatByCurHp', pct: 100 * parseInt(m[1], 10) / parseInt(m[2], 10), req: { type: 'selfHpHigher' } });
      return true;
    }
    if ((m = /^附加自身的攻击值的(\d+)%的百分比伤害$/.exec(text))) {
      out.push({ kind: 'flatByOwnStat', stat: 'atk', pct: parseInt(m[1], 10) });
      return true;
    }
    if ((m = /^使自身体力百分比与对手体力百分比对调$/.exec(text))) {
      out.push({ kind: 'swapHpPct' });
      return true;
    }
    if ((m = /^恢复己方所有不在场精灵(\d+)点体力$/.exec(text))) {
      out.push({ kind: 'benchHeal', value: parseInt(m[1], 10) });
      return true;
    }
    if (/对手处于能力下降状态时先制\+2/.test(text)) {
      out.push({ kind: 'priorityCond', value: 2, req: { type: 'targetStatDown' } });
      return true;
    }
    return false;
  }

  function parseOneEffectBasic(text, out) {
    if (!text) return;
    var m;
    if (parseModernBatch(text, out, 0)) return;

    // 神觉·米斯蒂克（4676）技能结构
    if (/4回合内对手的能力下降状态无法被解除或反转/.test(text)) {
      out.push({ kind: 'statDownLock', turns: 4 }); return;
    }
    m = text.match(/为对手附加(\d+)层蚩庸之锁/);
    if (m) {
      out.push({ kind: 'addLock', value: parseInt(m[1], 10), overPriority: 1, overTurns: 2 });
      return;
    }
    if (/对手每有1层蚩庸之锁令对手随机1个攻击技能PP值归0/.test(text)) {
      out.push({ kind: 'lockPpZero' }); return;
    }

    // 瀚空之门：对手用属性技扣 PP、用攻击技扣体力
    m = text.match(/对手使用属性技能则减少PP值[；;]?对手使用攻击技能则减少体力/);
    if (m) { out.push({ kind: 'punishByCategory', turns: 1, pp: 1, hpPct: 10 }); return; }
    if (/抵抗异常状态的能力提升了/.test(text)) { out.push({ kind: 'statusResist', value: 30 }); return; }
    // 万皇宗魄决：暴击率递增
    m = text.match(/致命一击率提升(\d+)%[，,]每次使用增加(\d+)%[，,]最高(\d+)%/);
    if (m) { out.push({ kind: 'critRamp', base: parseInt(m[1], 10), inc: parseInt(m[2], 10), cap: parseInt(m[3], 10) }); return; }
    if (/打出致命一击后令自身下(\d+)次技能触发[的]?星皇之怒/.test(text)) {
      var n2 = parseInt(text.match(/下(\d+)次技能触发的星皇之怒/)[1], 10);
      out.push({ kind: 'critThenStarRage', times: n2 });
      return;
    }

    if (/^开始吸取对手的体力了$/.test(text)) { out.push({ kind: 'drainPct', turns: 3, pct: 15 }); return; }
    if (/^开始免疫并反弹异常状态$/.test(text)) { out.push({ kind: 'immuneReflectStatus', turns: 3 }); return; }
    if (/^恢复了?了一定的体力$/.test(text)) { out.push({ kind: 'heal', num: 1, den: 4 }); return; }
    if (/^消除了?双方的能力提升、能力下降$/.test(text)) { out.push({ kind: 'clearBothBoth' }); return; }
    m = text.match(/(?:获得|叠加|增加)(\d+)层神耀能量/);
    if (m) { out.push({ kind: 'addStacks', value: parseInt(m[1], 10) }); return; }
    if (/获得1层神耀能量/.test(text)) { out.push({ kind: 'addStacks', value: 1 }); return; }

    // 早期技能文本被截断：「命中降低了」「防御和特防降低了」「速度提升了很多」
    m = text.match(/^(.{1,12}?)(?:等级)?(降低|下降)(了很多|了许多|很多|许多)$/);
    if (m && /攻击|防御|特攻|特防|速度|命中|闪避/.test(m[1])) {
      m[1].split(/和|、/).forEach(function (nm) {
        var st = STAT_WORD[nm.replace(/[^\u4e00-\u9fa5]/g, '')];
        if (st) out.push({ kind: 'stat', target: 'foe', stat: st, stages: -2, chance: 100 });
      });
      return;
    }
    m = text.match(/^(.{1,12}?)(?:等级)?提升(了许多|很多)$/);
    if (m && /攻击|防御|特攻|特防|速度|命中|闪避/.test(m[1])) {
      m[1].split(/和|、/).forEach(function (nm) {
        var st = STAT_WORD[nm.replace(/[^\u4e00-\u9fa5]/g, '')];
        if (st) out.push({ kind: 'stat', target: 'self', stat: st, stages: 2, chance: 100 });
      });
      return;
    }
    if (/^全属性都提升了$/.test(text)) {
      ['atk','def','spAtk','spDef','spd'].forEach(function (s6) { out.push({ kind: 'stat', target: 'self', stat: s6, stages: 1, chance: 100 }); });
      return;
    }
    m = text.match(/^(.{1,12}?)(?:等级)?(降低|下降)了?$/);
    if (m && /攻击|防御|特攻|特防|速度|命中|闪避/.test(m[1])) {
      m[1].split(/和|、/).forEach(function (nm) {
        var st = STAT_WORD[nm.replace(/[^\u4e00-\u9fa5]/g, '')];
        if (st) out.push({ kind: 'stat', target: 'foe', stat: st, stages: -1, chance: 100 });
      });
      return;
    }
    m = text.match(/^(.{1,12}?)(?:等级)?提升(了很多|了)?$/);
    if (m && /攻击|防御|特攻|特防|速度|命中|闪避/.test(m[1])) {
      var upN = m[2] === '了很多' ? 2 : 1;
      m[1].split(/和|、/).forEach(function (nm) {
        var st = STAT_WORD[nm.replace(/[^\u4e00-\u9fa5]/g, '')];
        if (st) out.push({ kind: 'stat', target: 'self', stat: st, stages: upN, chance: 100 });
      });
      return;
    }
    m = text.match(/(\d+)%的概率打出致命一击[；;]?若打出致命一击[，,],则造成伤害值的(\d+)%恢复自身体力/);
    if (m) { out.push({ kind: 'critChance', value: parseInt(m[1], 10) }); out.push({ kind: 'drainOnCrit', pct: parseInt(m[2], 10) }); return; }

    m = text.match(/(\d+)%概率(?:使|令)对手陷入(中毒|烧伤|冻伤|麻痹|睡眠|害怕|疲惫|混乱|石化|流血|易燃|瘫痪|失神)状态(\d+)回合/);
    if (m) { out.push({ kind: 'status', statusId: STATUS_WORD[m[2]] || 'paralyze', chance: parseInt(m[1], 10), turns: parseInt(m[3], 10) }); return; }
    m = text.match(/(\d+)回合内自身受到直接攻击伤害的(\d+)%反馈给对手/);
    if (m) { out.push({ kind: 'onHitReflectPct', turns: parseInt(m[1], 10), pct: parseInt(m[2], 10) }); return; }
    m = text.match(/(\d+)回合内自身所有攻击威力为(\d+)倍/);
    if (m) { out.push({ kind: 'damageBuff', turns: parseInt(m[1], 10), mul: parseInt(m[2], 10) }); return; }
    if (/^牺牲自己/.test(text)) { out.push({ kind: 'sacrificeNextPet' }); return; }

    // 全属性 +N / -N（含「若体力低于对手则翻倍」这类写法）
    // 893「全属性+N，自身满体力时强化效果翻倍」
    m = text.match(/^全属性\+([0-9]+)[，,]\s*自身满体力时(?:强化)?效果翻倍/);
    if (m) {
      ['atk', 'def', 'spAtk', 'spDef', 'spd'].forEach(function (sH) {
        out.push({ kind: 'stat', target: 'self', stat: sH, stages: parseInt(m[1], 10), chance: 100, fullHpDouble: true });
      });
      return;
    }
    m = text.match(/全属性\s*([+-]\d+)/);
    if (m) {
      var tgtAll = /(令|使|对)(对手|对方)全属性/.test(text) ? 'foe' : 'self';
      var stageAll = parseInt(m[1], 10);
      ['atk', 'def', 'spAtk', 'spDef', 'spd'].forEach(function (s) {
        out.push({ kind: 'stat', target: tgtAll, stat: s, stages: stageAll, chance: 100 });
      });
      return;
    }
    if (/全属性/.test(text) && /提升|强化/.test(text) && !/对手|对方/.test(text)) {
      ['atk', 'def', 'spAtk', 'spDef', 'spd'].forEach(function (s) {
        out.push({ kind: 'stat', target: 'self', stat: s, stages: 1, chance: 100 });
      });
      return;
    }

    // 「攻击+1，防御+1，速度+1」这种列表式写法（没有「等级」二字）
    if (!/等级/.test(text)) {
      var reList = /(攻击|防御|特攻|特防|速度|命中|闪避)\s*([+-]\d+)/g;
      var mm;
      var hits = [];
      while ((mm = reList.exec(text))) hits.push({ stat: STAT_WORD[mm[1]], stages: parseInt(mm[2], 10) });
      if (hits.length) {
        var tgt = /对手|对方/.test(text) ? 'foe' : 'self';
        hits.forEach(function (h) {
          out.push({ kind: 'stat', target: tgt, stat: h.stat, stages: h.stages, chance: 100 });
        });
        return;
      }
    }

    // 免疫并反弹异常状态
    m = text.match(/(\d+)回合内免疫并反弹所有受到的异常状态/);
    if (m) { out.push({ kind: 'immuneReflectStatus', turns: parseInt(m[1], 10) }); return; }

    // 随机恢复 / 随机固定伤害
    m = text.match(/随机恢复(\d+)到(\d+)点(?:生命值|体力)/);
    if (m) { out.push({ kind: 'healRandom', min: parseInt(m[1], 10), max: parseInt(m[2], 10) }); return; }
    m = text.match(/随机附加(\d+)[~-](\d+)点固定伤害/);
    if (m) { out.push({ kind: 'flatRandom', min: parseInt(m[1], 10), max: parseInt(m[2], 10) }); return; }

    // 必定暴击 / 先制（持续若干回合）
    m = text.match(/下(\d+)回合自身攻击技能必定打出致命一击/);
    if (m) { out.push({ kind: 'critBuff', turns: parseInt(m[1], 10) }); return; }
    m = text.match(/下(\d+)回合自身攻击先制\+(\d+)/);
    if (m) { out.push({ kind: 'priorityBuff', turns: parseInt(m[1], 10), value: parseInt(m[2], 10) }); return; }
    m = text.match(/未击败对手则己方下(\d+)次攻击技能必定打出致命一击/);
    if (m) { out.push({ kind: 'nextCrit', times: parseInt(m[1], 10) }); return; }

    // 反转能力下降
    if (/反转自身能力下降状态/.test(text)) { out.push({ kind: 'invertStages', dbl: /双倍反转/.test(text) }); return; }

    // 对手上次造成伤害的固定伤害（天雷之剑）
    if (/附加对手上次造成伤害(?:数值)?的固定伤害/.test(text)) { out.push({ kind: 'prevDamageFlat' }); return; }

    // 攻击伤害倍率（持续若干回合）
    m = text.match(/(\d+)回合攻击伤害是正常状态下的([\d.]+)倍/);
    if (m) { out.push({ kind: 'damageBuff', turns: parseInt(m[1], 10), mul: parseFloat(m[2]) }); return; }
    m = text.match(/下(?:(\d+))?回合(?:自身)?造成的攻击伤害额外提升(\d+)%/);
    if (m) { out.push({ kind: 'damageBuff', turns: m[1] ? parseInt(m[1], 10) : 1, mul: 1 + parseInt(m[2], 10) / 100 }); return; }

    // 令对手攻击技能无效
    m = text.match(/下(?:(\d+))?回合令对手使用的攻击技能无效/);
    if (m) { out.push({ kind: 'attackBlock', turns: m[1] ? parseInt(m[1], 10) : 1 }); return; }

    // 反伤（自己承担对方所受伤害的一部分）
    m = text.match(/对方所受伤害的(\d+)\/(\d+)会反弹给自己/);
    if (m) { out.push({ kind: 'recoil', num: parseInt(m[1], 10), den: parseInt(m[2], 10) }); return; }

    // 消耗自身体力换固定伤害
    m = text.match(/损失自身(\d+)点体力[，,]?\s*给对手造成(\d+)点固定伤害/);
    if (m) { out.push({ kind: 'selfCostDamage', cost: parseInt(m[1], 10), value: parseInt(m[2], 10) }); return; }

    // 消除回合类效果的常见后续
    if (/恢复自身全部体力/.test(text)) { out.push({ kind: 'heal', num: 1, den: 1 }); return; }
    m = text.match(/吸取对手最大体力的(\d+)\/(\d+)/);
    if (m) { out.push({ kind: 'drainMax', num: parseInt(m[1], 10), den: parseInt(m[2], 10) }); return; }
    m = text.match(/己方免疫下(\d+)次受到的异常状态/);
    if (m) { out.push({ kind: 'immuneStatus', turns: parseInt(m[1], 10) }); return; }
    m = text.match(/令对手随机(\d+)项技能?PP值?归零/);
    if (m) { out.push({ kind: 'ppZero', count: parseInt(m[1], 10) }); return; }
    m = text.match(/使自身下(\d+)回合必定致命一击/);
    if (m) { out.push({ kind: 'critBuff', turns: parseInt(m[1], 10) }); return; }
    m = text.match(/(\d+)回合内令对手使用的属性技能无效/);
    if (m) { out.push({ kind: 'skillBlock', turns: parseInt(m[1], 10) }); return; }
    m = text.match(/抵挡下(\d+)次对手的攻击/);
    if (m) { out.push({ kind: 'oneHit', times: parseInt(m[1], 10) }); return; }

    // 增伤条件（先手 / 对手异常 / 自身残血）
    m = text.match(/先出手时造成的攻击伤害额外提升(\d+)%/);
    if (m) { out.push({ kind: 'power', cond: 'first', mul: 1 + parseInt(m[1], 10) / 100 }); return; }
    m = text.match(/若对手(?:不)?处于异常状态则(?:自身)?造成的攻击伤害额外提升(\d+)%/);
    if (m) { out.push({ kind: 'power', cond: /不处于/.test(text) ? 'targetNoStatus' : 'targetAnyStatus', mul: 1 + parseInt(m[1], 10) / 100 }); return; }
    m = text.match(/体力低于(\d+)\/(\d+)时威力([\d.]+)倍/);
    if (m) { out.push({ kind: 'power', cond: 'selfLow', threshold: parseInt(m[1], 10) / parseInt(m[2], 10), mul: parseFloat(m[3]) }); return; }
    m = text.match(/打出致命一击则附加对手最大体力(\d+)\/(\d+)的百分比伤害/);
    if (m) { out.push({ kind: 'critPercent', num: parseInt(m[1], 10), den: parseInt(m[2], 10) }); return; }

    // —— 现代技能的常见句式（第二批） ——
    m = text.match(/(\d+)回合内对手使用技能消耗的PP值变为(\d+)倍/);
    if (m) { out.push({ kind: 'ppCostMul', turns: parseInt(m[1], 10), mul: parseInt(m[2], 10) }); return; }
    m = text.match(/(\d+)回合若本方先手攻击[，,]?\s*使得对方的技能失效/);
    if (m) { out.push({ kind: 'firstNullify', turns: parseInt(m[1], 10) }); return; }
    m = text.match(/(\d+)%恢复自己所有技能PP值(\d+)点/);
    if (m) { out.push({ kind: 'ppRestoreSelf', chance: parseInt(m[1], 10), value: parseInt(m[2], 10) }); return; }
    m = text.match(/造成的伤害不少于(\d+)/);
    if (m) { out.push({ kind: 'minDamage', value: parseInt(m[1], 10) }); return; }
    if (/无视伤害限制效果/.test(text)) { out.push({ kind: 'ignoreGuards' }); return; }
    if (/无视攻击免疫效果/.test(text)) { out.push({ kind: 'ignoreImmune' }); return; }
    if (/无视对手双防能力提升状态/.test(text)) { out.push({ kind: 'ignoreDefUp' }); return; }
    m = text.match(/随机吸取对手(\d+)项属性-(\d+)[，,]\s*并将该属性附加给自己/);
    if (m) { out.push({ kind: 'stealStats', count: parseInt(m[1], 10), stages: parseInt(m[2], 10) }); return; }
    m = text.match(/(?:令|使)对手随机(\d+)项技能?的?PP值?归零/);
    if (m) { out.push({ kind: 'ppZero', count: parseInt(m[1], 10) }); return; }
    m = text.match(/若自身处于能力提升状态则先制\+(\d+)/);
    if (m) { out.push({ kind: 'priorityIfPositive', value: parseInt(m[1], 10) }); return; }
    m = text.match(/作用(\d+)回合[，,]每回合反弹对手(\d+)\/(\d+)的伤害/);
    if (m) { out.push({ kind: 'reflectDamage', turns: parseInt(m[1], 10), num: parseInt(m[2], 10), den: parseInt(m[3], 10) }); return; }
    m = text.match(/(\d+)回合内对手无法通过自身技能恢复体力/);
    if (m) { out.push({ kind: 'healBlock', turns: parseInt(m[1], 10) }); return; }
    m = text.match(/随机使对手(\d+)种能力等级-(\d+)/);
    if (m) { out.push({ kind: 'randomStatDown', count: parseInt(m[1], 10), stages: parseInt(m[2], 10) }); return; }
    if (/若先出手则当回合闪避对手的攻击技能/.test(text)) { out.push({ kind: 'evadeIfFirst' }); return; }
    m = text.match(/后出手时令对手下(\d+)回合先制-(\d+)/);
    if (m) { out.push({ kind: 'priorityDown', turns: parseInt(m[1], 10), value: parseInt(m[2], 10), cond: 'last' }); return; }
    m = text.match(/后出手时令对手下(\d+)回合属性技能无效/);
    if (m) { out.push({ kind: 'skillBlock', turns: parseInt(m[1], 10), cond: 'last' }); return; }
    m = text.match(/(\d+)%概率攻击(\d+)次/);
    if (m) { out.push({ kind: 'multiHitChance', chance: parseInt(m[1], 10), times: parseInt(m[2], 10) }); return; }
    if (/若先出手则必定打出致命一击/.test(text)) { out.push({ kind: 'critIfFirst' }); return; }
    m = text.match(/(\d+)回合使对方攻击伤害是正常状态下的(\d+)\/(\d+)倍/);
    if (m) { out.push({ kind: 'targetDamageDown', turns: parseInt(m[1], 10), num: parseInt(m[2], 10), den: parseInt(m[3], 10) }); return; }
    m = text.match(/下(\d+)回合自身攻击技能必定命中/);
    if (m) { out.push({ kind: 'mustHit', turns: parseInt(m[1], 10) }); return; }

    // 吸取对手能力提升状态 + 后续
    var sp = /^吸取对手能力提升状态[,，]?\s*(?:吸取成功则)?(.*)$/.exec(text);
    if (sp) {
      out.push({ kind: 'stealPositive' });
      var restSp = (sp[1] || '').trim();
      if (restSp && restSp !== text) {
        var innerSp = [];
        parseOneEffect(restSp, innerSp, 1);
        innerSp.forEach(function (e) { e.req = { type: 'clearSuccess' }; });
        innerSp.forEach(function (e) { out.push(e); });
      }
      return;
    }

    // —— 反击 / 反弹类 ——
    m = text.match(/下次受到攻击伤害后[^。]*?反馈伤害值(\d+)%的百分比伤害/);
    if (m) { out.push({ kind: 'reflectNext', pct: parseInt(m[1], 10) }); return; }
    m = text.match(/受到攻击伤害后[^。]*?反馈(\d+)%的伤害/);
    if (m) { out.push({ kind: 'reflectNext', pct: parseInt(m[1], 10) }); return; }
    m = text.match(/将受到的伤害(\d+)倍反馈给对手/);
    if (m) { out.push({ kind: 'reflectNext', pct: parseInt(m[1], 10) * 100 }); return; }

    // —— 第五批：条件增伤 / 伤害触发 / 特殊 ——
    if (/对手为自身天敌时造成的伤害翻倍/.test(text)) { out.push({ kind: 'power', cond: 'disadvantage', mul: 2 }); return; }
    if (/攻击时造成的伤害不会出现微弱/.test(text)) { out.push({ kind: 'noWeak' }); return; }
    m = text.match(/先出手时附加自身攻击(\d+)%的百分比伤害/);
    if (m) { out.push({ kind: 'flatByAtk', pct: parseInt(m[1], 10), req: { type: 'first' } }); return; }
    m = text.match(/附加已损失体力值(\d+)%的百分比伤害/);
    if (m) { out.push({ kind: 'flatBySelfLost', pct: parseInt(m[1], 10) }); return; }
    m = text.match(/若自身当前体力高于对手则附加对手最大体力(\d+)\/(\d+)的百分比伤害/);
    if (m) { out.push({ kind: 'flatByTargetMax', pct: 100 * parseInt(m[1], 10) / parseInt(m[2], 10), req: { type: 'selfHpHigher' } }); return; }
    m = text.match(/造成的伤害低于(\d+)则下(\d+)回合自身先制\+(\d+)/);
    if (m) { out.push({ kind: 'priorityBuff', turns: parseInt(m[2], 10), value: parseInt(m[3], 10), req: { type: 'damageUnder', value: parseInt(m[1], 10) } }); return; }
    m = text.match(/造成的伤害低于(\d+)则自身下(\d+)次技能先制\+(\d+)/);
    if (m) { out.push({ kind: 'priorityBuff', turns: 1, value: parseInt(m[3], 10), req: { type: 'damageUnder', value: parseInt(m[1], 10) } }); return; }
    m = text.match(/造成的(?:攻击)?伤害若?低于(\d+)则恢复自身(\d+)点体力/);
    if (m) { out.push({ kind: 'healFlat', value: parseInt(m[2], 10), req: { type: 'damageUnder', value: parseInt(m[1], 10) } }); return; }
    m = text.match(/后出手时下回合所有技能先制\+(\d+)/);
    if (m) { out.push({ kind: 'priorityBuff', turns: 1, value: parseInt(m[1], 10), cond: 'last' }); return; }
    m = text.match(/自身处于能力提升状态时(\d+)%打出致命一击/);
    if (m) { out.push({ kind: 'critIfPositive', chance: parseInt(m[1], 10) }); return; }
    m = text.match(/附加自身能力提升等级总和X?(\d+)的固定伤害/);
    if (m) { out.push({ kind: 'flatByStatStages', value: parseInt(m[1], 10) }); return; }
    m = text.match(/下(\d+)回合令对手无法主动切换精灵/);
    if (m) { out.push({ kind: 'blockSwitch', turns: parseInt(m[1], 10) }); return; }
    m = text.match(/(\d+)回合内自身的能力提升状态无法被消除或吸取/);
    if (m) { out.push({ kind: 'protectStats', turns: parseInt(m[1], 10) }); return; }
    m = text.match(/损失(\d+)\/(\d+)的体力[，,]\s*提升自身/);
    if (m) { out.push({ kind: 'costHpStats', num: parseInt(m[1], 10), den: parseInt(m[2], 10) }); return; }

    m = text.match(/随机自身(\d+)项属性\+(\d+)/);
    if (m) { out.push({ kind: 'randomStatUp', count: parseInt(m[1], 10), stages: parseInt(m[2], 10) }); return; }
    m = text.match(/将所受的伤害(\d+)倍反馈给对手/);
    if (m) { out.push({ kind: 'reflectNext', pct: parseInt(m[1], 10) * 100 }); return; }
    m = text.match(/(\d+)回合内受到攻击则对手下回合受到的伤害翻倍/);
    if (m) { out.push({ kind: 'onHitDamageUp', turns: parseInt(m[1], 10) }); return; }
    m = text.match(/(\d+)回合内每回合(攻击|防御|特攻|特防|速度|命中|闪避)等级-(\d+)/);
    if (m) { out.push({ kind: 'perTurnStatDown', turns: parseInt(m[1], 10), stat: STAT_WORD[m[2]], stages: parseInt(m[3], 10) }); return; }










    m = text.match(/(\d+)%复制对手当回合释放的技能[，,]/);
    if (m) { out.push({ kind: 'copySkill' }); return; }

    m = text.match(/若先手攻击[，,]则将所受伤害(\d+)倍反击给对手/);
    if (m) { out.push({ kind: 'counterMul', mul: parseInt(m[1], 10) }); return; }
    m = text.match(/(\d+)回合内属性攻击对自身必定miss/);
    if (m) { out.push({ kind: 'statusSkillMiss', turns: parseInt(m[1], 10) }); return; }
    m = text.match(/(\d+)回合内每次直接攻击都有(\d+)%概率附带衰弱效果/);
    if (m) { out.push({ kind: 'onHitStatUp', turns: parseInt(m[1], 10), stat: 'spd', stages: -1, chance: parseInt(m[2], 10) }); return; }
    m = text.match(/(\d+)回合内如果先出手[，,]伤害的(\d+)%恢复体力/);
    if (m) { out.push({ kind: 'drainTurns', turns: parseInt(m[1], 10), num: parseInt(m[2], 10), den: 100, req: { type: 'first' } }); return; }
    m = text.match(/(\d+)回合内受到任何伤害[，,]自身(特攻|攻击|防御|特防|速度|命中|闪避)提高(\d+)个等级/);
    if (m) { out.push({ kind: 'onHitStatUp', turns: parseInt(m[1], 10), stat: STAT_WORD[m[2]], stages: parseInt(m[3], 10), chance: 100 }); return; }
    m = text.match(/对方为(雌性|雄性)则免疫当前回合伤害/);
    if (m) { out.push({ kind: 'genderImmune', gender: m[1] === '雌性' ? 1 : 0, turns: 1 }); return; }
    m = text.match(/损失(\d+)\/(\d+)的体力值[，,]下回合能较快出手/);
    if (m) { out.push({ kind: 'selfCostPriority', pct: parseInt(m[1], 10) / parseInt(m[2], 10) }); return; }
    m = text.match(/消耗自己全部体力[，,]使下一个出战的精灵(\d+)回合免疫异常状态/);
    if (m) { out.push({ kind: 'sacrificeImmune', turns: parseInt(m[1], 10) }); return; }

    // —— 第二十一批 ——
    m = text.match(/自身雄性[，,]下([一两三四五\d]+)回合必定先手[；;]自身雌性[，,]下([一两三四五\d]+)回合必定致命一击/);
    if (m) { var CN3 = { 一: 1, 两: 2, 三: 3, 四: 4, 五: 5 }; out.push({ kind: 'genderBranch', turns: CN3[m[1]] || parseInt(m[1], 10) || 2 }); return; }
    if (m) { out.push({ kind: 'genderBranch', turns: parseInt(m[1], 10) }); return; }
    if (/^复制对手释放的技能/.test(text)) { out.push({ kind: 'copySkill' }); return; }

    // —— 第二十批 ——

    if (/攻击时将对手的能力提升状态视为相应的能力下降状态/.test(text)) { out.push({ kind: 'treatFoeStatAsDown' }); return; }
    m = text.match(/(\d+)%恢复自身所有PP值(\d+)点/);
    if (m) { out.push({ kind: 'ppRestoreChance', chance: parseInt(m[1], 10), amount: parseInt(m[2], 10) }); return; }
    m = text.match(/随机附加(\d+)种非限制类异常状态/);
    if (m) { out.push({ kind: 'randomStatus', count: parseInt(m[1], 10), chance: 100 }); return; }
    m = text.match(/(\d+)%的概率造成伤害翻倍[，,]自身处于能力提升状态或对手处于能力下降状态时概率翻倍/);
    if (m) { out.push({ kind: 'powerChance', chance: parseInt(m[1], 10), mul: 2, statOrDouble: true }); return; }
    m = text.match(/(\d+)回合内每回合使用技能吸取对手(\d+)点体力/);
    if (m) { out.push({ kind: 'perTurnDrain', turns: parseInt(m[1], 10), value: parseInt(m[2], 10) }); return; }
    m = text.match(/击败对手时[，,]自身下回合开始时恢复最大体力的(\d+)\/(\d+)并使自身下次攻击后附加恢复量(\d+)%的百分比伤害/);
    if (m) { out.push({ kind: 'onKillHealNext', num: parseInt(m[1], 10), den: parseInt(m[2], 10), pct: parseInt(m[3], 10) }); return; }

    m = text.match(/若对手当前精灵未携带技能石则造成的攻击伤害提升(\d+)%/);
    if (m) { out.push({ kind: 'damageBuff', turns: 1, mul: 1 + parseInt(m[1], 10) / 100 }); return; }
    m = text.match(/(\d+)回合内若对手恢复体力则自身也恢复等量体力/);
    if (m) { out.push({ kind: 'mirrorHeal', turns: parseInt(m[1], 10), num: 1, den: 1 }); return; }

    // —— 第十九批 ——

    m = text.match(/令对手下(\d+)次使用的技能PP值归零/);
    if (m) { out.push({ kind: 'ppZeroTimes', turns: parseInt(m[1], 10) }); return; }
    m = text.match(/若自身处于异常状态则造成的攻击伤害额外提升(\d+)%且回合结束后解除自身所有异常状态/);
    if (m) { out.push({ kind: 'power', cond: 'selfAnyStatus', mul: 1 + parseInt(m[1], 10) / 100 }); out.push({ kind: 'endClearStatus' }); return; }
    m = text.match(/(\d+)回合内若对手恢复体力则自身也恢复等量体力的(\d+)\/(\d+)倍/);
    if (m) { out.push({ kind: 'mirrorHeal', turns: parseInt(m[1], 10), num: parseInt(m[2], 10), den: parseInt(m[3], 10) }); return; }
    m = text.match(/(\d+)回合内若对手造成的伤害低于(\d+)则免疫该伤害/);
    if (m) { out.push({ kind: 'immuneBelow', turns: parseInt(m[1], 10), value: parseInt(m[2], 10) }); return; }
    m = text.match(/当回合未击败对手则使自身下回合受到的伤害降低(\d+)%/);
    if (m) { out.push({ kind: 'guard', turns: 1, mul: 1 - parseInt(m[1], 10) / 100, scope: 'all', needAlive: true }); return; }
    m = text.match(/下(\d+)次受到的攻击伤害减少(\d+)%/);
    if (m) { out.push({ kind: 'nextGuard', times: parseInt(m[1], 10), pct: parseInt(m[2], 10) }); return; }
    m = text.match(/后出手时令对手当回合使用的技能的PP值额外-(\d+)/);
    if (m) { out.push({ kind: 'ppExtra', amount: parseInt(m[1], 10), cond: 'last' }); return; }
    m = text.match(/吸取对手(\d+)点体力[，,]对手≥(\d+)项技能PP值为零时额外吸取(\d+)点体力/);
    if (m) { out.push({ kind: 'drainFlat', value: parseInt(m[1], 10), bonusIfPpZero: { count: parseInt(m[2], 10), value: parseInt(m[3], 10) } }); return; }
    m = text.match(/(\d+)%的概率造成伤害翻倍[，,]对手不处于异常状态时概率翻倍/);
    if (m) { out.push({ kind: 'powerChance', chance: parseInt(m[1], 10), mul: 2, noStatusDouble: true }); return; }
    m = text.match(/(\d+)回合做(\d+)-(\d+)次攻击[，,]自身体力低于对手时连击上限为(\d+)/);
    if (m) { out.push({ kind: 'multiHitLowerHp', min: parseInt(m[2], 10), max: parseInt(m[3], 10), lowMax: parseInt(m[4], 10) }); return; }
    m = text.match(/造成的攻击伤害提升(\d+)%[，,]若未击败对手则对手回合结束后其恢复最大体力的(\d+)\/(\d+)/);
    if (m) { out.push({ kind: 'damageBuff', turns: 1, mul: 1 + parseInt(m[1], 10) / 100 }); out.push({ kind: 'foeHealEnd', num: parseInt(m[2], 10), den: parseInt(m[3], 10), needAlive: true }); return; }

    // —— 第十八批 ——

    if (/自身天赋值越高则技能威力越大/.test(text)) { out.push({ kind: 'powerByStat', stat: 'talent', pct: 0.5 }); return; }
    if (/惩罚[，,]对方能力等级越高[，,]此技能威力越大/.test(text)) { out.push({ kind: 'powerPerFoeStage' }); return; }
    m = text.match(/(\d+)回合内若自身处于异常状态则受到伤害减少(\d+)点/);
    if (m) { out.push({ kind: 'damageFlat', turns: parseInt(m[1], 10), value: parseInt(m[2], 10), req: { type: 'selfAnyStatus' } }); return; }
    m = text.match(/命中后(\d+)%令对手瘫痪/);
    if (m) { out.push({ kind: 'status', statusId: 'paralyze', chance: parseInt(m[1], 10), turns: 1 }); return; }
    if (/^解除自身能力下降状态[，,]?\s*(?:解除成功则)?消除对手回合类效果/.test(text)) {
      out.push({ kind: 'clear', target: 'self', which: 'negative' });
      out.push({ kind: 'clearFoe', req: { type: 'clearSuccess' } });
      return;
    }
    m = text.match(/若自身生命值低于(\d+)\/(\d+)则从下回合开始必定致命一击/);
    if (m) { out.push({ kind: 'critBuff', turns: 2, req: { type: 'selfHpRatioBelow', threshold: parseInt(m[1], 10) / parseInt(m[2], 10) } }); return; }
    m = text.match(/自身满体力时(\d+)%令对手随机(\d+)个技能PP值归零/);
    if (m) { out.push({ kind: 'ppZero', count: parseInt(m[2], 10), chance: parseInt(m[1], 10), req: { type: 'fullHp' } }); return; }
    m = text.match(/使对手和自身同时降低(\d+)\/(\d+)最大体力/);
    if (m) { out.push({ kind: 'bothMaxHpDown', pct: 100 * parseInt(m[1], 10) / parseInt(m[2], 10) }); return; }
    m = text.match(/若对手处于能力下降状态则造成伤害的(\d+)%恢复体力/);
    if (m) { out.push({ kind: 'drainOnHit', num: parseInt(m[1], 10), den: 100, req: { type: 'targetStatDown' } }); return; }
    m = text.match(/对手基础速度值高于(\d+)则自身下回合先制\+(\d+)/);
    if (m) { out.push({ kind: 'priorityIfFoeSpeed', threshold: parseInt(m[1], 10), value: parseInt(m[2], 10) }); return; }
    m = text.match(/自身体力高于(\d+)\/(\d+)时[，,]附加自身当前体力(\d+)%的百分比伤害/);
    if (m) { out.push({ kind: 'flatByCurHp', pct: parseInt(m[3], 10), req: { type: 'selfHpRatioOver', threshold: parseInt(m[1], 10) / parseInt(m[2], 10) } }); return; }
    m = text.match(/(\d+)回合内若对手使用攻击技能降低对手最大体力的(\d+)\/(\d+)/);
    if (m) { out.push({ kind: 'onHitMaxHpDown', turns: parseInt(m[1], 10), num: parseInt(m[2], 10), den: parseInt(m[3], 10) }); return; }
    m = text.match(/(\d+)%概率令对手增加一层衰弱/);
    if (m) { out.push({ kind: 'stat', target: 'foe', stat: 'spd', stages: -1, chance: parseInt(m[1], 10) }); return; }
    m = text.match(/对手不处于能力下降状态则使对手随机(\d+)项能力值-(\d+)/);
    if (m) { out.push({ kind: 'randomStatDown', count: parseInt(m[1], 10), stages: parseInt(m[2], 10), req: { type: 'targetStatNotDown' } }); return; }
    if (/自身存在护罩则造成的攻击伤害翻倍/.test(text)) { out.push({ kind: 'power', cond: 'selfHasShield', mul: 2 }); return; }

    // —— 第十七批 ——

    m = text.match(/若自身同时不存在回合类效果与能力提升状态则(\d+)%随机附加(\d+)种控制类异常状态/);
    if (m) { out.push({ kind: 'randomStatus', count: parseInt(m[2], 10), chance: parseInt(m[1], 10), req: { type: 'selfStatNotUp' } }); return; }
    m = text.match(/对手处于任意异常状态时造成的伤害将全额恢复体力/);
    if (m) { out.push({ kind: 'drainOnHit', num: 1, den: 1, req: { type: 'targetAnyStatus' } }); return; }
    m = text.match(/附加自身当前体力(?:值)?(\d+)%的百分比伤害[，,](?:连续使用)?每次(?:使用)?增加(\d+)%[，,]最高(\d+)%/);
    if (m) { out.push({ kind: 'flatByCurHp', pct: parseInt(m[1], 10), inc: parseInt(m[2], 10), cap: parseInt(m[3], 10) }); return; }
    m = text.match(/若对手处于能力提升状态则对方命中等级-(\d+)/);
    if (m) { out.push({ kind: 'stat', target: 'foe', stat: 'acc', stages: -parseInt(m[1], 10), chance: 100, req: { type: 'targetStatUp' } }); return; }
    m = text.match(/后出手时附加自身当前体力(\d+)%的百分比伤害/);
    if (m) { out.push({ kind: 'flatByCurHp', pct: parseInt(m[1], 10), cond: 'last' }); return; }
    m = text.match(/反转对手能力提升状态[，,]反转成功则(\d+)%令对手随机(\d+)个技能PP值归零/);
    if (m) { out.push({ kind: 'invertToFoe' }); out.push({ kind: 'ppZero', count: parseInt(m[2], 10), chance: parseInt(m[1], 10), req: { type: 'clearSuccess' } }); return; }
    m = text.match(/遇到天敌时(\d+)%令对手感染/);
    if (m) { out.push({ kind: 'status', statusId: 'poison', chance: parseInt(m[1], 10), turns: 1, req: { type: 'disadvantage' } }); return; }
    m = text.match(/^附加(\d+)点真实伤害/);
    if (m) { out.push({ kind: 'flat', value: parseInt(m[1], 10) }); return; }
    m = text.match(/对手不处于能力提升时令对手所有技能PP值-(\d+)/);
    if (m) { out.push({ kind: 'ppDrain', chance: 100, amount: parseInt(m[1], 10), req: { type: 'targetStatNotUp' } }); return; }
    m = text.match(/吸取对手(\d+)点固定体力[，,]自身体力低于(\d+)\/(\d+)时吸取效果翻倍/);
    if (m) { out.push({ kind: 'drainFlat', value: parseInt(m[1], 10), selfBelow: parseInt(m[2], 10) / parseInt(m[3], 10) }); return; }
    m = text.match(/自身速度能力每提升(\d+)段[，,]则回合结束时减少对手(\d+)\/(\d+)最大体力/);
    if (m) { out.push({ kind: 'endDamagePerSpeed', per: parseInt(m[1], 10), num: parseInt(m[2], 10), den: parseInt(m[3], 10) }); return; }
    m = text.match(/(\d+)回合内若对手使用属性技能[，,]则使用属性技能后的下(\d+)回合攻击技能无法造成伤害且命中效果失效/);
    if (m) { out.push({ kind: 'punishStatusSkill', turns: parseInt(m[1], 10), punishTurns: parseInt(m[2], 10) }); return; }

    // —— 第十六批 ——

    m = text.match(/消除对手所有护盾效果[，,]消除成功则为自身附加等量的护盾值/);
    if (m) { out.push({ kind: 'stealShield' }); return; }
    m = text.match(/(\d+)回合内免疫并反弹所有受到的控制类异常状态/);
    if (m) { out.push({ kind: 'immuneReflectStatus', turns: parseInt(m[1], 10) }); return; }
    m = text.match(/对手处于能力下降状态时自身先制\+(\d+)/);
    if (m) { out.push({ kind: 'priorityBuff', turns: 1, value: parseInt(m[1], 10), req: { type: 'targetStatDown' } }); return; }
    m = text.match(/造成的伤害不足(\d+)则自身下(\d+)次造成的伤害提升(\d+)%/);
    if (m) { out.push({ kind: 'damageBuff', turns: parseInt(m[2], 10), mul: 1 + parseInt(m[3], 10) / 100, req: { type: 'damageUnder', value: parseInt(m[1], 10) } }); return; }
    m = text.match(/消除对手能力上升状态[，,]消除成功下(\d+)回合必定暴击/);
    if (m) { out.push({ kind: 'clear', target: 'foe', which: 'positive' }); out.push({ kind: 'critBuff', turns: parseInt(m[1], 10), req: { type: 'clearSuccess' } }); return; }
    m = text.match(/造成伤害低于(\d+)[，,]则下(\d+)回合必定暴击/);
    if (m) { out.push({ kind: 'critBuff', turns: parseInt(m[2], 10), req: { type: 'damageUnder', value: parseInt(m[1], 10) } }); return; }
    m = text.match(/自身处于能力下降状态时恢复全部体力/);
    if (m) { out.push({ kind: 'heal', num: 1, den: 1, req: { type: 'selfStatDown' } }); return; }
    m = text.match(/先出手时(\d+)回合内不受能力下降技能影响/);
    if (m) { out.push({ kind: 'immuneStat', turns: parseInt(m[1], 10), req: { type: 'first' } }); return; }
    m = text.match(/命中后使对手受到(\d+)点固定伤害[，,]未命中则自身死亡/);
    if (m) { out.push({ kind: 'flat', value: parseInt(m[1], 10) }); out.push({ kind: 'selfKoOnMiss' }); return; }
    m = text.match(/(\d+)%令对手失明[，,]每次使用概率增加(\d+)%[，,]最高概率(\d+)%/);
    if (m) { out.push({ kind: 'statusRamp', statusId: 'blind', base: parseInt(m[1], 10), inc: parseInt(m[2], 10), cap: parseInt(m[3], 10) }); return; }
    m = text.match(/当回合击败对手则下回合自身攻击先制\+(\d+)/);
    if (m) { out.push({ kind: 'onKillPriority', value: parseInt(m[1], 10) }); return; }
    m = text.match(/使自身下次受到的伤害减少n点[，,]n等于本回合自身造成的伤害/);
    if (m) { out.push({ kind: 'nextGuardByDealt' }); return; }
    m = text.match(/造成的伤害高于(\d+)则获得(\d+)点护盾/);
    if (m) { out.push({ kind: 'shield', value: parseInt(m[2], 10), req: { type: 'damageOver', value: parseInt(m[1], 10) } }); return; }
    m = text.match(/造成的攻击伤害若高于(\d+)则自身免疫下(\d+)次受到的异常状态/);
    if (m) { out.push({ kind: 'immuneStatus', turns: parseInt(m[2], 10), req: { type: 'damageOver', value: parseInt(m[1], 10) } }); return; }
    m = text.match(/(\d+)%的概率造成(\d+)倍伤害[，,]每次使用概率增加(\d+)%[，,]最高概率(\d+)%/);
    if (m) { out.push({ kind: 'powerChanceRamp', base: parseInt(m[1], 10), mul: parseInt(m[2], 10), inc: parseInt(m[3], 10), cap: parseInt(m[4], 10) }); return; }
    m = text.match(/威力随机[，,]随机范围(\d+)-(\d+)[，,]连续使用每次威力提升(\d+)[，,]最高提升至(\d+)/);
    if (m) { out.push({ kind: 'powerRandomRamp', min: parseInt(m[1], 10), max: parseInt(m[2], 10), inc: parseInt(m[3], 10), cap: parseInt(m[4], 10) }); return; }
    m = text.match(/下(\d+)回合对手使用体力药剂时效果变成减少相应的体力/);
    if (m) { out.push({ kind: 'itemFlip', turns: parseInt(m[1], 10) }); return; }
    m = text.match(/使用后在战斗结束时可以获得(\d+)赛尔豆/);
    if (m) { out.push({ kind: 'cosmetic', note: '赛尔豆' }); return; }

    // —— 第十五批 ——

    m = text.match(/先出手时本回合自身下次死亡时恢复全部体力并解除自身的异常状态和能力下降状态/);
    if (m) { out.push({ kind: 'reviveOnce', turns: 1 }); return; }
    if (/将自身相应的能力提升赋予给对手相应的能力下降/.test(text)) { out.push({ kind: 'giveStatsAsDebuff' }); return; }
    m = text.match(/击败对手则令对手下(\d+)次使用的属性技能无效/);
    if (m) { out.push({ kind: 'onKillSkillBlock', times: parseInt(m[1], 10) }); return; }
    m = text.match(/(\d+)回合内有(\d+)%的概率免疫对手攻击技能造成的伤害并直接扣除对手等量体力/);
    if (m) { out.push({ kind: 'chanceImmuneReflect', turns: parseInt(m[1], 10), chance: parseInt(m[2], 10) }); return; }
    m = text.match(/(\d+)回合内将对手的攻击、特攻能力降为(\d+)点/);
    if (m) { out.push({ kind: 'foeStatSet', turns: parseInt(m[1], 10), value: parseInt(m[2], 10) }); return; }
    m = text.match(/(\d+)回合内所有直接攻击都将降低对手(\d+)\/(\d+)的HP/);
    if (m) { out.push({ kind: 'onHitPercentHp', turns: parseInt(m[1], 10), num: parseInt(m[2], 10), den: parseInt(m[3], 10) }); return; }
    m = text.match(/下(\d+)回合受到致命伤害时残留(\d+)点体力/);
    if (m) { out.push({ kind: 'survive', turns: parseInt(m[1], 10), hp: parseInt(m[2], 10) }); return; }
    m = text.match(/若自身先出手[，,]?则本回合对手释放的属性技能失效/);
    if (m) { out.push({ kind: 'firstSkillNullify' }); return; }
    m = text.match(/令自身下(\d+)次受到的攻击伤害转化为体力/);
    if (m) { out.push({ kind: 'convertTaken', turns: parseInt(m[1], 10) }); return; }
    m = text.match(/消除对手所有护盾、护罩效果[，,]并附加等同于消除护盾、护罩值总和(\d+)%的百分比伤害/);
    if (m) { out.push({ kind: 'clearShieldFlat', pct: parseInt(m[1], 10) }); return; }
    m = text.match(/双方下(\d+)回合无法主动切换精灵/);
    if (m) { out.push({ kind: 'blockSwitchBoth', turns: parseInt(m[1], 10) }); return; }
    m = text.match(/减少对手体力上限的(\d+)\/(\d+)/);
    if (m) { out.push({ kind: 'maxHpDownPct', pct: 100 * parseInt(m[1], 10) / parseInt(m[2], 10) }); return; }
    m = text.match(/(\d+)回合内受到攻击(\d+)%恢复(\d+)\/(\d+)体力/);
    if (m) { out.push({ kind: 'onHitHealChance', turns: parseInt(m[1], 10), chance: parseInt(m[2], 10), num: parseInt(m[3], 10), den: parseInt(m[4], 10) }); return; }

    // —— 第十四批 ——

    m = text.match(/(\d+)回合内自身造成的伤害为(\d+)倍/);
    if (m) { out.push({ kind: 'damageBuff', turns: parseInt(m[1], 10), mul: parseInt(m[2], 10) }); return; }
    m = text.match(/(\d+)回合内每次造成伤害的(\d+)\/(\d+)会恢复自己的HP/);
    if (m) { out.push({ kind: 'drainTurns', turns: parseInt(m[1], 10), num: parseInt(m[2], 10), den: parseInt(m[3], 10) }); return; }
    m = text.match(/(\d+)合内自身所有攻击造成的伤害都将为自己恢复体力/);
    if (m) { out.push({ kind: 'drainTurns', turns: parseInt(m[1], 10), num: 1, den: 1 }); return; }
    m = text.match(/(\d+)%概率对方减血(\d+)\/(\d+)[，,](\d+)%概率自己减血(\d+)\/(\d+)/);
    if (m) { out.push({ kind: 'randomSelfOrFoe', foePct: parseInt(m[1], 10), foeNum: parseInt(m[2], 10), foeDen: parseInt(m[3], 10), selfPct: parseInt(m[4], 10), selfNum: parseInt(m[5], 10), selfDen: parseInt(m[6], 10) }); return; }
    m = text.match(/先出手时[，,]?(\d+)回合自己不会受到对手攻击性技能伤害并反弹对手造成伤害的(\d+)\/(\d+)/);
    if (m) { out.push({ kind: 'immuneAndReflect', turns: parseInt(m[1], 10), num: parseInt(m[2], 10), den: parseInt(m[3], 10) }); return; }
    m = text.match(/(\d+)回合内使得对手所有能力增强效果失效/);
    if (m) { out.push({ kind: 'disableFoeBuffs', turns: parseInt(m[1], 10) }); return; }
    m = text.match(/(\d+)回合内若对手MISS则自身恢复(\d+)\/(\d+)的最大体力值/);
    if (m) { out.push({ kind: 'healOnFoeMiss', turns: parseInt(m[1], 10), num: parseInt(m[2], 10), den: parseInt(m[3], 10) }); return; }
    m = text.match(/(\d+)%概率令对手在(\d+)回合内每回合受到(\d+)点固定伤害/);
    if (m) { out.push({ kind: 'dot', turns: parseInt(m[2], 10), value: parseInt(m[3], 10), chance: parseInt(m[1], 10) }); return; }
    m = text.match(/复制对手攻击、防御、特攻、特防、速度、命中的能力提升状态/);
    if (m) { out.push({ kind: 'stealPositive' }); return; }
    m = text.match(/(\d+)%概率使对手陷入冰封状态(\d+)回合/);
    if (m) { out.push({ kind: 'status', statusId: 'frost', chance: parseInt(m[1], 10), turns: parseInt(m[2], 10) }); return; }
    m = text.match(/下(\d+)回合每回合使用攻击技能附加自身防御、特防值总和(\d+)%的百分比伤害/);
    if (m) { out.push({ kind: 'perTurnFlatByStats', turns: parseInt(m[1], 10), pct: parseInt(m[2], 10) }); return; }
    m = text.match(/下(\d+)回合[，,]?每回合都使对手的先制-(\d+)/);
    if (m) { out.push({ kind: 'perTurnPriorityDown', turns: parseInt(m[1], 10), value: parseInt(m[2], 10) }); return; }
    m = text.match(/(\d+)回合内(\d+)%令对手使用的属性技能无效/);
    if (m) { out.push({ kind: 'skillBlockChance', turns: parseInt(m[1], 10), chance: parseInt(m[2], 10) }); return; }
    m = text.match(/(\d+)回合内自身受到的固定伤害和百分比伤害减少(\d+)%/);
    if (m) { out.push({ kind: 'takenTurns', turns: parseInt(m[1], 10), pct: parseInt(m[2], 10) }); return; }
    m = text.match(/(\d+)回合内对雄性精灵的伤害为(\d+)倍/);
    if (m) { out.push({ kind: 'damageBuff', turns: parseInt(m[1], 10), mul: parseInt(m[2], 10) }); return; }

    // —— 第十三批 ——

    m = text.match(/^吸取对手能力提升[，,]?\s*(?:吸取成功则)?下(\d+)次受到的攻击伤害减少(\d+)%/);
    if (m) { out.push({ kind: 'stealPositive' }); out.push({ kind: 'nextGuard', times: parseInt(m[1], 10), pct: parseInt(m[2], 10), req: { type: 'clearSuccess' } }); return; }
    m = text.match(/若自身满体力则附加自身最大体力(\d+)\/(\d+)的百分比伤害/);
    if (m) { out.push({ kind: 'flatByMaxHp', pct: 100 * parseInt(m[1], 10) / parseInt(m[2], 10), req: { type: 'fullHp' } }); return; }
    m = text.match(/(\d+)%的概率造成伤害翻倍[，,]自身处于护盾状态时概率翻倍/);
    if (m) { out.push({ kind: 'powerChance', chance: parseInt(m[1], 10), mul: 2, shieldDouble: true }); return; }
    m = text.match(/未击败对手则下回合造成的伤害提升(\d+)%/);
    if (m) { out.push({ kind: 'damageBuff', turns: 1, mul: 1 + parseInt(m[1], 10) / 100, needAlive: true }); return; }
    m = text.match(/(\d+)回合内每回合结束时使对手随机(\d+)个技能PP归零/);
    if (m) { out.push({ kind: 'perTurnPpZero', turns: parseInt(m[1], 10), count: parseInt(m[2], 10) }); return; }
    m = text.match(/自身不处于能力提升状态则吸取对手(\d+)点体力[，,]若先出手则额外吸取(\d+)点体力/);
    if (m) { out.push({ kind: 'drainFlat', value: parseInt(m[1], 10), bonusIfFirst: parseInt(m[2], 10), req: { type: 'selfStatNotUp' } }); return; }
    m = text.match(/下(\d+)回合对手打出致命一击的非必中技能无效/);
    if (m) { out.push({ kind: 'blockCrit', turns: parseInt(m[1], 10) }); return; }
    if (/^解除自身能力下降状态[，,]?\s*(?:解除成功则)?使对手随机(\d+)个技能PP值归零/.test(text)) {
      out.push({ kind: 'clear', target: 'self', which: 'negative' });
      var mp2 = text.match(/使对手随机(\d+)个技能PP值归零/);
      out.push({ kind: 'ppZero', count: parseInt(mp2[1], 10), req: { type: 'clearSuccess' } });
      return;
    }
    m = text.match(/未击败对手时[，,]下(\d+)回合自身技能先制\+(\d+)/);
    if (m) { out.push({ kind: 'priorityBuff', turns: parseInt(m[1], 10), value: parseInt(m[2], 10), needAlive: true }); return; }
    m = text.match(/消除双方能力上升、下降状态[，,]消除成功则附加消除总段数乘以(\d+)的固定伤害/);
    if (m) { out.push({ kind: 'clearBothThenFlat', value: parseInt(m[1], 10) }); return; }
    m = text.match(/出手时若自身未满体力则吸取对手(\d+)点体力/);
    if (m) { out.push({ kind: 'drainFlat', value: parseInt(m[1], 10), req: { type: 'notFullHp' } }); return; }
    m = text.match(/击败对手则对手下只出场精灵(\d+)回合内先制-(\d+)/);
    if (m) { out.push({ kind: 'onKillNextPriorityDown', turns: parseInt(m[1], 10), value: parseInt(m[2], 10) }); return; }
    m = text.match(/若对手处于能力提升状态则先制\+(\d+)且必定命中/);
    if (m) { out.push({ kind: 'priorityBuff', turns: 1, value: parseInt(m[1], 10), req: { type: 'targetStatUp' } }); out.push({ kind: 'mustHit', turns: 1 }); return; }
    if (/消除对手护盾、护罩类效果/.test(text)) { out.push({ kind: 'clearShield' }); return; }
    m = text.match(/(\d+)回合自身的攻击力和对手相同/);
    if (m) { out.push({ kind: 'copyAtk', turns: parseInt(m[1], 10) }); return; }
    m = text.match(/(\d+)回合吸取对方最大体力的(\d+)\/(\d+)/);
    if (m) { out.push({ kind: 'drainMax', num: parseInt(m[2], 10), den: parseInt(m[3], 10), turns: parseInt(m[1], 10) }); return; }

    // —— 第十二批 ——

    m = text.match(/若对手处于能力提升状态则造成的攻击伤害额外提升(\d+)%/);
    if (m) { out.push({ kind: 'power', cond: 'targetStatUp', mul: 1 + parseInt(m[1], 10) / 100 }); return; }
    if (/自身体力越少则威力越大/.test(text)) { out.push({ kind: 'powerLowHp' }); return; }
    m = text.match(/若自身处于能力提升状态[，,]则每次攻击恢复自身体力的(\d+)\/(\d+)/);
    if (m) { out.push({ kind: 'drainOnHit', num: parseInt(m[1], 10), den: parseInt(m[2], 10), req: { type: 'selfStatUp' } }); return; }
    if (/击败对手则自身能力提升等级翻倍/.test(text)) { out.push({ kind: 'doubleStagesOnKill' }); return; }
    if (/^击败对手时若自身处于能力提升状态/.test(text) && /翻倍/.test(text)) { out.push({ kind: 'doubleStagesOnKill' }); return; }
    m = text.match(/若对手处于异常状态[，,]则(\d+)%自身速度等级\+(\d+)/);
    if (m) { out.push({ kind: 'stat', target: 'self', stat: 'spd', stages: parseInt(m[2], 10), chance: parseInt(m[1], 10), req: { type: 'targetAnyStatus' } }); return; }
    m = text.match(/反转自身能力下降[，,]反转成功则自身下(\d+)回合免疫攻击伤害/);
    if (m) { out.push({ kind: 'invertThenImmune', turns: parseInt(m[1], 10) }); return; }
    m = text.match(/本回合打出致命一击则令对手(\d+)回合属性技能无效/);
    if (m) { out.push({ kind: 'critThenSkillBlock', turns: parseInt(m[1], 10) }); return; }
    m = text.match(/未击败对手则下回合自身所有技能先制\+(\d+)/);
    if (m) { out.push({ kind: 'priorityBuff', turns: 1, value: parseInt(m[1], 10) }); return; }
    m = text.match(/遇到天敌时附加(\d+)点真实伤害/);
    if (m) { out.push({ kind: 'flat', value: parseInt(m[1], 10), req: { type: 'disadvantage' } }); return; }
    m = text.match(/每次攻击提升(\d+)%的致命概率[，,]最高提升(\d+)%/);
    if (m) { out.push({ kind: 'critRamp', base: parseInt(m[1], 10), inc: parseInt(m[1], 10), cap: parseInt(m[2], 10) }); return; }
    m = text.match(/若对手处于能力下降状态则(\d+)%概率冰封/);
    if (m) { out.push({ kind: 'status', statusId: 'frost', chance: parseInt(m[1], 10), turns: 1, req: { type: 'targetStatDown' } }); return; }
    m = text.match(/出手时若自身未满体力则下回合自身受到的攻击伤害减少(\d+)%/);
    if (m) { out.push({ kind: 'guard', turns: 1, mul: 1 - parseInt(m[1], 10) / 100, scope: 'all', req: { type: 'notFullHp' } }); return; }

    // —— 第十一批 ——
    m = text.match(/每次命中对手会降低对手下只出战精灵最大体力的(\d+)%[，,]最多降低(\d+)%/);
    if (m) { out.push({ kind: 'nextPetMaxHpDown', pct: parseInt(m[1], 10), cap: parseInt(m[2], 10) }); return; }
    m = text.match(/(\d+)回合内每回合使用技能吸取对手能力提升状态/);
    if (m) { out.push({ kind: 'perTurnSteal', turns: parseInt(m[1], 10) }); return; }
    m = text.match(/(\d+)回合内每回合使用技能则造成伤害前随机吸取对手(\d+)项能力值-(\d+)/);
    if (m) { out.push({ kind: 'perTurnStealStats', turns: parseInt(m[1], 10), count: parseInt(m[2], 10), stages: parseInt(m[3], 10) }); return; }
    m = text.match(/自身主动切换下场后令己方下只精灵出战时获得(\d+)点护罩/);
    if (m) { out.push({ kind: 'switchOutShield', value: parseInt(m[1], 10) }); return; }
    m = text.match(/(\d+)回合内免疫受到的致命一击伤害并直接扣除对手等量体力/);
    if (m) { out.push({ kind: 'immuneCritReflect', turns: parseInt(m[1], 10) }); return; }
    m = text.match(/(\d+)回合内每回合使用技能恢复自身最大体力的(\d+)\/(\d+)/);
    if (m) { out.push({ kind: 'useHeal', turns: parseInt(m[1], 10), num: parseInt(m[2], 10), den: parseInt(m[3], 10) }); return; }
    m = text.match(/将自身的能力下降状态(\d+)倍返还给对手/);
    if (m) { out.push({ kind: 'returnStats', mult: parseInt(m[1], 10) }); return; }
    m = text.match(/附加自身防御、特防和速度总和(\d+)%的百分比伤害/);
    if (m) { out.push({ kind: 'flatByStats3', pct: parseInt(m[1], 10) }); return; }

    // —— 第十批 ——
    m = text.match(/(\d+)回合内对手的状态变化会同时作用在自己身上/);
    if (m) { out.push({ kind: 'mirrorStat', turns: parseInt(m[1], 10) }); return; }
    m = text.match(/(\d+)回合做(\d+)-(\d+)次攻击[，,]自身处于护盾状态下连击上限为(\d+)/);
    if (m) { out.push({ kind: 'multiHitShield', min: parseInt(m[2], 10), max: parseInt(m[3], 10), shieldMax: parseInt(m[4], 10) }); return; }
    m = text.match(/己方场下每存活一只[\u4e00-\u9fa5]{0,8}[，,]威力提升(\d+)点/);
    if (m) { out.push({ kind: 'powerPerBench', value: parseInt(m[1], 10) }); return; }
    m = text.match(/(\d+)回合自己使用([\u4e00-\u9fa5]{1,2})招式伤害[×x](\d+)/);
    if (m) { out.push({ kind: 'typePower', turns: parseInt(m[1], 10), typeName: m[2], mul: parseInt(m[3], 10) }); return; }
    m = text.match(/下(\d+)回合攻击忽略对手(\d+)%的双防值/);
    if (m) { out.push({ kind: 'ignoreDefPctTurns', turns: parseInt(m[1], 10), pct: parseInt(m[2], 10) }); return; }
    m = text.match(/若对手处于能力下降则使对手随机(\d+)个技能的PP归零/);
    if (m) { out.push({ kind: 'ppZero', count: parseInt(m[1], 10), req: { type: 'targetStatDown' } }); return; }
    m = text.match(/(\d+)回合内每回合随机恢复(\d+)-(\d+)点体力/);
    if (m) { out.push({ kind: 'regenRandom', turns: parseInt(m[1], 10), min: parseInt(m[2], 10), max: parseInt(m[3], 10) }); return; }
    m = text.match(/(\d+)回合内自身受到的攻击伤害额外减少(\d+)%/);
    if (m) { out.push({ kind: 'takenTurns', turns: parseInt(m[1], 10), pct: parseInt(m[2], 10) }); return; }
    m = text.match(/自身体力高于对手时附加自身最大体力值(\d+)%的百分比伤害/);
    if (m) { out.push({ kind: 'flatByMaxHp', pct: parseInt(m[1], 10), req: { type: 'selfHpHigher' } }); return; }
    m = text.match(/出手时本回合若未受到伤害则对手下(\d+)回合属性技能无效/);
    if (m) { out.push({ kind: 'skillBlock', turns: parseInt(m[1], 10), req: { type: 'damageUnder', value: 1 } }); return; }
    m = text.match(/未击败对手则使自身下(\d+)回合受到的伤害减少(\d+)点/);
    if (m) { out.push({ kind: 'damageFlat', turns: parseInt(m[1], 10), value: parseInt(m[2], 10) }); return; }
    m = text.match(/若后出手则附加自身最大体力(\d+)\/(\d+)的百分比伤害并恢复等量体力/);
    if (m) { out.push({ kind: 'flatDrainSelf', pct: 100 * parseInt(m[1], 10) / parseInt(m[2], 10), cond: 'last' }); return; }
    m = text.match(/反弹(\d+)倍的伤害给对手并使自身恢复等量体力/);
    if (m) { out.push({ kind: 'reflectNext', pct: parseInt(m[1], 10) * 100, healSelf: true }); return; }
    m = text.match(/造成的伤害低于(\d+)则吸取对手(\d+)\/(\d+)最大体力/);
    if (m) { out.push({ kind: 'drainMax', num: parseInt(m[2], 10), den: parseInt(m[3], 10), req: { type: 'damageUnder', value: parseInt(m[1], 10) } }); return; }
    m = text.match(/若自身体力小于(\d+)\/(\d+)[，,]?则每次攻击不消耗PP值/);
    if (m) { out.push({ kind: 'noPpCost', threshold: parseInt(m[1], 10) / parseInt(m[2], 10) }); return; }

    // —— 第九批 ——
    m = text.match(/(\d+)%概率受到自身最大体力(\d+)\/(\d+)的百分比伤害[，,]剩下(\d+)%概率附加自身最大体力(\d+)\/(\d+)的百分比伤害/);
    if (m) { out.push({ kind: 'randomSelfOrTarget', selfPct: parseInt(m[1], 10), selfNum: parseInt(m[2], 10), selfDen: parseInt(m[3], 10), foePct: parseInt(m[4], 10), foeNum: parseInt(m[5], 10), foeDen: parseInt(m[6], 10) }); return; }
    m = text.match(/随机恢复自身(\d+)-(\d+)点体力[，,]自身不处于能力提升状态时变为(\d+)-(\d+)点体力/);
    if (m) { out.push({ kind: 'healRandomCond', min: parseInt(m[1], 10), max: parseInt(m[2], 10), altMin: parseInt(m[3], 10), altMax: parseInt(m[4], 10) }); return; }
    m = text.match(/(\d+)%的概率威力(\d+)倍[，,]若未触发则下回合自身先制\+(\d+)/);
    if (m) { out.push({ kind: 'powerChance', chance: parseInt(m[1], 10), mul: parseInt(m[2], 10), fallbackPriority: parseInt(m[3], 10) }); return; }
    m = text.match(/附加自身防御和特防能力提升总段数x(\d+)的固定伤害/);
    if (m) { out.push({ kind: 'flatByDefStages', value: parseInt(m[1], 10) }); return; }
    m = text.match(/(\d+)回合内对手每回合(攻击|防御|特攻|特防|速度|命中|闪避)和(攻击|防御|特攻|特防|速度|命中|闪避)等级-(\d+)/);
    if (m) { out.push({ kind: 'perTurnStatDown2', turns: parseInt(m[1], 10), stats: [STAT_WORD[m[2]], STAT_WORD[m[3]]], stages: parseInt(m[4], 10) }); return; }
    m = text.match(/(\d+)回合内若受到攻击[，,]对手(攻击|防御|特攻|特防|速度|命中|闪避)等级-(\d+)[、,](攻击|防御|特攻|特防|速度|命中|闪避)等级-(\d+)/);
    if (m) { out.push({ kind: 'onHitMultiStatDown', turns: parseInt(m[1], 10), stats: [[STAT_WORD[m[2]], parseInt(m[3], 10)], [STAT_WORD[m[4]], parseInt(m[5], 10)]] }); return; }
    if (/与对手互换当前体力/.test(text)) { out.push({ kind: 'swapHp' }); return; }
    m = text.match(/当自身血量少于(\d+)\/(\d+)时先制\+(\d+)/);
    if (m) { out.push({ kind: 'priorityIfLow', threshold: parseInt(m[1], 10) / parseInt(m[2], 10), value: parseInt(m[3], 10) }); return; }
    m = text.match(/下回合受到致命伤害时残留(\d+)点体力/);
    if (m) { out.push({ kind: 'survive', turns: 1, hp: parseInt(m[1], 10) }); return; }
    m = text.match(/(\d+)%降低对手所有PP值?(\d+)点/);
    if (m) { out.push({ kind: 'ppDrain', chance: parseInt(m[1], 10), amount: parseInt(m[2], 10) }); return; }
    m = text.match(/(\d+)回合内若对手使用攻击技能则自身下(\d+)回合必定暴击/);
    if (m) { out.push({ kind: 'onHitCritBuff', turns: parseInt(m[1], 10), critTurns: parseInt(m[2], 10) }); return; }
    m = text.match(/若对手不是([\u4e00-\u9fa5]{1,2})系精灵则恢复自身(\d+)点体力/);
    if (m) { out.push({ kind: 'healFlat', value: parseInt(m[2], 10), req: { type: 'foeNotType', name: m[1] } }); return; }

    // —— 第八批 ——
    m = text.match(/(\d+)回合内每回合自身(攻击|防御|特攻|特防|速度|命中|闪避)和(攻击|防御|特攻|特防|速度|命中|闪避)(?:提高|提升)(\d+)个?等级/);
    if (m) { out.push({ kind: 'perTurnStatUp', turns: parseInt(m[1], 10), stats: [STAT_WORD[m[2]], STAT_WORD[m[3]]], stages: parseInt(m[4], 10) }); return; }
    m = text.match(/损失一半当前体力值[，,]自身(攻击|特攻)和(速度)(?:提升|提高)(\d+)个?等级/);
    if (m) { out.push({ kind: 'costHalfStats', stats: [STAT_WORD[m[1]], STAT_WORD[m[2]]], stages: parseInt(m[3], 10) }); return; }
    m = text.match(/损失(\d+)\/(\d+)的体力[，,]给予对手同等的伤害/);
    if (m) {
      out.push({ kind: 'selfCostDamage', costPct: parseInt(m[1], 10) / parseInt(m[2], 10), equalDamage: true });
      return;
    }
    m = text.match(/出手时对手体力低于最大体力的(\d+)\/(\d+)则造成的伤害提升(\d+)%/);
    if (m) { out.push({ kind: 'power', cond: 'targetHpRatioBelow', threshold: parseInt(m[1], 10) / parseInt(m[2], 10), mul: 1 + parseInt(m[3], 10) / 100 }); return; }
    m = text.match(/若打出致命一击则自身免疫下(\d+)次受到的异常状态/);
    if (m) { out.push({ kind: 'immuneStatus', turns: parseInt(m[1], 10), req: { type: 'crit' } }); return; }
    m = text.match(/先出手时(\d+)回合内免疫并反弹异常状态/);
    if (m) { out.push({ kind: 'immuneReflectStatus', turns: parseInt(m[1], 10), req: { type: 'first' } }); return; }
    m = text.match(/(\d+)%随机附加(\d+)控制类异常状态/);
    if (m) { out.push({ kind: 'randomStatus', count: parseInt(m[2], 10), chance: parseInt(m[1], 10) }); return; }
    m = text.match(/自身体力低于对手时(\d+)%的概率打出致命一击/);
    if (m) { out.push({ kind: 'critIfLower', chance: parseInt(m[1], 10) }); return; }
    if (/将对手攻击和特攻中最高的能力值作为自己的能力值进行攻击/.test(text)) { out.push({ kind: 'useHighestStat' }); return; }
    m = text.match(/(\d+)回合内([\u4e00-\u9fa5]{1,2})系技能威力为([\d.]+)倍/);
    if (m) { out.push({ kind: 'typePower', turns: parseInt(m[1], 10), typeName: m[2], mul: parseFloat(m[3]) }); return; }
    m = text.match(/命中时[，,]?\s*(\d+)%的概率秒杀对方/);
    if (m) { out.push({ kind: 'execChance', value: parseInt(m[1], 10) }); return; }
    if (/^消除双方能力提升、下降状态/.test(text)) { out.push({ kind: 'clearBothBoth' }); return; }
    m = text.match(/(\d+)%令对手流血/);
    if (m) { out.push({ kind: 'status', statusId: 'bleed', chance: parseInt(m[1], 10), turns: 1 }); return; }

    // —— 第七批 ——
    m = text.match(/(\d+)回合内自身与对方反转战斗时属性/);
    if (m) { out.push({ kind: 'swapType', turns: parseInt(m[1], 10) }); return; }
    m = text.match(/(\d+)回合内使自身的属性和对方的属性相同/);
    if (m) { out.push({ kind: 'copyType', turns: parseInt(m[1], 10) }); return; }
    if (/^消除双方能力提升状态/.test(text)) {
      out.push({ kind: 'clearBoth' });
      var restBoth = text.replace(/^消除双方能力提升状态[，,]?\s*(?:消除任意一方成功则)?/, '').trim();
      if (restBoth && restBoth !== text) {
        var innerBoth = [];
        parseOneEffect(restBoth, innerBoth, 1);
        innerBoth.forEach(function (e) { e.req = { type: 'clearSuccess' }; });
        innerBoth.forEach(function (e) { out.push(e); });
      }
      return;
    }
    m = text.match(/(\d+)回合内若被对方击败[，,]?则对手所有能力加强状态消失/);
    if (m) { out.push({ kind: 'onDeathClearFoe', turns: parseInt(m[1], 10) }); return; }
    m = text.match(/(\d+)回合内每回合结束后反转对手能力提升状态/);
    if (m) { out.push({ kind: 'endInvertFoe', turns: parseInt(m[1], 10) }); return; }
    m = text.match(/若下回合受到攻击[，,]?则对手随机(\d+)项能力值-(\d+)/);
    if (m) { out.push({ kind: 'onHitRandomStatDown', count: parseInt(m[1], 10), stages: parseInt(m[2], 10) }); return; }
    m = text.match(/先出手时使对手(\d+)回合属性技能无效/);
    if (m) { out.push({ kind: 'skillBlock', turns: parseInt(m[1], 10), req: { type: 'first' } }); return; }
    m = text.match(/未击败对手则令自身下(\d+)次受到的攻击伤害额外减少(\d+)%/);
    if (m) { out.push({ kind: 'nextGuard', times: parseInt(m[1], 10), pct: parseInt(m[2], 10) }); return; }
    m = text.match(/击败对手则令对手下(\d+)次使用的攻击技能无效/);
    if (m) { out.push({ kind: 'onKillAttackBlock', times: parseInt(m[1], 10) }); return; }
    m = text.match(/吸取对手(\d+)点体力[，,]体力低于对手时吸取效果翻倍/);
    if (m) { out.push({ kind: 'drainFlat', value: parseInt(m[1], 10), doubleIfLower: true }); return; }
    m = text.match(/自身体力低于(\d+)时必定先手/);
    if (m) { out.push({ kind: 'priorityIfHpBelow', value: parseInt(m[1], 10) }); return; }
    m = text.match(/降低对方(\d+)点战斗时的最高HP/);
    if (m) { out.push({ kind: 'maxHpDown', value: parseInt(m[1], 10) }); return; }
    m = text.match(/(\d+)%恢复自身(\d+)\/(\d+)体力值/);
    if (m) { out.push({ kind: 'healChance', chance: parseInt(m[1], 10), num: parseInt(m[2], 10), den: parseInt(m[3], 10) }); return; }
    m = text.match(/若Miss则自己恢复(\d+)\/(\d+)体力/);
    if (m) { out.push({ kind: 'onMissHeal', num: parseInt(m[1], 10), den: parseInt(m[2], 10) }); return; }
    m = text.match(/若对手处于异常状态则回合结束时减少对手(\d+)\/(\d+)最大体力/);
    if (m) { out.push({ kind: 'endDamageIfStatus', num: parseInt(m[1], 10), den: parseInt(m[2], 10) }); return; }
    m = text.match(/附加防御、特防总和(\d+)%的百分比伤害/);
    if (m) { out.push({ kind: 'flatByStats', pct: parseInt(m[1], 10) }); return; }
    if (/增加致命一击的概率/.test(text)) { out.push({ kind: 'critBonus', value: 10 }); return; }
    m = text.match(/对手处于能力下降状态造成的伤害提升(\d+)%/);
    if (m) { out.push({ kind: 'power', cond: 'targetStatDown', mul: 1 + parseInt(m[1], 10) / 100 }); return; }

    // —— 第六批 ——
    m = text.match(/(\d+)回合后若对方没有将自己击败[，,]?则对方死亡/);
    if (m) { out.push({ kind: 'delayedKill', turns: parseInt(m[1], 10) }); return; }
    if (/后出手时将自身能力等级返回至上一回合结束时/.test(text)) { out.push({ kind: 'restoreStages' }); return; }
    m = text.match(/暴击率提升(\d+)%[，,]每次使用额外提升(\d+)%[，,]最高概率(\d+)%/);
    if (m) { out.push({ kind: 'critRamp', base: parseInt(m[1], 10), inc: parseInt(m[2], 10), cap: parseInt(m[3], 10) }); return; }
    if (/恢复自身n点体力（n=双方当前护盾值总和）/.test(text)) { out.push({ kind: 'healByShield' }); return; }
    m = text.match(/若上回合自身未受到攻击伤害则附加对手最大体力(\d+)\/(\d+)的百分比伤害/);
    if (m) { out.push({ kind: 'flatByTargetMax', pct: 100 * parseInt(m[1], 10) / parseInt(m[2], 10), req: { type: 'noDamageLast' } }); return; }
    m = text.match(/(\d+)回合内若被对手击败则对手损失(\d+)点体力/);
    if (m) { out.push({ kind: 'deathCurse', turns: parseInt(m[1], 10), value: parseInt(m[2], 10) }); return; }
    m = text.match(/体力低于最大体力的(\d+)\/(\d+)时先制\+(\d+)/);
    if (m) { out.push({ kind: 'priorityIfLow', threshold: parseInt(m[1], 10) / parseInt(m[2], 10), value: parseInt(m[3], 10) }); return; }
    m = text.match(/后出手时下回合攻击技能先制\+(\d+)/);
    if (m) { out.push({ kind: 'priorityBuff', turns: 1, value: parseInt(m[1], 10), cond: 'last' }); return; }
    m = text.match(/自身处于能力提升状态时造成的伤害提升(\d+)%[，,]先出手时效果翻倍/);
    if (m) { out.push({ kind: 'power', cond: 'selfStatUp', mul: 1 + parseInt(m[1], 10) / 100, doubleIfFirst: true }); return; }
    m = text.match(/(\d+)回合自身的防御力和对手相同/);
    if (m) { out.push({ kind: 'copyDef', turns: parseInt(m[1], 10) }); return; }
    m = text.match(/降低对方(\d+)\/(\d+)的hp/);
    if (m) { out.push({ kind: 'percentHp', num: parseInt(m[1], 10), den: parseInt(m[2], 10) }); return; }
    if (/若先出手[，,]则免疫当回合伤害并恢复/.test(text)) { out.push({ kind: 'oneHitIfFirst' }); return; }
    m = text.match(/(\d+)回合内每回合所受的伤害减少(\d+)/);
    if (m) { out.push({ kind: 'guardFlat', turns: parseInt(m[1], 10), value: parseInt(m[2], 10) }); return; }
    m = text.match(/出手时本回合若未受到伤害则对手下(\d+)回合先制-(\d+)/);
    if (m) { out.push({ kind: 'priorityDownNoDamage', turns: parseInt(m[1], 10), value: parseInt(m[2], 10) }); return; }

    // —— 第四批常见句式 ——
    m = text.match(/若未击败对手则下(\d+)回合攻击必定致命一击/);
    if (m) { out.push({ kind: 'critBuff', turns: parseInt(m[1], 10), needAlive: true }); return; }
    if (/无视对手能力提升状态/.test(text)) { out.push({ kind: 'ignoreDefUp' }); return; }
    m = text.match(/命中时[，,]?\s*(\d+)%概率令对手混乱/);
    if (m) { out.push({ kind: 'status', statusId: 'confuse', chance: parseInt(m[1], 10), turns: 1 }); return; }
    m = text.match(/下(\d+)回合令自身所有技能先制\+(\d+)/);
    if (m) { out.push({ kind: 'priorityBuff', turns: parseInt(m[1], 10), value: parseInt(m[2], 10) }); return; }
    m = text.match(/附加自身最大体力(\d+)%的百分比伤害/);
    if (m) { out.push({ kind: 'flatByMaxHp', pct: parseInt(m[1], 10) }); return; }
    m = text.match(/作用(\d+)~(\d+)回合[，,]每回合反弹对手(\d+)\/(\d+)的伤害/);
    if (m) { out.push({ kind: 'reflectDamage', turns: parseInt(m[2], 10), num: parseInt(m[3], 10), den: parseInt(m[4], 10) }); return; }
    m = text.match(/(\d+)%的概率恢复自身体力的(\d+)\/(\d+)/);
    if (m) { out.push({ kind: 'healChance', chance: parseInt(m[1], 10), num: parseInt(m[2], 10), den: parseInt(m[3], 10) }); return; }
    m = text.match(/若自身处于能力提升状态则造成的攻击伤害额外提升(\d+)%/);
    if (m) { out.push({ kind: 'power', cond: 'selfStatUp', mul: 1 + parseInt(m[1], 10) / 100 }); return; }
    m = text.match(/后出手时下回合受到的伤害降低(\d+)点/);
    if (m) { out.push({ kind: 'damageFlat', turns: 1, value: parseInt(m[1], 10), cond: 'last' }); return; }
    m = text.match(/先出手时对手当回合攻击技能无效/);
    if (m) { out.push({ kind: 'attackBlockFirst', turns: 1 }); return; }
    m = text.match(/若对手处于异常状态则恢复造成伤害的(\d+)%的体力/);
    if (m) { out.push({ kind: 'drainIfStatus', pct: parseInt(m[1], 10) }); return; }
    m = text.match(/自身体力低于对手时造成的伤害提高(\d+)%/);
    if (m) { out.push({ kind: 'power', cond: 'selfHpLower', mul: 1 + parseInt(m[1], 10) / 100 }); return; }
    m = text.match(/附加自身防御、特防总和(\d+)%的百分比伤害/);
    if (m) { out.push({ kind: 'flatByStats', pct: parseInt(m[1], 10) }); return; }

    // —— 第三批常见句式 ——
    m = text.match(/(\d+)回合内受到致死攻击时则余下(\d+)点体力/);
    if (m) { out.push({ kind: 'survive', turns: parseInt(m[1], 10), hp: parseInt(m[2], 10) }); return; }
    m = text.match(/(\d+)回合内每回合被攻击所受到的伤害不超过(\d+)/);
    if (m) { out.push({ kind: 'damageCap', turns: parseInt(m[1], 10), value: parseInt(m[2], 10) }); return; }
    m = text.match(/附加所造成伤害值(\d+)%的固定伤害/);
    if (m) { out.push({ kind: 'flatByDealt', pct: parseInt(m[1], 10) }); return; }
    m = text.match(/附加对手已损失(?:生命值|体力)(\d+)%的百分比伤害/);
    if (m) { out.push({ kind: 'flatByTargetLost', pct: parseInt(m[1], 10) }); return; }
    if (/使对手的能力提升效果转化到自己身上/.test(text)) { out.push({ kind: 'stealPositive' }); return; }
    m = text.match(/随机使自己(\d+)项能力\+(\d+)/);
    if (m) { out.push({ kind: 'randomStatUp', count: parseInt(m[1], 10), stages: parseInt(m[2], 10) }); return; }
    m = text.match(/攻击时忽略对手(\d+)%的防御值/);
    if (m) { out.push({ kind: 'ignoreDefPct', pct: parseInt(m[1], 10) }); return; }
    m = text.match(/先出手时降低对手所有PP(\d+)点/);
    if (m) { out.push({ kind: 'ppDrainFirst', value: parseInt(m[1], 10) }); return; }
    m = text.match(/可以抵挡(\d+)点伤害/);
    if (m) { out.push({ kind: 'shield', value: parseInt(m[1], 10) }); return; }
    m = text.match(/(\d+)回合内每回合(\d+)%闪避对手(?:的)?攻击/);
    if (m) { out.push({ kind: 'dodge', turns: parseInt(m[1], 10), chance: parseInt(m[2], 10) }); return; }
    m = text.match(/使用后(\d+)回合攻击击中对象要害概率增加(\d+)\/(\d+)/);
    if (m) { out.push({ kind: 'critBonusTurns', turns: parseInt(m[1], 10), add: 100 * parseInt(m[2], 10) / parseInt(m[3], 10) }); return; }
    m = text.match(/(\d+)回合内致命一击率上升(\d+)\/(\d+)/);
    if (m) { out.push({ kind: 'critBonusTurns', turns: parseInt(m[1], 10), add: 100 * parseInt(m[2], 10) / parseInt(m[3], 10) }); return; }
    m = text.match(/(\d+)回合内对手恢复体力时恢复效果减少(\d+)%/);
    if (m) { out.push({ kind: 'healDown', turns: parseInt(m[1], 10), pct: parseInt(m[2], 10) }); return; }
    m = text.match(/随机附加(\d+)种异常状态/);
    if (m) { out.push({ kind: 'randomStatus', count: parseInt(m[1], 10) }); return; }
    m = text.match(/(\d+)%概率先制\+(\d+)/);
    if (m) { out.push({ kind: 'priorityChance', chance: parseInt(m[1], 10), value: parseInt(m[2], 10) }); return; }
    if (/遇到天敌时先制\+\d+/.test(text)) { out.push({ kind: 'priorityAlways', value: parseInt(/先制\+(\d+)/.exec(text)[1], 10) }); return; }
    m = text.match(/每次使用则当回合造成的攻击伤害额外提升(\d+)%，最高额外提升(\d+)%/);
    if (m) { out.push({ kind: 'rampDamage', inc: parseInt(m[1], 10) / 100, cap: parseInt(m[2], 10) / 100 }); return; }

    // 能力等级变化
    m = text.match(/(\d+)?%?\s*(?:技能使用成功时[，,]?)?\s*(?:改变|降低|提升)(自身|对手|对方|本方)(攻击|防御|特攻|特防|速度|命中|闪避)等级([+-]\d+)/);
    if (m) {
      out.push({
        kind: 'stat',
        target: (m[2] === '自身' || m[2] === '本方') ? 'self' : 'foe',
        stat: STAT_WORD[m[3]],
        stages: parseInt(m[4], 10),
        chance: m[1] ? parseInt(m[1], 10) : 100
      });
      return;
    }

    // 护盾（抵挡攻击伤害）
    m = text.match(/获得(\d+)点护盾/);
    if (m) { out.push({ kind: 'shield', value: parseInt(m[1], 10) }); return; }

    // 护罩（抵挡固定伤害 / 百分比伤害）
    m = text.match(/(?:获得|为自身附加|附加)(\d+)点护罩/);
    if (m) { out.push({ kind: 'ward', value: parseInt(m[1], 10) }); return; }

    // 护盾
    m = text.match(/为自身附加(\d+)点护盾/);
    if (m) { out.push({ kind: 'shield', value: parseInt(m[1], 10) }); return; }

    // 伤害减免
    m = text.match(/(\d+)回合[^。]{0,12}?受到(物理|特殊)攻击伤害减半/);
    if (m) { out.push({ kind: 'guard', turns: parseInt(m[1], 10), mul: 0.5, scope: m[2] === '物理' ? 'phys' : 'spec' }); return; }
    m = text.match(/(\d+)回合[^。]{0,12}?受到(?:的)?([\u4e00-\u9fa5]{1,2})系攻击伤害减半/);
    if (m) { out.push({ kind: 'guard', turns: parseInt(m[1], 10), mul: 0.5, scope: 'type', typeName: m[2] }); return; }
    m = text.match(/(\d+)回合[^。]{0,12}?受到的伤害减半/);
    if (m) { out.push({ kind: 'guard', turns: parseInt(m[1], 10), mul: 0.5, scope: 'all' }); return; }
    m = text.match(/(\d+)回合[^。]{0,12}?对手造成的伤害降低(\d+)%/);
    if (m) { out.push({ kind: 'guard', turns: parseInt(m[1], 10), mul: 1 - parseInt(m[2], 10) / 100, scope: 'all' }); return; }

    // 免疫
    m = text.match(/(\d+)回合内免疫(?:所有受到的)?异常状态/);
    if (m) { out.push({ kind: 'immuneStatus', turns: parseInt(m[1], 10) }); return; }
    m = text.match(/(\d+)回合内免疫能力下降状态/);
    if (m) { out.push({ kind: 'immuneStat', turns: parseInt(m[1], 10) }); return; }
    if (/免疫下1次对手的攻击/.test(text)) { out.push({ kind: 'oneHit' }); return; }
    // 自身回合类效果不可被消除（后出手回合数 +N）
    m = text.match(/(\d+)回合内自身(?:的)?回合类效果无法被消除[，,]?\s*后出手时回合数\+(\d+)/);
    if (m) { out.push({ kind: 'roundLock', turns: parseInt(m[1], 10), slowAdd: parseInt(m[2], 10) }); return; }

    // 对手使用属性技能 → 自身数回合受伤上限
    m = text.match(/(\d+)回合内若对手使用属性技能[，,]?\s*则下(\d+)回合自身受到的伤害不超过(\d+)/);
    if (m) { out.push({ kind: 'capOnStatus', turns: parseInt(m[1], 10), capTurns: parseInt(m[2], 10), value: parseInt(m[3], 10) }); return; }

    // 直接造成 N 点 X 系伤害（自身每项强化 +M%）
    m = text.match(/直接造成(\d+)点([\u4e00-\u9fa5])系伤害[，,]?\s*自身每处于一种能力提升状态则造成的伤害提高(\d+)%/);
    if (m) { out.push({ kind: 'typeFixedDamage', value: parseInt(m[1], 10), typeName: m[2], perUp: parseInt(m[3], 10) }); return; }

    // 受到攻击则令对手陷入异常（持续回合）
    m = text.match(/(\d+)回合内若受到攻击则(?:有)?(\d+)%?(?:的)?概率令对手(麻痹|害怕|疲惫|睡眠|石化|冻伤|烧伤|中毒)/);
    if (m) { out.push({ kind: 'onHitStatusTimed', turns: parseInt(m[1], 10), chance: parseInt(m[2], 10), statusId: STATUS_WORD[m[3]] || 'paralyze' }); return; }

    // 每有一种能力提升则异常概率提高 N%
    m = text.match(/(\d+)%使对手(麻痹|害怕|疲惫|睡眠|石化|冻伤|烧伤|中毒)[，,]?\s*自身每处于一种能力提升状态则概率提高(\d+)%/);
    if (m) { out.push({ kind: 'status', statusId: STATUS_WORD[m[2]] || 'paralyze', chance: parseInt(m[1], 10), turns: 1, chancePerUp: parseInt(m[3], 10) }); return; }
    m = text.match(/(\d+)回合内免疫低于(\d+)的攻击伤害/);
    if (m) { out.push({ kind: 'immuneBelow', turns: parseInt(m[1], 10), value: parseInt(m[2], 10) }); return; }

    // 反弹
    m = text.match(/(\d+)回合内受攻击时反弹(\d+)点固定伤害/);
    if (m) { out.push({ kind: 'thorns', turns: parseInt(m[1], 10), value: parseInt(m[2], 10) }); return; }

    // PP 削减
    m = text.match(/(\d+)%降低对手所有技能?(\d+)点PP值/);
    if (m) { out.push({ kind: 'ppDrain', chance: parseInt(m[1], 10), amount: parseInt(m[2], 10) }); return; }
    if (/降低对手所有PP一点，并恢复自身所有PP一点/.test(text)) {
      out.push({ kind: 'ppDrain', chance: 100, amount: 1, selfRestore: 1 });
      return;
    }

    // 异常状态
    m = text.match(/(\d+)?%?\s*(?:概率|几率)?\s*(?:的)?\s*(?:命中后)?\s*(?:令|使)?(?:对方|对手|本方|自身)?(中毒|烧伤|冻伤|麻痹|睡眠|害怕|疲惫|混乱|石化|流血|易燃)(?:(\d+)回合)?/);
    if (m) {
      out.push({
        kind: 'status',
        statusId: STATUS_WORD[m[2]],
        chance: m[1] ? parseInt(m[1], 10) : 100,
        turns: m[3] ? parseInt(m[3], 10) : (m[2] === '睡眠' ? 2 : 1)
      });
      return;
    }

    // 多段攻击
    m = text.match(/1回合做(\d+)(?:~(\d+))?次攻击/);
    if (m) {
      out.push({ kind: 'multiHit', min: parseInt(m[1], 10), max: m[2] ? parseInt(m[2], 10) : parseInt(m[1], 10) });
      return;
    }

    // 固定伤害
    m = text.match(/额外附加(\d+)点固定伤害/);
    if (m) { out.push({ kind: 'flat', value: parseInt(m[1], 10) }); return; }

    // 每回合固定伤害
    m = text.match(/(\d+)回合内每回合都能附加(\d+)点固定伤害/);
    if (m) { out.push({ kind: 'dot', turns: parseInt(m[1], 10), value: parseInt(m[2], 10) }); return; }

    // 吸血
    m = text.match(/给予(?:对方|对象)?[^，。]*?损伤的(\d+)\/(\d+)[^。]*?恢复自己/);
    if (m) { out.push({ kind: 'drain', num: parseInt(m[1], 10), den: parseInt(m[2], 10) }); return; }
    m = text.match(/伤害数值的(\d+)%\s*恢复自身体力/);
    if (m) { out.push({ kind: 'drain', num: parseInt(m[1], 10), den: 100 }); return; }
    if (/给予对方损伤的一半会恢复自己的体力/.test(text)) { out.push({ kind: 'drain', num: 1, den: 2 }); return; }

    // 回复
    m = text.match(/恢复自身最大体力的(\d+)\/(\d+)/);
    if (m) { out.push({ kind: 'heal', num: parseInt(m[1], 10), den: parseInt(m[2], 10) }); return; }

    // 消除能力等级
    if (/消除对手能力提升状态/.test(text)) { out.push({ kind: 'clear', target: 'foe', which: 'positive' }); return; }
    if (/解除自身的能力下降状态/.test(text)) { out.push({ kind: 'clear', target: 'self', which: 'negative' }); return; }

    // 条件威力
    m = text.match(/对方体力小于(\d+)\/(\d+)时威力(?:加倍|为([\d.]+)倍)/);
    if (m) { out.push({ kind: 'power', cond: 'targetLow', threshold: parseInt(m[1], 10) / parseInt(m[2], 10), mul: m[3] ? parseFloat(m[3]) : 2 }); return; }
    m = text.match(/自身HP小于(\d+)\/(\d+)时威力为([\d.]+)倍/);
    if (m) { out.push({ kind: 'power', cond: 'selfLow', threshold: parseInt(m[1], 10) / parseInt(m[2], 10), mul: parseFloat(m[3]) }); return; }
    if (/先出手的话威力为2倍|先出手[^。]*威力为2倍/.test(text)) { out.push({ kind: 'power', cond: 'first', mul: 2 }); return; }
    if (/后出手的话威力为2倍/.test(text)) { out.push({ kind: 'power', cond: 'last', mul: 2 }); return; }
    m = text.match(/连续使用每次威力增加(\d+)，最高威力(\d+)/);
    if (m) { out.push({ kind: 'ramp', inc: parseInt(m[1], 10), cap: parseInt(m[2], 10) }); return; }

    // 通用异常状态兜底（放在最后，避免抢在具体概率/回合规则前面）
    m = text.match(new RegExp('(?:令|使)(?:对手|对方|敌方)?(?:陷入|进入|附加|获得)?(' + STATUS_NAME_RE + ')'));
    if (m && STATUS_WORD[m[1]]) {
      var chM = text.match(/(\d+)%/);
      var tM = text.match(/(?:持续\s*)?(\d+)\s*回合/);
      out.push({
        kind: 'status', statusId: STATUS_WORD[m[1]],
        chance: chM ? parseInt(chM[1], 10) : 100,
        turns: tM ? parseInt(tM[1], 10) : 1
      });
      return;
    }
  }

  /** 把一个技能的全部效果解析成结构化列表（结果缓存在技能对象上） */
  /* ---- 赛尔效果编号（effects[].id）直读表 ----------------------------------
   * 同一 id = 同一机制；数字参数从 effects[].args 取，文本只在 id 未收录时兜底。
   * 目前先落 3033 帝天战佛用到的 24 个 id，其余走 js/effect-ids.js 的自动模板。
   */
  var STAT_BY_IDX = { 0: 'atk', 1: 'def', 2: 'spAtk', 3: 'spDef', 4: 'spd', 5: 'acc' };
  var ALL_STATS = ['atk', 'def', 'spAtk', 'spDef', 'spd'];
var SIX_STATS = ['atk', 'def', 'spAtk', 'spDef', 'spd', 'acc'];
  function statEntry(target, idx, stages, chance) {
    return { kind: 'stat', target: target, stat: STAT_BY_IDX[idx] || 'atk', stages: stages, chance: chance == null ? 100 : chance };
  }
  var EFFECT_ID_SPEC = {
    // 能力等级：args = [能力下标, 命中率, 等级数]
    4: function (a) { return [statEntry('self', num(a[0]), num(a[2]) || 1, num(a[1]))]; },
    5: function (a) { return [statEntry('foe', num(a[0]), num(a[2]), num(a[1]))]; },
    // 对方体力小于 1/2 时威力加倍
    2: function () { return [{ kind: 'power', cond: 'targetLow', threshold: 0.5, mul: 2 }]; },
    // 命中后 N% 令对方烧伤
    12: function (a) { return [{ kind: 'status', statusId: 'burn', chance: num(a[0]) || 10, turns: 1 }]; },
    // 额外附加 N 点固定伤害
    29: function (a) { return [{ kind: 'flat', value: num(a[0]) }]; },
    // 消除对手回合类效果，消除成功则令对手害怕
    889: function () {
      return [{ kind: 'clearFoe' }, { kind: 'status', statusId: 'fear', chance: 100, turns: 1, req: { type: 'clearSuccess' } }];
    },
    // N 回合内受到物理/特殊伤害减少 M%
    599: function (a) { return [{ kind: 'guard', turns: num(a[0]) || 3, mul: 1 - (num(a[2]) || 50) / 100, scope: 'all' }]; },
    // 令对手全属性 -1
    749: function () {
      return ALL_STATS.map(function (k) { return { kind: 'stat', target: 'foe', stat: k, stages: -1, chance: 100 }; });
    },
    // 降低对手所有 PP 1 点并恢复自身所有 PP 1 点
    444: function () { return [{ kind: 'ppDrain', chance: 100, amount: 1, selfRestore: 1 }]; },
    697: function () { return [{ kind: 'ignoreGuards' }]; },
    699: function () { return [{ kind: 'ignoreImmune' }]; },
    // 全属性 +N，满体力时强化翻倍
    893: function (a) {
      var n = num(a[0]) || 1;
      return ALL_STATS.map(function (k) { return { kind: 'stat', target: 'self', stat: k, stages: n, chance: 100, fullHpDouble: true }; });
    },
    // N 回合对手无法使自身能力出现提升状态
    765: function (a) { return [{ kind: 'foeNoStatUp', turns: num(a[0]) || 3 }]; },
    // N 回合免疫并反弹异常状态
    191: function (a) { return [{ kind: 'immuneReflectStatus', turns: num(a[0]) || 5 }]; },
    // 反转自身能力下降状态
    521: function () { return [{ kind: 'invertStages', dbl: false }]; },
    // N 回合内每回合使用技能恢复最大体力的 1/M
    57: function (a) { return [{ kind: 'useHeal', turns: num(a[0]) || 4, num: 1, den: num(a[1]) || 3 }]; },
    // N 回合内免疫致命一击并扣除对手等量体力
    692: function (a) { return [{ kind: 'immuneCritReflect', turns: num(a[0]) || 2 }]; },
    // N 回合内对手使用技能消耗的 PP 变为 M 倍
    440: function (a) { return [{ kind: 'ppCostMul', turns: num(a[0]) || 3, mul: num(a[1]) || 2 }]; },
    // 造成伤害的 N% 恢复自身体力
    101: function (a) { return [{ kind: 'drain', num: num(a[0]) || 100, den: 100 }]; },
    // 处于能力提升状态时造成的伤害翻倍
    890: function () { return [{ kind: 'damageBuff', turns: 1, mul: 2, req: { type: 'selfStatUp' } }]; },
    // 使对手能力提升转化到自己身上
    85: function () { return [{ kind: 'stealPositive' }]; },
    // 每次使用当回合伤害 +N%，最高 +M%
    795: function (a) { return [{ kind: 'rampDamage', inc: (num(a[0]) || 30) / 100, cap: (num(a[1]) || 120) / 100 }]; },
    // 击败对手时能力提升翻倍
    709: function () { return [{ kind: 'doubleStagesOnKill' }]; },
    // ---- 第二批（按出现次数排序的高频 id）----
    // 下 N 回合自身所有技能先制 +M
    843: function (a) { return [{ kind: 'priorityBuff', turns: num(a[0]) || 1, value: num(a[1]) || 1 }]; },
    // N 回合内免疫所有异常状态
    48: function (a) { return [{ kind: 'immuneStatus', turns: num(a[0]) || 1 }]; },
    // N 回合内免疫能力下降状态
    47: function (a) { return [{ kind: 'immuneStat', turns: num(a[0]) || 1 }]; },
    // 下 N 回合自身攻击技能必定致命一击
    58: function (a) { return [{ kind: 'critBuff', turns: num(a[0]) || 1 }]; },
    // 自身六项能力等级（args 依次 atk/def/spAtk/spDef/spd/acc 的等级，0 表示不加）
    585: function (a) {
      var keys = ['atk', 'def', 'spAtk', 'spDef', 'spd', 'acc'];
      var out = [];
      keys.forEach(function (k, i) { var v = num(a[i]) || 0; if (v) out.push({ kind: 'stat', target: 'self', stat: k, stages: v, chance: 100 }); });
      return out;
    },
    // 命中后 N% 令对方害怕 / 麻痹 / 中毒 / 冻伤 / 睡眠
    15: function (a) { return [{ kind: 'status', statusId: 'fear', chance: num(a[0]) || 5, turns: 1 }]; },
    10: function (a) { return [{ kind: 'status', statusId: 'paralyze', chance: num(a[0]) || 5, turns: 1 }]; },
    11: function (a) { return [{ kind: 'status', statusId: 'poison', chance: num(a[0]) || 100, turns: 1 }]; },
    14: function (a) { return [{ kind: 'status', statusId: 'frost', chance: num(a[0]) || 100, turns: 1 }]; },
    16: function (a) { return [{ kind: 'status', statusId: 'sleep', chance: num(a[0]) || 5, turns: 1 }]; },
    // 随机恢复 min~max 点体力
    450: function (a) { return [{ kind: 'healRandom', min: num(a[0]) || 1, max: num(a[1]) || 100 }]; },
    // 随机附加 min~max 点固定伤害
    683: function (a) { return [{ kind: 'flatRandom', min: num(a[0]) || 0, max: num(a[1]) || 0 }]; },
    // 1 回合做 min~max 次攻击
    31: function (a) { return [{ kind: 'multiHit', min: num(a[0]) || 2, max: num(a[1]) || 2 }]; },
    // 下 N 回合造成的攻击伤害额外提升 M%
    693: function (a) { return [{ kind: 'damageBuff', turns: num(a[0]) || 1, mul: 1 + (num(a[1]) || 0) / 100 }]; },
    // 下 N 回合自身造成的攻击伤害翻倍
    776: function (a) { return [{ kind: 'damageBuff', turns: num(a[0]) || 1, mul: 2 }]; },
    // N 回合内若使用技能则恢复 M 点体力
    77: function (a) { return [{ kind: 'healFlat', value: num(a[1]) || 0 }]; },
    // 恢复自身最大体力的 1/M
    43: function (a) { return [{ kind: 'heal', num: 1, den: num(a[0]) || 10 }]; },
    // N 回合内每回合使用技能恢复最大体力的 1/M（并造成等量百分比伤害）
    532: function (a) { return [{ kind: 'useHeal', turns: num(a[0]) || 1, num: 1, den: num(a[1]) || 3 }]; },
    // N 回合内每回合使用技能吸取对手最大体力的 1/M
    597: function (a) { return [{ kind: 'drainMax', num: 1, den: num(a[1]) || 8 }]; },
    // N 回合内每回合附加 M 点固定伤害
    60: function (a) { return [{ kind: 'dot', turns: num(a[0]) || 1, value: num(a[1]) || 0 }]; },
    // N% 概率额外附加 M 点固定伤害
    93: function (a) { return [{ kind: 'flat', value: num(a[1]) || 0 }]; },
    // N 回合内每回合攻击/防御/特攻…+S（args = [回合数, atk, def, spAtk, spDef, spd, acc]）
    433: function (a) {
      var keys = ['atk', 'def', 'spAtk', 'spDef', 'spd', 'acc'];
      var out = [];
      keys.forEach(function (k, i) { var v = num(a[i + 1]) || 0; if (v) out.push({ kind: 'stat', target: 'self', stat: k, stages: v, chance: 100 }); });
      return out;
    },
    // 造成的伤害不少于 N
    447: function (a) { return [{ kind: 'minDamage', value: num(a[0]) || 0 }]; },
    // 自身 HP 小于 1/2 时威力为 2 倍
    37: function () { return [{ kind: 'power', cond: 'selfLow', threshold: 0.5, mul: 2 }]; },
    // N 回合内每回合所受伤害减少 M
    408: function (a) { return [{ kind: 'guardFlat', turns: num(a[0]) || 1, value: num(a[1]) || 0 }]; },
    // ---- 第三批：32 只主流精灵用到的 id ----
    // 4 回合每回合用技能回 1/3（体力低于 1/2 时翻倍的阈值由文本说明，fx 结构与文本解析一致）
    1065: function (a) {
      return [{ kind: 'useHeal', turns: num(a[0]) || 4, num: 1, den: num(a[1]) || 3, lowHalf: num(a[2]) || 2, percent: true }];
    },
    // 消除对手能力提升，成功则 N 回合属性技能无效
    736: function (a) { return [{ kind: 'clear', target: 'foe', which: 'positive' }, { kind: 'skillBlock', turns: num(a[0]) || 2, req: { type: 'clearSuccess' } }]; },
    // 4 回合每回合用技能吸取对手 1/3 最大体力
    971: function (a) { return [{ kind: 'drainMax', num: 1, den: num(a[2]) || 3 }]; },
    // N 回合内对手无法通过技能回血
    679: function (a) { return [{ kind: 'healBlock', turns: num(a[0]) || 3 }]; },
    // 附加自身最大体力 N% 百分比伤害并回等量
    852: function (a) { return [{ kind: 'flatByMaxHp', pct: num(a[0]) || 25 }]; },
    // 全属性 +N（体力高于对手时翻倍）
    885: function (a) {
      var n = num(a[0]) || 1;
      return ALL_STATS.map(function (k) { return { kind: 'stat', target: 'self', stat: k, stages: n, chance: 100 }; });
    },
    // 断回合，成功则攻击/速度 +N
    901: function (a) {
      var out = [{ kind: 'clearFoe' }];
      var keys = ['atk', 'def', 'spAtk', 'spDef', 'spd', 'acc'];
      keys.forEach(function (k, i) { var v = num(a[i]) || 0; if (v) out.push({ kind: 'stat', target: 'self', stat: k, stages: v, chance: 100, req: { type: 'clearSuccess' } }); });
      return out;
    },
    // 断回合，成功则免疫 N 次异常
    928: function (a) { return [{ kind: 'clearFoe' }, { kind: 'immuneStatus', turns: num(a[0]) || 1, req: { type: 'clearSuccess' } }]; },
    // 断回合，成功则 N 回合必暴
    1224: function (a) { return [{ kind: 'clearFoe' }, { kind: 'critBuff', turns: num(a[0]) || 2, req: { type: 'clearSuccess' } }]; },
    // N% 概率伤害为 M 倍
    88: function (a) { return [{ kind: 'powerChance', chance: num(a[0]) || 10, mul: num(a[1]) || 2, statUpDouble: false }]; },
    // 下 N 回合攻击先制 +M
    481: function (a) { return [{ kind: 'priorityBuff', turns: num(a[0]) || 1, value: num(a[1]) || 1 }]; },
    // 攻击结束时自身能力 +N（args 同 585 的六项）
    523: function (a) {
      var keys = ['atk', 'def', 'spAtk', 'spDef', 'spd', 'acc'];
      var out = [];
      keys.forEach(function (k, i) { var v = num(a[i]) || 0; if (v) out.push({ kind: 'stat', target: 'self', stat: k, stages: v, chance: 100 }); });
      return out;
    },
    // 使对手随机 N 项技能 PP 归零
    583: function (a) { return [{ kind: 'ppZero', count: num(a[0]) || 1 }]; },
    // 体力低于 1/3 时威力 3 倍（args = [分母, 倍数]）
    645: function (a) { return [{ kind: 'power', cond: 'selfLow', threshold: 1 / (num(a[0]) || 3), mul: num(a[1]) || 3 }]; },
    // 4 回合每回合用技能吸取对手 1/M
    717: function (a) { return [{ kind: 'drainMax', num: 1, den: num(a[1]) || 4 }]; },
    // 吸取 N 点固定体力，每次使用 +M，最高 C
    837: function (a) { return [{ kind: 'drainFlatRamp', value: num(a[0]) || 150, inc: num(a[1]) || 100, cap: num(a[2]) || 350 }]; },
    // 断回合，成功则吸取对手 1/M 最大体力
    942: function (a) { return [{ kind: 'clearFoe' }, { kind: 'drainMax', num: 1, den: num(a[0]) || 3, req: { type: 'clearSuccess' } }]; },
    // 恢复自身最大体力的 1/M（并造成等量百分比伤害）
    1005: function (a) { return [{ kind: 'heal', num: 1, den: num(a[0]) || 2 }]; },
    // 当回合未击败对手则减少对手所有技能 PP N 点
    1285: function (a) { return [{ kind: 'ppDrain', chance: 100, amount: num(a[0]) || 2, needAlive: true }]; },
    // 打出致命一击则免疫下 N 次异常
    1355: function (a) { return [{ kind: 'immuneStatus', turns: num(a[0]) || 1, req: { type: 'crit' } }]; },
    // N 回合内对手能力下降无法被解除/反转
    1684: function (a) { return [{ kind: 'statDownLock', turns: num(a[0]) || 4 }]; },
    // N 回合内每回合受到的伤害不超过 M
    125: function (a) { return [{ kind: 'damageCap', turns: num(a[0]) || 1, value: num(a[1]) || 200 }]; },
    // N 回合内每回合附加 M 点固定伤害（args = [概率, 回合, 数值]）
    76: function (a) { return [{ kind: 'dot', turns: num(a[1]) || 5, value: num(a[2]) || 100 }]; },
    // 下 N 回合攻击必定致命且必定命中
    681: function (a) { return [{ kind: 'critBuff', turns: num(a[0]) || 1 }, { kind: 'mustHit', turns: num(a[0]) || 1 }]; },
    // 未击败对手则下回合先制 +N
    984: function (a) { return [{ kind: 'priorityBuff', turns: 1, value: num(a[0]) || 2 }]; },
    // 先出手时当回合对手使用技能后若自身体力为 0，则体力等于最大体力（堕世）
    561: function () { return [{ kind: 'firstReviveTurn' }]; },
    // 100% 令对手害怕，未触发则吸取 1/N 最大体力（1047）
    1047: function (a) {
      var ch = num(a[0]) || 100, den = num(a[2]) || 3;
      var ft = (num(a[1]) >= 1 && num(a[1]) <= 3) ? num(a[1]) : 1;
      return [{ kind: 'status', statusId: 'fear', chance: ch, turns: ft },
        { kind: 'drainMax', num: 1, den: den, req: { type: 'statusFail' } }];
    },
    // 使对手全属性 -N，自身体力低于对手时弱化翻倍（1130）
    1130: function (a) {
      var sv = -(num(a[0]) || 1);
      return SIX_STATS.map(function (s) { return { kind: 'stat', target: 'foe', stat: s, stages: sv, chance: 100, lowHpDouble: true }; });
    },
    // 随机附加 a-b 固定伤害，处于能力提升时改为 c-d（1131）
    1131: function (a) {
      return [{ kind: 'flatRandom', min: num(a[0]) || 0, max: num(a[1]) || 0, min2: num(a[2]), max2: num(a[3]) }];
    },
    // 消除对手全部护盾，成功则使对手全属性 -N，体力低于对手时翻倍（1215）
    1215: function (a) {
      var sv2 = -(num(a[0]) || 1);
      return [{ kind: 'clearShield' }].concat(SIX_STATS.map(function (s) {
        return { kind: 'stat', target: 'foe', stat: s, stages: sv2, chance: 100, lowHpDouble: true, req: { type: 'clearSuccess' } };
      }));
    },
    // 反转对手能力提升状态，反转成功则恢复自身全部体力和 PP 值（1216）
    1216: function () { return [{ kind: 'invertFoeStages' }]; },
    // 若自身为满体力则技能威力提升 N%（925）
    925: function (a) { return [{ kind: 'power', mul: 1 + (num(a[0]) || 50) / 100, cond: 'selfFull' }]; },
    // 若自身未满体力则吸取对手最大体力的 1/N（1371）
    1371: function (a) { return [{ kind: 'drainMax', num: 1, den: num(a[0]) || 3, req: { type: 'selfHpNotFull' } }]; },
    // 消除对手能力提升，成功则下 N 回合自身攻击必定致命一击（1220）
    1220: function (a) {
      return [{ kind: 'clear', target: 'foe', which: 'positive' },
        { kind: 'critBuff', turns: num(a[0]) || 2, req: { type: 'clearSuccess' } }];
    },
    // 反转自身能力下降，反转成功则附加给对手等同的能力下降状态（1232）
    1232: function () { return [{ kind: 'invertToFoe', dbl: false }]; },
    // 本回合打出致命一击则下 N 回合其它攻击技能必定致命一击（731）
    731: function (a) { return [{ kind: 'critBuff', turns: num(a[0]) || 1, req: { type: 'crit' } }]; },
    // N 回合内对手无法通过自身技能恢复体力且受到原本恢复量 1/M 的百分比伤害（1449）
    1449: function (a) {
      return [{ kind: 'healBlockPunish', turns: num(a[0]) || 2, num: 1, den: num(a[1]) || 3 }];
    },
    // 伤害低于 X 附加 Y 固伤，若先出手则提高 Z 点（1066）
    // 全属性+1，对手处于能力下降时强化效果翻倍（1338）
    1338: function (a) {
      var sv3 = num(a[0]) || 1;
      return SIX_STATS.map(function (s) {
        return { kind: 'stat', target: 'self', stat: s, stages: sv3, chance: 100, doubleIfTargetDown: true };
      });
    },
    // 全属性-N，N 回合内每回合对手指定能力 -M（1428）
    1428: function (a) {
      var ch8 = num(a[0]) || 100, turns8 = num(a[1]) || 3;
      var vec = [a[2], a[3], a[4], a[5], a[6], a[7]];
      var out8 = SIX_STATS.map(function (s, i) {
        return { kind: 'stat', target: 'foe', stat: s, stages: -1, chance: ch8 };
      });
      var stats8 = [], vals8 = [];
      vec.forEach(function (v, i) { var n = num(v); if (n) { stats8.push(SIX_STATS[i]); vals8.push(n); } });
      if (stats8.length) out8.push({ kind: 'perTurnStatDown', turns: turns8, stats: stats8, value: vals8[0] });
      return out8;
    },
    // N 回合内使用技能吸取对手最大体力 1/M，低于 1/K 翻倍；对手未掉血则场下各回 X（2076）
    2076: function (a) {
      return [{ kind: 'drainTimed', turns: num(a[0]) || 4, den: num(a[1]) || 3, lowHalf: num(a[2]) || 2, bench: num(a[3]) || 0 }];
    },
    // N 回合内每回合使用技能吸取 1/M，低于 1/K 时翻倍（717）
    717: function (a) {
      return [{ kind: 'drainTimed', turns: num(a[0]) || 4, den: num(a[1]) || 3, lowHalf: num(a[2]) || 2 }];
    },
    // 消除对手回合类效果，成功则随机 N 项技能 PP 归零（1114）
    1114: function (a) {
      return [{ kind: 'clearFoe' }, { kind: 'ppZero', count: num(a[0]) || 2, req: { type: 'clearSuccess' } }];
    },
    // 反转自身能力下降，成功则随机 2 项技能 PP 归零（907）
    907: function () {
      return [{ kind: 'invertStages', dbl: false }, { kind: 'ppZero', count: 2, req: { type: 'clearSuccess' } }];
    },
    // 消耗自身全部体力，己方下只精灵获得消耗值 N% 的护盾与护罩（2213）
    2213: function (a) { return [{ kind: 'selfKo' }, { kind: 'selfKoHalfShield', pct: num(a[0]) || 50 }]; },
    // 1066 伤害低于 X 附加 Y 固伤，若先出手则提高 Z 点
    // 消除对手回合类效果，成功则令对手异常（889，异常由 args[0] 编号决定）
    889: function (a) {
      var st89 = statusByCode(num(a[0]));
      var out89 = [{ kind: 'clearFoe' }];
      if (st89) out89.push({ kind: 'status', statusId: st89, chance: 100, turns: 1, req: { type: 'clearSuccess' } });
      return out89;
    },
    // 消除对手能力提升，成功则令对手异常，未触发则恢复自身 1/M（1471）
    1471: function (a) {
      var ch71 = num(a[0]) || 100, st71 = statusByCode(num(a[1]));
      var den71 = num(a[2]) || 3;
      var out71 = [{ kind: 'clear', target: 'foe', which: 'positive' }];
      if (st71) out71.push({ kind: 'status', statusId: st71, chance: ch71, turns: 1, req: { type: 'clearSuccess' } });
      out71.push({ kind: 'healStatusFail', num: 1, den: den71 });
      return out71;
    },
    // N 回合内对手使用威力不高于 X 的攻击技能时令其异常，未触发则抵挡当次攻击（2212）
    2212: function (a) {
      var st12 = statusByCode(num(a[2]));
      if (!st12) return [];
      return [{ kind: 'lowPowerPunish', turns: num(a[0]) || 2, threshold: num(a[1]) || 150, statusId: st12 }];
    },
    // N 回合内对手使用属性技能则概率令其异常（469）
    469: function (a) {
      var st69 = statusByCode(num(a[2]));
      if (!st69) return [];
      return [{ kind: 'attrTriggerStatus', turns: num(a[0]) || 2, chance: num(a[1]) || 100, statusId: st69 }];
    },
    // 1066 伤害低于 X 附加 Y 固伤，若先出手则提高 Z 点
    // 消除对手能力提升，成功则对手下 N 次攻击技能无效（1217）
    1217: function (a) {
      return [{ kind: 'clear', target: 'foe', which: 'positive' },
        { kind: 'attackBlock', turns: num(a[0]) || 2, req: { type: 'clearSuccess' } }];
    },
    // 未击败对手则下 M 回合自身先制 +N（1218）
    1218: function (a) {
      return [{ kind: 'priorityBuff', turns: num(a[1]) || 2, value: num(a[0]) || 2, req: { type: 'targetAlive' } }];
    },
    // 对手每有 1 项能力等级与自身相同则附加 N 点固定伤害（1133）
    1133: function (a) {
      return [{ kind: 'flatPerEqualStat', per: num(a[0]) || 1, value: num(a[1]) || 120 }];
    },
    // 圣世惩杀：断回合/消强 + 随机 2 技能 PP 归零；成功则星怒概率 +20%
    1094: function () {
      return [{ kind: 'clearFoe' }, { kind: 'ppZero', count: 2, req: { type: 'clearSuccess' } },
        { kind: 'starRageBonus', turns: 2, bonus: 20 }, { kind: 'starRageMode', mode: 'noUpPercent' }];
    },
    // 瀚空之门：3 回合对手出手惩罚 + 己方免疫 2 次异常
    1095: function () {
      return [{ kind: 'starPunish', turns: 3 }, { kind: 'immuneStatus', turns: 2 },
        { kind: 'starRageMode', mode: 'roundLock' }];
    },
    // 命宇轮回：低血全属性翻倍 + 4 回合吸血 + 下 2 次星怒概率翻倍
    1096: function () {
      var s = SIX_STATS.map(function (k) {
        return { kind: 'stat', target: 'self', stat: k, stages: 1, chance: 100, lowHpDouble: true };
      });
      return s.concat([{ kind: 'drainTimed', turns: 4, den: 3, lowHalf: 2 },
        { kind: 'starRageDouble', n: 2 }, { kind: 'starRageMode', mode: 'dmgBuff' }]);
    },
    // 亘古圣辰决：低伤令对手疲惫 + 未击败封锁攻击
    1097: function () {
      return [{ kind: 'starLowDamage', threshold: 280, statusId: 'tired' },
        { kind: 'starRageMode', mode: 'blind' }];
    },
    // 万皇宗魄决：暴击率每次 +20%（上限 100%）+ 暴击后星怒威力不减
    1098: function () {
      return [{ kind: 'critRamp', base: 20, inc: 20, cap: 100 }, { kind: 'starPowerKeep' },
        { kind: 'starRageMode', mode: 'prio' }];
    },
    1066: function (a) {
      var th = num(a[0]) || 300, base = num(a[1]) || th, extra = num(a[2]) || 0;
      return [{ kind: 'flat', value: base, req: { type: 'damageUnder', value: th } },
        { kind: 'flat', value: extra, req: { type: 'damageUnder', value: th, first: true } }];
    },
    // 对手不处于能力提升时伤害提升 N%
    1021: function (a) { return [{ kind: 'damageBuff', turns: 1, mul: 1 + (num(a[0]) || 0) / 100, req: { type: 'targetStatNotUp' } }]; },
  };
  /**
   * 效果编号覆盖表：同 id 的不同文本在不同技能里通用，但内置 spec 若有偏差，
   * 在这里按 id 统一修正（优先级高于 EFFECT_ID_SPEC，低于无）。
   */
  var EFFECT_ID_OVERRIDES = {
    // 后出手的话威力为 2 倍
    30: function () { return [{ kind: 'power', cond: 'last', mul: 2 }]; },
    // N% 概率额外附加 M 点固定伤害
    93: function (a) { return [{ kind: 'flat', value: num(a[1]) || 200, chance: num(a[0]) || 10 }]; },
    // 4 回合内对手使用属性技能 → 对手全技能 PP -N
    861: function (a) { return [{ kind: 'attrPunishPP', turns: num(a[0]) || 4, amount: num(a[1]) || 2 }]; },
    // 消耗所有神耀能量，每层威力 +N（满层不再消耗）
    862: function (a) { return [{ kind: 'powerPerStack', per: num(a[0]) || 50, keepAtMaxStacks: 6 }]; },
    // 后出手则下 1 回合对手攻击技能无效
    863: function () { return [{ kind: 'lastFoeAttackBlock' }]; },
    // 未击败则下 N 回合反弹受到伤害的 1/M
    864: function (a) { return [{ kind: 'reflectIfAlive', turns: num(a[0]) || 1, num: 1, den: num(a[1]) || 2 }]; },
    // 击败对手获得 N 层神耀能量
    865: function (a) { return [{ kind: 'stacksOnKill', value: num(a[0]) || 2 }]; },
    // 致命一击获得 M 层，否则 N 层
    866: function (a) { return [{ kind: 'stacksOnResult', crit: num(a[0]) || 2, base: num(a[1]) || 1 }]; },
    // 消除回合类效果，成功则对手下回合先制 -N
    867: function (a) { return [{ kind: 'clearFoe' }, { kind: 'foePriorityDown', turns: 1, value: num(a[0]) || 2, req: { type: 'clearSuccess' } }]; },
    // 消除能力提升，成功则对手下回合先制 -N
    868: function (a) { return [{ kind: 'clear', target: 'foe', which: 'positive' }, { kind: 'foePriorityDown', turns: 1, value: num(a[0]) || 2, req: { type: 'clearSuccess' } }]; },
    // 天启帝君 3550
    1297: function () { return [{ kind: 'clearFoe' }, { kind: 'clearOrFearDrain', statusId: 'fear', num: 1, den: 3, req: { type: 'clearSuccess' } }]; },
    1298: function () { return [{ kind: 'clear', target: 'foe', which: 'positive' }, { kind: 'benchQuarterOnClear', den: 4, residue: 1, req: { type: 'clearSuccess' } }]; },
    1315: function (a) { return [{ kind: 'critBonus', value: num(a[0]) || 50 }]; },
    505: function (a) { return [{ kind: 'critHealDealt', num: 1, den: num(a[0]) || 2 }]; },
    1299: function (a) { return [{ kind: 'junPunish', turns: 3, threshold: num(a[0]) || 300, bench: num(a[1]) || 100, residue: 1 }]; },
    821: function (a) { return [{ kind: 'roundLock', turns: num(a[0]) || 3, slowAdd: 1, selfLock: true }]; },
    1300: function (a) { return [{ kind: 'junGuard', turns: 3, mul: 1 - (num(a[0]) || 50) / 100, threshold: num(a[1]) || 280, statusCount: 2 }]; },
    1316: function (a) { return [{ kind: 'randomStatUp', count: num(a[0]) || 3, stages: num(a[1]) || 1, req: { type: 'first' } }]; },
    1317: function () { return [{ kind: 'heal', num: 1, den: 4, req: { type: 'last' } }]; },
    1302: function (a) { return [{ kind: 'allStatChanceDouble', stages: num(a[0]) || 1, chance: num(a[1]) || 50 }]; },
    1303: function (a) { return [{ kind: 'drainTimed', turns: num(a[0]) || 4, num: 1, den: num(a[1]) || 3, lowHalf: 2, benchHealOnFull: 100 }]; },
    1304: function (a) { return [{ kind: 'ignoreDefPctTurns', turns: num(a[0]) || 2, pct: num(a[1]) || 25 }]; },
    1208: function () { return [{ kind: 'invertSelfDowns', blockAttack: 1 }]; },
    1305: function (a) { return [{ kind: 'benchScaleHeal', perAlive: num(a[0]) || 100, perDead: num(a[1]) || 100 }]; },
    1306: function (a) { return [{ kind: 'lowDamageBenchStrike', threshold: num(a[0]) || 350, value: num(a[1]) || 100, residue: 1 }]; },
    1307: function (a) { return [{ kind: 'benchHealAll', value: num(a[0]) || 100, req: { type: 'targetAlive' } }]; },
    1308: function () { return [{ kind: 'junNoWeakenNext' }]; },
    // 消除对手能力提升（无附加参数）
    33: function () { return [{ kind: 'clear', target: 'foe', which: 'positive' }]; },
    // N 回合内每回合使用技能吸取对手能力提升
    677: function (a) { return [{ kind: 'perTurnSteal', turns: num(a[0]) || 3 }]; },
    // 解除自身能力下降（无附加参数）
    3: function () { return [{ kind: 'clear', target: 'self', which: 'negative' }]; },
    // N 回合内受到攻击 M% 令对手某异常
    164: function (a) { return [{ kind: 'onHitStatusTimed', turns: num(a[0]) || 2, chance: num(a[1]) || 50, statusId: statusByCode(num(a[2])) || 'burn' }]; },
    // 消除对手回合类效果
    180: function () { return [{ kind: 'clearFoe' }]; },
    // N 回合内对手攻击必定 MISS（必中技能有效）
    432: function (a) { return [{ kind: 'foeMiss', turns: num(a[0]) || 2 }]; },
    // 随机使对手 N 项能力等级 -M
    198: function (a) { return [{ kind: 'randomStatDown', count: num(a[0]) || 2, stages: num(a[1]) || 1 }]; },
    // N 回合内对手造成的伤害降低 M%
    491: function (a) { return [{ kind: 'guard', turns: num(a[0]) || 2, mul: 1 - (num(a[1]) || 50) / 100 }]; },
    // 附加对手上次造成伤害数值的固定伤害
    807: function () { return [{ kind: 'prevDamageFlat' }]; },
    // 随机使自身 N 项能力 +M
    626: function (a) { return [{ kind: 'randomStatUp', count: num(a[0]) || 1, stages: num(a[1]) || 1 }]; },
    // 消除回合类效果，成功则自身下 N 回合攻击伤害 +M%
    1124: function (a) { return [{ kind: 'clearFoe' }, { kind: 'damageBuff', turns: num(a[0]) || 2, mul: 1 + (num(a[1]) || 50) / 100, req: { type: 'clearSuccess' } }]; },
    // 吸取对手 N 点体力，体力低于对手时翻倍
    894: function (a) { return [{ kind: 'drainFlat', value: num(a[0]) || 200, doubleIfLower: true }]; },
    // 击败对手则令对手下 N 次使用的攻击技能无效
    1128: function (a) { return [{ kind: 'onKillAttackBlock', times: num(a[0]) || 1 }]; },
    // 命中后 M% 令对手某异常
    756: function (a) { return [{ kind: 'status', chance: num(a[0]) || 30, statusId: statusByCode(num(a[1])) || 'paralyze', turns: 1 }]; },
    // N 回合内将受到的攻击伤害转化为自身体力
    128: function (a) { return [{ kind: 'convertTaken', turns: num(a[0]) || 1 }]; },
    // 对手体力不足 N 则直接秒杀
    456: function (a) { return [{ kind: 'exec', req: { type: 'targetHpBelow', value: num(a[0]) || 260 } }]; },
    // 获得 N 层神耀能量
    860: function (a) { return [{ kind: 'addStacks', value: num(a[0]) || 2 }]; },
    // N 回合内每回合攻击/速度/命中 +1
    433: function (a) { return [{ kind: 'perTurnStatUp', turns: num(a[1]) || 3, stats: ['atk', 'spd', 'acc'], stages: 1 }]; },
    // 遇到天敌时先制 +N
    610: function (a) { return [{ kind: 'priorityAlways', value: num(a[0]) || 1, req: { type: 'disadvantage' } }]; },
    // 若对手处于指定异常，技能威力翻倍
    609: function () { return [{ kind: 'power', cond: 'targetStatus', statusId: 'tired', mul: 2 }]; },
    // N 回合内自身攻击技能命中则 M% 令对手疲惫
    470: function (a) { return [{ kind: 'attackHitStatusTimed', turns: num(a[1]) || 4, chance: num(a[0]) || 70, statusId: 'tired' }]; },
    // N 回合内能力提升状态消失则对手属性技能失效
    690: function (a) { return [{ kind: 'buffGoneAttrBlock', turns: num(a[0]) || 3 }]; },
    // N 回合对手攻击必 Miss，若命中则下 M 回合对手属性技能无效
    1125: function (a) { return [{ kind: 'foeMiss', turns: num(a[0]) || 3 }, { kind: 'attrBlockIfHit', turns: num(a[0]) || 3, block: num(a[1]) || 2 }]; },
    // 随机清零 N 个技能 PP，若本回合受到攻击再清零 M 个
    1126: function (a) { return [{ kind: 'ppZero', count: num(a[0]) || 2 }, { kind: 'ppZeroOnHit', count: num(a[1]) || 1 }]; },
    // N 回合每回合回血 1/M 并造成等量百分比伤害
    532: function (a) { return [{ kind: 'useHeal', turns: num(a[0]) || 5, num: 1, den: num(a[1]) || 3, percent: true }]; },
    // 降低对手所有技能 N 点 PP，若所选技能 PP 为 0 则其本回合无法行动
    39: function (a) { return [{ kind: 'ppDrain', amount: num(a[0]) || 2, chance: 100, lockIfZero: true }]; },
  };

  /** 按效果编号生成 fx：内置 spec 优先，其次 js/effect-ids.js 的自动模板；都没有返回 null 走文本解析 */
  function fxByEffectId(e) {
    if (!e || e.id == null) return null;
    var a = e.args || [];
    if (EFFECT_ID_OVERRIDES[e.id]) {
      try { return EFFECT_ID_OVERRIDES[e.id](a); } catch (err0) { return null; }
    }
    var spec = EFFECT_ID_SPEC[e.id];
    if (spec) {
      try { return spec(a); } catch (err) { return null; }
    }
    var reg = (typeof SEER_EFFECT_IDS !== 'undefined' && SEER_EFFECT_IDS) ||
      (typeof window !== 'undefined' && window.SEER_EFFECT_IDS) || null;
    var t = reg && reg[String(e.id)];
    if (!t || !t.t) return null;
    return t.t.map(function (tpl) {
      var f = {};
      Object.keys(tpl).forEach(function (k) {
        var v = tpl[k];
        if (typeof v === 'string' && v.charAt(0) === '$') f[k] = num(a[parseInt(v.slice(1), 10)]) || 0;
        else f[k] = v;
      });
      return f;
    });
  }

  function parseSkillEffects(skill) {
    if (!skill) return [];
    if (skill._fx) return skill._fx;
    var out = [];
    var src = (skill.effects && skill.effects.length) ? skill.effects : (skill.skill_effect || []);
    for (var i = 0; i < src.length; i++) {
      var e = src[i];
      if (!e) continue;
      var byId = fxByEffectId(e);
      if (byId && byId.length) { for (var bi = 0; bi < byId.length; bi++) out.push(byId[bi]); continue; }
      parseOneEffect(e.info || e.analyze_info, out);
    }
    if (!out.length && skill.info) {
      // 有些技能把多条效果写在 info 里，用分隔符拆开分别解析
      String(skill.info).split(/[；;|]|\s\/\s/).forEach(function (part) {
        var p = part.trim();
        if (p) parseOneEffect(p, out);
      });
    }

    var seen = {};
    var uniq = [];
    out.forEach(function (f) {
      var k = f.kind + '|' + JSON.stringify(f);
      if (seen[k]) return;
      seen[k] = 1;
      uniq.push(f);
    });
    skill._fx = uniq;
    return uniq;
  }

  /** 解析魂印描述里「无条件生效」的部分（条件/层叠段落只展示，不参与结算） */
  var SOUL_SKIP = /^(若|当|处于|满体力|登场|出战|每击败|对手|自身处于|首回合|在战斗中|战斗阶段)/;

  /** 解析「登场后前 N 回合」窗口里的若干子效果，拆成 entryBuff */
  function pushEntryWindow(rest, turns, once, out) {
    if (!rest) return 0;
    var added = 0;
    String(rest).split(/[，,、]|且/).forEach(function (piece) {
      var p = piece.trim();
      if (!p) return;
      var m;
      if (/免疫[^。]{0,6}异常状态/.test(p)) {
        out.push({ kind: 'entryBuff', once: once, turns: turns, fx: { kind: 'immuneStatus' } }); added++; return;
      }
      if (/不会陷入[^。]{0,4}能力下降|免疫[^。]{0,6}能力下降/.test(p)) {
        out.push({ kind: 'entryBuff', once: once, turns: turns, fx: { kind: 'immuneStat' } }); added++; return;
      }
      if ((m = p.match(/受到致死(?:攻击)?伤害时?保留(\d+)点体力/))) {
        out.push({ kind: 'entryBuff', once: once, turns: turns, fx: { kind: 'survive', hp: parseInt(m[1], 10) } }); added++; return;
      }
      if (/致死(?:攻击)?伤害[^。]{0,12}反弹/.test(p)) {
        out.push({ kind: 'entryBuff', once: once, turns: turns, fx: { kind: 'reflectLethal' } }); added++; return;
      }
      if ((m = p.match(/先制\+(\d+)/))) {
        out.push({ kind: 'entryBuff', once: once, turns: turns, fx: { kind: 'priority', value: parseInt(m[1], 10) } }); added++; return;
      }
      if ((m = p.match(/(?:使|令)对手(攻击|防御|特攻|特防|速度|命中|闪避)-?(\d+)/))) {
        out.push({ kind: 'entryBuff', once: once, turns: turns, fx: { kind: 'foeStatDown', stat: STAT_WORD[m[1]], stages: parseInt(m[2], 10) } }); added++; return;
      }
      if ((m = p.match(/(?:使|令)对手(中毒|烧伤|冻伤|麻痹|混乱|石化|流血|易燃)/))) {
        out.push({ kind: 'entryBuff', once: once, turns: turns, fx: { kind: 'entryStatus', statusId: STATUS_WORD[m[1]], chance: 100 } }); added++; return;
      }
      if ((m = p.match(/增加(\d+)%?(?:的)?致命一击概率/))) {
        out.push({ kind: 'entryBuff', once: once, turns: turns, fx: { kind: 'critBonus', value: parseInt(m[1], 10) } }); added++; return;
      }
      if ((m = p.match(/附加(\d+)点固定伤害/))) {
        out.push({ kind: 'entryBuff', once: once, turns: turns, fx: { kind: 'flat', value: parseInt(m[1], 10) } }); added++; return;
      }
      if ((m = p.match(/受到的?(?:攻击)?伤害[^。]{0,8}减少(\d+)%/))) {
        out.push({ kind: 'entryBuff', once: once, turns: turns, fx: { kind: 'taken', value: 1 - parseInt(m[1], 10) / 100 } }); added++; return;
      }
    });
    return added;
  }

  /** 魂印里的条件文本（比技能宽一些：满体力、首回合、体力低于对手…） */
  function parseSoulCond(t) {
    if (!t) return null;
    if (/满体力/.test(t)) return { type: 'fullHp' };
    if (/^(?:登场)?首回合/.test(t) || /^出战时/.test(t)) return { type: 'firstTurn' };
    var c = parseCond(t);
    if (c) return c;
    if ((c = t.match(/自身体力(?:低于|小于)最大体力的(\d+)\/(\d+)/))) {
      return { type: 'selfHpRatioBelow', threshold: parseInt(c[1], 10) / parseInt(c[2], 10) };
    }
    if ((c = t.match(/自身体力(?:高于|大于)最大体力的(\d+)\/(\d+)/))) {
      return { type: 'selfHpRatioOver', threshold: parseInt(c[1], 10) / parseInt(c[2], 10) };
    }
    return null;
  }

  /** 识别魂印里的「若…则…」/「满体力时…」/「首回合…」，包成 cond 被动 */
  function trySoulConditional(t) {
    var m, cond, inner;
    m = /^若(.{2,30}?)[，,]?\s*则(.+)$/.exec(t);
    if (m) {
      cond = parseSoulCond(m[1]);
      if (!cond) return null;
      inner = [];
      parseSoulPart(m[2], inner);
      if (!inner.length) return null;
      return inner.map(function (fx) { return { kind: 'cond', req: cond, fx: fx }; });
    }
    var forms = [
      { re: /^满体力(?:时|的状态下|状态下)[，,]?\s*/, cond: { type: 'fullHp' } },
      { re: /^(?:登场)?首回合[，,]?\s*/, cond: { type: 'firstTurn' } },
      { re: /^出战时[，,]?\s*/, cond: { type: 'firstTurn' } },
      { re: /^自身体力低于对手(?:体力)?时[，,]?\s*/, cond: { type: 'selfHpLower' } },
      { re: /^自身体力高于对手(?:体力)?时[，,]?\s*/, cond: { type: 'selfHpHigher' } },
      { re: /^对手处于异常状态时[，,]?\s*/, cond: { type: 'targetAnyStatus' } },
      { re: /^对手处于能力提升状态时[，,]?\s*/, cond: { type: 'targetStatUp' } },
      { re: /^对手处于能力下降状态时[，,]?\s*/, cond: { type: 'targetStatDown' } }
    ];
    for (var i = 0; i < forms.length; i++) {
      m = forms[i].re.exec(t);
      if (!m) continue;
      inner = [];
      parseSoulPart(t.slice(m[0].length), inner);
      if (!inner.length) continue;
      return inner.map(function (fx) { return { kind: 'cond', req: forms[i].cond, fx: fx }; });
    }
    return null;
  }

  function parseSoulmark(desc) {
    var out = [];
    if (!desc) return out;
    // 天启帝君 3550：帝君之罚/赐/援/御/阵/威/殒 整段识别（条件拆段会吃掉「御/威/殒」）
    if (/帝君之[罚赐援御阵威殒]/.test(String(desc))) {
      if (/帝君之罚/.test(desc)) out.push({ kind: 'benchStrike', num: 1, den: 3 });
      if (/帝君之赐/.test(desc)) out.push({ kind: 'benchHeal', num: 1, den: 3 });
      if (/帝君之援/.test(desc)) out.push({ kind: 'junYuan' });
      if (/帝君之御/.test(desc)) out.push({ kind: 'junYu' });
      if (/帝君之阵/.test(desc)) out.push({ kind: 'junZhen' });
      if (/帝君之威/.test(desc)) out.push({ kind: 'junWei' });
      var jyM = /被击败后[，,]?\s*(\d+)%令对方1只不在场精灵死亡/.exec(desc);
      out.push({ kind: 'junYun', chance: jyM ? parseInt(jyM[1], 10) : 30 });
      return out;
    }
    var parts = String(desc).split(/[；;|①②③④⑤。\n]/);
    parts.forEach(function (raw) {
      // 去掉「虚无：」这类条目标签
      var t = raw.trim().replace(/^[^：:]{1,10}[：:]\s*/, '');
      if (!t) return;
      // 3308 玄武：先/后手双条件的魂印段，必须在条件拆段之前整段处理
      var mXwBoth = t.match(/^若自身先出手则使对手随机(\d+)个技能的PP值归零[，,]?\s*若自身后出手则附加自身双防能力值总和(\d+)%的固定伤害并恢复等量体力/);
      if (mXwBoth) {
        out.push({ kind: 'prioPpZero', count: parseInt(mXwBoth[1], 10) });
        out.push({ kind: 'defFixedHeal', pct: parseInt(mXwBoth[2], 10) });
        return;
      }
      // 3809 哈莫：「满体力时…」会被条件拆段吃掉（fullHp + taken），必须先整段处理
      if (/^满体力时自身受到的攻击伤害降低50%且造成的攻击伤害提升50%/.test(t)) { out.push({ kind: 'hpScaleHao' }); return; }
      // 3627 弗里德：「若自身先出手则…」会被条件拆段吃掉，必须先整段处理
      var mFr3 = t.match(/^若自身先出手则自身技能命中前直至当回合结束后自身免疫能力下降状态且当回合造成的攻击伤害提升(\d+)%/);
      if (mFr3) { out.push({ kind: 'ifSelfFirstBoost', pct: parseInt(mFr3[1], 10) }); return; }
      // 3994 格劳瑞：「若自身体力低于最大体力的1/2…」会被条件拆段吃掉，必须先整段处理
      var mGl2bPre = t.match(/^若自身体力低于最大体力的1\/2则攻击技能命中后附加自身已损失体力(\d+)%的百分比伤害，先出手时伤害附加效果翻倍/);
      if (mGl2bPre) { out.push({ kind: 'rageLow', low: parseInt(mGl2bPre[1], 10) }); return; }
      // 4950 帝皇之戎：「自身的副位没有空缺时…」会被条件拆段吃掉
      if (/^自身的副位没有空缺时/.test(t)) { out.push({ kind: 'subFull' }); return; }
      var wrapped = trySoulConditional(t);
      if (wrapped) { wrapped.forEach(function (p) { out.push(p); }); return; }
      parseSoulPart(t, out);
    });
    return out;
  }

  function parseSoulPart(t, out) {
    {
      var m;
      // 魂印原文常带 [color]/[sprite] 标签；先剥掉再匹配，避免“属性[color]技能无效”拆断
      t = String(t || '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();

      // 瀚宇星皇（3291）魂印三条：给数据分级/图鉴一个可解析结构，结算在 Combatant 按 pet.id 兜底
      if (/星皇之赐/.test(t) && /星皇之佑/.test(t)) { out.push({ kind: 'starAura' }); return; }
      if (/技能无效/.test(t) && /星皇之怒/.test(t)) { out.push({ kind: 'starRageOnNull' }); return; }
      if (/免疫/.test(t) && /固定伤害/.test(t) && /百分比伤害/.test(t) && /能力下降/.test(t) &&
        (/星皇/.test(t) || /抗性始终视为100/.test(t))) {
        out.push({ kind: 'starImmunity' }); return;
      }

      // 神觉·米斯蒂克（4676）魂印两条可结算结构（结算在 Combatant.mistikeSoul）
      if (/登场时/.test(t) && /属性技能无效/.test(t) && /蚩庸之锁/.test(t)) {
        out.push({ kind: 'mistikeEntry' }); return;
      }
      if (/对手每次使用技能时随机2项能力等级-1/.test(t)) {
        out.push({ kind: 'mistikeReact' }); return;
      }

      // 王·雷伊（3142）魂印「雷」
      if (/每回合开始和结束时吸取对手能力提升状态/.test(t)) { out.push({ kind: 'leiSteal' }); return; }
      if (/回合开始时对手所有回合类效果的回合数变为1回合/.test(t)) { out.push({ kind: 'leiRoundToOne' }); return; }
      var mLei = t.match(/回合开始时若自身体力高于对手则战斗阶段结束时自身攻击\+(\d+)(?:、速度\+(\d+))?(?:、命中\+(\d+))?/);
      var leiPushed = false;
      if (mLei) {
        out.push({ kind: 'leiEndBoost', atk: parseInt(mLei[1], 10), spd: parseInt(mLei[2] || 0, 10), acc: parseInt(mLei[3] || 0, 10) });
        leiPushed = true;
      }
      if (/回合开始时若自身体力低于对手[，,]?则当回合自身回合类效果无法被消除/.test(t)) { out.push({ kind: 'leiRoundLock' }); leiPushed = true; }
      if (leiPushed) return;

      // 3205 王·缪斯魂印：攻击技能概率睡眠，未触发则强化/断回合
      var mMu = t.match(/攻击技能(\d+)%使对手(睡眠|麻痹|害怕|疲惫)[，,]?\s*未触发则自身(特攻|攻击)\+([0-9]+)、(速度|命中)\+([0-9]+)(?:且有(\d+)%的概率消除对手回合类效果)?/);
      if (mMu) {
        out.push({ kind: 'atkStatusElse', statusId: STATUS_WORD[mMu[2]] || 'sleep', chance: parseInt(mMu[1], 10),
          stats: [{ stat: STAT_WORD[mMu[3]] || 'spAtk', stages: parseInt(mMu[4], 10) },
            { stat: STAT_WORD[mMu[5]] || 'spd', stages: parseInt(mMu[6], 10) }],
          clearChance: parseInt(mMu[7] || 0, 10) });
        return;
      }
      var mMu2 = t.match(/攻击技能命中(睡眠|麻痹|害怕|疲惫)中的对手时[，,]?\s*附加自身最大体力(\d+)\/(\d+)的固定伤害/);
      if (mMu2) { out.push({ kind: 'hitStatusFixed', statusId: STATUS_WORD[mMu2[1]] || 'sleep', num: parseInt(mMu2[2], 10), den: parseInt(mMu2[3], 10) }); return; }
      var mXw3 = t.match(/(\d+)回合内对手使用攻击技能[，,]?\s*则使对手随机(\d+)个技能(?:的)?PP值归零/);
      if (mXw3) { out.push({ kind: 'ppZeroOnFoeAtk', turns: parseInt(mXw3[1], 10), count: parseInt(mXw3[2], 10) }); return; }

      // 3308 万世北溟·玄武魂印
      var nXw = 0;
      if (/自身不处于双防强化状态时免疫异常状态/.test(t)) { out.push({ kind: 'immuneStatusIfNoDefUp' }); nXw++; }
      var mXw = t.match(/若自身先出手则使对手随机(\d+)个技能的PP值归零/);
      if (mXw) { out.push({ kind: 'prioPpZero', count: parseInt(mXw[1], 10) }); nXw++; }
      var mXw2 = t.match(/若自身后出手则附加自身双防能力值总和(\d+)%的固定伤害并恢复等量体力/);
      if (mXw2) { out.push({ kind: 'defFixedHeal', pct: parseInt(mXw2[1], 10) }); nXw++; }
      if (nXw) return;

      // 4950 帝皇之戎魂印
      var nDh = 0;
      if (/^帝皇之戎为团体精灵$/.test(t)) { out.push({ kind: 'twinCorps' }); nDh++; }
      if (/^战斗开始时，若帝皇之戎为首发精灵，则帝皇之钺担任帝皇之戎的主位/.test(t)) { out.push({ kind: 'twinCorps', lead: true }); nDh++; }
      if (/帝皇之钺担任主位时，自身攻击值提升100点、自身攻击技能先制+1且造成的伤害提升50%/.test(t)) { out.push({ kind: 'yueMain' }); nDh++; }
      var mDh1 = t.match(/帝皇之钺担任副位时，帝皇之戎每造成(\d+)点伤害，回合结束时令对手进入1种非限制类的控制类异常状态/);
      if (mDh1) { out.push({ kind: 'yueSub', threshold: parseInt(mDh1[1], 10) }); nDh++; }
      if (/帝皇之御担任主位时，自身速度值提升100点、自身受到攻击伤害后附加伤害值100%的真实伤害/.test(t)) { out.push({ kind: 'yuMain' }); nDh++; }
      if (/帝皇之御担任副位时，帝皇之戎登场时，解除双方所处的异常状态、2回合内免疫受到的异常状态且所有技能先制+2/.test(t)) { out.push({ kind: 'yuSub' }); nDh++; }
      if (/自身的副位没有空缺时，自身免疫受到的致命一击伤害且攻击技能无视对手护盾效果/.test(t)) { out.push({ kind: 'subFull' }); nDh++; }
      if (/帝皇之钺担任主位时/.test(t) && /造成的伤害提升50%/.test(t)) { out.push({ kind: 'yueMain' }); nDh++; }
      if (/帝皇之御担任副位时/.test(t) && /所有技能先制\+2/.test(t)) { out.push({ kind: 'yuSub' }); nDh++; }
      if (nDh) return;

      // 4766 灭战神决·盖亚魂印
      var nGy = 0;
      if (/登场时自身开启武道，初始为血之道/.test(t)) { out.push({ kind: 'wudaoOpen' }); nGy++; }
      if (/每完成一次完成轨迹的衍化，自身恢复全部PP值/.test(t)) { out.push({ kind: 'wudaoPP' }); nGy++; }
      var mGy1 = t.match(/战斗阶段结束时自身恢复最大体力的1\/(\d+)，自身处于血之道时效果翻倍/);
      if (mGy1) { out.push({ kind: 'wudaoHeal', den: parseInt(mGy1[1], 10) }); nGy++; }
      var mGy2 = t.match(/自身使用技能时附加对手最大体力1\/(\d+)的百分比伤害，自身处于邪之道时效果翻倍/);
      if (mGy2) { out.push({ kind: 'wudaoSkillDmg', den: parseInt(mGy2[1], 10) }); nGy++; }
      var mGy3 = t.match(/自身造成的攻击伤害提升(\d+)%，自身处于天之道时效果翻倍/);
      if (mGy3) { out.push({ kind: 'wudaoDealt', pct: parseInt(mGy3[1], 10) }); nGy++; }
      if (nGy) return;

      // 4648 星光·鲁斯王魂印
      var nLs = 0;
      var mLs1 = t.match(/每次登场时，若自身为对手天敌则为对手附加(\d+)回合的星海之浸/);
      if (mLs1) { out.push({ kind: 'starSeaMark', turns: parseInt(mLs1[1], 10) }); nLs++; }
      var mLs1b = t.match(/自身每次使用攻击后附加(\d+)回合的星海之浸/);
      if (mLs1b) { out.push({ kind: 'starSeaMark', turns: parseInt(mLs1b[1], 10) }); nLs++; }
      if (/自身所有技能必定打出致命一击/.test(t)) { out.push({ kind: 'allCrit' }); nLs++; }
      if (/每场战斗限1次，自身受到致死伤害时，若自身的等级为100则消除对手能力提升状态/.test(t)) { out.push({ kind: 'level100Revive' }); nLs++; }
      if (nLs) return;

      // 4515 霍光魂印
      var nHg = 0;
      var mHg1 = t.match(/自身拥有北冥之刃，每次击败对手后，(\d+)回合内自身的北冥之刃升级为北冥狂刃/);
      if (mHg1) { out.push({ kind: 'beimingBlade', turns: parseInt(mHg1[1], 10) }); nHg++; }
      if (/自身拥有强击形态、无罔形态、威破形态三种形态，自身首次出战时，进入强击形态/.test(t)) { out.push({ kind: 'formSystem' }); nHg++; }
      if (nHg) return;

      // 4329 倪克斯魂印
      var nNx = 0;
      var mNx1 = t.match(/每次登场首回合若对手处于能力提升状态则自身受到的攻击伤害降低(\d+)%且下回合对手属性技能失效/);
      if (mNx1) { out.push({ kind: 'nyxEnter', reduce: parseInt(mNx1[1], 10) }); nNx++; }
      var mNx2 = t.match(/当回合战斗阶段结束时若双方全属性能力差值≥(\d+)开启倪克斯结界：下(\d+)回合对手攻击技能先制效果失效、下\d+回合自身攻击必定命中、(\d+)回合内每个战斗阶段结束时恢复自身所有技能(\d+)点PP值/);
      if (mNx2) { out.push({ kind: 'nyxField', diff: parseInt(mNx2[1], 10), turns: parseInt(mNx2[2], 10), pp: parseInt(mNx2[4], 10) }); nNx++; }
      var mNx3 = t.match(/战斗阶段结束时若自身体力高于回合开始时则下回合攻击必定打出致命一击[，,]?\s*战斗阶段结束时若自身体力等于回合开始时则下回合攻击技能先制\+(\d+)[，,]?\s*战斗阶段结束时若自身体力低于回合开始时则恢复自身最大体力的1\/(\d+)/);
      if (mNx3) { out.push({ kind: 'nyxHpBranch', equal: parseInt(mNx3[1], 10), low: parseInt(mNx3[2], 10) }); nNx++; }
      if (nNx) return;

      // 4275 命运之轮·莫伊莱魂印
      var nMy = 0;
      if (/回合开始时转动命运之轮·恒，战斗阶段结束时转动命运之轮·界/.test(t)) { out.push({ kind: 'fateWheel' }); nMy++; }
      if (/对手每次主动切换精灵则对手下一只精灵登场当回合命运之轮·恒和命运之轮·界的效果全部触发/.test(t)) { out.push({ kind: 'fateOnSwitch' }); nMy++; }
      var mMy1 = t.match(/^令自身全属性\+1且获得(\d+)点护盾和(\d+)点护罩/);
      if (mMy1) { out.push({ kind: 'fateHengDef', shield: parseInt(mMy1[1], 10), ward: parseInt(mMy1[2], 10) }); nMy++; }
      var mMy2 = t.match(/^令对手随机(\d+)个技能PP值归零且当回合无法通过自身技能恢复体力/);
      if (mMy2) { out.push({ kind: 'fateHengDef', pp: parseInt(mMy2[1], 10) }); nMy++; }
      var mMy3 = t.match(/^令对手全属性-1且下回合受到的固定伤害和百分比伤害提升(\d+)%/);
      if (mMy3) { out.push({ kind: 'fateJieDef', pct: parseInt(mMy3[1], 10) }); nMy++; }
      var mMy4 = t.match(/^恢复自身最大体力的1\/(\d+)且自身下回合所有技能额外先制\+(\d+)/);
      if (mMy4) { out.push({ kind: 'fateJieDef', den: parseInt(mMy4[1], 10), prio: parseInt(mMy4[2], 10) }); nMy++; }
      if (nMy) return;

      // 4219 红莲之誓·安卡魂印
      var nAn = 0;
      if (/自身能力提升状态被消除或吸取则100%令对手焚烬/.test(t)) { out.push({ kind: 'fenjinOnClear' }); nAn++; }
      if (/未触发焚烬则自身下回合选择使用攻击技能时获得灼心之焰效果/.test(t)) { out.push({ kind: 'pendingZhuoxin' }); nAn++; }
      var mAn1 = t.match(/战斗阶段结束时，若对手处于烧伤状态则令对手全属性-1且下回合自身所有技能先制\+(\d+)，若对手不处于烧伤状态则消除对手回合类效果，若对手不处于回合类效果或回合类效果无法被消除则恢复自身最大体力的1\/(\d+)并造成等量百分比伤害/);
      if (mAn1) { out.push({ kind: 'burnEndBranch', prio: parseInt(mAn1[1], 10), den: parseInt(mAn1[2], 10) }); nAn++; }
      var mAn2 = t.match(/^先制\+(\d+)、攻击必定打出致命一击、攻击命中且伤害结算后随机令自身(\d+)项能力值\+1/);
      if (mAn2) { out.push({ kind: 'zhuoxinBuff', prio: parseInt(mAn2[1], 10), ups: parseInt(mAn2[2], 10) }); nAn++; }
      if (nAn) return;

      // 3994 暴乱·格劳瑞魂印
      var nGl = 0;
      var mGl1 = t.match(/^首次攻击(\d+)%打出致命一击且附加造成伤害值(\d+)%的百分比伤害，之后每次登场致命一击触发概率为(\d+)%/);
      if (mGl1) { out.push({ kind: 'rageCrit', first: parseInt(mGl1[1], 10), extra: parseInt(mGl1[2], 10), later: parseInt(mGl1[3], 10) }); nGl++; }
      var mGl2a = t.match(/^回合开始时，若自身体力高于最大体力的1\/2则当回合攻击技能造成的伤害提升(\d+)%，先出手时伤害提升效果翻倍/);
      if (mGl2a) { out.push({ kind: 'rageHigh', high: parseInt(mGl2a[1], 10) }); nGl++; }
      var mGl2b = t.match(/^若自身体力低于最大体力的1\/2则攻击技能命中后附加自身已损失体力(\d+)%的百分比伤害，先出手时伤害附加效果翻倍/);
      if (mGl2b) { out.push({ kind: 'rageLow', low: parseInt(mGl2b[1], 10) }); nGl++; }
      if (nGl) return;

      // 3924 凛戾·寂灭魔神魂印
      var nJm = 0;
      var mJm1 = t.match(/自身使用攻击技能若未造成伤害则使用后\{吸取\}对手最大\{体力\}的1\/(\d+)且下回合自身所有技能先制\+(\d+)/);
      if (mJm1) { out.push({ kind: 'noDamageDrain', den: parseInt(mJm1[1], 10), prio: parseInt(mJm1[2], 10) }); nJm++; }
      var mJm2 = t.match(/自身每次先出手则技能命中前全属性\+1，若自身体力高于最大体力的1\/(\d+)则额外攻击\+1、速度\+1/);
      if (mJm2) { out.push({ kind: 'firstStatUp', halfDen: parseInt(mJm2[1], 10) }); nJm++; }
      var mJm3 = t.match(/自身每次后出手则技能命中前消除对手回合类效果，若对手不处于回合类效果或回合类效果无法被消除则使用技能后恢复自身最大体力的1\/(\d+)并造成等量百分比伤害/);
      if (mJm3) { out.push({ kind: 'lastClearHeal', den: parseInt(mJm3[1], 10) }); nJm++; }
      if (nJm) return;

      // 3809 龙神哈莫魂印
      var nHm = 0;
      if (/哈莫雷特获得龙神之力，万龙臣服/.test(t)) { out.push({ kind: 'dragonAura' }); nHm++; }
      if (/满体力时自身受到的攻击伤害降低50%且造成的攻击伤害提升50%/.test(t)) { out.push({ kind: 'hpScaleHao' }); nHm++; }
      var mHm1 = t.match(/对手使用属性技能则自身当回合免疫异常状态和能力下降状态，使用攻击技能则战斗阶段结束时随机附加给对手(\d+)-(\d+)点固定伤害/);
      if (mHm1) { out.push({ kind: 'foeTypeBranch', low: parseInt(mHm1[1], 10), high: parseInt(mHm1[2], 10) }); nHm++; }
      var mHm2 = t.match(/^受到的固定伤害和百分比伤害减少(\d+)%、攻击令对手随机(\d+)个技能PP值归零/);
      if (mHm2) { out.push({ kind: 'yuBuff', reduce: parseInt(mHm2[1], 10), pp: parseInt(mHm2[2], 10) }); nHm++; }
      var mHm3 = t.match(/^所有技能先制\+(\d+)且必定命中、攻击造成的伤害随机提升(\d+)%-(\d+)%/);
      if (mHm3) { out.push({ kind: 'zhanBuff', prio: parseInt(mHm3[1], 10), low: parseInt(mHm3[2], 10), high: parseInt(mHm3[3], 10) }); nHm++; }
      if (nHm) return;

      // 3807 欧德奈瑞魂印
      var nOu = 0;
      var mOu1 = t.match(/自身所有技能先出手时(\d+)%使对手当回合技能失效，每触发1次则概率下降(\d+)%，每下降\d+%则自身在整场战斗中造成的攻击伤害提升(\d+)%，概率降低为0%的当回合使对手随机(\d+)项技能PP值归零/);
      if (mOu1) { out.push({ kind: 'firstNullifyScale', pct: parseInt(mOu1[1], 10), step: parseInt(mOu1[2], 10), bonus: parseInt(mOu1[3], 10), ppCount: parseInt(mOu1[4], 10) }); nOu++; }
      var mOu2 = t.match(/回合开始时若自身不处于能力提升状态则当回合所有技能先制\+(\d+)，若自身处于能力提升状态则当回合攻击造成的伤害提升(\d+)%/);
      if (mOu2) { out.push({ kind: 'startStageBranch', prio: parseInt(mOu2[1], 10), dealtPct: parseInt(mOu2[2], 10) }); nOu++; }
      if (nOu) return;

      // 3740 怒涛·沧岚魂印
      var nCl = 0;
      var mCl1 = t.match(/登场时获得(\d+)点护盾，自身存在护盾时所有技能先制\+(\d+)/);
      if (mCl1) { out.push({ kind: 'entryShieldFlat', value: parseInt(mCl1[1], 10), prio: parseInt(mCl1[2], 10) }); nCl++; }
      var mCl2 = t.match(/战斗阶段结束时，若当回合自身未受到攻击伤害则恢复自身(\d+)点体力并造成恢复量的固定伤害，若受到了攻击伤害则自身免疫下1次受到的攻击伤害/);
      if (mCl2) { out.push({ kind: 'endShieldBranch', heal: parseInt(mCl2[1], 10) }); nCl++; }
      var mCl3 = t.match(/自身每次使用攻击技能时本次在场造成的攻击伤害提升(\d+)%，最高提升(\d+)%/);
      if (mCl3) { out.push({ kind: 'atkUseDealtStack', per: parseInt(mCl3[1], 10), cap: parseInt(mCl3[2], 10) }); nCl++; }
      if (nCl) return;

      // 3711 圣光莫妮卡魂印（自然祝福）
      var nMo = 0;
      var mMo1 = t.match(/首次出战登场时获得(\d+)层自然祝福，之后每次登场时获得(\d+)层自然祝福/);
      if (mMo1) { out.push({ kind: 'enterBless', first: parseInt(mMo1[1], 10), later: parseInt(mMo1[2], 10) }); nMo++; }
      if (/战斗阶段结束时，若当回合自身使用了技能则消耗1层自然祝福/.test(t)) { out.push({ kind: 'blessTurnEnd' }); nMo++; }
      if (nMo) return;

      // 3697 擎空·凡尔斯魂印
      var nFs = 0;
      if (/所有对于速度的强化同时应用于体力/.test(t)) { out.push({ kind: 'speedToHp' }); nFs++; }
      var mFs1 = t.match(/自身背包内每死亡一只精灵则自身技能先制\+(\d+)，最高先制\+(\d+)/);
      if (mFs1) { out.push({ kind: 'deadAllyPriority', per: parseInt(mFs1[1], 10), cap: parseInt(mFs1[2], 10) }); nFs++; }
      var mFs2 = t.match(/回合开始时[，,]?若自身体力高于对手则当回合免疫异常状态且(\d+)%使对手全属性-1/);
      if (mFs2) { out.push({ kind: 'highHpImmuneAllDown', chance: parseInt(mFs2[1], 10) }); nFs++; }
      var mFs3 = t.match(/若自身体力低于对手则当回合受到的伤害减少(\d+)%（包括攻击伤害和固定伤害）且(\d+)%使对手全属性-1/);
      if (mFs3) { out.push({ kind: 'lowHpReduceAllDown', pct: parseInt(mFs3[1], 10), chance: parseInt(mFs3[2], 10) }); nFs++; }
      if (nFs) return;

      // 3683 混沌魔尊魂印
      var nHz = 0;
      if (/首次登场100%令对手随机进入1种控制类异常状态/.test(t)) { out.push({ kind: 'enterRandomStatus', first: true }); nHz++; }
      if (/之后每次登场100%令对手随机进入1种异常状态/.test(t)) { out.push({ kind: 'enterRandomStatus', first: false }); nHz++; }
      var mHz = t.match(/自身攻击造成伤害高于(\d+)则100%令对手随机进入1种异常状态[，,]?\s*自身攻击造成伤害低于(\d+)则下回合攻击先制\+(\d+)且必定致命/);
      if (mHz) { out.push({ kind: 'atkThreshStatus', high: parseInt(mHz[1], 10), low: parseInt(mHz[2], 10), prio: parseInt(mHz[3], 10) }); nHz++; }
      if (nHz) return;

      // 3627 不羁·弗里德魂印
      var nFr = 0;
      if (/自身攻击技能命中前消除对手回合类效果/.test(t)) { out.push({ kind: 'preHitClearFoe' }); nFr++; }
      var mFr1 = t.match(/若对手先出手则对手技能命中前直至当回合结束后自身免疫异常状态且当回合受到的攻击伤害减少(\d+)%/);
      if (mFr1) { out.push({ kind: 'ifFoeFirstReduce', pct: parseInt(mFr1[1], 10) }); nFr++; }
      var mFr2 = t.match(/若自身先出手则自身技能命中前直至当回合结束后自身免疫能力下降状态且当回合造成的攻击伤害提升(\d+)%/);
      if (mFr2) { out.push({ kind: 'ifSelfFirstBoost', pct: parseInt(mFr2[1], 10) }); nFr++; }
      if (nFr) return;

      // 3568 圣地卡修斯魂印
      var nKs = 0;
      var mKs0 = t.match(/每次登场时为自身附加等同于自身最大体力值1\/(\d+)的护盾且当回合开始起自身免疫异常状态直到自身的下个回合开始/);
      if (mKs0) { out.push({ kind: 'enterShieldImmune', num: 1, den: parseInt(mKs0[1], 10) }); nKs++; }
      var mKs1 = t.match(/回合开始时若自身存在护盾则自身使用攻击技能先制\+(\d+)/);
      if (mKs1) { out.push({ kind: 'shieldPriority', value: parseInt(mKs1[1], 10) }); nKs++; }
      var mKs2 = t.match(/自身护盾消失时消除对手回合类效果和能力提升状态[，,]?\s*同时使对手随机(\d+)个技能的PP值归零/);
      if (mKs2) { out.push({ kind: 'shieldBreakClear', ppCount: parseInt(mKs2[1], 10) }); nKs++; }
      if (nKs) return;

      // 3541 魔灵王·斯摩亚蒂魂印
      var nSm = 0;
      if (/首次出战登场时[，,]?自身无效对手下次攻击技能并消除对手的回合类效果[，,]?\s*若消除成功则当回合开始时令对手害怕/.test(t)) { out.push({ kind: 'firstEntryNullAttack' }); nSm++; }
      if (/回合开始时[，,]?若自身体力高于最大体力的1\/2则以回合类效果的形式使自身当回合回合类效果无法被消除/.test(t)) { out.push({ kind: 'halfHpRoundLock' }); nSm++; }
      var mSm = t.match(/若自身体力低于最大体力的1\/2则当回合自身所有技能先制\+(\d+)且战斗阶段结束时恢复自身最大体力的(\d+)\/(\d+)/);
      if (mSm) { out.push({ kind: 'halfHpPrioHeal', prio: parseInt(mSm[1], 10), num: parseInt(mSm[2], 10), den: parseInt(mSm[3], 10) }); nSm++; }
      if (nSm) return;

      // 3539 混沌·布莱克魂印
      var nBl = 0;
      if (/自身首次死亡时\d+%的概率会残留1点体力/.test(t)) { out.push({ kind: 'firstDeathSurvive' }); nBl++; }
      if (/同时战斗阶段结束时\d+%令对手害怕/.test(t)) { out.push({ kind: 'deathFear' }); nBl++; }
      if (/对手使用属性技能则自身免疫下1次受到的异常状态/.test(t)) { out.push({ kind: 'statusSkillImmuneNext' }); nBl++; }
      var mBl = t.match(/对手使用攻击技能则自身有(\d+)%的概率闪避对手攻击[，,]?\s*若该效果触发则下回合自身攻击造成的伤害提升(\d+)%，若该效果未触发则战斗阶段结束时附加自身攻击值(\d+)%的百分比伤害/);
      if (mBl) { out.push({ kind: 'chanceDodge', pct: parseInt(mBl[1], 10), buffPct: parseInt(mBl[2], 10), counterPct: parseInt(mBl[3], 10) }); nBl++; }
      if (nBl) return;

      // 3514 弑神猎皇魂印（822 与 1646 两版）
      var nSl4 = 0;
      var mSl40 = t.match(/自身攻击技能忽略对手双防值的(\d+)%[，,]?\s*连续使用时效果提升(\d+)%，最高叠加至(\d+)%/);
      if (mSl40) { out.push({ kind: 'ignoreDefStack', base: parseInt(mSl40[1], 10), per: parseInt(mSl40[2], 10), cap: parseInt(mSl40[3], 10) }); nSl4++; }
      if (/自身使用攻击技能后获得(\d+)支灭神之箭/.test(t)) { out.push({ kind: 'arrowsOnAtk', count: parseInt(t.match(/获得(\d+)支/)[1], 10) }); nSl4++; }
      if (nSl4) return;
      var nSl5 = 0;
      var mSl41 = t.match(/回合开始时[，,]?若自身体力高于对手则自身当回合技能先制\+(\d+)且直到本场战斗自身的下个回合开始[，,]?自身免疫受到的异常状态/);
      if (mSl41) { out.push({ kind: 'highHpPrioImmune', prio: parseInt(mSl41[1], 10) }); nSl5++; }
      var mSl42 = t.match(/战斗阶段结束时[，,]?若自身体力低于对手则吸取对手最大体力的(\d+)\/(\d+)/);
      if (mSl42) { out.push({ kind: 'endDrainIfLow', num: parseInt(mSl42[1], 10), den: parseInt(mSl42[2], 10) }); nSl5++; }
      if (nSl5) return;

      // 3456 圣光·斯嘉丽魂印
      var nSj = 0;
      var mSj0 = t.match(/回合开始时若自身体力高于对手则令自身随机(\d+)项能力值\+(\d+)并附加给对手相同属性的能力下降/);
      if (mSj0) { out.push({ kind: 'randomUpFoeDown', count: parseInt(mSj0[1], 10), stages: parseInt(mSj0[2], 10) }); nSj++; }
      var mSj1 = t.match(/回合开始时若自身体力低于对手则当回合受到的攻击伤害额外减少(\d+)\/(\d+)/);
      if (mSj1) { out.push({ kind: 'lowHpExtraReduce', num: parseInt(mSj1[1], 10), den: parseInt(mSj1[2], 10) }); nSj++; }
      var mSj2 = t.match(/自身受到的固定伤害和百分比伤害将持续减少(\d+)\/(\d+)/);
      if (mSj2) { out.push({ kind: 'fixedPctPersistReduce', num: parseInt(mSj2[1], 10), den: parseInt(mSj2[2], 10) }); nSj++; }
      if (nSj) return;
      var mSj3 = t.match(/自身首次使用攻击技能则出手流程结束时(\d+)%令对手失明[，,]?\s*之后每次使用概率提升(\d+)%，最高提升至(\d+)%[，,]?\s*未触发则消除对手回合类效果且令自身下回合造成的攻击伤害提升(\d+)%/);
      if (mSj3) { out.push({ kind: 'blindStack', base: parseInt(mSj3[1], 10), per: parseInt(mSj3[2], 10), cap: parseInt(mSj3[3], 10), missBuffPct: parseInt(mSj3[4], 10) }); return; }

      // 3482 圣·瑞尔斯魂印
      var nRl = 0;
      var mRl0 = t.match(/自身使用攻击技能后令对手下(\d+)次属性技能无效/);
      if (mRl0) { out.push({ kind: 'foeStatusSealOnAtk', times: parseInt(mRl0[1], 10) }); nRl++; }
      var mRl1 = t.match(/自身使用属性技能后战斗阶段结束时恢复自身最大体力的(\d+)\/(\d+)并造成等量百分比伤害[，,]?\s*自身体力低于1\/2时恢复效果和百分比伤害翻倍/);
      if (mRl1) { out.push({ kind: 'statusSkillEndHeal', num: parseInt(mRl1[1], 10), den: parseInt(mRl1[2], 10), doubleLow: true }); nRl++; }
      if (nRl) return;
      var nRl2 = 0;
      if (/回合开始时[，,]?若自身体力高于对手则当回合自身造成的伤害翻倍/.test(t)) { out.push({ kind: 'startDamageDouble' }); nRl2++; }
      if (/若自身体力低于对手则战斗阶段结束时恢复等同于当回合造成伤害数值的体力并造成等量百分比伤害/.test(t)) { out.push({ kind: 'endHealByDealt' }); nRl2++; }
      if (nRl2) return;
      var mRl2 = t.match(/每次受到攻击都会反馈给对手所受攻击伤害(\d+)\/(\d+)的百分比伤害[，,]?\s*反馈的伤害超过(\d+)时自身全属性\+(\d+)/);
      if (mRl2) { out.push({ kind: 'reflectOnHitPct', num: parseInt(mRl2[1], 10), den: parseInt(mRl2[2], 10), threshold: parseInt(mRl2[3], 10), stages: parseInt(mRl2[4], 10) }); return; }

      // 3414 混沌魔君索伦森魂印
      var mSl = t.match(/登场时[，,]?消除对手能力提升状态[，,]?消除成功则以回合类效果的形式令对手(\d+)回合内无法处于能力提升状态且令对手下(\d+)次使用的属性技能无效/);
      if (mSl) { out.push({ kind: 'enterClearLock', turns: parseInt(mSl[1], 10), statusSkills: parseInt(mSl[2], 10) }); return; }
      if (/若对手存在高于自身的能力等级[，,]?则令对手该能力等级变为与自身相同/.test(t)) { out.push({ kind: 'mirrorFoeStages' }); return; }
      var mSl2 = t.match(/回合开始时[，,]?若自身不处于能力提升状态[，,]?则(\d+)%使自身免疫对手下次使用的技能造成的攻击伤害[，,]?未触发则当回合受到的攻击伤害减少(\d+)%/);
      if (mSl2) { out.push({ kind: 'immuneNextOrHalve', chance: parseInt(mSl2[1], 10), pct: parseInt(mSl2[2], 10) }); return; }
      var mSl3 = t.match(/战斗阶段结束时若自身处于能力提升状态[，,]?则恢复自身最大体力的(\d+)\/(\d+)并附加等量的百分比伤害/);
      if (mSl3) { out.push({ kind: 'endHealIfUp', num: parseInt(mSl3[1], 10), den: parseInt(mSl3[2], 10) }); return; }

      // 3311 圣光灵神魂印：固伤 / 重生 / 重生后威力
      if (/每次使用攻击技能附加对手上次造成伤害数值一半的固定伤害/.test(t)) { out.push({ kind: 'prevDamageHalfAttack' }); return; }
      var mRv = t.match(/自身死亡后(\d+)%重生一次/);
      if (mRv) {
        out.push({ kind: 'reviveOnce', clear: /消除对手能力提升状态和回合类效果/.test(t), immune: /免疫下1次受到的异常状态/.test(t) });
        return;
      }
      // 3421 圣灵之魂迈尔斯魂印
      var mMy = t.match(/攻击技能命中后附加自身最大体力值(\d+)%的百分比伤害/);
      if (mMy) { out.push({ kind: 'atkHitPercentMaxHp', pct: parseInt(mMy[1], 10) }); return; }
      var mMy2 = t.match(/回合开始时[，,]?若自身体力高于最大体力的1\/2[，,]?则当回合受到的攻击伤害减少(\d+)%/);
      if (mMy2) { out.push({ kind: 'startTakenMul', pct: parseInt(mMy2[1], 10) }); return; }
      var mMy3 = t.match(/战斗阶段结束时[，,]?若自身体力低于最大体力的1\/2[，,]?则恢复自身最大体力的(\d+)\/(\d+)并造成等量百分比伤害/);
      if (mMy3) { out.push({ kind: 'endHealLowPct', num: parseInt(mMy3[1], 10), den: parseInt(mMy3[2], 10) }); return; }
      var mRv2 = t.match(/重生后自身(\d+)回合所有技能威力提升(\d+)%/);
      if (mRv2) { out.push({ kind: 'revivePowerBuff', turns: parseInt(mRv2[1], 10), mul: 1 + parseInt(mRv2[2], 10) / 100 }); return; }
      // 帝天战佛（3033）魂印「渡」：被击败的回合结束后清算
      if (/自身被击败后/.test(t) && /吸取对手的能力提升/.test(t) && /PP(?:值)?归0|PP(?:值)?归零/i.test(t)) {
        out.push({ kind: 'dtzfSoul' }); return;
      }



      // —— 登场窗口：「首次登场之后前2回合…」「登场后3回合内…」 ——
      m = t.match(/^(首次)?(?:登场|出战|上场|开场)(?:之后|后)?(前)?(首|\d+|[一二两三四五六七八九十])回合(?:内)?(.+)$/);
      if (m) {
        var CN2 = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 首: 1 };
        var tn = CN2[m[3]] || parseInt(m[3], 10) || 1;
        pushEntryWindow(m[4], tn, !!m[1], out);
        if (out.length) return;
      }

      // —— 被击败后给下一只的增益 ——
      m = t.match(/^自身被击败后[，,]?\s*己方下(?:只|一只)出场精灵(\d+)回合内受到的攻击伤害和固定伤害减少(\d+)%/);
      if (m) {
        out.push({ kind: 'deathTeamGuard', turns: parseInt(m[1], 10), mul: 1 - parseInt(m[2], 10) / 100 });
        return;
      }

      // 满体力时的概率免疫
      m = t.match(/满体力时(\d+)%(?:概率)?免疫异常状态/);
      if (m) { out.push({ kind: 'chanceImmuneStatus', chance: parseInt(m[1], 10) }); return; }
      m = t.match(/满体力时(\d+)%(?:概率)?免疫能力下降状态/);
      if (m) { out.push({ kind: 'permImmuneStatWhenFull' }); return; }
      // 登场时立刻削对手能力
      m = t.match(/登场时(?:使|令)对手(攻击|防御|特攻|特防|速度|命中|闪避)-?(\d+)/);
      if (m) { out.push({ kind: 'entryStatDown', turns: 1, stat: STAT_WORD[m[1]], stages: parseInt(m[2], 10) }); return; }
      // 上场后 N 回合内使对手属性技能无效
      m = t.match(/上场后(\d+)回合内使对手属性技能无效/);
      if (m) { out.push({ kind: 'entrySkillBlock', turns: parseInt(m[1], 10) }); return; }
      // 受到先制技能伤害减少
      m = t.match(/受到先制技能的伤害减少(\d+)%/);
      if (m) { out.push({ kind: 'taken', value: 1 - parseInt(m[1], 10) / 100 }); return; }
      // 有强化时暴击率提升
      m = t.match(/处于能力提升状态时[，,]?致命一击的概率提升(\d+)%/);
      if (m) { out.push({ kind: 'critBonus', value: parseInt(m[1], 10) }); return; }
      // 使对手命中率下降
      m = t.match(/使对手的命中率-(\d+)%/);
      if (m) { out.push({ kind: 'entryStatDown', turns: 1, stat: 'acc', stages: 1 }); return; }
      // 每次直接攻击都有 X% 概率使对手状态
      m = t.match(/每次直接攻击都有(\d+)%(?:概率)?(?:使|令)对手(中毒|烧伤|冻伤|麻痹|混乱|石化|流血|易燃)/);
      if (m) { out.push({ kind: 'onHitStatus', statusId: STATUS_WORD[m[2]], chance: parseInt(m[1], 10) }); return; }

      // 更多老式魂印句式
      m = t.match(/(\d+)%(?:的)?概率(?:使|令)(?:对手|敌方)攻击落空/);
      if (m) { out.push({ kind: 'dodgePassive', chance: parseInt(m[1], 10) }); return; }
      m = t.match(/对手处于异常状态时(?:技能)?威力翻倍/);
      if (m) { out.push({ kind: 'dealtMulFoeStatus', mul: 2 }); return; }
      m = t.match(/每次(?:收到|受到)攻击都会反馈给对手(\d+)\/(\d+)的伤害/);
      if (m) { out.push({ kind: 'onHitReflect', num: parseInt(m[1], 10), den: parseInt(m[2], 10) }); return; }
      m = t.match(/每次攻击(\d+)%(?:的)?概率附加(\d+)点固定伤害/);
      if (m) { out.push({ kind: 'onHitExtraFlat', chance: parseInt(m[1], 10), value: parseInt(m[2], 10) }); return; }
      m = t.match(/处于能力提升状态时[，,]?每回合恢复(\d+)HP/);
      if (m) { out.push({ kind: 'endHealCond', value: parseInt(m[1], 10) }); return; }
      m = t.match(/满体力时(?:使|令)?对手(攻击|防御|特攻|特防|速度|命中|闪避)-(\d+)/);
      if (m) { out.push({ kind: 'entryStatDown', turns: 1, stat: STAT_WORD[m[1]], stages: parseInt(m[2], 10), req: { type: 'fullHp' } }); return; }
      m = t.match(/受到致死攻击时(\d+)%概率重生/);
      if (m) { out.push({ kind: 'reviveChance', chance: parseInt(m[1], 10) }); return; }



      // —— 场下精灵相关（帝君之罚 / 帝君之赐）——
      m = t.match(/(?:[\u4e00-\u9fa5]{0,6})出战后对对方不在场精灵附加其最大体力(\d+)\/(\d+)的真实伤害/);
      if (m) { out.push({ kind: 'benchStrike', num: parseInt(m[1], 10), den: parseInt(m[2], 10) }); return; }
      m = t.match(/(?:[\u4e00-\u9fa5]{0,6})出战后恢复己方所有不在场精灵其最大体力的(\d+)\/(\d+)/);
      if (m) { out.push({ kind: 'benchHeal', num: parseInt(m[1], 10), den: parseInt(m[2], 10) }); return; }
      if (/自身免疫受到的固定伤害、百分比伤害/.test(t)) { out.push({ kind: 'immuneFixedPct' }); return; }

      m = t.match(/位于出战背包时[，,]?己方精灵(.+)$/);
      if (m) {
        var a2 = m[1].match(/(攻击|防御|特攻|特防|速度|体力)[^0-9]{0,6}(\d+)/);
        if (a2) {
          out.push({ kind: 'benchAura', names: null, fx: { type: 'teamStat', stat: STAT_WORD[a2[1]] || 'hp', pct: parseInt(a2[2], 10) } });
          return;
        }
        out.push({ kind: 'benchAura', names: null, fx: { type: 'note', text: m[1].slice(0, 40) } });
        return;
      }

      m = t.match(/背包内每存在一种(.{2,8}?)精灵时[，,]?自身每回合恢复(\d+)点体力(?:\(最多每回合恢复(\d+)点\))?/);
      if (m) {
        out.push({ kind: 'regenPerSibling', group: m[1], value: parseInt(m[2], 10), cap: m[3] ? parseInt(m[3], 10) : 0 });
        return;
      }

      // 天启帝君 3550：帝君之罚/赐/援/御/阵/威/殒
      if (/帝君之御/.test(t)) { out.push({ kind: 'junYu' }); return; }
      if (/帝君之阵/.test(t)) { out.push({ kind: 'junZhen' }); return; }
      if (/帝君之威/.test(t)) { out.push({ kind: 'junWei' }); return; }
      if (/帝君之殒/.test(t)) { out.push({ kind: 'junYun', chance: 30 }); return; }
      if (/帝君之援/.test(t)) { out.push({ kind: 'junYuan' }); return; }

      // 被击败后复活 1 只阵亡队友（重生之翼 2987）
      if (/被击败后/.test(t) && /复活/.test(t) && /阵亡/.test(t)) {
        var revM = /(\d+)%?\s*复活/.exec(t);
        var revChance = revM ? parseInt(revM[1], 10) : 100;
        if (!(revM && /%/.test(revM[0]))) revChance = 100;
        out.push({ kind: 'reviveTeammate', chance: revChance });
        return;
      }

      // 神耀能量：层数解锁型被动
      if (/神耀能量/.test(t)) {
        var mx = parseInt((t.match(/最多(\d+)层神耀能量/) || [])[1] || '5', 10);
        var th = [];
        if (/2层[：:][^|]*(免疫|不受)[^|]*异常/.test(t)) th.push({ at: 2, fx: { kind: 'immuneStatus' } });
        if (/3层[：:]/.test(t)) th.push({ at: 3, fx: { kind: 'endHeal', num: 1, den: 3 } });
        if (/4层[：:]/.test(t)) th.push({ at: 4, fx: { kind: 'immuneFixedPct' } });
        if (/5层[：:]/.test(t)) th.push({ at: 5, fx: { kind: 'priority', value: 1 } });
        if (/6层[：:]/.test(t)) th.push({ at: 6, fx: { kind: 'dealt', value: 1.6 } });
        out.push({ kind: 'stackPassive', maxStacks: mx, perStackReduce: 8, thresholds: th });
        var rev = /自身被击败后[，,]?(\d+)%复活出战阵容中的1只阵亡/.exec(t);
        if (rev) out.push({ kind: 'reviveTeammate', chance: parseInt(rev[1], 10) });
        else if (/自身被击败后[，,]?复活出战背包内的1只阵亡/.test(t)) out.push({ kind: 'reviveTeammate', chance: 100 });
        return;
      }


      // 启灵元神：神殇 / 神印 / 神谕 / 神照 / 神启（魂印前缀已被 parseSoulmark 剥离，按正文匹配）
      if (/^回合开始时创造一个神秘结界/.test(t)) { out.push({ kind: 'exile', min: 1, max: 3, lowMax: 2, capAliveMinus: 2 }); return; }
      if (/^自身在出战背包时[，,]?对方主动切换精灵登场时/.test(t)) { out.push({ kind: 'benchAura', names: null, fx: { type: 'markOnSwitch', value: 1 } }); return; }
      if (/己方不在场精灵体力低于最大体力的1\/2时不会下降/.test(t)) { out.push({ kind: 'benchAura', names: null, fx: { type: 'benchFloor', pct: 50 } }); return; }
      if (/^自身在出战背包时[，,]?己方首发精灵首次登场时获得/.test(t)) { out.push({ kind: 'benchAura', names: null, fx: { type: 'firstShield', pct: 30 } }); return; }
      // 神启：回合开始时按自身体力分支（>1/2 免疫异常/能力下降，<1/2 获得护盾）
      if (/^回合开始时[，,]?若自身体力高于最大体力的1\/2则当回合自身免疫/.test(t)) { out.push({ kind: 'divineTurn', highPct: 50, lowPct: 50, shieldPct: 30 }); return; }
      // —— 桃园 / 西游组（2026-10-21）——
      // 三藏：在背包时，己方出战精灵每次攻击有概率增伤，未触发则吸血
      m = t.match(/^自身在出战背包时使己方出战精灵每次攻击(\d+)%的概率伤害提高(\d+)%/);
      if (m) {
        var dmS = t.match(/随机[^0-9]{0,4}(\d+)~(\d+)点/);
        out.push({ kind: 'benchAura', names: null, fx: { type: 'attackBuff', chance: parseInt(m[1], 10), mul: 1 + parseInt(m[2], 10) / 100, min: dmS ? parseInt(dmS[1], 10) : 1, max: dmS ? parseInt(dmS[2], 10) : 100 } });
        return;
      }
      // 沙悟净：满体力时当回合减伤 50%
      m = t.match(/^回合开始时若自身满体力则当回合受到的攻击伤害减少(\d+)%/);
      if (m) { out.push({ kind: 'fullHpGuard', pct: parseInt(m[1], 10) }); return; }
      // 沙悟净：战斗阶段结束时的递增固伤
      m = t.match(/^战斗阶段结束时附加(\d+)点固定伤害[，,]每回合增加(\d+)点[，,]最高(\d+)点/);
      if (m) {
        out.push({ kind: 'endRampFlat', base: parseInt(m[1], 10), inc: parseInt(m[2], 10), cap: parseInt(m[3], 10), dbl: /对手处于能力提升状态时固伤效果翻倍/.test(t) });
        return;
      }
      // 天河神将：受到攻击消除对手能力提升
      if (/^受到攻击将消除对手能力提升状态/.test(t)) { out.push({ kind: 'onHitClearFoeStats' }); return; }
      // 孙悟空：免疫能力下降 + 焚烬/烧伤
      if (/^孙悟空天生免疫能力下降状态/.test(t)) {
        out.push({ kind: 'immuneStat' });
        out.push({ kind: 'immuneStatusIds', ids: ['burn'] });
        return;
      }
      // 孙悟空：对手体力 >1/2 增伤，<1/2 先制 + 追加百分比伤害
      if (/^回合开始时[，,]?若对手体力高于其最大体力的1\/2/.test(t)) { out.push({ kind: 'wukongTurn' }); return; }
      // 孙悟空：法天象地·圣（每场一次）
      if (/^每场战斗限一次[，,]?回合开始时若孙悟空处于异常状态且体力低于最大体力的1\/2/.test(t)) { out.push({ kind: 'wukongForm' }); return; }
      if (/^触发时重置自身的体力值、PP值、所处异常状态/.test(t)) { out.push({ kind: 'wukongFormDetail' }); return; }
      // —— 马尔修斯形态组（2026-10-21）——
      // 3393 坚壁：登场护盾 300 / 免疫下 1 次异常 / 破碎 2 回合重激活 / 未激活回合末回 1/3
      if (/护盾消失后会在\d+回合后重新激活/.test(t)) {
        var mgShield = (t.match(/吸收(\d+)点伤害的护盾/) || [])[1];
        var mgRe = (t.match(/护盾消失后会在(\d+)回合后重新激活/) || [])[1];
        var mgHeal = (t.match(/恢复自身最大体力的(\d+)\/(\d+)/) || []);
        out.push({
          kind: 'morphGuard',
          shield: mgShield ? parseInt(mgShield, 10) : 300,
          recharge: mgRe ? parseInt(mgRe, 10) : 2,
          healNum: mgHeal[1] ? parseInt(mgHeal[1], 10) : 1,
          healDen: mgHeal[2] ? parseInt(mgHeal[2], 10) : 3
        });
        return;
      }
      // 3393 极速：先制额外 +1；先手攻击伤害结算前对手全属性 -1
      if (/所有技能先制额外\+1/.test(t) && /全属性-\d+/.test(t)) {
        var msDown = (t.match(/全属性-(\d+)/) || [])[1];
        out.push({ kind: 'morphSpeed', priority: 1, statDown: msDown ? parseInt(msDown, 10) : 1 });
        return;
      }
      // 3393 毁灭：攻击伤害 +70%；对手 <25% 秒杀
      if (/所有攻击技能伤害提升\d+%/.test(t) && /对手体力低于\d+%则所有技能必定秒杀/.test(t)) {
        var mdMul = (t.match(/所有攻击技能伤害提升(\d+)%/) || [])[1];
        var mdExec = (t.match(/低于(\d+)%/) || [])[1];
        out.push({ kind: 'morphDestroy', dmgMul: 1 + parseInt(mdMul, 10) / 100, execPct: mdExec ? parseInt(mdExec, 10) : 25 });
        return;
      }
      if (/终极技能王[•·]异甲同心/.test(t)) { out.push({ kind: 'morphUltimate' }); return; }
      // 2880 极速型：先手禁疗 + 下回合速度 +1
      if (/^先出手时对手本回合无法通过自身技能恢复自身体力/.test(t)) { out.push({ kind: 'firstHealBlock' }); return; }
      if (/^先出手时下回合自身速度\+1/.test(t)) { out.push({ kind: 'firstSpeedUp' }); return; }
      // 2881 坚壁型：双防 +30%，受伤 -20%
      m = t.match(/^自身的双防能力值提升(\d+)%/);
      if (m) { out.push({ kind: 'defStatsPct', pct: parseInt(m[1], 10) }); return; }
      m = t.match(/^受到的伤害减少(\d+)%/);
      if (m) { out.push({ kind: 'taken', value: 1 - parseInt(m[1], 10) / 100 }); return; }
      // 2882 毁灭型：对手 <25% 时所有技能秒杀
      m = t.match(/^回合开始时[,，]?若对手体力低于(\d+)%[,，]?则所有技能必定瞬杀/);
      if (m) { out.push({ kind: 'lowHpExec', pct: parseInt(m[1], 10) }); return; }
      // —— 天启星魂 4677（2026-10-21）——
      if (/双攻值.*二者之和/.test(t)) {
        var sdPct = t.match(/双防值总和(\d+)%的体力/);
        out.push({ kind: 'starAtkSum' });
        out.push({ kind: 'starSpecialPrio', value: 1 });
        out.push({ kind: 'starPhysDrain', pct: sdPct ? parseInt(sdPct[1], 10) : 30 });
        return;
      }
      if (/每次登场时进行星启/.test(t)) { out.push({ kind: 'starEntry' }); return; }
      if (/异常状态结束的当回合结束后转动星盘/.test(t)) {
        var sdMax = (t.match(/星盘转动(\d+)个刻度/) || [])[1];
        var sdDmg = (t.match(/附加(\d+)点/) || [])[1];
        out.push({ kind: 'starDial', maxTicks: sdMax ? parseInt(sdMax, 10) : 12, returnDmg: sdDmg ? parseInt(sdDmg, 10) : 120, reducePct: 99 });
        return;
      }
      // —— 背包光环（位于背包中时…）——
      m = t.match(/位于背包中时[，,]?\s*使得?己方背包中([^，,。；]+?)的(.+)$/);
      if (m) {
        var names2 = m[1].split(/[、和及]/).map(function (s) { return s.trim().replace(/专属.*$/, ''); }).filter(Boolean);
        var rest2 = m[2];
        var hv = rest2.match(/体力恢复效果从(\d+)点提升至(\d+)点/);
        if (hv) {
          var capM = rest2.match(/最多可叠加至(\d+)点/);
          out.push({ kind: 'benchAura', names: names2, fx: { type: 'healFix', from: parseInt(hv[1], 10), to: parseInt(hv[2], 10), cap: capM ? parseInt(capM[1], 10) : 0 } });
          return;
        }
        out.push({ kind: 'benchAura', names: names2, fx: { type: 'note', text: rest2.slice(0, 40) } });
        return;
      }
      m = t.match(/位于背包中时[，,]?\s*(?:使得)?己方(?:所有|全体|全部)精灵(.+)$/);
      if (m) {
        var rest3 = m[1];
        var stv = rest3.match(/(攻击|防御|特攻|特防|速度|体力)[^0-9]{0,6}(\d+)%/);
        if (stv) {
          out.push({ kind: 'benchAura', names: null, fx: { type: 'teamStat', stat: STAT_WORD[stv[1]] || 'hp', pct: parseInt(stv[2], 10) } });
          return;
        }
        out.push({ kind: 'benchAura', names: null, fx: { type: 'note', text: rest3.slice(0, 40) } });
        return;
      }

      // 闪避 / 减伤 / 受击附加状态（老式魂印常见）
      m = t.match(/(\d+)%闪避对手的攻击/);
      if (m) { out.push({ kind: 'dodgePassive', chance: parseInt(m[1], 10) }); return; }
      m = t.match(/(\d+)%的概率使敌方攻击落空/);
      if (m) { out.push({ kind: 'dodgePassive', chance: parseInt(m[1], 10) }); return; }
      m = t.match(/减少(\d+)%受到伤害/);
      if (m) { out.push({ kind: 'taken', value: 1 - parseInt(m[1], 10) / 100 }); return; }
      m = t.match(/减少(\d+)%来自.{1,10}的攻击伤害/);
      if (m) { out.push({ kind: 'taken', value: 1 - parseInt(m[1], 10) / 100 }); return; }
      m = t.match(/受到攻击(\d+)%的概率(?:使|令)对手(中毒|烧伤|冻伤|麻痹|混乱|石化|流血|易燃)/);
      if (m) { out.push({ kind: 'onHitStatus', statusId: STATUS_WORD[m[2]], chance: parseInt(m[1], 10) }); return; }
      m = t.match(/若受到的攻击伤害大于(\d+)[，,]?则令对手(中毒|烧伤|冻伤|麻痹|混乱|石化|流血|易燃)/);
      if (m) { out.push({ kind: 'onHitCondStatus', threshold: parseInt(m[1], 10), statusId: STATUS_WORD[m[2]] }); return; }
      if (/出战时[，,]?首回合免疫所有异常状态/.test(t)) { out.push({ kind: 'entryImmuneStatus', turns: 1 }); return; }
      m = t.match(/^(\d+)%概率免疫异常状态/);
      if (m) { out.push({ kind: 'chanceImmuneStatus', chance: parseInt(m[1], 10) }); return; }
      if (/所有自身受到的异常状态只持续一回合/.test(t)) { out.push({ kind: 'statusShorten' }); return; }
      m = t.match(/若回合内没有受到伤害[，,]?则恢复(\d+)点体力/);
      if (m) { out.push({ kind: 'noDamageHeal', value: parseInt(m[1], 10) }); return; }
      m = t.match(/每次直接攻击都有(\d+)%的概率(?:使|令)对手(中毒|烧伤|冻伤|麻痹|混乱|石化|流血|易燃)/);
      if (m) { out.push({ kind: 'onHitStatus', statusId: STATUS_WORD[m[2]], chance: parseInt(m[1], 10) }); return; }

      // 先处理「回合结束 / 受击后」这类可实现的特殊被动
      m = t.match(/每次攻击都附加对手当前体力值(\d+)%的固定伤害/);
      if (m) { out.push({ kind: 'onHitFlatPct', pct: parseInt(m[1], 10) }); return; }
      m = t.match(/首次出场时带有能抵挡(\d+)点伤害的护盾/);
      if (m) { out.push({ kind: 'entryShield', value: parseInt(m[1], 10) }); return; }
      m = t.match(/(\d+)%免疫对手致命一击造成的伤害/);
      if (m) { out.push({ kind: 'critImmune', chance: parseInt(m[1], 10) }); return; }
      m = t.match(/开场(\d+)回合内所有直接攻击(?:都)?(?:会)?(?:使|令)对手(攻击|防御|特攻|特防|速度|命中|闪避)-(\d+)/);
      if (m) { out.push({ kind: 'entryStatDown', turns: parseInt(m[1], 10), stat: STAT_WORD[m[2]], stages: parseInt(m[3], 10) }); return; }
      m = t.match(/开场(\d+)回合内所有直接攻击都将额外附带(\d+)%概率(?:使|令)对手(中毒|烧伤|冻伤|麻痹|混乱|石化|流血|易燃)/);
      if (m) { out.push({ kind: 'entryStatus', turns: parseInt(m[1], 10), chance: parseInt(m[2], 10), statusId: STATUS_WORD[m[3]] }); return; }
      if (/免疫下1次受到的技能伤害/.test(t)) { out.push({ kind: 'onHitImmune' }); return; }
      if (/受到(?:的)?(?:攻击)?伤害(?:减半|降低一半)/.test(t)) { out.push({ kind: 'taken', value: 0.5 }); return; }
      m = t.match(/(?:受到的)?所有?攻击伤害减少(\d+)%/);
      if (m) { out.push({ kind: 'taken', value: 1 - parseInt(m[1], 10) / 100 }); return; }
      m = t.match(/造成伤害的(\d+)%恢复自身体力/);
      if (m) { out.push({ kind: 'drainOnHit', num: parseInt(m[1], 10), den: 100 }); return; }
      m = t.match(/(\d+)%概率打出致命一击/);
      if (m) { out.push({ kind: 'critBonus', value: parseInt(m[1], 10) }); return; }
      m = t.match(/每回合开始时为自身附加(\d+)点护盾/);
      if (m) { out.push({ kind: 'regenShield', value: parseInt(m[1], 10) }); return; }
      m = t.match(/增加(\d+)点体力上限/);
      if (m) { out.push({ kind: 'hpBonus', value: parseInt(m[1], 10) }); return; }
      m = t.match(/(?:每次攻击|攻击时)(\d+)%?(?:的)?(?:概率)?(?:使|令)对手(中毒|烧伤|冻伤|麻痹|混乱|石化|流血|易燃)/);
      if (m) { out.push({ kind: 'onHitStatus', statusId: STATUS_WORD[m[2]], chance: parseInt(m[1], 10) }); return; }
      m = t.match(/攻击时有(\d+)%的概率秒杀对手/);
      if (m) { out.push({ kind: 'execChance', value: parseInt(m[1], 10) }); return; }
      m = t.match(/免疫低于(\d+)的攻击伤害/);
      if (m) { out.push({ kind: 'immuneBelowPassive', value: parseInt(m[1], 10) }); return; }
      m = t.match(/恢复最大体力值?(\d+)\/(\d+)/);
      if (m) { out.push({ kind: 'endHeal', num: parseInt(m[1], 10), den: parseInt(m[2], 10) }); return; }
      m = t.match(/附加自身已损失体力(\d+)%的百分比伤害/);
      if (m) { out.push({ kind: 'endDamageLost', value: parseInt(m[1], 10) / 100 }); return; }
      m = t.match(/恢复自身最大体力的(\d+)\/(\d+)(?:和随机(\d+)个)?/);
      if (m) {
        out.push({ kind: 'endHeal', num: parseInt(m[1], 10), den: parseInt(m[2], 10) });
        if (m[3]) out.push({ kind: 'endPpRestore', value: parseInt(m[3], 10) });
        return;
      }
      if (/免疫受到的异常状态和能力下降状态|免疫异常状态和能力下降状态/.test(t)) {
        out.push({ kind: 'immuneStatus' });
        out.push({ kind: 'immuneStat' });
        return;
      }
      if (/体力高于对手则当回合自身技能必定先手/.test(t)) { out.push({ kind: 'priorityIfHigher' }); return; }
      if (/奇数回合登场/.test(t) && /灵籁泳馆/.test(t)) { out.push({ kind: 'fieldOnEnter' }); return; }
      if (/登场时[，,]?\s*消除对手回合类效果/.test(t)) { out.push({ kind: 'onEnterClear' }); return; }
      if (/受到致死伤害时当回合保留/.test(t)) { out.push({ kind: 'rebirth' }); return; }

      if (SOUL_SKIP.test(t)) return;
      // 概率触发的被动不当作常驻（但「100%概率」是必定，照常解析）
      m = t.match(/(\d+)%\s*(?:的)?(?:概率|几率)/);
      if ((m && parseInt(m[1], 10) < 100) || (!m && /概率|几率/.test(t))) return;

      m = t.match(/每回合(?:结束)?(?:时)?(?:恢复|回复)(\d+)\/(\d+)(?:的)?(?:最大)?体力/);
      if (m) { out.push({ kind: 'regenRatio', num: parseInt(m[1], 10), den: parseInt(m[2], 10) }); return; }

      m = t.match(/每回合(?:结束)?(?:时)?(?:恢复|回复)(\d+)点?(?:最大)?(?:体力|HP)/i);
      if (m) { out.push({ kind: 'regen', value: parseInt(m[1], 10) }); return; }

      m = t.match(/受到(?:的)?(?:攻击)?伤害(?:减少|降低)(\d+)%/);
      if (m) { out.push({ kind: 'taken', value: 1 - parseInt(m[1], 10) / 100 }); return; }

      // 3740：本次在场攻击伤害逐次递增，必须在通用「造成伤害提升」之前
      var mClv = t.match(/自身每次使用攻击技能时本次在场造成的攻击伤害提升(\d+)%，最高提升(\d+)%/);
      if (mClv) { out.push({ kind: 'atkUseDealtStack', per: parseInt(mClv[1], 10), cap: parseInt(mClv[2], 10) }); return; }
      m = t.match(/造成(?:的)?(?:攻击)?伤害(?:提升|增加)(\d+)%/);
      if (m) { out.push({ kind: 'dealt', value: 1 + parseInt(m[1], 10) / 100 }); return; }

      m = t.match(/(?:受到|免疫)[^。]{0,6}异常状态/);
      if (/免疫[^。]{0,8}异常状态/.test(t)) { out.push({ kind: 'immuneStatus' }); return; }
      if (/免疫能力下降状态/.test(t)) { out.push({ kind: 'immuneStat' }); return; }

      m = t.match(/先制\+(\d+)/);
      if (m) { out.push({ kind: 'priority', value: parseInt(m[1], 10) }); return; }

      m = t.match(/速度\+(\d+)/);
      if (m) { out.push({ kind: 'speed', value: parseInt(m[1], 10) }); return; }
    }
  }

  /** 条件被动的倍率（taken=受伤 / dealt=增伤） */
  function condMul(c, kind, ctx) {
    var mul = 1;
    if (!c || !c.condPassives) return mul;
    for (var i = 0; i < c.condPassives.length; i++) {
      var p = c.condPassives[i];
      if (!p.fx || p.fx.kind !== kind) continue;
      if (!checkCond(p.req, ctx)) continue;
      mul *= p.fx.value;
    }
    return mul;
  }

  /** 单次伤害结算 */
  function calcDamage(o) {
    var actor = o.actor;
    var target = o.target;
    var skill = o.skill;
    var level = o.level || actor.level || 100;
    var power = o.powerOverride != null ? num(o.powerOverride) : num(skill.power);
    if (power <= 0) return { damage: 0, effectiveness: 1, crit: false, stab: false };

    var catId = skill.category ? skill.category.id : 1;
    var special = catId === 2;
    var atkKey = special ? 'spAtk' : 'atk';
    var defKey = special ? 'spDef' : 'def';

    var A;
    if (actor.starAtkSum) {
      A = actor.stats.atk * stageMul(actor.stages.atk) + actor.stats.spAtk * stageMul(actor.stages.spAtk);
    } else {
      A = actor.stats[atkKey] * stageMul(actor.stages[atkKey]);
    }
    var defStage = target.treatStatAsDown ? -target.stages[defKey] : target.stages[defKey];
    if (o.ignoreDefUp && defStage > 0) defStage = 0;
    var D = target.stats[defKey] * stageMul(defStage);
    if (!o.ignoreDefPct && actor.ignoreDefCur) o.ignoreDefPct = actor.ignoreDefCur;
    if (o.ignoreDefPct) D *= (1 - o.ignoreDefPct / 100);
    if (D <= 0) D = 1;

    var baseDmg = Math.floor(Math.floor(Math.floor(2 * level / 5 + 2) * power * A / D) / 50) + 2;

    var skillElems = comboElements(o.skillCombo);
    var actorElems = comboElements(o.actorCombo);
    var targetElems = comboElements(o.targetCombo);

    var stab = 1;
    for (var i = 0; i < skillElems.length; i++) {
      if (actorElems.indexOf(skillElems[i]) >= 0) { stab = 1.5; break; }
    }

    var eff = effMul(o.chart, skillElems, targetElems);
    if (o.noWeak && eff > 0 && eff < 1) eff = 1;

    var critRate = skill.crit_rate == null ? 6.25 : num(skill.crit_rate);
    critRate += (actor.critBonus || 0);
    critRate += (o.critAdd || 0);
    if (actor.critBuffTurns > 0) critRate = 100;
    if (actor.critTimed && actor.critTimed.turns > 0) critRate += actor.critTimed.add;
    critRate *= (1 - Math.max(0, Math.min(100, target.critResist || 0)) / 100);
    var crit = !!o.forceCrit || (o.rng ? o.rng() : Math.random()) * 100 < critRate;
    if (crit && target.critImmune && (o.rng ? o.rng() : Math.random()) * 100 < target.critImmune) {
      crit = false;
    }
    // 692「免疫受到的致命一击伤害并直接扣除对手等量体力」：先记下被免掉的那一刀
    var critNullify = crit && target.immuneCritReflect > 0;
    if (critNullify) crit = false;
    if (crit && target.blockCrit > 0 && !o.mustHit) {
      return { damage: 0, effectiveness: 1, crit: false, stab: false, blocked: true };
    }

    var rand = 0.85 + (o.rng ? o.rng() : Math.random()) * 0.15;

    var dmg = baseDmg * stab * eff * (crit ? 1.5 : 1) * rand * (o.powerMul || 1);
    // 魂印被动：增伤 / 减伤
    if (actor.dealtMul) dmg *= actor.dealtMul;
    if (crit && actor.critDamage) dmg *= actor.critDamage;
    if (o.isFirst && actor.firstDealt) dmg *= actor.firstDealt;
    if (actor.morphMode === 'destroy' && actor.morphDestroy) dmg *= actor.morphDestroy.dmgMul;
    if (actor.turnDealt) dmg *= (crit && actor.turnDealtCrit ? actor.turnDealtCrit : actor.turnDealt);
    if (target.takenMul) dmg *= target.takenMul;
    if (target.turnTakenMul && target.turnTakenMul !== 1) dmg *= target.turnTakenMul;
    var atkStatusDef = actor.status ? STATUS_DEF[actor.status.id] : null;
    var defStatusDef = target.status ? STATUS_DEF[target.status.id] : null;
    if (atkStatusDef && atkStatusDef.dealtMul) dmg *= atkStatusDef.dealtMul;
    if (defStatusDef && defStatusDef.takenPct) dmg *= 1 + defStatusDef.takenPct / 100;
    // 条件被动：若…则… / 满体力时… 的增伤与减伤
    // 注意两边的 ctx 不同：判定谁的条件，谁就是 ctx.actor
    var actxCtx = { actor: actor, target: target, turn: o.turn || 1, isFirst: false };
    var tgtCtx = { actor: target, target: actor, turn: o.turn || 1, isFirst: false };
    dmg *= condMul(actor, 'dealt', actxCtx);
    dmg *= condMul(target, 'taken', tgtCtx);
    // 烧伤：物理攻击伤害减半
    if (actor.status && actor.status.id === 'burn' && !special) dmg *= 0.5;
    if (actor.damageBuff && actor.damageBuff.turns > 0) {
      // 带条件的增伤（如「自身处于能力提升状态时造成的伤害翻倍」）必须在结算时判定
      if (!actor.damageBuff.req || checkCond(actor.damageBuff.req, actxCtx)) dmg *= actor.damageBuff.mul;
    }
    if (actor.firstNullBonus) dmg *= 1 + actor.firstNullBonus / 100;
    if (actor.blade === '北冥狂刃' && actor.bladeTurns > 0) dmg *= 2;
    if (actor.wudaoDealt) dmg *= 1 + actor.wudaoDealt * (actor.wudao === '天' ? 2 : 1) / 100;
    if (actor.yueMain && actor.mainPos === '钺') dmg *= 1.5;
    // 3809 龙神哈莫：满血减伤/增伤随体力降低线性衰减；龙系光环；战之龙魂
    if (actor.hpScaleHao) {
      var lossHao = Math.min(10, Math.floor((1 - actor.hp / actor.maxHp) * 10)) * 10;
      dmg *= 1 + (50 + lossHao) / 100;
    }
    if (actor.junZhen && actor.deadAllies) dmg *= 1 + 0.1 * actor.deadAllies;
    if (target.junZhen && target.deadAllies) dmg *= 1 - 0.1 * target.deadAllies;
    if (actor.auraDealtMul != null && actor.auraDealtMul < 1) dmg *= actor.auraDealtMul;
    if (actor.zhanTurns > 0 && actor.zhanBuff) {
      var zr = (typeof o.rng === 'function') ? o.rng() : 0.5;
      dmg *= 1 + (actor.zhanBuff.low + zr * (actor.zhanBuff.high - actor.zhanBuff.low)) / 100;
    }
    if (target.stackPassive && target.stackPassive.perStackReduce) {
      dmg *= 1 - (target.stacks || 0) * target.stackPassive.perStackReduce / 100;
    }
    if (target.hpScaleHao) {
      var lossHaoT = Math.min(10, Math.floor((1 - target.hp / target.maxHp) * 10)) * 10;
      dmg *= 1 - Math.max(0, 50 - lossHaoT) / 100;
    }
    if (actor.dealtMulFoeStatus && target.status) dmg *= actor.dealtMulFoeStatus;
    if (hasStack(actor, 6)) dmg *= 1.6;
    if (actor.rampInc > 0 && actor.rampActive) dmg *= (1 + Math.min(Math.max(0, (actor.rampUses || 0) - 1) * actor.rampInc, actor.rampCap));
    if (eff === 0) dmg = 0;
    dmg = Math.max(eff === 0 ? 0 : 1, Math.floor(dmg));
    if (target.lowPowerBlock) dmg = 0;
    if (o.minDamage && dmg > 0) dmg = Math.max(dmg, o.minDamage);

    if (critNullify) {
      // 这一刀被完全免疫；等量体力由调用方直接扣给出手方（不吃减伤/护盾）
      return { damage: 0, effectiveness: eff, crit: false, stab: stab > 1, critNullified: Math.max(0, Math.floor(dmg)) };
    }
    return { damage: dmg, effectiveness: eff, crit: crit, stab: stab > 1 };
  }

  /** 名词解释：引擎里用到的专有名词（魂印/技能文本里会出现），界面用于提示 */
  /** 已废弃/不再生效的魂印（按精灵 id 指定）：2987 重生之翼只用 574，372 不再生效 */
  var DISABLED_SOULMARKS = { 2987: [372] };
  function soulmarkDisabled(petId, markId) {
    var list = DISABLED_SOULMARKS[petId];
    return !!(list && list.indexOf(markId) >= 0);
  }

  var KEYWORD_DEFS = {
    '蚩庸之锁': '为对手叠加的封印标记（上限 3 道）。每道锁在「王·御影神罚」命中时令对手随机 1 个攻击技能 PP 归零；对手剩余可用攻击技能少于锁层数时，该技能伤害 +100%。回合结束时自然减少 1 道（当回合刚附加的不减）。',
    '神圣印记': '附加在对手身上的层数标记（上限 3 层）。回合结束时按层数结算真实伤害：1 层 1/8、2 层 1/6、3 层 1/4 最大体力。',
    '星赐': '持续若干回合的祝福状态：处于星赐时「魂·天忤太虚」按物理攻击结算；重复获得时改为全属性 +1。',
    '星哲': '持续若干回合的祝福状态：处于星哲时「魂·天忤太虚」按特殊攻击结算；重复获得时改为全属性 +1。',
    '星盘': '星盘有 0~12 刻。异常状态结束的当回合结束后转动 1 刻，转满后进入「星盘回返」；回返期间免疫攻击伤害。',
    '星海之浸': '被附加的回合数标记，用于星海类效果（当前版本记录回合数，完整结算待补）。',
    '法天象地·圣': '每场一次：处于异常且体力低于 1/2 时触发，重置体力/PP/异常，3 回合内免疫异常、先制提升、必定暴击，下场后消失。',
    '神耀能量': '重生之翼的能量层数（上限 5 或 6 层）：每层使受到的攻击伤害 -8%；2 层免疫异常与能力下降；3 层每回合结束回复 1/3 最大体力；4 层免疫并反弹固定伤害；5 层攻击技先制 +1；6 层攻击伤害 +60%，第五技能不再消耗能量，击败对手后层数归 0 且下回合先制 +3。',
    '星皇之赐': '背包效果：只要己方队伍（含场下）有瀚宇星皇，己方每只精灵使用技能后回复自身最大体力 1/8。',
    '星皇之佑': '背包效果：瀚宇星皇在队伍中时，己方首发精灵前 3 回合免疫异常状态与能力下降。',
    '星皇之怒': '攻击技能命中后 50% 概率追加该技能括号内的「星皇之怒」效果；可通过技能提升或翻倍概率。'
  };
  function keywordHits(text) {
    var out = [];
    if (!text) return out;
    Object.keys(KEYWORD_DEFS).forEach(function (k) {
      if (text.indexOf(k) >= 0) out.push({ term: k, def: KEYWORD_DEFS[k] });
    });
    return out;
  }

  /** 把一只精灵身上「看得见」的状态整理成给界面用的条目 */
  function effectsOf(c) {
    var arr = [];
    if (!c) return arr;
    if (c.status) {
      var sd = STATUS_DEF[c.status.id];
      var stx = (sd ? sd.name : c.status.id) + (c.status.turns < 900 ? '(' + c.status.turns + ')' : '');
      arr.push({ text: stx, tone: 'bad' });
    }
    if (c.shield > 0) arr.push({ text: '护盾 ' + c.shield, tone: 'good' });
    if (c.ward > 0) arr.push({ text: '护罩 ' + c.ward, tone: 'good' });
    if (c.holyMarks > 0) arr.push({ text: '神圣印记×' + c.holyMarks, tone: 'bad' });
    if (c.wukongFormTurns > 0) arr.push({ text: '法天象地(' + c.wukongFormTurns + ')', tone: 'good' });
    if (c.morphMode) arr.push({ text: c.morphMode === 'speed' ? '极速形态' : '毁灭形态', tone: 'good' });
    if (c.statusGuard > 0) arr.push({ text: '免疫异常×' + c.statusGuard, tone: 'good' });
    if (c.formExec) arr.push({ text: '瞬杀待发', tone: 'good' });
    if (c.turnDealt > 1) arr.push({ text: '本回合增伤×' + c.turnDealt.toFixed(1), tone: 'good' });
    if (c.endRampFlat) arr.push({ text: '递增固伤', tone: 'good' });
    (c.guards || []).forEach(function (g) {
      var scope = g.scope === 'phys' ? '物理' : (g.scope === 'spec' ? '特殊' : (g.scope === 'type' ? (g.typeName || '') + '系' : ''));
      arr.push({ text: scope + '减伤×' + g.mul + (g.turns ? '(' + g.turns + ')' : ''), tone: 'good' });
    });
    if (c.immuneStatus > 0) arr.push({ text: '免异常(' + c.immuneStatus + ')', tone: 'good' });
    if (c.noStatUp > 0) arr.push({ text: '锁强化(' + c.noStatUp + ')', tone: 'bad' });
    if (c.buffDisabled > 0) arr.push({ text: '能力强化被封(' + c.buffDisabled + ')', tone: 'bad' });
    if (c.immuneStat > 0) arr.push({ text: '免下降(' + c.immuneStat + ')', tone: 'good' });
    if (c.ppCostMul && c.ppCostMul.turns > 0) arr.push({ text: 'PP消耗×' + c.ppCostMul.mul + '(' + c.ppCostMul.turns + ')', tone: 'bad' });
    if (c.immuneCrit > 0) arr.push({ text: '免致命×' + c.immuneCrit, tone: 'good' });
    if (c.immuneCritReflect > 0) arr.push({ text: '免致命反噬(' + c.immuneCritReflect + ')', tone: 'good' });
    if (c.teUseHeal && c.teUseHeal.turns > 0) arr.push({ text: '用技能回血' + Math.round(c.teUseHeal.num / (c.teUseHeal.den || 1) * 100) + '%(' + c.teUseHeal.turns + ')', tone: 'good' });
    if (c.teHeal && c.teHeal.turns > 0) arr.push({ text: '回合回血' + Math.round(c.teHeal.pct * 100) + '%(' + c.teHeal.turns + ')', tone: 'good' });
    if (c.immuneBelow) arr.push({ text: '免低伤(' + c.immuneBelow.turns + ')', tone: 'good' });
    if (c.oneHit > 0) arr.push({ text: '挡击×' + c.oneHit, tone: 'good' });
    if (c.thorns && c.thorns.turns > 0) arr.push({ text: '反弹' + c.thorns.value + '(' + c.thorns.turns + ')', tone: 'good' });
    if (c.dot && c.dot.turns > 0) arr.push({ text: '持续伤害' + c.dot.value + '(' + c.dot.turns + ')', tone: 'bad' });
    if (c.skillBlock > 0) arr.push({ text: '属性封锁(' + c.skillBlock + ')', tone: 'bad' });
    if (c.guaranteeCrit > 0) arr.push({ text: '必暴×' + c.guaranteeCrit, tone: 'good' });
    if (c.guaranteePrio > 0) arr.push({ text: '必先×' + c.guaranteePrio, tone: 'good' });
    if (c.takenMul && c.takenMul < 1) arr.push({ text: '受伤×' + c.takenMul.toFixed(2), tone: 'good' });
    if (c.dealtMul && c.dealtMul > 1) arr.push({ text: '增伤×' + c.dealtMul.toFixed(2), tone: 'good' });
    // 有名字的专有标记/层数：补上名词解释，方便第一次上手的玩家
    if (c.starBless) arr.push({ text: '星皇之赐', tone: 'good', tip: KEYWORD_DEFS['星皇之赐'] });
    if (c.stackPassive && (c.stacks || 0) > 0) arr.push({ text: '神耀能量×' + c.stacks + '/' + c.stackPassive.maxStacks, tone: 'good', tip: KEYWORD_DEFS['神耀能量'] });
    if (c.attrPunishPP && c.attrPunishPP.turns > 0) arr.push({ text: '属性技惩罚(' + c.attrPunishPP.turns + ')', tone: 'good' });
    if (c.reflectTakenPct && c.reflectTakenPct.turns > 0) arr.push({ text: '反弹受伤 ' + c.reflectTakenPct.num + '/' + c.reflectTakenPct.den + '(' + c.reflectTakenPct.turns + ')', tone: 'good' });
    if (c.starGuard > 0) arr.push({ text: '星皇之佑(' + c.starGuard + ')', tone: 'good', tip: KEYWORD_DEFS['星皇之佑'] });
    if (c.lockStacks > 0) arr.push({ text: '蚩庸之锁×' + c.lockStacks, tone: 'bad', tip: KEYWORD_DEFS['蚩庸之锁'] });
    if (c.starGift > 0) arr.push({ text: '星赐(' + c.starGift + ')', tone: 'good', tip: KEYWORD_DEFS['星赐'] });
    if (c.starPhil > 0) arr.push({ text: '星哲(' + c.starPhil + ')', tone: 'good', tip: KEYWORD_DEFS['星哲'] });
    if (c.starDialCfg && c.starDial > 0) arr.push({ text: '星盘 ' + c.starDial + '/' + c.starDialCfg.maxTicks + (c.starReturn ? ' 回返' : ''), tone: 'good', tip: KEYWORD_DEFS['星盘'] });
    if (c.starSea && c.starSea.turns > 0) arr.push({ text: '星海之浸(' + c.starSea.turns + ')', tone: 'bad', tip: KEYWORD_DEFS['星海之浸'] });
    if (c.starRageChanceBonus > 0) arr.push({ text: '星怒概率+' + c.starRageChanceBonus + '%(' + c.starRageChanceTurns + ')', tone: 'good', tip: KEYWORD_DEFS['星皇之怒'] });
    if (c.starRageDouble > 0) arr.push({ text: '星怒翻倍×' + c.starRageDouble, tone: 'good', tip: KEYWORD_DEFS['星皇之怒'] });
    if (c.starRagePowerKeep > 0) arr.push({ text: '星怒威力保留×' + c.starRagePowerKeep, tone: 'good', tip: KEYWORD_DEFS['星皇之怒'] });
    if (c.starRoundLock > 0) arr.push({ text: '回合效果锁定(' + c.starRoundLock + ')', tone: 'good' });
    if (c.punish3291 && c.punish3291.turns > 0) arr.push({ text: '瀚空封印(' + c.punish3291.turns + ')', tone: 'good' });
    if (c.teDrain && c.teDrain.turns > 0) arr.push({ text: '用技能吸血 1/' + c.teDrain.den + '(' + c.teDrain.turns + ')', tone: 'good' });
    if (c.drain3291 && c.drain3291.turns > 0) arr.push({ text: '瀚空吸血 1/' + (c.drain3291.den || 3) + '(' + c.drain3291.turns + ')', tone: 'good' });
    if (c.drain4676 && c.drain4676.turns > 0) arr.push({ text: '魂劫吸血 1/' + (c.drain4676.den || 3) + '(' + c.drain4676.turns + ')', tone: 'good' });
    if (c.statDownLock > 0) arr.push({ text: '锁能力下降(' + c.statDownLock + ')', tone: 'bad' });
    if (c.attackHitStatus && c.attackHitStatus.turns > 0) arr.push({ text: '命中附加异常(' + c.attackHitStatus.turns + ')', tone: 'good' });
    if (c.attrBlockIfHit && c.attrBlockIfHit.turns > 0) arr.push({ text: '反制属性封锁(' + c.attrBlockIfHit.turns + ')', tone: 'good' });
    if (c.buffGoneAttr && c.buffGoneAttr.turns > 0) arr.push({ text: '强化消失封锁(' + c.buffGoneAttr.turns + ')', tone: 'good' });
    return arr;
  }

  function Combatant(entry, level) {
    this.pet = entry.pet;
    this.combo = entry.combo || null;
    this.level = entry.level == null ? level : Math.max(1, Math.min(100, entry.level | 0));
    this.stats = computeStats(entry.pet, {
      level: this.level,
      iv: entry.iv == null ? 31 : entry.iv,
      ev: entry.ev || {},
      nature: entry.nature || null,
      bonus: entry.bonus || null,
      bonusPct: entry.bonusPct || null
    });
    this.maxHp = this.stats.hp;
    this.hp = this.maxHp;
    this.stages = freshStages();
    this.status = null;      // { id, turns }
    this.dot = null;         // { value, turns }
    this.streak = 0;         // 连续使用同一技能次数
    this.lastSkillKey = null;
    this.guards = [];        // 伤害减免 { turns, mul, scope, typeName }
    this.shield = 0;         // 护盾吸收点数（只挡攻击伤害）
    this.ward = 0;           // 护罩吸收点数（只挡固定伤害 / 百分比伤害）
    this.immuneStatus = 0;   // 免疫异常状态剩余回合
    this.immuneStat = 0;     // 免疫能力下降剩余回合
    this.immuneBelow = null; // 免疫低于 X 的伤害 { turns, value }
    this.oneHit = 0;         // 免疫下 N 次攻击
    this.thorns = null;      // 受击反弹 { turns, value }
    this.skillBlock = 0;     // 属性技能被封锁的剩余回合
    this.attackBlock = 0;    // 攻击技能被封锁的剩余回合
    this.guaranteeCrit = 0;  // 接下来必定暴击的次数
    this.guaranteePrio = 0;  // 接下来必定先手的次数

    // 魂印被动
    this.takenMul = 1;
    this.dealtMul = 1;
    this.firstDealt = 1;
    this.critDamage = 1;
    this.ignoreDefPctPassive = 0;
    this.regen = 0;
    this.regenRatio = 0;
    this.priorityBonus = 0;
    this.permImmuneStatus = false;
    this.permImmuneStat = false;
    // 抗性：0–100，按固定伤害 / 百分比伤害 / 暴击率分别减免
    var resIn = entry.resist || entry.resistance || {};
    this.fixedResist = Math.max(0, Math.min(100, num(resIn.fixed) || 0));
    this.percentResist = Math.max(0, Math.min(100, num(resIn.percent) || 0));
    this.critResist = Math.max(0, Math.min(100, num(resIn.crit) || 0));
    this.statusResist = Math.max(0, Math.min(100, num(resIn.status) || 0));
    this.statusResistById = resIn.statusById || null;
    this.immuneFixedPct = false;
    if (this.pet.id === 3291) {
      this.fixedResist = 100;
      this.percentResist = 100;
    }
    this.soulmarks = entry.soulmarks || [];
    this.passives = entry.passives || [];
    this.onHitImmune = false;      // 受击后获得一次伤害免疫
    this.endDamageLost = 0;        // 回合结束按已损失体力造成的百分比伤害
    this.endHealNum = 0;           // 回合结束回复（比例）
    this.endHealDen = 1;
    this.endPpRestore = 0;         // 回合结束恢复若干技能 PP
    this.priorityIfHigher = false; // 体力高于对手时必定先手
    this.fieldOnEnter = false;     // 登场时按回合奇偶开启场地
    this.onEnterClear = false;     // 登场时消除对手回合类效果
    this.hasRebirth = false;       // 致死伤害保留 1 点体力
    this.rebirthUsed = false;
    this.pendingRestore = null;    // 回合结束要恢复的快照
    this.skillNull = 0;            // 接下来 N 次技能无效
    this.critBonus = 0;            // 额外暴击率（%）
    this.drainOnHit = 0;           // 造成伤害后按比例回血
    this.regenShield = 0;          // 每回合开始获得的护盾
    this.onHitStatus = null;       // 攻击命中后附加异常状态
    this.execChance = 0;           // 攻击时秒杀概率（%）
    this.hpBonus = 0;              // 额外体力上限
    this.critBuffTurns = 0;        // 必暴击剩余回合
    this.priorityBuff = null;      // { turns, value } 先制加成
    this.reflectStatus = 0;        // 反弹异常状态剩余回合
    this.damageBuff = null;        // { turns, mul } 伤害倍率
    this.teUseHeal = null;         // { turns, num, den } 每回合使用技能恢复体力
    this.lastDealt = 0;            // 上一次对对手造成的伤害
    this.lastTaken = 0;            // 上一次被对手打掉的体力
    this.ppCostMul = null;         // { turns, mul } 使用技能消耗的 PP 倍数
    this.healBlock = 0;            // 无法回血的剩余回合
    this.reflectDamage = null;     // { turns, num, den } 受击反弹比例伤害
    this.attackMiss = 0;           // 接下来 N 次攻击必定落空
    this.mustHitTurns = 0;         // 接下来 N 回合自身攻击必定命中
    this.priorityDown = null;      // { turns, value } 先制降低
    this.survive = null;           // { turns, hp } 致死时留血
    this.damageCap = null;         // { turns, value } 单次受伤上限
    this.dodge = null;             // { turns, chance } 闪避率
    this.healMul = 1;              // 回血倍率
    this.critTimed = null;         // { turns, add } 临时暴击加成
    this.rampInc = 0;              // 连续使用增伤
    this.rampCap = 0;
    this.rampUses = 0;             // 当前连击层数（本技能）
    this.rampSkillId = 0;          // 叠层所属技能 id
    this.rampActive = false;       // 增伤只在当回合生效
    this.currentSkillId = 0;
    this.reflectNext = 0;          // 下次受击反馈比例（%）
    this.blockSwitch = 0;          // 被禁止主动换人的剩余回合
    this.protectStats = 0;         // 能力提升不被消除的剩余回合
    this.delayedKill = null;       // { due } 若干回合后对手未击败自己则死亡
    this.critUses = 0;             // 暴击率递增的使用次数
    this.deathCurse = null;        // { turns, value } 被击败时让对手掉血
    this.priorityIfLow = null;     // { threshold, value } 残血时先制
    this.guardFlat = null;         // { turns, value } 固定减伤
    this.tookDamageLastTurn = false;
    this.turnStartStages = null;   // 回合开始时的能力等级快照
    this.copyDefTurns = 0;         // 防御力复制对手的剩余回合
    this.priorityCond = null;      // { req, value } 条件先制（每次使用刷新）
    this.priorityStreak = 0;       // 连续使用时先制加成
    this.missTurns = 0;            // 自身攻击必定落空的剩余回合
    this.immuneAbove = null;       // 免疫高于 X 的伤害 { turns, value }
    this.rampPctInc = 0;           // 连续使用威力百分比递增
    this.rampPctCap = 0;
    this.chanceImmune = null;      // { turns, chance } 概率免疫攻击伤害
    this.immuneCrit = 0;           // 免疫致命一击伤害剩余回合
    this.noStatUp = 0;             // 无法提升能力的剩余回合
    this.entryBuffs = [];          // 登场窗口效果（首次登场后前 N 回合…）
    this.entryUsed = false;        // 是否已经登场过（配合 once）
    this.condPassives = [];        // 带条件的被动（若…则…、满体力时…）
    this.enterTurn = 1;            // 登场后的第一个回合
    this.deathTeamGuard = null;    // 被击败后给下一只的减伤 { turns, mul }
    this.reflectLethal = 0;        // 受到致死伤害时反弹剩余回合
    this.delayed = [];             // 延迟固定伤害 [{dueTurn, value}]
    this.reflectIfHit = 0;         // 本回合受到伤害则反馈（1 = 待触发）
    this.dodgeTimes = null;        // { times, chance } 按次数闪避
    this.convertTaken = 0;         // 受到攻击伤害转化为体力剩余回合
    this.exileAura = null;         // 神殇：每回合放逐对手场下精灵
    this.divineTurn = null;        // 神启：回合开始时按体力分支
    this.holyMarks = 0;            // 神圣印记层数（神印）
    this.holyMarkDue = 0;          // 本次登场需要结算印记的回合
    this.holyMarkSrcMax = 0;       // 施加印记的启灵元神最大体力
    this.firstShieldUsed = false;  // 神照：首发护盾是否已领取
    this.immuneStatusIds = null;   // 只免疫指定异常（如孙悟空的烧伤）
    this.wukongTurn = false;       // 孙悟空：回合开始按对手体力分支
    this.wukongForm = false;       // 孙悟空：法天象地·圣
    this.wukongFormUsed = false;
    this.wukongFormTurns = 0;
    this.wukongLow = false;        // 本回合是否处于「对手残血」分支
    this.turnDealt = 0;            // 本回合增伤倍率
    this.turnDealtCrit = 0;        // 本回合暴击时的增伤倍率
    this.fullHpGuardPct = 0;       // 满体力时本回合减伤（%）
    this.endRampFlat = null;       // 战斗阶段结束的递增固伤
    this.endRampTurns = 0;
    this.onHitClearFoeStats = false; // 受击消除对手能力提升
    this.westwardUsed = false;     // 西游师徒：首发全属性 +1 是否已触发
    this.morphGuard = null;        // 3393 坚壁形态（护盾/重激活/回合末回血）
    this.morphSpeed = null;        // 3393 极速形态
    this.morphDestroy = null;      // 3393 毁灭形态
    this.morphUltimate = false;    // 3393 王·异甲同心
    this.morphMode = null;         // 'speed' | 'destroy'
    this.morphSwitchNext = null;   // 下回合切换到的形态
    this.shieldRecharge = 0;       // 护盾重激活倒计时
    this.shieldActive = false;
    this.statusGuard = 0;          // 免疫下 N 次异常
    this.formExec = false;         // 本回合所有技能秒杀
    this.lowHpExecPct = 0;         // 对手低于该比例时秒杀
    this.firstHealBlock = false;   // 2880 先手禁疗
    this.firstSpeedUp = false;     // 2880 先手下回合速度 +1
    this.pendingSpeedUp = false;
    this.starAtkSum = false;       // 4677：双攻值取和
    this.starSpecialPrio = 0;      // 4677：特殊攻击额外先制
    this.starPhysDrain = 0;        // 4677：物理攻击后吸取双防总和百分比
    this.starEntry = false;        // 4677：登场星启
    this.starGift = 0;             // 星赐剩余回合
    this.starPhil = 0;             // 星哲剩余回合
    this.starDialCfg = null;       // 星盘配置
    this.starDial = 0;             // 星盘刻度 0-12
    this.starReturn = false;       // 星盘回返阶段
    this.starWasReturn = false;
    this.starGuardTurns = 0;       // 转动后的 1 回合减伤
    this.starPpZero = false;       // 转动后的回合末 PP 归零
    this.starReEntryDue = 0;       // 下回合结束再次星启
    this.starAttackImmune = false; // 回返期间免疫攻击
    this.starHadStatus = false;
    this.starStatusEnded = false;
    this.starRageChanceBonus = 0;   // 星皇之怒概率加成（%）
    this.starRageChanceTurns = 0;   // 概率加成剩余回合
    this.starRageDouble = 0;        // 下 N 次星皇之怒概率翻倍
    this.starBless = false;         // 星皇之赐：出手后回 1/8
    this.starGuard = 0;             // 星皇之佑：免疫异常/能力下降剩余回合
    this.starRoundLock = 0;         // 回合类效果不可被消除剩余回合
    this.starRagePriority = 0;      // 星皇之怒：下 N 次攻击先制 +2
    this.starRagePowerKeep = 0;     // 星皇之怒：下 N 次威力不减
    this.punish3291 = null;         // 瀚空之门：对手出手惩罚 { turns }
    this.drain3291 = null;          // 命宇轮回：每回合吸取 { turns, num, den }
    this.drain4676 = null;          // 魂劫骇咒：每回合吸取 { turns, num, den }
    this.lockStacks = 0;            // 蚩庸之锁层数（挂在对手身上）
    this.lockAddedTurn = 0;         // 最近一次加锁的回合（避免当回合结束立刻掉）
    this.mistikeSoul = false;       // 神觉·米斯蒂克魂印
    this.mistikeEntryTurn = 0;      // 登场回合（判断“当回合未出手”）
    this.mistikeFoeActed = false;
    this.mistikeGuardTurn = 0;      // 触发未降级时，本回合三档减伤 50%
    this.mistikeVuln = false;       // 下 1 次受到攻击伤害 +100%
    this.mistikeNoDebuff = 0;       // 对手攻击无法附加异常/能力下降的剩余回合
    this.statDownLock = 0;          // 能力下降不可被解除/反转的剩余回合
    this.dtzfSoul = false;          // 帝天战佛（3033）魂印「渡」
    this.leiSteal = false;          // 王·雷伊（3142）魂印：每回合吸强
    this.leiRoundToOne = false;     //  对手回合类效果压到 1 回合
    this.leiEndBoost = null;        //  { atk, spd, acc } 回合末强化
    this.leiEndBoostLead = false;
    this.leiRoundLock = false;      //  体力低时自身回合效果不可消
    this.capOnStatus = null;        //  { turns, capTurns, value } 敌属性技 → 受伤上限
    this.atkStatusElse = null;      // 3205：攻击技能概率异常，未触发则强化/断回合
    this.hitStatusFixed = null;     // 3205：命中异常目标追加固定伤害
    this.immuneStatusIfNoDefUp = false; // 3308：不在双防强化时免疫异常
    this.prioPpZero = 0;            // 3308：先出手使对手随机 PP 归零个数
    this.defFixedHeal = 0;          // 3308：后出手按双防和百分比附伤+回血
    this.ppZeroOnFoeAtk = null;     // 3308：对手用攻击技能时随机清 PP
    this.prevDamageHalf = false;    // 3311：攻击技能附加对手上次伤害一半固伤
    this.reviveOnce = null;         // 3311：死亡后重生一次
    this.reviveUsed = false;
    this.revivePowerBuff = null;    //  { turns, mul }
    this.atkHitPercentMaxHp = 0;    // 3421：攻击命中后按最大体力百分比附伤
    this.startTakenMulPct = 0;      // 3421：回合开始体力高则当回合减伤
    this.turnTakenMul = 1;          //  当回合攻击减伤系数
    this.endHealLowPct = null;      // 3421：回合末低血回复 + 等量百分比伤害
    this.enterClearLock = null;     // 3414：登场清强化 + 封强化/属性技
    this.mirrorFoeStages = false;   // 3414：对手能力等级不高于自己
    this.immuneNextOrHalve = null;  // 3414：无强化时 50% 免一击 / 否则减伤
    this.endHealIfUp = null;        // 3414：回合末有强化则回血 + 等量百分比伤害
    this.statusSkillNull = 0;       //  接下来 N 次属性技能无效
    this.foeStatusSealOnAtk = 0;    // 3482：攻击后令对手属性技失效
    this.statusSkillEndHeal = null; // 3482：属性技后回合末回血+等量百分比
    this.pendingStatusHeal = null;
    this.startDamageDouble = false;  // 3482：体力高时当回合伤害翻倍
    this.endHealByDealt = null;      // 3482：体力低时回合末按造成伤害回血
    this.endHealByDealtActive = false;
    this.reflectOnHitPct = null;     // 3482：受击反馈百分比伤害
    this.randomUpFoeDown = null;     // 3456：体力高随机 2 项+1 并给对手-1
    this.lowHpExtraReduce = null;    // 3456：体力低当回合额外减伤
    this.fixedPctPersistMul = 1;     // 3456：固伤/百分比伤害永久减伤系数
    this.blindStack = null;          // 3456：失明概率逐次提升
    this.blindStackChance = 0;
    this.ignoreDefStack = null;      // 3514：攻击忽略双防百分比（随攻击叠加）
    this.ignoreDefCur = 0;
    this.arrowsOnAtk = 0;            // 3514(1646)：攻击后获得灭神之箭
    this.arrows = 0;
    this.highHpPrioImmune = null;    // 3514：体力高则先制+1 且免疫异常
    this.endDrainIfLow = null;       // 3514：体力低则回合末吸取对手体力
    this.firstDeathSurvive = false;  // 3539：首次死亡保留 1 点体力
    this.firstDeathUsed = false;
    this.endTurnFear = false;        //  死亡保留后回合末令对手害怕
    this.deathFear = false;
    this.statusSkillImmuneNext = false; // 3539：对手属性技 → 免疫下次异常
    this.chanceDodgePct = 0;         // 3539：对手攻击 70% 闪避
    this.dodgeBuffPct = 0;
    this.dodgeCounterPct = 0;
    this.dodgeBuffPending = false;
    this.dodgeFailedThisTurn = false;
    this.firstEntryNullAttack = false; // 3541：首次登场无效对手攻击 + 断回合
    this.firstEntryUsed = false;
    this.pendingFoeFear = false;
    this.halfHpRoundLock = false;      // 3541：体力>1/2 回合效果不可消
    this.halfHpPrioHeal = null;        // 3541：体力<1/2 先制+回合末回复
    this.pendingHalfHeal = null;
    this.enterShieldImmune = null;   // 3568：登场护盾 + 免疫异常
    this.shieldPriority = 0;         // 3568：有护盾时攻击先制+1
    this.shieldBreakClear = null;    // 3568：护盾消失 → 断回合清强化清 PP
    this.shieldBreakArmed = false;
    this.preHitClearFoe = false;     // 3627：攻击命中前断回合
    this.ifFoeFirstReduce = null;    // 3627：对手先手 → 免疫异常 + 减伤
    this.ifSelfFirstBoost = null;    // 3627：自身先手 → 免疫下降 + 伤害提升
    this.enterRandomStatus = null;   // 3683：登场随机异常
    this.enterStatusUsed = false;
    this.atkThreshStatus = null;     // 3683：伤害阈值 → 异常 / 先制必暴
    this.speedToHp = false;          // 3697：速度强化同时加体力
    this.deadAllyPriority = null;    // 3697：队友阵亡 → 先制
    this.highHpImmuneAllDown = null; // 3697：体力高 → 免疫异常 + 概率全属性-1
    this.lowHpReduceAllDown = null;  // 3697：体力低 → 减伤 + 全属性-1
    this.turnFixedTakenMul = 1;
    this.bless = 0;                  // 3711：自然祝福层数
    this.blessEnterUsed = false;
    this.blessTurnEnd = false;
    this.blessGainOnHit = null;
    this.blessKillCost = false;
    this.blessKillFlag = false;
    this.actedThisTurn = false;
    this.entryShieldFlat = null;    // 3740：登场 400 护盾 + 有护盾先制
    this.endShieldBranch = null;    // 3740：回合末按是否挨打分支
    this.atkUseDealtStack = null;   // 3740：攻击伤害递增
    this.atkDealtStack = 0;
    this.tookAtkDmgTurn = false;
    this.firstNullifyScale = null;  // 3807：先手失效概率递减 + 永久增伤
    this.firstNullPct = 100;
    this.firstNullBonus = 0;
    this.startStageBranch = null;   // 3807：有无强化 → 先制 / 增伤
    this.dragonAura = false;         // 3809：龙系光环
    this.hpScaleHao = false;         // 3809：满血减伤增伤随体力衰减
    this.foeTypeBranch = null;       // 3809：对手属性/攻击技能分支
    this.yuBuff = null;              // 3809：御之龙魂 BUFF
    this.zhanBuff = null;            // 3809：战之龙魂 BUFF
    this.yuTurns = 0;
    this.zhanTurns = 0;
    this.auraDealtMul = 1;
    this.pendingEndFixed = null;
    this.lastSkillCategory = 0;
    this.noDamageDrain = null;       // 3924：攻击未造成伤害 → 吸血 + 下回合先制
    this.firstStatUp = null;         // 3924：先出手 → 全属性+1
    this.lastClearHeal = null;       // 3924：后出手 → 断回合/回血
    this.pendingNextPrio = 0;
    this.rageCrit = null;            // 3994：狂怒雷电暴击
    this.rageChance = 0;
    this.ragePending = false;
    this.hpHalfRage = null;          // 3994：半血上下分支
    this.hpHalfHighB = false;
    this.hpHalfLowB = false;
    this.fenjinOnClear = false;      // 4219：强化被消 → 焚烬
    this.pendingZhuoxin = false;     // 4219：下回合攻击获得灼心之焰
    this.zhuoxinBuff = null;         // 4219：灼心之焰 BUFF
    this.zhuoxinActive = false;
    this.prevPosStages = 0;
    this.fateWheel = false;          // 4275：命运之轮
    this.fateOnSwitch = false;
    this.fateHengDef = null;
    this.fateJieDef = null;
    this.fateBothThisEntry = false;
    this.nyxEnter = null;             // 4329：登场首回合减伤
    this.nyxField = null;             // 4329：倪克斯结界
    this.nyxFieldTurns = 0;
    this.nyxHpBranch = null;
    this.turnStartHp = 0;
    this.beimingBlade = null;        // 4515：北冥之刃/狂刃
    this.blade = '北冥之刃';
    this.bladeTurns = 0;
    this.formSystem = false;
    this.form = '强击';
    this.starSeaMark = null;         // 4648：星海之浸标记
    this.allCrit = false;            // 4648：必定暴击
    this.level100Revive = false;     // 4648：满级致死复活
    this.revivedOnce = false;
    this.wudaoOpen = false;          // 4766：武道系统
    this.wudao = '血';
    this.wudaoPP = false;
    this.wudaoHeal = 0;
    this.wudaoSkillDmg = 0;
    this.wudaoDealt = 0;
    this.twinCorps = false;          // 4950：主位/副位
    this.mainPos = null;
    this.subPos = null;
    this.yueMain = false;
    this.yueSub = null;
    this.yuMain = false;
    this.yuSub = false;
    this.subFull = false;
    this.dmgCounter = 0;
    this.dtzfPending = false;       // 本回合被击败，待回合结束清算
    this.dtzfDone = false;          // 「渡」已经清算过
    this.iv = entry.iv == null ? 31 : entry.iv;
    if (this.pet.id === 4676) this.mistikeSoul = true;
    if (this.pet.id === 3033) this.dtzfSoul = true;
    if (this.pet.id === 3291) {
      // 瀚宇星皇：魂印常驻；具体文本解析仍以 parseSoulmark 为主，这里是结算兜底
      this.immuneFixedPct = true;
      this.permImmuneStat = true;
      this.starRage = true;
    }

    var self = this;
    this.passives.forEach(function (p) {
      switch (p.kind) {
        case 'taken': self.takenMul *= p.value; break;
        case 'dealt': self.dealtMul *= p.value; break;
        case 'firstDealt': self.firstDealt *= p.value; break;
        case 'critDamage': self.critDamage *= p.value; break;
        case 'ignoreDefPctPassive': self.ignoreDefPctPassive += p.value; break;
        case 'regen': self.regen += p.value; break;
        case 'regenRatio': self.regenRatio += p.num / p.den; break;
        case 'priority': self.priorityBonus += p.value; break;
        case 'speed': self.stats.spd += p.value; break;
        case 'immuneStatus': self.permImmuneStatus = true; break;
        case 'immuneStat': self.permImmuneStat = true; break;
        case 'starAura': self.starAura = true; break;
        case 'starRageOnNull': self.starRageOnNull = true; break;
        case 'mistikeEntry': self.mistikeSoul = true; break;
        case 'mistikeReact': self.mistikeSoul = true; break;
        case 'dtzfSoul': self.dtzfSoul = true; break;
        case 'leiSteal': self.leiSteal = true; break;
        case 'leiRoundToOne': self.leiRoundToOne = true; break;
        case 'leiEndBoost': self.leiEndBoost = { atk: p.atk, spd: p.spd, acc: p.acc }; break;
        case 'leiRoundLock': self.leiRoundLock = true; break;
        case 'atkStatusElse': self.atkStatusElse = { statusId: p.statusId, chance: p.chance, stats: p.stats || [], clearChance: p.clearChance || 0 }; break;
        case 'hitStatusFixed': self.hitStatusFixed = { statusId: p.statusId, num: p.num, den: p.den }; break;
        case 'immuneStatusIfNoDefUp': self.immuneStatusIfNoDefUp = true; break;
        case 'prioPpZero': self.prioPpZero = p.count; break;
        case 'defFixedHeal': self.defFixedHeal = p.pct; break;
        case 'prevDamageHalfAttack': self.prevDamageHalf = true; break;
        case 'reviveOnce': self.reviveOnce = { clear: !!p.clear, immune: !!p.immune }; break;
        case 'revivePowerBuff': self.revivePowerBuff = { turns: p.turns, mul: p.mul }; break;
        case 'atkHitPercentMaxHp': self.atkHitPercentMaxHp = p.pct; break;
        case 'startTakenMul': self.startTakenMulPct = p.pct; break;
        case 'endHealLowPct': self.endHealLowPct = { num: p.num, den: p.den }; break;
        case 'enterClearLock': self.enterClearLock = { turns: p.turns, statusSkills: p.statusSkills }; break;
        case 'mirrorFoeStages': self.mirrorFoeStages = true; break;
        case 'immuneNextOrHalve': self.immuneNextOrHalve = { chance: p.chance, pct: p.pct }; break;
        case 'endHealIfUp': self.endHealIfUp = { num: p.num, den: p.den }; break;
        case 'foeStatusSealOnAtk': self.foeStatusSealOnAtk = p.times; break;
        case 'statusSkillEndHeal': self.statusSkillEndHeal = { num: p.num, den: p.den, doubleLow: !!p.doubleLow }; break;
        case 'startDamageDouble': self.startDamageDouble = true; break;
        case 'endHealByDealt': self.endHealByDealt = true; break;
        case 'reflectOnHitPct': self.reflectOnHitPct = { num: p.num, den: p.den, threshold: p.threshold, stages: p.stages }; break;
        case 'randomUpFoeDown': self.randomUpFoeDown = { count: p.count, stages: p.stages }; break;
        case 'lowHpExtraReduce': self.lowHpExtraReduce = { num: p.num, den: p.den }; break;
        case 'fixedPctPersistReduce': self.fixedPctPersistMul = 1 - p.num / p.den; break;
        case 'blindStack': self.blindStack = { base: p.base, per: p.per, cap: p.cap, missBuffPct: p.missBuffPct }; self.blindStackChance = p.base; break;
        case 'ignoreDefStack': self.ignoreDefStack = { base: p.base, per: p.per, cap: p.cap }; self.ignoreDefCur = p.base; break;
        case 'arrowsOnAtk': self.arrowsOnAtk = p.count; break;
        case 'highHpPrioImmune': self.highHpPrioImmune = { prio: p.prio }; break;
        case 'endDrainIfLow': self.endDrainIfLow = { num: p.num, den: p.den }; break;
        case 'firstDeathSurvive': self.firstDeathSurvive = true; break;
        case 'deathFear': self.deathFear = true; break;
        case 'statusSkillImmuneNext': self.statusSkillImmuneNext = true; break;
        case 'chanceDodge': self.chanceDodgePct = p.pct; self.dodgeBuffPct = p.buffPct; self.dodgeCounterPct = p.counterPct; break;
        case 'firstEntryNullAttack': self.firstEntryNullAttack = true; break;
        case 'halfHpRoundLock': self.halfHpRoundLock = true; break;
        case 'halfHpPrioHeal': self.halfHpPrioHeal = { prio: p.prio, num: p.num, den: p.den }; break;
        case 'enterShieldImmune': self.enterShieldImmune = { num: p.num, den: p.den }; break;
        case 'shieldPriority': self.shieldPriority = p.value; break;
        case 'shieldBreakClear': self.shieldBreakClear = { ppCount: p.ppCount }; break;
        case 'preHitClearFoe': self.preHitClearFoe = true; break;
        case 'ifFoeFirstReduce': self.ifFoeFirstReduce = { pct: p.pct }; break;
        case 'ifSelfFirstBoost': self.ifSelfFirstBoost = { pct: p.pct }; break;
        case 'enterRandomStatus': self.enterRandomStatus = { first: !!p.first || !!(self.enterRandomStatus && self.enterRandomStatus.first) }; break;
        case 'atkThreshStatus': self.atkThreshStatus = { high: p.high, low: p.low, prio: p.prio }; break;
        case 'speedToHp': self.speedToHp = true; break;
        case 'deadAllyPriority': self.deadAllyPriority = { per: p.per, cap: p.cap }; break;
        case 'highHpImmuneAllDown': self.highHpImmuneAllDown = { chance: p.chance }; break;
        case 'lowHpReduceAllDown': self.lowHpReduceAllDown = { pct: p.pct, chance: p.chance }; break;
        case 'enterBless': self.enterBless = { first: p.first, later: p.later }; break;
        case 'blessTurnEnd': self.blessTurnEnd = true; break;
        case 'blessGainOnHit': self.blessGainOnHit = { high: p.high }; break;
        case 'blessKillCost': self.blessKillCost = true; break;
        case 'entryShieldFlat': self.entryShieldFlat = { value: p.value, prio: p.prio }; break;
        case 'endShieldBranch': self.endShieldBranch = { heal: p.heal }; break;
        case 'atkUseDealtStack': self.atkUseDealtStack = { per: p.per, cap: p.cap }; break;
        case 'firstNullifyScale': self.firstNullifyScale = { pct: p.pct, step: p.step, bonus: p.bonus, ppCount: p.ppCount }; self.firstNullPct = p.pct; break;
        case 'startStageBranch': self.startStageBranch = { prio: p.prio, dealtPct: p.dealtPct }; break;
        case 'dragonAura': self.dragonAura = true; break;
        case 'hpScaleHao': self.hpScaleHao = true; break;
        case 'foeTypeBranch': self.foeTypeBranch = { low: p.low, high: p.high }; break;
        case 'yuBuff': self.yuBuff = { reduce: p.reduce, pp: p.pp }; break;
        case 'zhanBuff': self.zhanBuff = { prio: p.prio, low: p.low, high: p.high }; break;
        case 'noDamageDrain': self.noDamageDrain = { den: p.den, prio: p.prio }; break;
        case 'firstStatUp': self.firstStatUp = { halfDen: p.halfDen }; break;
        case 'lastClearHeal': self.lastClearHeal = { den: p.den }; break;
        case 'rageCrit': self.rageCrit = { first: p.first, extra: p.extra, later: p.later }; break;
        case 'rageHigh': self.hpHalfRage = { high: p.high, low: (self.hpHalfRage && self.hpHalfRage.low) || 0 }; break;
        case 'rageLow': self.hpHalfRage = { high: (self.hpHalfRage && self.hpHalfRage.high) || 0, low: p.low }; break;
        case 'fenjinOnClear': self.fenjinOnClear = true; break;
        case 'pendingZhuoxin': self.pendingZhuoxin = true; break;
        case 'burnEndBranch': self.burnEndBranch = { prio: p.prio, den: p.den }; break;
        case 'zhuoxinBuff': self.zhuoxinBuff = { prio: p.prio, ups: p.ups }; break;
        case 'fateWheel': self.fateWheel = true; break;
        case 'fateOnSwitch': self.fateOnSwitch = true; break;
        case 'fateHengDef': var hd = self.fateHengDef || { }; self.fateHengDef = { shield: p.shield != null ? p.shield : hd.shield, ward: p.ward != null ? p.ward : hd.ward, pp: p.pp != null ? p.pp : hd.pp }; break;
        case 'fateJieDef': var jd = self.fateJieDef || { }; self.fateJieDef = { pct: p.pct != null ? p.pct : jd.pct, den: p.den != null ? p.den : jd.den, prio: p.prio != null ? p.prio : jd.prio }; break;
        case 'nyxEnter': self.nyxEnter = { reduce: p.reduce }; break;
        case 'nyxField': self.nyxField = { diff: p.diff, turns: p.turns, pp: p.pp }; break;
        case 'nyxHpBranch': self.nyxHpBranch = Object.assign(self.nyxHpBranch || {}, p); break;
        case 'beimingBlade': self.beimingBlade = { turns: p.turns }; break;
        case 'formSystem': self.formSystem = true; break;
        case 'starSeaMark': self.starSeaMark = { turns: p.turns }; break;
        case 'allCrit': self.allCrit = true; break;
        case 'level100Revive': self.level100Revive = true; break;
        case 'wudaoOpen': self.wudaoOpen = true; break;
        case 'wudaoPP': self.wudaoPP = true; break;
        case 'wudaoHeal': self.wudaoHeal = p.den; break;
        case 'wudaoSkillDmg': self.wudaoSkillDmg = p.den; break;
        case 'wudaoDealt': self.wudaoDealt = p.pct; break;
        case 'twinCorps': self.twinCorps = true; break;
        case 'yueMain': self.yueMain = true; break;
        case 'yueSub': self.yueSub = { threshold: p.threshold }; break;
        case 'yuMain': self.yuMain = true; break;
        case 'yuSub': self.yuSub = true; break;
        case 'subFull': self.subFull = true; break;
        case 'starImmunity':
          self.immuneFixedPct = true;
          self.permImmuneStat = true;
          break;
        case 'onHitImmune': self.onHitImmune = true; break;
        case 'endDamageLost': self.endDamageLost += p.value; break;
        case 'endHeal': self.endHealNum += p.num; self.endHealDen = p.den; break;
        case 'endPpRestore': self.endPpRestore += p.value; break;
        case 'priorityIfHigher': self.priorityIfHigher = true; break;
        case 'fieldOnEnter': self.fieldOnEnter = true; break;
        case 'onEnterClear': self.onEnterClear = true; break;
        case 'rebirth': self.hasRebirth = true; break;
        case 'critBonus': self.critBonus += p.value; break;
        case 'drainOnHit': self.drainOnHit += p.num / p.den; break;
        case 'regenShield': self.regenShield += p.value; break;
        case 'onHitStatus': self.onHitStatus = { statusId: p.statusId, chance: p.chance }; break;
        case 'dodgePassive': self.dodgePassive = p.chance; break;
        case 'chanceImmuneStatus': self.chanceImmuneStatus = p.chance; break;
        case 'permImmuneStatWhenFull': self.permImmuneStatWhenFull = true; break;
        case 'entrySkillBlock': self.entrySkillBlock = p.turns; break;
        case 'dealtMulFoeStatus': self.dealtMulFoeStatus = p.mul; break;
        case 'onHitReflect': self.onHitReflect = { num: p.num, den: p.den }; break;
        case 'onHitExtraFlat': self.onHitExtraFlat = { chance: p.chance, value: p.value }; break;
        case 'endHealCond': self.endHealCond = p.value; break;
        case 'reviveChance': self.reviveChance = p.chance; break;
        case 'barrier': self.barrier = { value: p.value, perTurn: !!p.perTurn }; break;
        case 'exile': self.exileAura = { min: p.min, max: p.max, lowMax: p.lowMax || p.max, capAliveMinus: p.capAliveMinus == null ? 2 : p.capAliveMinus }; break;
        case 'divineTurn': self.divineTurn = { highPct: p.highPct, lowPct: p.lowPct, shieldPct: p.shieldPct }; break;
        case 'immuneStatusIds': self.immuneStatusIds = (self.immuneStatusIds || []).concat(p.ids || []); break;
        case 'wukongTurn': self.wukongTurn = true; break;
        case 'wukongForm': self.wukongForm = true; break;
        case 'fullHpGuard': self.fullHpGuardPct = p.pct; break;
        case 'endRampFlat': self.endRampFlat = { base: p.base, inc: p.inc, cap: p.cap, dbl: !!p.dbl }; break;
        case 'onHitClearFoeStats': self.onHitClearFoeStats = true; break;
        case 'morphGuard': self.morphGuard = { shield: p.shield, recharge: p.recharge, healNum: p.healNum, healDen: p.healDen }; break;
        case 'morphSpeed': self.morphSpeed = { priority: p.priority, statDown: p.statDown }; if (!self.morphMode) self.morphMode = 'speed'; break;
        case 'morphDestroy': self.morphDestroy = { dmgMul: p.dmgMul, execPct: p.execPct }; self.lowHpExecPct = Math.max(self.lowHpExecPct, p.execPct); break;
        case 'morphUltimate': self.morphUltimate = true; break;
        case 'firstHealBlock': self.firstHealBlock = true; break;
        case 'firstSpeedUp': self.firstSpeedUp = true; break;
        case 'defStatsPct':
          self.stats.def = Math.round(self.stats.def * (1 + p.pct / 100));
          self.stats.spDef = Math.round(self.stats.spDef * (1 + p.pct / 100));
          break;
        case 'lowHpExec': self.lowHpExecPct = Math.max(self.lowHpExecPct, p.pct); break;
        case 'starAtkSum': self.starAtkSum = true; break;
        case 'starSpecialPrio': self.starSpecialPrio += p.value; break;
        case 'starPhysDrain': self.starPhysDrain = p.pct; break;
        case 'starEntry': self.starEntry = true; break;
        case 'starDial': self.starDialCfg = { maxTicks: p.maxTicks, returnDmg: p.returnDmg, reducePct: p.reducePct }; break;
        case 'stackPassive':
      if (!self.stackPassive) { self.stackPassive = p; self.stacks = 0; }
      else self.stackPassive = Object.assign({}, self.stackPassive, { maxStacks: Math.max(self.stackPassive.maxStacks, p.maxStacks) });
      break;
        case 'reviveTeammate': self.reviveTeammate = p.chance; break;
        case 'regenPerSibling': self.regenPerSibling = { group: p.group, value: p.value, cap: p.cap }; break;
        case 'immuneFixedPct': self.immuneFixedPct = true; break;
        case 'junYu': self.junYu = true; self.immuneFixedPct = true; break;
    case 'junZhen': self.junZhen = true; break;
    case 'junWei': self.junWei = true; break;
    case 'junYun': self.junYun = p.chance || 30; break;
    case 'junYuan': self.junYuan = true; break;
    case 'benchStrike': self.benchStrike = { num: p.num, den: p.den, used: false }; break;
        case 'benchHeal': self.benchHeal = { num: p.num, den: p.den, used: false }; break;
        case 'benchAura': self.benchAura = self.benchAura || []; self.benchAura.push({ names: p.names, fx: p.fx }); break;
        case 'onHitCondStatus': self.onHitCondStatus = { threshold: p.threshold, statusId: p.statusId }; break;
        case 'entryImmuneStatus': self.entryImmuneStatus = p.turns; break;
        case 'onHitFlatPct': self.onHitFlatPct = p.pct; break;
        case 'entryShield': self.entryShield = p.value; break;
        case 'critImmune': self.critImmune = p.chance; break;
        case 'entryStatDown': self.entryStatDown = { stat: p.stat, stages: p.stages }; break;
        case 'entryStatus': self.entryStatus = { chance: p.chance, statusId: p.statusId }; break;
        case 'execChance': self.execChance += p.value; break;
        case 'hpBonus': self.hpBonus += p.value; break;
        case 'immuneBelowPassive': self.immuneBelow = { turns: 999, value: p.value }; break;
        case 'entryBuff': self.entryBuffs.push(p); break;
        case 'cond': self.condPassives.push(p); break;
        case 'deathTeamGuard': self.deathTeamGuard = { turns: p.turns, mul: p.mul }; break;
        default: break;
      }
    });
    if (this.hpBonus) {
      this.maxHp += this.hpBonus;
      this.hp = this.maxHp;
    }
    var list = entry.skills || [];
    this.skills = list.map(function (s) {
      var maxPp = Math.max(1, num(s.max_pp));
      return { skill: s, pp: maxPp, maxPp: maxPp };
    });
  }

  function Battle(config) {
    config = config || {};
    this.chart = config.chart || {};
    this.typeByName = config.typeByName || null; // 属性名 → 属性 ID（B08：属性系直伤要按克制结算）
    this.comboOf = config.comboOf || function () { return null; };
    this.rng = config.rng || Math.random;
    this.difficulty = config.difficulty || 'normal';
    this.pvp = !!config.pvp;
    this.field = null;
    this.level = config.level || 100;
    this.turn = 0;
    this.over = false;
    this.winner = null;
    this.needPlayerSwitch = false;
    this.needSwitch = { me: false, foe: false };
    this.exiled = { me: [], foe: [] }; // 神殇：本回合被放逐、无法主动切换的场下精灵下标
    this.log = [];
    this.benchAuras = { me: null, foe: null }; // 队伍建好后再收集（见 refreshBenchAuras）
    this.sideBuff = { me: null, foe: null }; // 自爆技能留给下一只精灵的强化
    this.deathGuard = { me: null, foe: null }; // 被击败魂印留给下一只的减伤
    this.lastCrit = null;                    // 本回合谁打出过会心一击

    // 双方各带一套基础道具
    var selfBag = this;
    this.items = {};
    ['me', 'foe'].forEach(function (side) {
      selfBag.items[side] = DEFAULT_ITEMS.map(function (id) {
        var d = ITEM_DEFS[id];
        return { id: d.id, name: d.name, desc: d.desc, count: d.init };
      });
    });

    var self = this;
    function makeSide(team, sideName) {
      return {
        active: 0,
        team: (team || []).map(function (e) {
          var c = new Combatant(e, self.level);
          c.side = sideName;
          return c;
        })
      };
    }
    this.me = makeSide(config.meTeam, 'me');
    this.foe = makeSide(config.foeTeam, 'foe');
    this.reserve = { me: config.meReserve || [], foe: config.foeReserve || [] };
    this.initStarAura();
    this.refreshBenchAuras();

    this.push('对战开始！');
    var a = this.activeOf('me');
    var b = this.activeOf('foe');
    if (a && b) this.push(a.pet.name + '  VS  ' + b.pet.name);
    this.onEnter(a);
    this.onEnter(b);
  }

  Battle.prototype.initStarAura = function () {
    var self = this;
    ['me', 'foe'].forEach(function (side) {
      var team = (self[side] && self[side].team) || [];
      var reserve = (self.reserve && self.reserve[side]) || [];
      var has = team.some(function (c) { return c && c.pet && c.pet.id === 3291 && c.hp > 0; }) ||
        reserve.some(function (e) { return e && e.pet && e.pet.id === 3291; });
      if (!has) return;
      team.forEach(function (c) {
        if (c && c.hp > 0) c.starBless = true;
      });
      var lead = null;
      for (var i = 0; i < team.length; i++) if (team[i] && team[i].hp > 0) { lead = team[i]; break; }
      if (lead) lead.starGuard = 3;
      self.push(self.tag(side) + '星皇之赐/星皇之佑生效。');
    });
  };

  Battle.prototype.tag = function (side) {
    return side === 'me' ? '【我方】' : '【对手】';
  };

  Battle.prototype.push = function (line) {
    this.log.push(line);
    if (this.log.length > 800) this.log.splice(0, this.log.length - 800);
  };

  Battle.prototype.activeOf = function (side) {
    var s = this[side];
    return s ? s.team[s.active] || null : null;
  };

  Battle.prototype.aliveCount = function (side) {
    var s = this[side];
    if (!s) return 0;
    var n = 0;
    for (var i = 0; i < s.team.length; i++) if (s.team[i].hp > 0) n++;
    return n;
  };

  Battle.prototype.effSpeed = function (c) {
    return c ? c.stats.spd * stageMul(c.stages.spd) : 0;
  };

  Battle.prototype.accuracyCheck = function (actor, target, skill) {
    // 「失明」（官方口径）：50% 概率令**攻击技能**失效 —— 必中技能也会被打空（显示 -0），普通技能显示 Miss
    if (actor && actor.status && actor.status.id === 'blind' && skill && skill.category && skill.category.id !== 4) {
      if (this.rng() * 100 < 50) {
        var mh = !!skill.must_hit || !!(this.field && this.field.mustHit);
        this.push(this.tag(actor.side) + actor.pet.name + (mh ? ' 因失明打空（必中技能也失效）：-0' : ' 因失明落空：Miss'));
        this.lastMissSide = actor.side;
        return false;
      }
    }
    // 3539 混沌·布莱克魂印：对手攻击技能概率闪避
    if (target.chanceDodgePct && skill && skill.category && skill.category.id !== 4) {
      if (this.rng() * 100 < target.chanceDodgePct) {
        this.push(target.pet.name + ' 的魂印闪避了这次攻击！');
        target.dodgeBuffPending = true;
        return false;
      }
      target.dodgeFailedThisTurn = true;
    }
    if (this.field && this.field.mustHit) return true;
    if (skill && skill.must_hit) return true;
    if (actor && actor.missTurns > 0) {
      this.push(actor.pet.name + ' 的攻击落空了！');
      return false;
    }
    if (target.attackMiss > 0) {
      target.attackMiss--;
      this.push(target.pet.name + ' 闪避了这次攻击！');
      return false;
    }
    if (actor.mustHitTurns > 0) return true;
    if (target.dodgeTimes && target.dodgeTimes.times > 0 && this.rng() * 100 < target.dodgeTimes.chance) {
      target.dodgeTimes.times--;
      this.push(target.pet.name + ' 闪避了这次攻击！');
      return false;
    }
    if (target.dodge && target.dodge.turns > 0) {
      var dspecial = skill && skill.category && skill.category.id === 2;
      var dsc = target.dodge.scope;
      var dHit = !dsc || (dsc === 'phys' && !dspecial) || (dsc === 'spec' && dspecial);
      if (dHit && this.rng() * 100 < target.dodge.chance) {
        this.push(target.pet.name + ' 闪避了这次攻击！');
        return false;
      }
    }
    var acc = skill.accuracy == null ? 100 : num(skill.accuracy);
    // 「失明」不是命中率惩罚（见 perform 里的操作覆写），被覆写出来的那一招照常按自身命中结算。
    var mul = accuracyMul(actor.stages.acc) / accuracyMul(target.stages.eva);
    return this.rng() * 100 < acc * mul;
  };

  Battle.prototype.applyPunish3291 = function (actor, target, skill) {
    if (!target || !target.punish3291 || target.punish3291.turns <= 0) return;
    var cat = skill && skill.category ? skill.category.id : 0;
    if (cat === 4) {
      var n = 1 + Math.floor(this.rng() * 3);
      var cand = actor.skills.filter(function (sl) { return sl.pp > 0; });
      if (cand.length) {
        var pick = cand[Math.floor(this.rng() * cand.length)];
        pick.pp = Math.max(0, pick.pp - n);
        this.push('瀚空之门：' + actor.pet.name + ' 的「' + pick.skill.name + '」PP 减少了 ' + n + ' 点。');
      }
    } else {
      var d = Math.max(1, Math.floor(actor.maxHp / 3));
      d = this.directDamage(actor, d, 'percent');
      this.push('瀚空之门：' + actor.pet.name + ' 受到 ' + d + ' 点百分比伤害。');
    }
    target.punish3291.turns--;
    if (target.punish3291.turns <= 0) target.punish3291 = null;
  };

  Battle.prototype.hasStarRage = function (skill) {
    if (!skill) return false;
    var src = (skill.effects && skill.effects.length) ? skill.effects : (skill.skill_effect || []);
    if (src.some(function (e) { return e && /星皇之怒/.test(e.info || e.analyze_info || ''); })) return true;
    return /星皇之怒/.test(skill.info || '');
  };

  Battle.prototype.tryStarRage = function (actor, target, skill, ctx) {
    if (!actor || !actor.starRage || !target || target.hp <= 0) return;
    if (!this.hasStarRage(skill)) return;
    var chance = 50 + (actor.starRageChanceBonus || 0);
    if (actor.starRageDouble > 0) chance *= 2;
    chance = Math.max(0, Math.min(100, chance));
    if (this.rng() * 100 >= chance) return;

    this.push(this.tag(actor.side) + actor.pet.name + ' 触发「星皇之怒」！');
    // 二次行动：重复一次技能伤害；不消耗 PP、不再触发星皇之怒
    if (num(skill.power) > 0 && target.hp > 0) {
      var r = calcDamage({
        actor: actor, target: target, skill: skill,
        skillCombo: this.comboOf(skill.type && skill.type.id),
        actorCombo: actor.combo, targetCombo: target.combo,
        chart: this.chart, level: actor.level || this.level,
        rng: this.rng
      });
      var actual = this.applyDamage(target.side, r.damage, {
        attack: true, physical: !!(skill.category && skill.category.id === 1),
        comboName: this.comboOf(skill.type && skill.type.id).name || '',
        crit: false
      });
      this.push('星皇之怒追加 ' + actual + ' 点伤害。');
    }

    // 各技能的 [星皇之怒] 附加效果（按 effect id 1094-1098 的 starRageMode 分派）
    if (actor.starRageModeCur === 'noUpPercent') {
      var noUp = ['atk', 'def', 'spAtk', 'spDef', 'spd', 'acc'].every(function (k) { return target.stages[k] <= 0; });
      if (noUp && target.hp > 0) {
        var pd = Math.max(1, Math.floor(target.maxHp / 3));
        pd = this.directDamage(target, pd, 'percent');
        this.push('星皇之怒：附加 ' + pd + ' 点百分比伤害。');
      }
    } else if (actor.starRageModeCur === 'dmgBuff') {
      actor.damageBuff = { turns: 2, mul: 2 };
      actor.guards.push({ turns: 2, mul: 0.5, scope: 'all' });
      this.push('星皇之怒：下 2 回合攻击伤害翻倍，受到攻击伤害减半。');
    } else if (actor.starRageModeCur === 'roundLock') {
      actor.starRoundLock = Math.max(actor.starRoundLock, 2);
      var pb = actor.priorityBuff || { turns: 0, value: 0 };
      actor.priorityBuff = { turns: Math.max(pb.turns, 2), value: Math.max(pb.value, 2) };
      this.push('星皇之怒：下 2 回合回合类效果不可被消除，先制 +2。');
    } else if (actor.starRageModeCur === 'blind') {
      if (this.rng() * 100 < 50) {
        this.applyStatus(target, 'blind', 2, '对手');
        this.push('星皇之怒：对手失明 2 回合。');
      } else {
        target.skillBlock = Math.max(target.skillBlock || 0, 2);
        this.push('星皇之怒：对手下 2 回合属性技能无效。');
      }
    } else if (actor.starRageModeCur === 'prio') {
      actor.starRagePriority = Math.max(actor.starRagePriority || 0, 2);
      this.push('星皇之怒：下 2 次攻击技能先制 +2。');
    }
    if (actor.starRageDouble > 0) actor.starRageDouble--;
    actor.starRageModeCur = null;
  };

  Battle.prototype.afterSkill3291 = function (actor, target, skill, ctx, selfDied) {
    if (!actor || actor.pet.id !== 3291) return;
    // 30376/25294/25295/30380/30381 的固定部分已由 effect id 1094-1098 的 fx 结算，下面只保留星怒/星皇之赐
    var specHandled = [30376, 25294, 25295, 30380, 30381].indexOf(skill.id) >= 0;

    // 圣世惩杀：断回合/消强成功后，下 2 回合星皇之怒概率 +20%
    if (!specHandled && skill.id === 30376) {
      var hadBoost = false;
      ['atk', 'def', 'spAtk', 'spDef', 'spd', 'acc', 'eva'].forEach(function (k) {
        if (target.stages[k] > 0) { target.stages[k] = 0; hadBoost = true; }
      });
      if (hadBoost) {
        ctx.clearSuccess = true;
        this.push('圣世惩杀：消除了对手的能力提升。');
      }
      if (ctx && ctx.clearSuccess) {
        actor.starRageChanceBonus = 20;
        actor.starRageChanceTurns = 2;
        this.push('圣世惩杀：下 2 回合星皇之怒概率 +20%。');
      }
    }

    // 命宇轮回：低血强化翻倍、4 回合吸血、下 2 次星皇之怒概率翻倍
    if (!specHandled && skill.id === 25295) {
      if (actor.hp < actor.maxHp / 2) {
        ['atk', 'def', 'spAtk', 'spDef', 'spd'].forEach(function (k) {
          actor.stages[k] = clampStage(actor.stages[k] + 1);
        });
        this.push('命宇轮回：体力低于一半，强化效果翻倍。');
      }
      actor.drain3291 = { turns: 4, num: 1, den: 3 };
      actor.starRageDouble = 2;
      this.push('命宇轮回：下 2 次星皇之怒概率翻倍。');
    }

    // 瀚空之门：3 回合对手出手惩罚
    if (!specHandled && skill.id === 25294) {
      actor.punish3291 = { turns: 3 };
      this.push('瀚空之门：3 回合内对手出手将受到惩罚。');
    }

    // 亘古圣辰决：伤害低于 280 → 疲惫；未击败 → 下回合攻击技能无效
    if (!specHandled && skill.id === 30380) {
      target.skillBlock = 0;
      if (ctx && ctx.dealt > 0 && ctx.dealt < 280) {
        this.applyStatus(target, 'tired', 1, '对手');
        this.push('亘古圣辰决：伤害不足 280，对手疲惫。');
      }
      if (target.hp > 0) {
        target.attackBlock = Math.max(target.attackBlock || 0, 1);
        this.push('亘古圣辰决：未击败对手，对手下回合攻击技能无效。');
      }
    }

    // 万皇宗魄决：暴击后下 2 次星皇之怒威力不再减少
    if (!specHandled && skill.id === 30381 && ctx && ctx.crit) {
      actor.starRagePowerKeep = 2;
      this.push('万皇宗魄决：下 2 次星皇之怒威力不再减少。');
    }

    // 星皇之怒的触发与附加效果
    if (!selfDied) this.tryStarRage(actor, target, skill, ctx);
  };

  /** 通用「技能结算后」钩子：低伤附加异常/未击败封锁攻击、暴击触发类 */
  Battle.prototype.afterSkillGeneric = function (actor, target, skill, ctx) {
    if (!actor || !target) return;
    // 星皇之赐（3291 背包效果）：己方每只精灵使用技能后回复最大体力 1/8
    if (actor.starBless && actor.hp > 0) {
      var hb = Math.max(1, Math.floor(actor.maxHp / 8));
      var blessHeal = Math.min(hb, actor.maxHp - actor.hp);
      if (blessHeal > 0) {
        actor.hp += blessHeal;
        this.push('星皇之赐：' + actor.pet.name + ' 回复 ' + blessHeal + ' 点体力。');
      }
    }
    if (actor.starLowDamage) {
      var low = actor.starLowDamage;
      if (ctx && ctx.dealt > 0 && ctx.dealt < low.threshold) {
        this.applyStatus(target, low.statusId, 1, '对手');
        this.push('伤害低于 ' + low.threshold + '，令对手陷入异常。');
      }
      if (target.hp > 0) {
        target.attackBlock = Math.max(target.attackBlock || 0, 1);
        this.push('未击败对手，其下回合攻击技能无效。');
      }
      actor.starLowDamage = null;
    }
    if (ctx && ctx.lowDamageBench && ctx.dealt > 0 && ctx.dealt < ctx.lowDamageBench.threshold) {
      var foeBn = this[actor.side === 'me' ? 'foe' : 'me'].team.filter(function (x) { return x && x !== target && x.hp > 0; });
      if (foeBn.length) {
        var lb = foeBn[Math.floor(this.rng() * foeBn.length)];
        lb.hp = Math.max(1, lb.hp - ctx.lowDamageBench.value);
        this.push('伤害低于 ' + ctx.lowDamageBench.threshold + '：对手场下 ' + lb.pet.name + ' 损失 ' + ctx.lowDamageBench.value + ' 点体力。');
      }
    }
    if (ctx && ctx.critHealDealt && ctx.crit && actor.hp > 0 && actor.hp < actor.maxHp) {
      var chi = Math.max(1, Math.floor((ctx.dealt || 0) * ctx.critHealDealt.num / ctx.critHealDealt.den));
      chi = Math.min(chi, actor.maxHp - actor.hp);
      if (chi > 0) { actor.hp += chi; this.push('暴击吸血：回复 ' + chi + ' 点体力。'); }
    }
    if (actor.pendingFoeAttackBlock) {
      target.attackBlock = Math.max(target.attackBlock || 0, actor.pendingFoeAttackBlock);
      actor.pendingFoeAttackBlock = 0;
    }
    if (target.junPunish && target.junPunish.turns > 0 && ctx && ctx.dealt > 0 && ctx.dealt < target.junPunish.threshold) {
      var ownBn = this[actor.side].team.filter(function (x) { return x && x !== actor && x.hp > 0; });
      if (ownBn.length) {
        var ob = ownBn[Math.floor(this.rng() * ownBn.length)];
        ob.hp = Math.max(1, ob.hp - target.junPunish.bench);
        this.push('帝君之罚：' + ob.pet.name + ' 场下损失 ' + target.junPunish.bench + ' 点体力。');
      }
    }
    if (target.junGuard && target.junGuard.turns > 0 && ctx && ctx.dealt > target.junGuard.threshold) {
      for (var gi = 0; gi < (target.junGuard.count || 2); gi++) {
        var poolG = ['poison', 'burn', 'paralyze', 'fear'];
        this.applyStatus(actor, poolG[Math.floor(this.rng() * poolG.length)], 1, '我方');
      }
      this.push('受到高额伤害，随机附加 2 种异常状态。');
    }
    if (ctx && ctx.powerPerStack) {
      var keepAt = ctx.powerPerStack.keepAtMaxStacks || 6;
      if (!(actor.stacks >= keepAt)) { actor.stacks = 0; this.push('神耀能量被消耗殆尽。'); }
      else this.push('神耀能量满层：第五技能不再消耗能量。');
    }
    if (ctx && ctx.stacksOnResult) {
      var addS = ctx.crit ? ctx.stacksOnResult.crit : ctx.stacksOnResult.base;
      var mxR = (actor.stackPassive && actor.stackPassive.maxStacks) || 6;
      actor.stacks = Math.min(mxR, (actor.stacks || 0) + addS);
      this.push('神耀能量 +' + addS + '（' + actor.stacks + '/' + mxR + '）。');
    }
    if (ctx && ctx.stacksOnKill && target.hp <= 0) {
      var mxK = (actor.stackPassive && actor.stackPassive.maxStacks) || 6;
      actor.stacks = Math.min(mxK, (actor.stacks || 0) + ctx.stacksOnKill);
      this.push('击败对手，神耀能量 +' + ctx.stacksOnKill + '（' + actor.stacks + '/' + mxK + '）。');
    }
    if (actor.lastFoeAttackBlockPending && ctx && !ctx.isFirst) {
      target.attackBlock = Math.max(target.attackBlock || 0, 1);
      actor.lastFoeAttackBlockPending = false;
      this.push('后出手：对手下 1 回合攻击技能无效。');
    }
    if (actor.reflectIfAlivePending && target.hp > 0) {
      actor.reflectTakenPct = actor.reflectIfAlivePending;
      actor.reflectIfAlivePending = null;
      this.push('未击败对手：下 ' + actor.reflectTakenPct.turns + ' 回合反弹受到伤害的 ' + actor.reflectTakenPct.num + '/' + actor.reflectTakenPct.den + '。');
    }
    if (actor.stackPassive && actor.stacks >= 6 && target.hp <= 0) {
      actor.stacks = 0;
      actor.priorityBuff = { turns: 1, value: 3 };
      this.push('6 层神耀击败对手：层数归 0，下回合先制 +3。');
    }
    if (actor.attackHitStatus && ctx && ctx.dealt > 0 && actor.hp > 0) {
      var ahs = actor.attackHitStatus;
      if (ahs.turns > 0 && this.rng() * 100 < ahs.chance) {
        this.applyStatus(target, ahs.statusId, 1, '对手');
        this.push('攻击命中触发：令对手陷入异常。');
      }
    }
    if (ctx && ctx.crit && actor.starPowerKeepPending) {
      actor.starRagePowerKeep = 2;
      actor.starPowerKeepPending = false;
      this.push('暴击后：下 2 次星皇之怒威力不再减少。');
    }
  };

  Battle.prototype.mistikeReact = function (actor, target, skill, ctx) {
    if (!target || !target.mistikeSoul || target.hp <= 0) return;
    target.mistikeFoeActed = true;

    // 对手每次使用技能：随机 2 项能力 -1
    var stats = ['atk', 'def', 'spAtk', 'spDef', 'spd', 'acc'];
    var lowered = 0;
    var self = this;
    var picks = stats.slice().sort(function () { return self.rng() - 0.5; });
    for (var i = 0; i < picks.length && lowered < 2; i++) {
      var k = picks[i];
      if (actor.stages[k] > -6) {
        actor.stages[k] = clampStage(actor.stages[k] - 1);
        lowered++;
      }
    }
    if (lowered > 0) {
      this.push('秘：' + actor.pet.name + ' 随机 ' + lowered + ' 项能力下降了。');
    } else {
      target.mistikeGuardTurn = this.turn;
      this.push('秘：未触发能力下降，' + target.pet.name + ' 本回合受到的伤害减少 50%。');
    }

    var cat = skill && skill.category ? skill.category.id : 0;
    if (cat !== 4) {
      target.priorityBuff = { turns: 1, value: 1 };
      target.mustHitTurns = Math.max(target.mustHitTurns || 0, 1);
      this.push('秘：对手使用攻击技能，' + target.pet.name + ' 下回合先制 +1 且必定命中。');
    } else {
      var pd = Math.max(1, Math.floor(actor.maxHp / 4));
      pd = self.directDamage(actor, pd, 'percent');
      actor.mistikeVuln = true;
      this.push('秘：对手使用属性技能，' + actor.pet.name + ' 受到 ' + pd + ' 点百分比伤害，下次受到攻击伤害 +100%。');
    }
  };

  Battle.prototype.afterSkill4676 = function (actor, target, skill, ctx) {
    this.mistikeReact(actor, target, skill, ctx);

    // 技能里的蚩庸之锁：28809 / 37510；上限 3 道
    if (skill.id === 28809 || skill.id === 37510) {
      var add = skill.id === 37510 ? 3 : 1;
      var room = Math.max(0, 3 - (target.lockStacks || 0));
      var added = Math.min(add, room);
      target.lockStacks = (target.lockStacks || 0) + added;
      target.lockAddedTurn = this.turn;
      this.push('蚩庸之锁：' + target.pet.name + ' 获得 ' + added + ' 道（' + target.lockStacks + '/3）。');
      if (added < add) {
        target.priorityDown = { turns: 2, value: 1 };
        this.push('蚩庸之锁超过上限：' + target.pet.name + ' 下 2 回合先制 -1。');
      }
    }

    // 28809：4 回合吸血；37510：自爆后给下一只护盾（这里先记录锁与吸血）
    if (skill.id === 28809) {
      actor.drain4676 = { turns: 4, num: 1, den: 3 };
      this.push('魂劫骇咒：4 回合内每回合吸取对手 1/3 最大体力。');
    }
    // 37510 堕之盛响：消耗自身全部体力 → 己方下只登场精灵获得「消耗值 50%」的护盾与护罩
    if (skill.id === 37510) {
      var consumed37510 = Math.max(0, actor.hp);
      actor.hp = 0;
      var gain37510 = Math.max(1, Math.floor(consumed37510 / 2));
      this.nextAllyShield = { side: actor.side, value: gain37510 };
      this.push('堕之盛响：消耗自身全部体力（' + consumed37510 + '），己方下一只登场精灵获得 ' + gain37510 + ' 点护盾与护罩。');
    }
    if (skill.id === 28808) {
      target.statDownLock = 4;
      this.push('心朽魂凋：对手 4 回合内能力下降不可被解除/反转。');
    }

    // 37511：每道锁随机清 1 个攻击技能 PP；攻击技能 PP 不足时伤害 +100%
    if (skill.id === 37511 && target.lockStacks > 0) {
      var atkSkills = target.skills.filter(function (sl) { return sl.skill.category && sl.skill.category.id !== 4; });
      var withPp = atkSkills.filter(function (sl) { return sl.pp > 0; });
      for (var i = 0; i < target.lockStacks; i++) {
        if (!withPp.length) break;
        var pick = withPp[Math.floor(this.rng() * withPp.length)];
        pick.pp = 0;
        withPp = withPp.filter(function (sl) { return sl.pp > 0; });
      }
      if (withPp.length < target.lockStacks) {
        this.push('王·御影神罚：对手攻击技能 PP 不足，本次伤害提升 100%。');
      }
    }
  };

  /** 「N回合内每回合使用技能恢复自身最大体力的1/M」：同一回合只回一次 */
  /** 2212：低威力攻击先判异常，未触发则标记抵挡当次攻击 */
  Battle.prototype.preAttackStatusHooks = function (actor, target, skill) {
    var h = target && target.teLowPower;
    if (!h || h.turns <= 0) return;
    var cat = skill && skill.category ? skill.category.id : 0;
    if (cat !== 1 && cat !== 2) return;
    if ((skill.power || 0) > h.threshold) return;
    this.applyStatus(actor, h.statusId, 1, this.tag(actor.side));
    var applied = !!(actor.status && actor.status.id === h.statusId);
    if (!applied) {
      target.lowPowerBlock = true;
      this.push('低威力攻击未触发异常，抵挡本次攻击。');
    }
  };

  /** 469：对手使用属性技能后按概率附加异常 */
  Battle.prototype.afterSkillStatusHooks = function (actor, target, skill) {
    var h = target && target.teAttrTrigger;
    if (!h || h.turns <= 0 || actor.hp <= 0) return;
    var cat = skill && skill.category ? skill.category.id : 0;
    if (cat !== 4) return;
    if (this.rng() * 100 >= h.chance) return;
    this.applyStatus(actor, h.statusId, 1, this.tag(actor.side));
  };

  Battle.prototype.applyTeUseHeal = function (side, actor) {
    var h = actor && actor.teUseHeal;
    if (!h || h.turns <= 0 || h.last === this.turn) return 0;
    h.last = this.turn;
    if (actor.hp <= 0 || actor.hp >= actor.maxHp) return 0;
    if (actor.healBlock > 0) return 0;
    var uh = Math.min(Math.floor(actor.maxHp * h.num / (h.den || 1)), actor.maxHp - actor.hp);
    if (h.lowHalf && actor.hp * (h.lowHalf || 2) < actor.maxHp) uh = Math.min(uh * 2, actor.maxHp - actor.hp);
    if (uh <= 0) return 0;
    actor.hp += uh;
    this.push(this.tag(side) + '回合类效果回复了 ' + uh + ' 点体力（剩 ' + h.turns + ' 回合）。');
    if (h.percent) {
      var foeC = this.activeOf(side === 'me' ? 'foe' : 'me');
      if (foeC && foeC.hp > 0) {
        var pdm = this.directDamage(foeC, uh, 'percent');
        if (pdm > 0) this.push('并造成等量 ' + pdm + ' 点百分比伤害。');
      }
    }
    return uh;
  };

  Battle.prototype.useSkill = function (side, index, turnCtx) {
    var actor = this.activeOf(side);
    // 861：对手使用属性技能 → 全技能 PP -N
    var _foeForPP = this.activeOf(side === 'me' ? 'foe' : 'me');
    if (actor && _foeForPP && _foeForPP.attrPunishPP && _foeForPP.attrPunishPP.turns > 0) {
      var _sl0 = actor.skills[index];
      if (_sl0 && _sl0.skill.category && _sl0.skill.category.id === 4) {
        var _amt = _foeForPP.attrPunishPP.amount;
        actor.skills.forEach(function (slP) { slP.pp = Math.max(0, slP.pp - _amt); });
        this.push('对手的属性技触发惩罚：全技能 PP -' + _amt + '。');
      }
    }
    if (actor) actor.actedThisTurn = true;
    // 「N回合内每回合使用技能恢复自身最大体力的1/M」：使用技能时立刻回血（同回合只一次）
    if (actor) this.applyTeUseHeal(side, actor);
    var foeSide = side === 'me' ? 'foe' : 'me';
    var target = this.activeOf(foeSide);
    if (!actor || !target || actor.hp <= 0 || target.hp <= 0) return;

    var slot = actor.skills[index];
    if (!slot) { this.push(this.tag(side) + '没有可用的技能。'); return; }
    var skill = slot.skill;

    // 魂·天忤太虚：仅处于星赐→物理、仅处于星哲→特殊；系别随自身，威力随天赋
    if (skill.id === 28810 && ((actor.starGift > 0) !== (actor.starPhil > 0))) {
      var starSkill = {};
      Object.keys(skill).forEach(function (k) { starSkill[k] = skill[k]; });
      starSkill.category = { id: actor.starGift > 0 ? 1 : 2 };
      starSkill.power = 150 + (actor.iv || 31); // 原始未给公式，按 150+天赋 估算
      if (actor.combo) starSkill.type = { id: actor.combo.id };
      skill = starSkill;
    }
    var self = this;

    // 4950 魂印：钺主位 → 攻击技能先制 +1
    if (actor.yueMain && actor.mainPos === '钺' && skill.category && (skill.category.id === 1 || skill.category.id === 2)) {
      actor.priorityBuff = { turns: 1, value: Math.max((actor.priorityBuff && actor.priorityBuff.value) || 0, 1) };
    }
    // 4766 魂印：使用技能附加对手最大体力 1/6 百分比伤害（邪之道翻倍）
    if (actor.wudaoSkillDmg) {
      var wd = Math.max(1, Math.floor(target.maxHp / actor.wudaoSkillDmg)) * (actor.wudao === '邪' ? 2 : 1);
      wd = this.directDamage(target, wd, 'percent');
      this.push(this.tag(side) + '魂印：武道附加 ' + wd + ' 点百分比伤害。');
    }
    // 4648 魂印：所有技能必定暴击 + 攻击后附加星海之浸
    if (skill.category && (skill.category.id === 1 || skill.category.id === 2)) {
      if (actor.allCrit) actor.critBuffTurns = Math.max(actor.critBuffTurns || 0, 1);
      if (actor.starSeaMark && target) { target.starSea = { turns: actor.starSeaMark.turns }; }
    }
    // 4219 魂印：灼心之焰（先制+1 / 必暴 / 命中后随机 2 项 +1）
    var isAtkAn = skill.category && (skill.category.id === 1 || skill.category.id === 2);
    if (isAtkAn && actor.pendingZhuoxin) {
      actor.pendingZhuoxin = false;
      actor.zhuoxinActive = true;
      this.push(this.tag(side) + '魂印：获得灼心之焰。');
    }
    if (isAtkAn && actor.zhuoxinActive && actor.zhuoxinBuff) {
      actor.critBuffTurns = Math.max(actor.critBuffTurns || 0, 1);
      actor.priorityBuff = { turns: 1, value: Math.max((actor.priorityBuff && actor.priorityBuff.value) || 0, actor.zhuoxinBuff.prio) };
    }
    // 3994 魂印：半血分支伤害提升 / 狂怒雷电暴击
    var isAtkGlS = skill.category && (skill.category.id === 1 || skill.category.id === 2);
    if (isAtkGlS && actor.hpHalfRage && actor.hpHalfHighB && actor.hpHalfRage.high > 0) {
      var mulGl = 1 + actor.hpHalfRage.high * ((turnCtx && turnCtx.isFirst) ? 2 : 1) / 100;
      actor.damageBuff = { turns: 1, mul: mulGl };
    }
    if (isAtkGlS && actor.rageCrit && actor.rageChance > 0) {
      if (this.rng() * 100 < actor.rageChance) {
        actor.critBuffTurns = Math.max(actor.critBuffTurns || 0, 1);
        actor.ragePending = true;
        this.push(this.tag(side) + '魂印：狂怒雷电触发致命一击。');
      }
      actor.rageChance = 0;
    }
    // 3924 魂印：先出手全属性+1 / 后出手断回合
    if (turnCtx && turnCtx.isFirst && actor.firstStatUp) {
      ['atk', 'def', 'spAtk', 'spDef', 'spd'].forEach(function (k9) { actor.stages[k9] = clampStage(actor.stages[k9] + 1); });
      this.push(this.tag(side) + '魂印：先出手，全属性 +1。');
      if (actor.hp * actor.firstStatUp.halfDen > actor.maxHp) {
        actor.stages.atk = clampStage(actor.stages.atk + 1);
        actor.stages.spd = clampStage(actor.stages.spd + 1);
        this.push(this.tag(side) + '魂印：体力过半，额外攻击 +1、速度 +1。');
      }
    }
    if (turnCtx && !turnCtx.isFirst && actor.lastClearHeal) {
      var nClr = this.clearRoundEffects(target);
      if (nClr === 0) {
        var healJm = Math.min(Math.floor(actor.maxHp / actor.lastClearHeal.den), actor.maxHp - actor.hp);
        if (healJm > 0) {
          actor.hp += healJm;
          if (target.hp > 0) this.directDamage(target, healJm, 'percent');
          this.push(this.tag(side) + '魂印：对手无回合类效果，恢复 ' + healJm + ' 体力并造成等量百分比伤害。');
        }
      }
    }
    // 3809 魂印：战之龙魂 / 御之龙魂 / 记录对手技能类型
    if (skill && skill.category) actor.lastSkillCategory = skill.category.id;
    var haoAtk = skill.category && (skill.category.id === 1 || skill.category.id === 2);
    if (actor.zhanTurns > 0 && actor.zhanBuff) {
      actor.mustHitTurns = Math.max(actor.mustHitTurns || 0, 1);
      actor.priorityBuff = { turns: 1, value: Math.max((actor.priorityBuff && actor.priorityBuff.value) || 0, actor.zhanBuff.prio) };
    }
    if (actor.yuTurns > 0 && actor.yuBuff && haoAtk && target.hp > 0) {
      var poolY = target.skills.filter(function (sl) { return sl.pp > 0; });
      for (var yi = 0; yi < actor.yuBuff.pp && poolY.length; yi++) {
        poolY.splice(Math.floor(this.rng() * poolY.length), 1)[0].pp = 0;
      }
      this.push(this.tag(side) + '御之龙魂：令对手随机 ' + actor.yuBuff.pp + ' 个技能 PP 归零。');
    }
    // 3807 魂印：先手时令对手技能失效，概率递减换永久增伤
    if (actor.firstNullifyScale && turnCtx && turnCtx.isFirst && actor.firstNullPct > 0) {
      if (this.rng() * 100 < actor.firstNullPct) {
        target.skillNull = Math.max(target.skillNull || 0, 1);
        actor.firstNullPct -= actor.firstNullifyScale.step;
        actor.firstNullBonus += actor.firstNullifyScale.bonus;
        this.push(actor.pet.name + ' 的魂印：对手本回合技能失效，下触发概率 ' + Math.max(0, actor.firstNullPct) + '%，永久增伤 +' + actor.firstNullBonus + '%。');
        if (actor.firstNullPct <= 0) {
          var poolOu = target.skills.filter(function (sl) { return sl.pp > 0; });
          for (var oi = 0; oi < actor.firstNullifyScale.ppCount && poolOu.length; oi++) {
            poolOu.splice(Math.floor(this.rng() * poolOu.length), 1)[0].pp = 0;
          }
          this.push(actor.pet.name + ' 的魂印：概率耗尽，对手随机 ' + actor.firstNullifyScale.ppCount + ' 项技能 PP 归零。');
        }
      }
    }
    // 3627 魂印：先手/后手的前置结算（命中前）
    var isAtkFr = skill.category && (skill.category.id === 1 || skill.category.id === 2);
    if (isAtkFr && actor.preHitClearFoe) {
      this.clearRoundEffects(target);
    }
    if (isAtkFr && turnCtx && turnCtx.isFirst) {
      if (actor.ifSelfFirstBoost) {
        actor.immuneStat = Math.max(actor.immuneStat || 0, 1);
        actor.damageBuff = { turns: 1, mul: 1 + actor.ifSelfFirstBoost.pct / 100 };
        this.push(actor.pet.name + ' 的魂印：先出手，本回合造成伤害提升 ' + actor.ifSelfFirstBoost.pct + '%。');
      }
      if (target.ifFoeFirstReduce) {
        target.immuneStatus = Math.max(target.immuneStatus || 0, 1);
        target.turnTakenMul = (target.turnTakenMul || 1) * (1 - target.ifFoeFirstReduce.pct / 100);
        this.push(target.pet.name + ' 的魂印：被先手，本回合受到的攻击伤害减少 ' + target.ifFoeFirstReduce.pct + '%。');
      }
    }
    // 3539 魂印：对手使用属性技能则自身免疫下次异常
    if (skill.category && skill.category.id === 4 && target.statusSkillImmuneNext && target !== actor) {
      target.immuneStatus = Math.max(target.immuneStatus || 0, 1);
      this.push(target.pet.name + ' 的魂印：免疫下 1 次受到的异常状态。');
    }
    // 3482 魂印：使用属性技能后，回合末回血 + 等量百分比伤害
    if (actor.statusSkillEndHeal && skill.category && skill.category.id === 4) {
      actor.pendingStatusHeal = actor.statusSkillEndHeal;
    }
    // 3414 魂印封印：属性技能无效
    if (actor.statusSkillNull > 0 && skill.category && skill.category.id === 4) {
      actor.statusSkillNull--;
      this.push(this.tag(side) + '的属性技能被封印了，没有产生效果。');
      return;
    }
    // 3308 圣灵之光：敌方使用攻击技能时随机清 PP
    if (target && target.ppZeroOnFoeAtk && target.ppZeroOnFoeAtk.turns > 0
      && skill.category && (skill.category.id === 1 || skill.category.id === 2)) {
      var pzPool = actor.skills.filter(function (sl) { return sl.pp > 0; });
      if (pzPool.length) {
        var pzPick = pzPool[Math.floor(this.rng() * pzPool.length)];
        pzPick.pp = 0;
        this.push(target.pet.name + ' 的护佑令 ' + actor.pet.name + ' 的「' + pzPick.name + '」PP 归零。');
      }
    }
    // 「天雷断绝」：对手使用属性技能时，自身获得数回合受伤上限
    if (skill.category && skill.category.id === 4 && target.capOnStatus && target.capOnStatus.turns > 0) {
      target.damageCap = { turns: target.capOnStatus.capTurns, value: target.capOnStatus.value };
      this.push(target.pet.name + ' 的受伤上限生效：' + target.capOnStatus.capTurns + ' 回合内受到伤害不超过 ' + target.capOnStatus.value + '。');
    }

    if (slot.pp <= 0) {
      this.push(this.tag(side) + actor.pet.name + ' 的 ' + skill.name + ' 已无 PP，只能硬撑。');
      var recoil = Math.max(1, Math.floor(actor.maxHp / 8));
      actor.hp = Math.max(0, actor.hp - recoil);
      this.push(actor.pet.name + ' 损失了 ' + recoil + ' 点体力。');
      return;
    }
    var ppCostNow = (actor.ppCostMul && actor.ppCostMul.turns > 0) ? Math.max(1, actor.ppCostMul.mul) : 1;
    if (actor.noPpCost && actor.hp / actor.maxHp < actor.noPpCost) ppCostNow = 0;
    slot.pp = Math.max(0, slot.pp - ppCostNow);

    // 属性技能被封锁（自爆技能留下的封锁）
    if (skill.category && skill.category.id === 4 && actor.skillBlock > 0) {
      this.push(this.tag(side) + '的属性技能被封锁，无法使用。');
      return;
    }
    if (skill.category && skill.category.id === 4 && actor.status && actor.status.id === 'silence') {
      this.push(this.tag(side) + '处于沉默状态，属性技能无效。');
      return;
    }
    if (skill.category && skill.category.id === 4 && actor.skillBlockChance && actor.skillBlockChance.turns > 0 && this.rng() * 100 < actor.skillBlockChance.chance) {
      this.push(this.tag(side) + '的属性技能被封锁了！');
      return;
    }
    // 攻击技能被封锁
    if (skill.category && skill.category.id !== 4 && actor.attackBlock > 0) {
      this.push(this.tag(side) + '的攻击技能被封锁，无法使用。');
      return;
    }

    // 连续使用同一技能计数（部分技能威力随连击递增）
    if (actor.lastSkillKey === skill.id) actor.streak++;
    else { actor.streak = 0; actor.lastSkillKey = skill.id; }
    actor.currentSkillId = skill.id;
    // 递增增伤只在「连续使用同一技能」时叠加：中间换了别的技能就清零（当回合标记也一并失效）
    if (actor.rampSkillId && actor.rampSkillId !== skill.id) { actor.rampUses = 0; actor.rampSkillId = 0; actor.rampActive = false; }

    var fx = parseSkillEffects(skill);
    this.preAttackStatusHooks(actor, target, skill);

    this.push(this.tag(side) + actor.pet.name + ' 使出「' + skill.name + '」！');

    // 技能效果原文（和魂印一样，让玩家看得到这句技能到底写了什么）
    var effText = skill.info;
    if (!effText) {
      var srcEff = skill.skill_effect || skill.effects || [];
      effText = srcEff.map(function (x) { return x && x.info; }).filter(Boolean).join('；');
    }
    if (effText) {
      this.push('　〔技能效果〕' + String(effText).replace(/\s*\n\s*/g, ' ').trim());
    }

    // 魂印：技能被无效化
    if (actor.skillNull > 0) {
      actor.skillNull--;
      this.push(this.tag(side) + '但技能被无效化了！');
      if (actor.starRageOnNull && target.hp > 0 && this.rng() * 100 < 50) {
        this.push('星皇之怒：技能无效后获得额外行动。');
        this.tryStarRage(actor, target, skill, {});
      }
      return;
    }

    if (!this.accuracyCheck(actor, target, skill)) {
      this.push('但是没有命中…');
      if (actor.selfKoOnMiss) {
        actor.hp = 0;
        this.push(actor.pet.name + ' 未命中，自身倒下了！');
      }
      var defHM = this.activeOf(foeSide);
      if (defHM && defHM.healOnFoeMiss && defHM.healOnFoeMiss.turns > 0) {
        var hhm = Math.min(Math.max(1, Math.floor(defHM.maxHp * defHM.healOnFoeMiss.num / defHM.healOnFoeMiss.den)), defHM.maxHp - defHM.hp);
        if (hhm > 0) { defHM.hp += hhm; this.push(defHM.pet.name + ' 恢复了 ' + hhm + ' 点体力。'); }
      }
      // 未命中时的补偿效果
      if (actor.onMissHeal && actor.hp > 0) {
        var omh = Math.min(Math.max(1, Math.floor(actor.maxHp * actor.onMissHeal.num / actor.onMissHeal.den)), actor.maxHp - actor.hp);
        if (omh > 0) {
          actor.hp += omh;
          this.push(actor.pet.name + ' 回复了 ' + omh + ' 点体力。');
        }
      }
      return;
    }

    var ctx = {
      actor: actor, target: target, side: side,
      isFirst: !!(turnCtx && turnCtx.isFirst),
      dealt: 0, crit: false, clearSuccess: false,
      chart: this.chart, turn: this.turn,
      skillCombo: this.comboOf(skill.type && skill.type.id)
    };

    // 2880 极速型：先手禁疗 + 下回合速度 +1
    if (ctx.isFirst && actor.firstHealBlock) {
      target.healBlock = Math.max(target.healBlock || 0, 1);
      this.push(actor.pet.name + ' 先手压制：' + target.pet.name + ' 本回合无法通过技能恢复体力。');
    }
    if (ctx.isFirst && actor.firstSpeedUp) {
      actor.pendingSpeedUp = true;
    }

    // 先处理「消除对手回合类效果」，后续依赖 clearSuccess 的效果才能生效
    fx.forEach(function (e) {
      if (e.kind !== 'clearFoe') return;
      var cleared = false;
      if (target.starRoundLock > 0) {
        self.push(target.pet.name + ' 的回合类效果被星皇之怒保护，无法被消除。');
        ctx.clearSuccess = false;
        return;
      }
      // 统一走 clearRoundEffects，避免「断回合」漏掉某些回合类效果（护盾/回血/PP消耗/免致命…）
      cleared = self.clearRoundEffects(target) > 0;
      ctx.clearSuccess = cleared;
      self.push(cleared ? '对手的回合类效果被消除了！' : '对手没有回合类效果。');
    });

    // 影响「本回合伤害 / 命中」的效果要先算，否则赶不上这次结算
    fx.forEach(function (e) {
      if (e.req && !checkCond(e.req, ctx)) return;
      if (e.cond === 'last' && ctx.isFirst) return;
      if (e.kind === 'minDamage') ctx.minDamage = Math.max(ctx.minDamage || 0, e.value);
      else if (e.kind === 'ignoreGuards') ctx.ignoreGuards = true;
      else if (e.kind === 'ignoreImmune') ctx.ignoreImmune = true;
      else if (e.kind === 'ignoreDefUp') ctx.ignoreDefUp = true;
      else if (e.kind === 'ignoreDefPct') ctx.ignoreDefPct = Math.max(ctx.ignoreDefPct || 0, e.pct);
      else if (e.kind === 'ignoreShield') ctx.ignoreShield = true;
      else if (e.kind === 'critIfFirst') { if (ctx.isFirst) ctx.forceCrit = true; }
      else if (e.kind === 'critThisHit') ctx.forceCrit = true;
      else if (e.kind === 'mustHit') actor.mustHitTurns = Math.max(actor.mustHitTurns, e.turns);
      else if (e.kind === 'dodge') actor.dodge = { turns: e.turns, chance: e.chance };
    });

    // 段数
    var hits = 1;
    fx.forEach(function (e) {
      if (e.kind === 'multiHit') {
        var mx = e.max;
        if (e.maxIfStatus && target.status) mx = Math.max(mx, e.maxIfStatus);
        hits = e.min + Math.floor(self.rng() * (mx - e.min + 1));
      }
      if (e.kind === 'multiHitChance' && self.rng() * 100 < e.chance) hits = Math.max(hits, e.times);
      if (e.kind === 'multiHitLowerHp') {
        var lh = e.min + Math.floor(self.rng() * (e.max - e.min + 1));
        if (actor.hp < target.hp) lh = Math.max(lh, e.lowMax);
        hits = Math.max(hits, lh);
      }
      if (e.kind === 'multiHitShield') {
        var mh = e.min + Math.floor(self.rng() * (e.max - e.min + 1));
        if ((actor.shield || 0) > 0) mh = Math.max(mh, e.shieldMax);
        hits = Math.max(hits, mh);
      }
    });

    // 威力修正
    var powerMul = 1;
    var powerAdd = 0;
    if (actor.pet.id === 4676 && skill.id === 37511 && target.lockStacks > 0) {
      var atkPp = target.skills.filter(function (sl) {
        return sl.skill.category && sl.skill.category.id !== 4 && sl.pp > 0;
      }).length;
      if (atkPp < target.lockStacks) powerMul *= 2;
    }
    fx.forEach(function (e) {
      if (e.kind === 'power') {
        if (e.req && !checkCond(e.req, ctx)) return;
        var pm = e.mul || 1;
        if (!e.cond) powerMul *= pm;
        else if (e.cond === 'first' && ctx.isFirst) powerMul *= pm;
        else if (e.cond === 'last' && !ctx.isFirst) powerMul *= pm;
        else if (e.cond === 'targetLow' && target.hp / target.maxHp < e.threshold) powerMul *= pm;
        else if (e.cond === 'selfLow' && actor.hp / actor.maxHp < e.threshold) powerMul *= pm;
        else if (e.cond === 'selfFull' && actor.hp >= actor.maxHp) powerMul *= pm;
        else if (e.cond === 'selfStatUp' && hasStatUp(actor)) powerMul *= pm;
        else if (e.cond === 'selfStatNotUp' && !hasStatUp(actor)) powerMul *= pm;
        else if (e.cond === 'targetStatNotUp' && !hasStatUp(target)) powerMul *= pm;
        else if (e.cond === 'selfHpLower' && actor.hp < target.hp) powerMul *= pm;
        else if (e.cond === 'targetStatDown' && hasStatDown(target)) powerMul *= pm;
        else if (e.cond === 'targetHpRatioBelow' && target.hp / target.maxHp < e.threshold) powerMul *= pm;
        else if (e.cond === 'targetStatus' && target.status && target.status.id === e.statusId) powerMul *= pm;
        if (e.doubleIfFirst && ctx.isFirst && e.cond === 'selfStatUp' && hasStatUp(actor)) powerMul *= pm;
        if (e.add) powerAdd += e.perUse ? e.add * actor.streak : e.add;
      }
      if (e.kind === 'powerChance') {
        if (e.req && !checkCond(e.req, ctx)) return;
        var pch = e.chance * (e.statUpDouble && hasStatUp(actor) ? 2 : 1) * (e.shieldDouble && actor.shield > 0 ? 2 : 1) * (e.noStatusDouble && !target.status ? 2 : 1) * (e.statOrDouble && (hasStatUp(actor) || hasStatDown(target)) ? 2 : 1);
        if (self.rng() * 100 < pch) {
          powerMul *= e.mul;
          self.push('威力提升发动！');
        } else if (e.fallbackPriority) {
          actor.priorityBuff = { turns: 1, value: e.fallbackPriority };
          self.push('未触发强化，先制 +' + e.fallbackPriority + '。');
        }
      }
      if (e.kind === 'rampPct' && num(skill.power) > 0) {
        powerMul *= 1 + Math.min(e.inc * actor.streak, e.cap);
      }
      if (e.kind === 'powerPerStatUp') {
        powerMul *= 1 + (countStatUp(actor) / e.per) * e.pct / 100;
      }
      if (e.kind === 'powerPerStack') {
        powerAdd += (actor.stacks || 0) * e.per;
        ctx.powerPerStack = e;
      }
      if (e.kind === 'powerLowHp') {
        powerMul *= 1 + (1 - actor.hp / actor.maxHp);
      }
      if (e.kind === 'powerPerBench') {
        powerAdd += e.value * Math.max(0, self.aliveCount(side) - 1);
      }
      if (e.kind === 'powerRandom' && num(skill.power) > 0) {
        if (e.req && !checkCond(e.req, ctx)) return;
        var pv = Math.round(e.min + self.rng() * (e.max - e.min + 1));
        powerAdd += (pv - num(skill.power));
      }
      if (e.kind === 'ramp' && num(skill.power) > 0) {
        powerAdd = Math.max(powerAdd, Math.min(e.cap - num(skill.power), e.inc * actor.streak));
      }
    });

    // 属性系技能威力加成
    if (actor.typePower && actor.typePower.turns > 0 && ctx.skillCombo) {
      if ((ctx.skillCombo.name || '').indexOf(actor.typePower.typeName) >= 0) {
        powerMul *= actor.typePower.mul;
      }
    }

    // 直接秒杀
    fx.forEach(function (e) {
      if (e.kind !== 'exec') return;
      if (e.req && !checkCond(e.req, ctx)) return;
      if (target.hp > 0) {
        target.hp = 0;
        self.push('对手被直接秒杀了！');
      }
    });

    // 马尔修斯极速形态：先手攻击伤害结算前，对手全属性 -1
    if (actor.morphMode === 'speed' && actor.morphSpeed && ctx.isFirst && num(skill.power) > 0) {
      ['atk', 'def', 'spAtk', 'spDef', 'spd', 'acc'].forEach(function (k) {
        target.stages[k] = clampStage(target.stages[k] - (actor.morphSpeed.statDown || 1));
      });
      this.push(actor.pet.name + ' 的极速形态压制了对手，全属性 -' + (actor.morphSpeed.statDown || 1) + '。');
    }

    // 「自身处于能力提升状态时造成的伤害翻倍」这类只在这一次攻击生效的条件增伤
    fx.forEach(function (e) {
      if (e.kind !== 'damageBuff' || !e.req) return;
      if (num(skill.power) <= 0) return;
      if (!checkCond(e.req, ctx)) return;
      ctx.attackBuffMul = (ctx.attackBuffMul || 1) * e.mul;
      self.push(self.tag(side) + '技能条件满足，本次伤害 ×' + e.mul + '。');
    });

    // 「每次使用则当回合造成的攻击伤害额外提升 N%」：计数要在本次伤害之前生效
    fx.forEach(function (e) {
      if (e.kind !== 'rampDamage') return;
      actor.rampInc = Math.max(actor.rampInc, e.inc);
      actor.rampCap = Math.max(actor.rampCap, e.cap);
      if (actor.rampSkillId === actor.currentSkillId) actor.rampUses = (actor.rampUses || 0) + 1;
      else { actor.rampSkillId = actor.currentSkillId; actor.rampUses = 1; }
      actor.rampActive = true;
      var rampPct = Math.min(Math.max(0, actor.rampUses - 1) * Math.round(e.inc * 100), Math.round(e.cap * 100));
      if (rampPct > 0) self.push('「' + actor.pet.name + '」本次攻击伤害额外提升 ' + rampPct + '%（当回合）。');
    });

    // 随机威力：必须在伤害计算前选定（B02 / PORT_NOTES D007；旧版在伤害之后才写 ctx.powerOverride，等于没生效）
    fx.forEach(function (e) {
      if (e.kind !== 'powerRandomRamp' || num(skill.power) <= 0) return;
      if (e.req && !checkCond(e.req, ctx)) return;
      if (ctx.powerOverride != null) return;
      var rv = e.min + Math.floor(self.rng() * (e.max - e.min + 1));
      rv = Math.min(e.cap, rv + e.inc * actor.streak);
      ctx.powerOverride = rv;
      self.push('威力随机：' + rv + '。');
    });

    // 伤害
    var dealt = 0;
    var sanzangBuff = this.benchAuras && this.benchAuras[side] && this.benchAuras[side].attackBuff;
    var thgCleared = false;
    var forceCrit = (actor.guaranteeCrit || 0) > 0;
    if (num(skill.power) > 0) {
      var skillCombo = ctx.skillCombo;
      var isPhysical = (skill.category ? skill.category.id : 1) !== 2;
      for (var h = 0; h < hits; h++) {
        if (target.hp <= 0) break;
        if (actor.atkUseDealtStack) {
          actor.damageBuff = { turns: 1, mul: 1 + Math.min(actor.atkUseDealtStack.cap, actor.atkDealtStack || 0) / 100 };
        }
        var r = calcDamage({
          actor: actor,
          target: target,
          skill: skill,
          skillCombo: skillCombo,
          actorCombo: actor.combo,
          targetCombo: target.combo,
          chart: this.chart,
          level: actor.level || this.level,
          rng: this.rng,
          powerOverride: ctx.powerOverride != null ? ctx.powerOverride : (powerAdd ? num(skill.power) + powerAdd : null),
          powerMul: powerMul * (this.field && this.field.damageMul ? this.field.damageMul : 1) * (ctx.powerRampMul || 1) * (ctx.powerStageMul || 1) * (ctx.attackBuffMul || 1),
          forceCrit: forceCrit || ctx.forceCrit,
          isFirst: !!ctx.isFirst,
          ignoreDefUp: ctx.ignoreDefUp,
          ignoreDefPct: ctx.ignoreDefPct || (actor.ignoreDefPctPassive || 0) || (actor.ignoreDefPctTurns && actor.ignoreDefPctTurns.pct) || 0,
          critAdd: ctx.critAdd,
          turn: this.turn,
          noWeak: ctx.noWeak,
          mustHit: !!(skill.must_hit),
          minDamage: ctx.minDamage
        });
        var szProc = false;
        if (sanzangBuff && h === 0) {
          szProc = this.rng() * 100 < sanzangBuff.chance;
          if (szProc) r.damage = Math.max(1, Math.floor(r.damage * sanzangBuff.mul));
        }
        var actual = this.applyDamage(foeSide, r.damage, {
          attack: true,
          physical: isPhysical,
          comboName: skillCombo ? skillCombo.name : '',
          crit: r.crit,
          ignoreGuards: ctx.ignoreGuards,
          ignoreShield: ctx.ignoreShield,
          ignoreImmune: ctx.ignoreImmune
        });
        if (r.critNullified > 0 && actor.hp > 0) {
          actor.hp = Math.max(0, actor.hp - r.critNullified);
          this.push(target.pet.name + ' 免疫了致命一击伤害，' + actor.pet.name + ' 被直接扣除 ' + r.critNullified + ' 点体力。');
        }
        dealt += actual;
        ctx.dealt = dealt;
        if (r.crit) { ctx.crit = true; this.lastCrit = side; }
        var extra = '';
        if (r.effectiveness === 0) extra += ' 似乎没有效果…';
        else if (r.effectiveness > 1) extra += ' 效果拔群！';
        else if (r.effectiveness < 1) extra += ' 效果不佳…';
        if (r.crit) extra += ' 会心一击！';
        this.push((hits > 1 ? '第 ' + (h + 1) + ' 击：' : '') + '造成 ' + actual + ' 点伤害。' + extra);

        // 三藏：在背包时，己方攻击 25% 增伤；未触发则随机吸取 1~100 体力
        if (sanzangBuff && h === 0) {
          if (szProc && actual > 0) {
            this.push('三藏的加持：本次攻击伤害提升 ' + Math.round((sanzangBuff.mul - 1) * 100) + '%。');
          } else if (!szProc && target.hp > 0) {
            var szSteal = sanzangBuff.min + Math.floor(this.rng() * (sanzangBuff.max - sanzangBuff.min + 1));
            szSteal = Math.min(szSteal, target.hp);
            target.hp -= szSteal;
            if (actor.healBlock <= 0) actor.hp = Math.min(actor.maxHp, actor.hp + szSteal);
            this.push('三藏的加持未触发，随机吸取了对手 ' + szSteal + ' 点体力。');
          }
        }

        // 天河神将：受到攻击消除对手能力提升
        if (!thgCleared && r.damage > 0 && target.onHitClearFoeStats && target.hp > 0) {
          var thgClr = false;
          Object.keys(actor.stages).forEach(function (kThg) {
            if (actor.stages[kThg] > 0) { actor.stages[kThg] = 0; thgClr = true; }
          });
          if (thgClr) this.push(target.pet.name + ' 受击消除了 ' + actor.pet.name + ' 的能力提升。');
          thgCleared = true;
        }

        // 受击反弹
        if (actual > 0 && target.thorns && target.thorns.turns > 0 && actor.hp > 0) {
          actor.hp = Math.max(0, actor.hp - target.thorns.value);
          this.push('受到反弹，损失 ' + target.thorns.value + ' 点体力。');
        }

        // 被「反馈」类效果打到（剑挥四方）
        if (this._reflectQueue > 0 && actor.hp > 0) {
          var rq = this._reflectQueue;
          this._reflectQueue = 0;
          rq = self.directDamage(actor, rq, 'percent');
          this.push(target.pet.name + ' 反馈了 ' + rq + ' 点百分比伤害给 ' + actor.pet.name + '。');
        }
      }
      if (hits > 1) this.push('共 ' + hits + ' 次攻击，合计 ' + dealt + ' 点伤害。');
    }

    // 固定伤害
    fx.forEach(function (e) {
      if (e.kind !== 'flat' || target.hp <= 0) return;
      if (e.req && !checkCond(e.req, ctx)) return;
      if (e.chance && self.rng() * 100 >= e.chance) return;
      var fv = self.resistDamage(target, e.value, 'fixed');
      if (fv <= 0) { self.push(target.pet.name + ' 的抗性免疫了固定伤害。'); return; }
      target.hp = Math.max(0, target.hp - fv);
      self.push('附加 ' + fv + ' 点固定伤害。');
    });

    // 追加固定伤害（按已造成伤害 / 对手已损失体力）
    fx.forEach(function (e) {
      if (target.hp <= 0) return;
      if (e.req && !checkCond(e.req, ctx)) return;
      if (e.kind === 'flatByAtk') {
        var fa = Math.max(1, Math.floor(actor.stats.atk * e.pct / 100));
        fa = self.directDamage(target, fa, 'percent');
        self.push('追加 ' + fa + ' 点百分比伤害。');
      } else if (e.kind === 'flatBySelfLost') {
        var fl = Math.max(1, Math.floor(Math.max(0, actor.maxHp - actor.hp) * e.pct / 100));
        fl = self.directDamage(target, fl, 'percent');
        self.push('追加 ' + fl + ' 点百分比伤害。');
      } else if (e.kind === 'flatByTargetMax') {
        var ft = Math.max(1, Math.floor(target.maxHp * e.pct / 100));
        ft = self.directDamage(target, ft, 'percent');
        self.push('追加 ' + ft + ' 点百分比伤害。');
      } else if (e.kind === 'flatByStatStages') {
        var sumSt = 0;
        Object.keys(actor.stages).forEach(function (k7) { if (actor.stages[k7] > 0) sumSt += actor.stages[k7]; });
        if (sumSt > 0) {
          var fst = sumSt * e.value;
          fst = self.directDamage(target, fst, 'fixed');
          self.push('追加 ' + fst + ' 点固定伤害。');
        }
      } else if (e.kind === 'flatByDealt' && dealt > 0) {
        var fv = Math.max(1, Math.floor(dealt * e.pct / 100));
        fv = self.directDamage(target, fv, 'fixed');
        self.push('追加 ' + fv + ' 点固定伤害。');
      } else if (e.kind === 'flatByTargetLost') {
        var lostHp = Math.max(0, target.maxHp - target.hp);
        var fv2 = Math.max(1, Math.floor(lostHp * e.pct / 100));
        fv2 = self.directDamage(target, fv2, 'percent');
        self.push('追加 ' + fv2 + ' 点百分比伤害。');
      }
    });

    if (actor.drainOnCritPct && ctx.crit && dealt > 0) {
      var doc = Math.min(Math.max(1, Math.floor(dealt * actor.drainOnCritPct / 100)), actor.maxHp - actor.hp);
      if (doc > 0) { actor.hp += doc; this.push(self.tag(side) + '暴击吸血 ' + doc + ' 点。'); }
    }
    if (actor.drainTurns && actor.drainTurns.turns > 0 && dealt > 0) {
      var dt = Math.min(Math.max(1, Math.floor(dealt * actor.drainTurns.num / actor.drainTurns.den)), actor.maxHp - actor.hp);
      if (dt > 0) { actor.hp += dt; this.push(self.tag(side) + '恢复了 ' + dt + ' 点体力。'); }
    }

    if (actor.onHitExtraFlat && dealt > 0 && target.hp > 0 && this.rng() * 100 < actor.onHitExtraFlat.chance) {
      target.hp = Math.max(0, target.hp - actor.onHitExtraFlat.value);
      this.push('追加 ' + actor.onHitExtraFlat.value + ' 点固定伤害。');
    }

    // 魂印：每次攻击追加目标当前体力的百分比固伤
    if (actor.onHitFlatPct && dealt > 0 && target.hp > 0) {
      var ohf = Math.max(1, Math.floor(target.hp * actor.onHitFlatPct / 100));
      ohf = self.directDamage(target, ohf, 'fixed');
      this.push('魂印追加 ' + ohf + ' 点固定伤害。');
    }

    // 吸血
    fx.forEach(function (e) {
      if (e.kind !== 'drain' || dealt <= 0) return;
      if (e.req && !checkCond(e.req, ctx)) return;
      if (actor.healBlock > 0) { self.push(self.tag(side) + '无法回复体力。'); return; }
      var heal = Math.max(1, Math.floor(dealt * e.num / e.den));
      heal = Math.min(heal, actor.maxHp - actor.hp);
      if (heal > 0) {
        actor.hp += heal;
        self.push(self.tag(side) + '恢复了 ' + heal + ' 点体力。');
      }
    });

    // 魂印：攻击时概率秒杀
    if (actor.execChance > 0 && target.hp > 0 && self.rng() * 100 < actor.execChance) {
      target.hp = 0;
      self.push('一击必杀！对手倒下了。');
    }

    // 魂印：造成伤害后按比例回血
    if (actor.drainOnHit > 0 && dealt > 0 && actor.hp > 0) {
      var dh = Math.min(Math.max(1, Math.floor(dealt * actor.drainOnHit)), actor.maxHp - actor.hp);
      if (dh > 0) {
        actor.hp += dh;
        self.push(self.tag(side) + '恢复了 ' + dh + ' 点体力。');
      }
    }

    // 消除对手护盾（1215）
    fx.forEach(function (e) {
      if (e.kind !== 'clearShield') return;
      if (e.req && !checkCond(e.req, ctx)) return;
      if ((target.shield || 0) > 0) {
        target.shield = 0;
        self.push('对手的护盾被消除了。');
        ctx.clearSuccess = true;
      } else {
        ctx.clearSuccess = false;
      }
    });

    // 反转对手能力提升，成功则回满体力与 PP（1216）
    fx.forEach(function (e) {
      if (e.kind !== 'invertFoeStages') return;
      var had = false;
      SIX_STATS.forEach(function (k) {
        if (target.stages[k] > 0) { target.stages[k] = clampStage(-target.stages[k]); had = true; }
      });
      self.push(had ? '对手的能力提升被反转了！' : '对手没有能力提升。');
      ctx.clearSuccess = had;
      if (had && actor.hp > 0) {
        actor.hp = actor.maxHp;
        actor.skills.forEach(function (s3) { s3.pp = s3.maxPp; });
        self.push(self.tag(side) + '体力与 PP 全部恢复。');
      }
    });

    // 消除能力等级：必须排在「直接回复」之前，否则「消除成功则恢复体力」拿不到 clearSuccess（B01 / PORT_NOTES D005）
    fx.forEach(function (e) {
      if (e.kind !== 'clear') return;
      if (e.req && !checkCond(e.req, ctx)) return;
      var who = e.target === 'self' ? actor : target;
      if (e.which === 'negative' && who.statDownLock > 0) {
        self.push(who.pet.name + ' 的能力下降被「蚩庸之锁」锁住，无法解除。');
        return;
      }
      var changed = false;
      Object.keys(who.stages).forEach(function (k) {
        if (e.which === 'negative' ? who.stages[k] < 0 : who.stages[k] > 0) { who.stages[k] = 0; changed = true; }
      });
      if (changed) ctx.clearSuccess = true;
      if (e.which === 'negative') self.push(changed ? '自身能力下降被解除。' : '自身没有能力下降。');
      else self.push(changed ? '对手能力提升被消除。' : '对手没有能力提升。');
    });

    // 直接回复
    fx.forEach(function (e) {
      if (e.kind !== 'heal' && e.kind !== 'healFlat') return;
      if (e.req && !checkCond(e.req, ctx)) return;
      var amount = e.kind === 'healFlat' ? e.value : Math.floor(actor.maxHp * e.num / e.den);
      if (actor.healBlock > 0) {
        self.push(self.tag(side) + '无法回复体力。');
        if (actor.healBlockPunish && amount > 0) {
          var pb = Math.max(1, Math.floor(amount * actor.healBlockPunish.num / actor.healBlockPunish.den));
          pb = self.directDamage(actor, pb, 'percent');
          if (pb > 0) self.push(self.tag(side) + '因恢复被阻断受到 ' + pb + ' 点百分比伤害。');
        }
        return;
      }
      amount = Math.max(1, Math.floor(amount * (actor.healMul || 1)));
      amount = self.auraHeal(side, actor, amount);
      var heal = Math.min(amount, actor.maxHp - actor.hp);
      if (heal > 0) {
        actor.hp += heal;
        self.push(self.tag(side) + '恢复了 ' + heal + ' 点体力。');
      } else {
        self.push(self.tag(side) + '体力已满。');
      }
    });

    // 能力等级变化
    fx.forEach(function (e) {
      if (e.kind !== 'stat') return;
      if (e.req && !checkCond(e.req, ctx)) return;
      if (self.rng() * 100 >= e.chance) { self.push('能力变化没有生效…'); return; }
      if (e.stages < 0 && e.target === 'foe' && target.immuneStat > 0) {
        self.push('对手免疫了能力下降。');
        return;
      }
      if (e.stages < 0 && e.target === 'foe' && target.starGuard > 0) {
        self.push('对手的星皇之佑免疫了能力下降。');
        return;
      }
      if (e.stages < 0 && e.target === 'foe' && target.mistikeNoDebuff > 0) {
        self.push('对手的「秘」免疫了能力下降。');
        return;
      }
      if (e.stages < 0 && e.target === 'foe' && target.permImmuneStatWhenFull && target.hp >= target.maxHp) {
        self.push('对手满体力，免疫了能力下降。');
        return;
      }
      if (e.stages < 0 && e.target === 'foe' && target.permImmuneStat) {
        self.push('对手的魂印免疫了能力下降。');
        return;
      }
      var who = e.target === 'self' ? actor : target;
      if (e.stages > 0 && who.buffDisabled > 0) {
        self.push(self.tag(who === actor ? side : '对手') + '的能力强化被封锁。');
        return;
      }
      if (e.stages > 0 && who.noStatUp > 0) {
        self.push((e.target === 'self' ? self.tag(side) : '对手') + '无法提升能力。');
        return;
      }
      var stGain = e.stages;
      if (e.fullHpDouble && who.hp >= who.maxHp) stGain = e.stages * 2;
      if (e.lowHpDouble) {
        var lowerCmp = (e.target === 'foe') ? (actor.hp < target.hp) : (who.hp < target.hp);
        if (lowerCmp) stGain = e.stages * 2;
      }
      if (e.doubleIfTargetDown && e.target === 'self') {
        var foeDown = false;
        SIX_STATS.forEach(function (kd) { if (target.stages[kd] < 0) foeDown = true; });
        if (foeDown) stGain = e.stages * 2;
      }
      who.stages[e.stat] = clampStage(who.stages[e.stat] + stGain);
      var sign = stGain > 0 ? '+' + stGain : String(stGain);
      self.push((e.target === 'self' ? self.tag(side) : '对手') + ' ' + STAT_LABEL[e.stat] + ' ' + sign);
    });

    // 异常状态
    fx.forEach(function (e) {
      if (e.kind !== 'status' || target.hp <= 0) return;
      if (e.req && !checkCond(e.req, ctx)) return;
      var chNow = e.chance;
      if (e.chancePerUp) {
        var upN9 = 0;
        ['atk', 'def', 'spAtk', 'spDef', 'spd', 'acc', 'eva'].forEach(function (kU) { if (actor.stages[kU] > 0) upN9++; });
        chNow += e.chancePerUp * upN9;
      }
      if (self.rng() * 100 >= chNow) { ctx.statusApplied = false; return; }
      if (target.reflectStatus > 0) {
        self.applyStatus(actor, e.statusId, e.turns, self.tag(side));
        self.push('异常状态被反弹了！');
        ctx.statusApplied = false;
        return;
      }
      self.applyStatus(target, e.statusId, e.turns, side === 'me' ? '对手' : '我方');
      ctx.statusApplied = !!(target.status && target.status.id === e.statusId);
    });

    // 异常未触发时的回血（1471 等）
    fx.forEach(function (e) {
      if (e.kind !== 'healStatusFail') return;
      if (ctx.statusApplied) return;
      if (actor.healBlock > 0) { self.push(self.tag(side) + '无法回复体力。'); return; }
      var hsf = Math.min(Math.floor(actor.maxHp * e.num / (e.den || 1)), actor.maxHp - actor.hp);
      if (hsf > 0) {
        actor.hp += hsf;
        self.push(self.tag(side) + '异常未触发，恢复 ' + hsf + ' 点体力。');
      }
    });

    // 持续伤害
    fx.forEach(function (e) {
      if (e.kind !== 'dot' || target.hp <= 0) return;
      if (e.chance && self.rng() * 100 >= e.chance) return;
      if (e.req && !checkCond(e.req, ctx)) return;
      target.dot = { value: e.value, turns: e.turns };
      self.push('对手每回合将额外受到 ' + e.value + ' 点伤害。');
    });

    // 护盾 / 减伤 / 免疫 / 反弹 / PP 削减
    fx.forEach(function (e) {
      if (e.req && !checkCond(e.req, ctx)) return;
      if (e.kind === 'shield') {
        actor.shield += e.value;
        self.push(self.tag(side) + '获得 ' + e.value + ' 点护盾。');
      } else if (e.kind === 'ward') {
        actor.ward += e.value;
        self.push(self.tag(side) + '获得 ' + e.value + ' 点护罩。');
      } else if (e.kind === 'guard') {
        actor.guards.push({ turns: e.turns, mul: e.mul, scope: e.scope, typeName: e.typeName });
        self.push(self.tag(side) + e.turns + ' 回合内受到的伤害降低。');
      } else if (e.kind === 'immuneStatus') {
        actor.immuneStatus = Math.max(actor.immuneStatus, e.turns);
        self.push(self.tag(side) + e.turns + ' 回合内免疫异常状态。');
      } else if (e.kind === 'immuneStat') {
        actor.immuneStat = Math.max(actor.immuneStat, e.turns);
        self.push(self.tag(side) + e.turns + ' 回合内免疫能力下降。');
      } else if (e.kind === 'oneHit') {
        actor.oneHit += (e.times || 1);
        self.push(self.tag(side) + '准备好挡下下一次攻击。');
      } else if (e.kind === 'immuneBelow') {
        actor.immuneBelow = { turns: e.turns, value: e.value };
        self.push(self.tag(side) + e.turns + ' 回合内免疫低于 ' + e.value + ' 的伤害。');
      } else if (e.kind === 'thorns') {
        actor.thorns = { turns: e.turns, value: e.value };
        self.push(self.tag(side) + e.turns + ' 回合内受击反弹 ' + e.value + ' 点。');
      } else if (e.kind === 'ppDrain') {
        if (self.rng() * 100 >= e.chance) return;
        target.skills.forEach(function (sl) { sl.pp = Math.max(0, sl.pp - e.amount); });
        self.push('对手全技能 PP 减少 ' + e.amount + ' 点。');
        if (e.lockIfZero && target.skills.some(function (sl) { return sl.pp === 0; })) {
          self.applyStatus(target, 'tired', 1, '对手');
          self.push('所选技能 PP 已耗尽，对手本回合无法行动。');
        }
        if (e.selfRestore) {
          actor.skills.forEach(function (sl) { sl.pp = Math.min(sl.maxPp, sl.pp + e.selfRestore); });
          self.push(self.tag(side) + '的技能 PP 恢复了。');
        }
      }
    });

    // 4950 魂印：钺副位累计造成伤害
    if (actor.twinCorps && actor.subPos === '钺' && actor.yueSub && dealt > 0) {
      actor.dmgCounter = (actor.dmgCounter || 0) + dealt;
    }
    // 4515 魂印：击败对手 → 北冥狂刃
    if (actor.beimingBlade && target.hp <= 0 && skill.category && (skill.category.id === 1 || skill.category.id === 2)) {
      actor.blade = '北冥狂刃';
      actor.bladeTurns = actor.beimingBlade.turns;
      self.push(self.tag(side) + '魂印：击败对手，北冥之刃升级为北冥狂刃 ' + actor.bladeTurns + ' 回合。');
    }
    // 3311 圣光灵神魂印：攻击技能附加对手上次伤害一半的固定伤害
    if (actor.prevDamageHalf && target.hp > 0 && skill.category && (skill.category.id === 1 || skill.category.id === 2)) {
      var pvHalf = Math.floor((target.lastDealt || 0) / 2);
      if (pvHalf > 0) {
        pvHalf = self.directDamage(target, pvHalf, 'fixed');
        self.push(self.tag(side) + '魂印：附加对手上次伤害一半的固定伤害 ' + pvHalf + ' 点。');
      }
    }
    // 3205 王·缪斯魂印：攻击技能概率睡眠 / 未触发补强化+断回合 / 命中睡眠追加固定伤害
    var isAtkSkill = skill.category && (skill.category.id === 1 || skill.category.id === 2);
    if (isAtkSkill && target.hp > 0 && actor.atkHitPercentMaxHp) {
      var aph = Math.max(1, Math.floor(actor.maxHp * actor.atkHitPercentMaxHp / 100));
      aph = self.directDamage(target, aph, 'percent');
      self.push(self.tag(side) + '魂印：附加 ' + aph + ' 点百分比伤害。');
    }
    if (isAtkSkill && target.hp > 0) {
      var priorSt = target.status && target.status.id;
      if (actor.hitStatusFixed && priorSt === actor.hitStatusFixed.statusId) {
        var hs = Math.max(1, Math.floor(actor.maxHp * actor.hitStatusFixed.num / actor.hitStatusFixed.den));
        hs = self.directDamage(target, hs, 'fixed');
        self.push(self.tag(side) + '魂印：命中' + (STATUS_DEF[actor.hitStatusFixed.statusId] ? STATUS_DEF[actor.hitStatusFixed.statusId].name : '') + '目标，附加 ' + hs + ' 点固定伤害。');
      }
      if (actor.zhuoxinActive && actor.zhuoxinBuff) {
        var ANKEYS = ['atk', 'def', 'spAtk', 'spDef', 'spd'];
        for (var ai = 0; ai < actor.zhuoxinBuff.ups; ai++) {
          var kPick = ANKEYS[Math.floor(self.rng() * ANKEYS.length)];
          actor.stages[kPick] = clampStage(actor.stages[kPick] + 1);
        }
        actor.zhuoxinActive = false;
        self.push(self.tag(side) + '魂印：灼心之焰命中后随机强化 ' + actor.zhuoxinBuff.ups + ' 项能力。');
      }
      if (actor.rageCrit && actor.ragePending) {
        if (dealt > 0) {
          var exGl = Math.max(1, Math.floor(dealt * actor.rageCrit.extra / 100));
          exGl = self.directDamage(target, exGl, 'percent');
          self.push(self.tag(side) + '魂印：狂怒雷电附加 ' + exGl + ' 点百分比伤害。');
        }
        actor.ragePending = false;
      }
      if (actor.hpHalfRage && actor.hpHalfLowB && dealt > 0) {
        var lostGl = actor.maxHp - actor.hp;
        var exGl2 = Math.floor(lostGl * actor.hpHalfRage.low / 100) * ((turnCtx && turnCtx.isFirst) ? 2 : 1);
        if (exGl2 > 0) {
          exGl2 = self.directDamage(target, exGl2, 'percent');
          self.push(self.tag(side) + '魂印：体力不足一半，附加已损失体力对应的 ' + exGl2 + ' 点百分比伤害。');
        }
      }
      if (actor.noDamageDrain && dealt === 0) {
        var drainJm = Math.max(1, Math.floor(target.maxHp / actor.noDamageDrain.den));
        drainJm = self.directDamage(target, drainJm, 'percent');
        actor.hp = Math.min(actor.maxHp, actor.hp + drainJm);
        actor.pendingNextPrio = actor.noDamageDrain.prio;
        self.push(self.tag(side) + '魂印：攻击未造成伤害，吸取 ' + drainJm + ' 点体力，下回合先制 +' + actor.noDamageDrain.prio + '。');
      }
      if (actor.atkUseDealtStack) {
        actor.atkDealtStack = Math.min(actor.atkUseDealtStack.cap, (actor.atkDealtStack || 0) + actor.atkUseDealtStack.per);
        self.push(self.tag(side) + '魂印：本次在场攻击伤害提升 ' + actor.atkDealtStack + '%。');
      }
      if (actor.blessGainOnHit) {
        var gBl = 1 + (dealt > actor.blessGainOnHit.high ? 1 : 0);
        actor.bless = (actor.bless || 0) + gBl;
        self.push(self.tag(side) + '魂印：获得 ' + gBl + ' 层自然祝福（当前 ' + actor.bless + ' 层）。');
      }
      if (actor.blessKillCost && target.hp <= 0) actor.blessKillFlag = true;
      if (actor.atkThreshStatus) {
        var th = actor.atkThreshStatus;
        if (dealt > th.high) {
          var ALL2 = ['sleep', 'fear', 'tired', 'paralyze', 'confuse', 'petrify', 'freeze', 'burn', 'poison', 'bleed'];
          var pick2 = ALL2[Math.floor(self.rng() * ALL2.length)];
          self.applyStatus(target, pick2, 1, side === 'me' ? '对手' : '我方');
          self.push(self.tag(side) + '魂印：伤害高于 ' + th.high + '，对手随机陷入' + (STATUS_DEF[pick2] ? STATUS_DEF[pick2].name : '异常') + '。');
        } else if (dealt > 0) {
          actor.priorityBuff = { turns: 1, value: th.prio };
          actor.critBuffTurns = 1;
          self.push(self.tag(side) + '魂印：伤害低于 ' + th.low + '，下回合先制 +' + th.prio + ' 且必定致命。');
        }
      }
      if (actor.ignoreDefStack) {
        actor.ignoreDefCur = Math.min(actor.ignoreDefStack.cap, actor.ignoreDefCur + actor.ignoreDefStack.per);
        self.push(self.tag(side) + '魂印：无视双防提升到 ' + actor.ignoreDefCur + '%。');
      }
      if (actor.arrowsOnAtk) {
        actor.arrows += actor.arrowsOnAtk;
        self.push(self.tag(side) + '魂印：获得 ' + actor.arrowsOnAtk + ' 支灭神之箭（现有 ' + actor.arrows + '）。');
      }
      if (actor.blindStack && target.hp > 0) {
        var bsChance = actor.blindStackChance || actor.blindStack.base;
        if (self.rng() * 100 < bsChance) {
          self.applyStatus(target, 'blind', 1, side === 'me' ? '对手' : '我方');
          self.push(self.tag(side) + '魂印：令对手失明（本次概率 ' + bsChance + '%）。');
        } else {
          self.clearRoundEffects(target);
          actor.damageBuff = { turns: 1, mul: 1 + actor.blindStack.missBuffPct / 100 };
          self.push(self.tag(side) + '魂印：未触发失明，消除对手回合类效果，下回合造成伤害提升 ' + actor.blindStack.missBuffPct + '%。');
        }
        actor.blindStackChance = Math.min(actor.blindStack.cap, bsChance + actor.blindStack.per);
      }
      if (actor.foeStatusSealOnAtk) {
        target.statusSkillNull = Math.max(target.statusSkillNull || 0, actor.foeStatusSealOnAtk);
        self.push(self.tag(side) + '魂印：对手下 ' + actor.foeStatusSealOnAtk + ' 次属性技能无效。');
      }
      if (actor.atkStatusElse) {
        var ase = actor.atkStatusElse;
        if (target.status && target.status.id === ase.statusId) {
          self.push(self.tag(side) + '对手已处于' + (STATUS_DEF[ase.statusId] ? STATUS_DEF[ase.statusId].name : '') + '，强化判定不触发。');
        } else if (self.rng() * 100 < ase.chance) {
          self.applyStatus(target, ase.statusId, 1, side === 'me' ? '对手' : '我方');
        } else {
          ase.stats.forEach(function (su) {
            actor.stages[su.stat] = clampStage(actor.stages[su.stat] + su.stages);
          });
          self.push(self.tag(side) + '魂印：睡眠未触发，' + ase.stats.map(function (su) { return su.stat + '+' + su.stages; }).join('、') + '。');
          if (ase.clearChance && self.rng() * 100 < ase.clearChance) self.clearRoundEffects(target);
        }
      }

    }
    // 3308 玄武魂印：先出手清对手 PP / 后出手按双防附加固定伤害并回血
    if (isAtkSkill && target.hp > 0) {
      if (actor.prioPpZero && ctx.isFirst) {
        var pool = target.skills.filter(function (sl) { return sl.pp > 0; });
        for (var pz = 0; pz < actor.prioPpZero && pool.length; pz++) {
          var pick = pool.splice(Math.floor(self.rng() * pool.length), 1)[0];
          pick.pp = 0;
          self.push(self.tag(side) + '魂印：先出手令对手「' + pick.name + '」PP 归零。');
        }
      }
      if (actor.defFixedHeal && !ctx.isFirst) {
        var dfl = Math.max(1, Math.floor((actor.stats.def + actor.stats.spDef) * actor.defFixedHeal / 100));
        dfl = self.directDamage(target, dfl, 'fixed');
        if (actor.healBlock <= 0) {
          var hfl = Math.min(dfl, actor.maxHp - actor.hp);
          if (hfl > 0) { actor.hp += hfl; self.push(self.tag(side) + '魂印：附加 ' + dfl + ' 点固定伤害并恢复 ' + hfl + ' 点体力。'); }
        }
      }
    }

    // 持续型增益 / 其他杂项
    fx.forEach(function (e) {
      if (e.req && !checkCond(e.req, ctx)) return;
      if (e.cond === 'last' && ctx.isFirst) return;

      if (e.kind === 'onHitDamageUp') {
        actor.onHitDamageUp = Math.max(actor.onHitDamageUp || 0, e.turns);
        self.push(self.tag(side) + '受击后对手下回合受到的伤害翻倍。');
      } else if (e.kind === 'perTurnStatDown') {
        actor.perTurnStatDown = { turns: e.turns, stat: e.stat, stages: e.stages };
        self.push('对手 ' + e.turns + ' 回合内每回合 ' + e.stat + ' -' + e.stages + '。');
      } else if (e.kind === 'delayedKill') {
        actor.delayedKill = { due: (self.turn || 0) + e.turns };
        self.push(self.tag(side) + e.turns + ' 回合后若对手没能击败自己，对手会倒下。');
      } else if (e.kind === 'restoreStages') {
        if (actor.turnStartStages) {
          actor.stages = JSON.parse(JSON.stringify(actor.turnStartStages));
          self.push(self.tag(side) + '的能力等级回到了回合初。');
        }
      } else if (e.kind === 'critRamp') {
        actor.critBonus += e.base + e.inc * (actor.critUses || 0);
        actor.critUses = (actor.critUses || 0) + 1;
        if (actor.critBonus > e.cap) actor.critBonus = e.cap;
        self.push(self.tag(side) + '暴击率提升到 ' + Math.round(actor.critBonus) + '%。');
      } else if (e.kind === 'healByShield') {
        var hbs = Math.floor((actor.shield || 0) + (target.shield || 0));
        hbs = Math.min(hbs, actor.maxHp - actor.hp);
        if (hbs > 0) { actor.hp += hbs; self.push(self.tag(side) + '恢复了 ' + hbs + ' 点体力。'); }
      } else if (e.kind === 'deathCurse') {
        actor.deathCurse = { turns: e.turns, value: e.value };
        self.push(self.tag(side) + '被击败时会让对手损失 ' + e.value + ' 点体力。');
      } else if (e.kind === 'priorityIfLow') {
        actor.priorityIfLow = { threshold: e.threshold, value: e.value };
        self.push(self.tag(side) + '残血时先制 +' + e.value + '。');
      } else if (e.kind === 'priorityDownNoDamage') {
        if (!actor.tookDamageLastTurn) {
          target.priorityDown = { turns: e.turns, value: e.value };
          self.push('对手 ' + e.turns + ' 回合内先制 -' + e.value + '。');
        }
      } else if (e.kind === 'copyDef') {
        actor.stats.def = target.stats.def;
        actor.copyDefTurns = e.turns;
        self.push(self.tag(side) + '的防御力暂时与对手相同。');
      } else if (e.kind === 'percentHp') {
        var php = self.resistDamage(target, Math.max(1, Math.floor(target.maxHp * e.num / e.den)), 'percent');
        if (php <= 0) { self.push('对手的抗性免疫了百分比伤害。'); return; }
        target.hp = Math.max(0, target.hp - php);
        self.push('对手损失 ' + php + ' 点体力。');
      } else if (e.kind === 'oneHitIfFirst') {
        if (ctx.isFirst) {
          actor.oneHit += 1;
          var oh = Math.min(Math.floor(actor.maxHp / 2), actor.maxHp - actor.hp);
          if (oh > 0) actor.hp += oh;
          self.push(self.tag(side) + '免疫本回合伤害并恢复了 ' + oh + ' 点体力。');
        }
      } else if (e.kind === 'guardFlat') {
        actor.guardFlat = { turns: e.turns, value: e.value };
        self.push(self.tag(side) + e.turns + ' 回合内每回合减少 ' + e.value + ' 点伤害。');
      } else if (e.kind === 'randomSelfOrTarget') {
        if (self.rng() * 100 < e.selfPct) {
          var rs = Math.max(1, Math.floor(actor.maxHp * e.selfNum / e.selfDen));
          actor.hp = Math.max(1, actor.hp - rs);
          self.push(self.tag(side) + '受到 ' + rs + ' 点反噬伤害。');
        } else {
          var rt2 = Math.max(1, Math.floor(actor.maxHp * e.foeNum / e.foeDen));
          if (target.hp > 0) {
            rt2 = self.directDamage(target, rt2, 'percent');
            self.push('对手受到 ' + rt2 + ' 点百分比伤害。');
          }
        }
      } else if (e.kind === 'healRandomCond') {
        var lo2 = hasStatUp(actor) ? e.min : e.altMin;
        var hi2 = hasStatUp(actor) ? e.max : e.altMax;
        var hr2 = Math.floor(lo2 + self.rng() * (hi2 - lo2 + 1));
        hr2 = Math.min(hr2, actor.maxHp - actor.hp);
        if (hr2 > 0) { actor.hp += hr2; self.push(self.tag(side) + '恢复了 ' + hr2 + ' 点体力。'); }
      } else if (e.kind === 'flatByDefStages') {
        var dst = (Math.max(0, actor.stages.def) + Math.max(0, actor.stages.spDef)) * e.value;
        if (dst > 0 && target.hp > 0) {
          dst = self.directDamage(target, dst, 'fixed');
          self.push('追加 ' + dst + ' 点固定伤害。');
        }
      } else if (e.kind === 'perTurnStatDown2') {
        actor.perTurnStatDown2 = { turns: e.turns, stats: e.stats, stages: e.stages };
        self.push('对手 ' + e.turns + ' 回合内每回合两项能力下降。');
      } else if (e.kind === 'onHitMultiStatDown') {
        actor.onHitMultiStatDown = { turns: e.turns, stats: e.stats };
        self.push(self.tag(side) + '受击时削弱对手能力。');
      } else if (e.kind === 'swapHp') {
        var tmpHp = actor.hp;
        actor.hp = Math.min(target.hp, actor.maxHp);
        target.hp = Math.min(tmpHp, target.maxHp);
        self.push('双方交换了当前体力！');
      } else if (e.kind === 'onHitCritBuff') {
        actor.onHitCritBuff = { turns: e.turns, critTurns: e.critTurns };
        self.push(self.tag(side) + '受击后将获得暴击提升。');
      } else if (e.kind === 'nextPetMaxHpDown') {
        self.nextPetHpDown = self.nextPetHpDown || { pct: 0, cap: e.cap };
        self.nextPetHpDown.pct = Math.min(e.cap, self.nextPetHpDown.pct + e.pct);
        self.push('对手下只精灵的体力上限将降低 ' + self.nextPetHpDown.pct + '%。');
      } else if (e.kind === 'perTurnSteal') {
        actor.perTurnSteal = Math.max(actor.perTurnSteal || 0, e.turns);
        self.push(self.tag(side) + e.turns + ' 回合内每回合吸取对手强化。');
      } else if (e.kind === 'perTurnStealStats') {
        actor.perTurnStealStats = { turns: e.turns, count: e.count, stages: e.stages };
      } else if (e.kind === 'switchOutShield') {
        actor.switchOutShield = e.value;
        self.push('主动换下时，下一只出场精灵获得 ' + e.value + ' 点护罩。');
      } else if (e.kind === 'immuneCritReflect') {
        actor.immuneCritReflect = Math.max(actor.immuneCritReflect || 0, e.turns);
        self.push(self.tag(side) + e.turns + ' 回合内免疫暴击并反伤。');
      } else if (e.kind === 'returnStats') {
        var ret = 0;
        Object.keys(actor.stages).forEach(function (k13) {
          if (actor.stages[k13] < 0) {
            target.stages[k13] = clampStage(target.stages[k13] + actor.stages[k13] * e.mult);
            ret++;
          }
        });
        self.push(ret ? '自身的能力下降返还给了对手。' : '自身没有能力下降。');
      } else if (e.kind === 'flatByStats3') {
        var sum3 = Math.max(1, Math.floor((actor.stats.def + actor.stats.spDef + actor.stats.spd) * e.pct / 100));
        if (target.hp > 0) {
          sum3 = self.directDamage(target, sum3, 'percent');
          self.push('追加 ' + sum3 + ' 点百分比伤害。');
        }      } else if (e.kind === 'doubleStagesOnKill') {
        actor.doubleStagesOnKill = true;
        self.push('击败对手后自身能力提升翻倍。');
      } else if (e.kind === 'invertThenImmune') {
        var inv = false;
        Object.keys(actor.stages).forEach(function (k15) {
          if (actor.stages[k15] < 0) { actor.stages[k15] = Math.min(6, -actor.stages[k15]); inv = true; }
        });
        if (inv) {
          actor.oneHit += 1;
          self.push('反转成功，获得一次攻击免疫。');
        }
      } else if (e.kind === 'critThenSkillBlock') {
        if (ctx.crit) {
          target.skillBlock = Math.max(target.skillBlock || 0, e.turns);
          self.push('暴击压制：对手属性技能被封锁。');
        }
      } else if (e.kind === 'perTurnPpZero') {
        actor.perTurnPpZero = { turns: e.turns, count: e.count };
        self.push('对手每回合结束会有 ' + e.count + ' 个技能 PP 归零。');
      } else if (e.kind === 'blockCrit') {
        actor.blockCrit = Math.max(actor.blockCrit || 0, e.turns);
        self.push(self.tag(side) + e.turns + ' 回合内对手的暴击非必中技能无效。');
      } else if (e.kind === 'clearBothThenFlat') {
        var sumCleared = 0;
        [actor, target].forEach(function (cc3) {
          Object.keys(cc3.stages).forEach(function (k17) {
            sumCleared += Math.abs(cc3.stages[k17]);
            cc3.stages[k17] = 0;
          });
        });
        ctx.clearSuccess = sumCleared > 0;
        if (sumCleared > 0 && target.hp > 0) {
          var cf2 = sumCleared * e.value;
          cf2 = self.directDamage(target, cf2, 'fixed');
          self.push('清除 ' + sumCleared + ' 段能力，追加 ' + cf2 + ' 点固定伤害。');
        }
      } else if (e.kind === 'onKillNextPriorityDown') {
        actor.onKillNextPriorityDown = { turns: e.turns, value: e.value };
      } else if (e.kind === 'typeFixedDamage') {
        var upC9 = 0;
        ['atk', 'def', 'spAtk', 'spDef', 'spd', 'acc', 'eva'].forEach(function (kC) { if (actor.stages[kC] > 0) upC9++; });
        var tfdVal = Math.max(1, Math.floor(e.value * (1 + upC9 * (e.perUp || 0) / 100)));
        var tfdElements = [];
        if (self.typeByName && e.typeName != null && self.typeByName[e.typeName] != null) tfdElements.push(self.typeByName[e.typeName]);
        var tfdHit = self.attributeDamage(target, tfdVal, tfdElements);
        self.push(self.tag(side) + '造成 ' + tfdHit + ' 点' + (e.typeName || '') + '系伤害（' + upC9 + ' 项强化加成）。');
      } else if (e.kind === 'clearShield') {
        var hadShield = (target.shield || 0) + (target.ward || 0) + (target.guards ? target.guards.length : 0) + (target.oneHit || 0);
        target.shield = 0;
        target.ward = 0;
        target.guards = [];
        target.oneHit = 0;
        self.push(hadShield ? '对手的护盾类效果被消除了！' : '对手没有护盾。');
      } else if (e.kind === 'copyAtk') {
        actor.atkOriginal = actor.stats.atk;
        actor.stats.atk = target.stats.atk;
        actor.copyAtkTurns = e.turns;
        self.push(self.tag(side) + '的攻击力暂时与对手相同。');
      } else if (e.kind === 'drainTurns') {
        actor.drainTurns = { turns: e.turns, num: e.num, den: e.den };
        self.push(self.tag(side) + e.turns + ' 回合内造成伤害会吸血。');
      } else if (e.kind === 'randomSelfOrFoe') {
        var roll = self.rng() * 100;
        if (roll < e.foePct && target.hp > 0) {
          var fdmg = Math.max(1, Math.floor(actor.maxHp * e.foeNum / e.foeDen));
          target.hp = Math.max(0, target.hp - fdmg);
          self.push('对手损失 ' + fdmg + ' 点体力。');
        } else if (roll < e.foePct + e.selfPct) {
          var sdmg = Math.max(1, Math.floor(actor.maxHp * e.selfNum / e.selfDen));
          actor.hp = Math.max(1, actor.hp - sdmg);
          self.push(self.tag(side) + '损失 ' + sdmg + ' 点体力。');
        }
      } else if (e.kind === 'immuneAndReflect') {
        actor.immuneAndReflect = { turns: e.turns, num: e.num, den: e.den };
        self.push(self.tag(side) + e.turns + ' 回合内免疫攻击并反弹。');
      } else if (e.kind === 'disableFoeBuffs') {
        target.buffDisabled = Math.max(target.buffDisabled || 0, e.turns);
        var cleared2 = false;
        Object.keys(target.stages).forEach(function (k18) { if (target.stages[k18] > 0) { target.stages[k18] = 0; cleared2 = true; } });
        self.push(cleared2 ? '对手的能力强化被清空并封锁。' : '对手的能力强化被封锁。');
      } else if (e.kind === 'healOnFoeMiss') {
        actor.healOnFoeMiss = { turns: e.turns, num: e.num, den: e.den };
        self.push(self.tag(side) + e.turns + ' 回合内对手失手会给自己回血。');
      } else if (e.kind === 'perTurnFlatByStats') {
        actor.perTurnFlatByStats = { turns: e.turns, pct: e.pct };
      } else if (e.kind === 'perTurnPriorityDown') {
        actor.perTurnPriorityDown = { turns: e.turns, value: e.value };
      } else if (e.kind === 'skillBlockChance') {
        actor.skillBlockChance = { turns: e.turns, chance: e.chance };
      } else if (e.kind === 'reviveOnce') {
        actor.reviveOnce = true;
        self.push(self.tag(side) + '本回合倒下会满血复活并解除异常。');
      } else if (e.kind === 'giveStatsAsDebuff') {
        var given = 0;
        Object.keys(actor.stages).forEach(function (k19) {
          if (actor.stages[k19] > 0) {
            target.stages[k19] = clampStage(target.stages[k19] - actor.stages[k19]);
            given++;
          }
        });
        self.push(given ? '把自身强化转成了对手的削弱。' : '自身没有强化。');
      } else if (e.kind === 'onKillSkillBlock') {
        actor.onKillSkillBlock = e.times;
      } else if (e.kind === 'chanceImmuneReflect') {
        actor.chanceImmuneReflect = { turns: e.turns, chance: e.chance };
        self.push(self.tag(side) + e.turns + ' 回合内 ' + e.chance + '% 免疫并反伤。');
      } else if (e.kind === 'foeStatSet') {
        target.stats.atk = Math.min(target.stats.atk, e.value);
        target.stats.spAtk = Math.min(target.stats.spAtk, e.value);
        target.foeStatSetTurns = e.turns;
        self.push('对手的攻击与特攻被压制。');
      } else if (e.kind === 'onHitPercentHp') {
        actor.onHitPercentHp = { turns: e.turns, num: e.num, den: e.den };
      } else if (e.kind === 'firstSkillNullify') {
        if (ctx.isFirst) {
          target.skillNull = (target.skillNull || 0) + 1;
          self.push('先手压制：对手本回合属性技能失效。');
        }
      } else if (e.kind === 'convertTaken') {
        actor.convertTaken = Math.max(actor.convertTaken || 0, e.turns);
        self.push(self.tag(side) + '接下来受到的攻击会转化为体力。');
      } else if (e.kind === 'clearShieldFlat') {
        var shSum = (target.shield || 0) + (target.guards ? target.guards.length * 100 : 0);
        target.shield = 0;
        target.guards = [];
        if (shSum > 0 && target.hp > 0) {
          var shDmg = Math.max(1, Math.floor(shSum * e.pct / 100));
          target.hp = Math.max(0, target.hp - shDmg);
          self.push('消除护盾并追加 ' + shDmg + ' 点伤害。');
        } else {
          self.push('对手没有护盾。');
        }
      } else if (e.kind === 'blockSwitchBoth') {
        actor.blockSwitch = Math.max(actor.blockSwitch || 0, e.turns);
        target.blockSwitch = Math.max(target.blockSwitch || 0, e.turns);
        self.push('双方 ' + e.turns + ' 回合内无法换人。');
      } else if (e.kind === 'maxHpDownPct') {
        var cutHp = Math.max(1, Math.floor(target.maxHp * e.pct / 100));
        target.maxHp = Math.max(1, target.maxHp - cutHp);
        target.hp = Math.min(target.hp, target.maxHp);
        self.push('对手体力上限降低 ' + cutHp + ' 点。');
      } else if (e.kind === 'onHitHealChance') {
        actor.onHitHealChance = { turns: e.turns, chance: e.chance, num: e.num, den: e.den };
      } else if (e.kind === 'genderBranch') {
        var isFemale = actor.pet && actor.pet.gender === 1;
        if (isFemale) {
          actor.critBuffTurns = Math.max(actor.critBuffTurns || 0, e.turns);
          self.push(self.tag(side) + '雌性：' + e.turns + ' 回合内必定暴击。');
        } else {
          actor.priorityBuff = { turns: e.turns, value: 1 };
          self.push(self.tag(side) + '雄性：' + e.turns + ' 回合内必定先手。');
        }
      } else if (e.kind === 'copySkill') {
        var lastSk = target.lastSkillName;
        if (lastSk) self.push(self.tag(side) + '复制了对手的技能：' + lastSk + '。');
        else self.push('对手本回合尚未使用技能，复制失败。');
      } else if (e.kind === 'addStacks') {
        var mxS = (actor.stackPassive && actor.stackPassive.maxStacks) || 6;
        actor.stacks = Math.min(mxS, (actor.stacks || 0) + e.value);
        self.push(self.tag(side) + '神耀能量 ' + actor.stacks + ' 层。');
      } else if (e.kind === 'drainPct') {
        actor.drainTurns = { turns: e.turns, num: e.pct, den: 100 };
      } else if (e.kind === 'punishByCategory') {
        actor.punishByCategory = { turns: e.turns, pp: e.pp, hpPct: e.hpPct };
      } else if (e.kind === 'statusResist') {
        actor.statusResist = (actor.statusResist || 0) + e.value;
      } else if (e.kind === 'critRamp') {
        actor.critRamp = { base: e.base, inc: e.inc, cap: e.cap, uses: 0 };
      } else if (e.kind === 'critThenStarRage') {
        actor.starRageOnCrit = e.times;
      } else if (e.kind === 'critChance') {
        actor.critBonus += e.value;
        self.push(self.tag(side) + '暴击率提升 ' + e.value + '%。');
      } else if (e.kind === 'drainOnCrit') {
        actor.drainOnCritPct = e.pct;
      } else if (e.kind === 'onHitReflectPct') {
        actor.onHitReflectPct = { turns: e.turns, pct: e.pct };
      } else if (e.kind === 'sacrificeNextPet') {
        actor.hp = 0;
        self.nextPetBuff = { side: side, crit: true, priority: true };
        self.push(actor.pet.name + ' 牺牲了自己！');
      } else if (e.kind === 'punishStatSkill') {
        actor.punishStatSkill = { turns: e.turns, chance: e.chance, stat: e.stat, stages: e.stages };
      } else if (e.kind === 'statusPriority') {
        actor.statusPriority = { turns: e.turns, value: e.value };
      } else if (e.kind === 'immuneKindReflect') {
        actor.immuneKindReflect = { turns: e.turns, category: e.category };
      } else if (e.kind === 'perTurnFlat') {
        actor.perTurnFlat = { turns: e.turns, value: e.value, req: e.req };
      } else if (e.kind === 'counterMul') {
        actor.counterMul = e.mul;
      } else if (e.kind === 'statusSkillMiss') {
        actor.statusSkillMiss = Math.max(actor.statusSkillMiss || 0, e.turns);
      } else if (e.kind === 'onHitStatUp') {
        actor.onHitStatUp = { turns: e.turns, stat: e.stat, stages: e.stages, chance: e.chance };
      } else if (e.kind === 'genderImmune') {
        actor.genderImmune = { gender: e.gender, turns: e.turns };
      } else if (e.kind === 'selfCostPriority') {
        var cst2 = Math.max(1, Math.floor(actor.maxHp * e.pct));
        actor.hp = Math.max(1, actor.hp - cst2);
        actor.priorityBuff = { turns: 1, value: 1 };
        self.push(self.tag(side) + '损失 ' + cst2 + ' 点体力，下回合先手。');
      } else if (e.kind === 'sacrificeImmune') {
        actor.hp = 0;
        self.nextPetImmuneStatus = { side: side, turns: e.turns };
        self.push(actor.pet.name + ' 献祭了自己！');
      } else if (e.kind === 'treatFoeStatAsDown') {
        target.treatStatAsDown = true;
        self.push('对手的能力提升被当作下降处理。');
      } else if (e.kind === 'ppRestoreChance') {
        if (self.rng() * 100 < e.chance) {
          actor.skills.forEach(function (s7) { s7.pp = Math.min(s7.maxPp || s7.pp + e.amount, s7.pp + e.amount); });
          self.push('所有技能回复了 ' + e.amount + ' 点 PP。');
        }
      } else if (e.kind === 'perTurnDrain') {
        actor.perTurnDrain = { turns: e.turns, value: e.value };
      } else if (e.kind === 'onKillHealNext') {
        actor.onKillHealNext = { num: e.num, den: e.den, pct: e.pct };
      } else if (e.kind === 'ppZeroTimes') {
        target.ppZeroUses = Math.max(target.ppZeroUses || 0, e.turns);
        self.push('对手接下来 ' + e.turns + ' 次使用技能会耗尽 PP。');
      } else if (e.kind === 'endClearStatus') {
        actor.endClearStatus = true;
      } else if (e.kind === 'mirrorHeal') {
        actor.mirrorHeal = { turns: e.turns, num: e.num, den: e.den };
      } else if (e.kind === 'ppExtra') {
        if (ctx.isFirst === false) {
          var fs2 = target.skills.filter(function (s5) { return s5.pp > 0; });
          if (fs2.length) fs2[0].pp = Math.max(0, fs2[0].pp - e.amount);
          self.push('对手技能额外消耗 PP。');
        }
      } else if (e.kind === 'foeHealEnd') {
        actor.foeHealEnd = { num: e.num, den: e.den };
      } else if (e.kind === 'bothMaxHpDown') {
        [[actor, target], [target, actor]].forEach(function (pair) {
          var d = pair[0], o2 = pair[1];
          var cut2 = Math.max(1, Math.floor(d.maxHp * e.pct / 100));
          d.maxHp = Math.max(1, d.maxHp - cut2);
          d.hp = Math.min(d.hp, d.maxHp);
        });
        self.push('双方体力上限都下降了。');
      } else if (e.kind === 'onHitMaxHpDown') {
        actor.onHitMaxHpDown = { turns: e.turns, num: e.num, den: e.den };
      } else if (e.kind === 'powerPerFoeStage') {
        ctx.powerStageMul = 1 + Math.max(0, countStatUp(target)) * 0.5;
      } else if (e.kind === 'powerByStat') {
        ctx.powerStageMul = (ctx.powerStageMul || 1) * (1 + (actor.pet.iv_total || 31) / 62);
      } else if (e.kind === 'priorityIfFoeSpeed') {
        if (target.stats.spd > e.threshold) {
          actor.priorityBuff = { turns: 1, value: e.value };
          self.push('对手速度更快，先制 +' + e.value + '。');
        }
      } else if (e.kind === 'flatByCurHp') {
        if (target.immuneFixedPct || hasStack(target, 4)) { self.push('对手免疫了百分比伤害。'); return; }
        var baseC = e.inc ? Math.min(e.cap, e.pct + e.inc * actor.streak) : e.pct;
        var dmgC = Math.max(1, Math.floor(actor.hp * baseC / 100));
        if (target.hp > 0) {
          dmgC = self.directDamage(target, dmgC, 'percent');
          self.push('追加 ' + dmgC + ' 点百分比伤害。');
        }
      } else if (e.kind === 'endDamagePerSpeed') {
        actor.endDamagePerSpeed = { per: e.per, num: e.num, den: e.den };
        self.push('每回合结束按速度强化削减对手体力。');
      } else if (e.kind === 'punishStatusSkill') {
        actor.punishStatusSkill = { turns: e.turns, punishTurns: e.punishTurns };
        self.push('对手使用属性技能会被惩罚。');
      } else if (e.kind === 'invertToFoe') {
        var invF = false;
        Object.keys(target.stages).forEach(function (k20) {
          if (target.stages[k20] > 0) { target.stages[k20] = -target.stages[k20]; invF = true; }
        });
        ctx.clearSuccess = invF;
        self.push(invF ? '对手的能力提升被反转了！' : '对手没有能力提升。');
      } else if (e.kind === 'stealShield') {
        var steal = target.shield || 0;
        target.shield = 0;
        if (steal > 0) {
          actor.shield += steal;
          self.push('夺取了对手 ' + steal + ' 点护盾。');
        } else {
          self.push('对手没有护盾。');
        }
      } else if (e.kind === 'selfKoOnMiss') {
        actor.selfKoOnMiss = true;
      } else if (e.kind === 'statusRamp') {
        var st = actor.statusRamp || { uses: 0 };
        var ch = Math.min(e.cap, e.base + e.inc * st.uses);
        st.uses++;
        actor.statusRamp = st;
        if (self.rng() * 100 < ch) self.applyStatus(target, e.statusId, 1, side === 'me' ? '对手' : '我方');
      } else if (e.kind === 'onKillPriority') {
        actor.onKillPriority = e.value;
      } else if (e.kind === 'nextGuardByDealt') {
        actor.nextGuardByDealt = true;
      } else if (e.kind === 'powerChanceRamp') {
        var pc = actor.powerChanceRamp || { uses: 0 };
        var pch2 = Math.min(e.cap, e.base + e.inc * pc.uses);
        pc.uses++;
        actor.powerChanceRamp = pc;
        if (self.rng() * 100 < pch2) {
          ctx.powerRampMul = (ctx.powerRampMul || 1) * e.mul;
          self.push('伤害翻倍发动！');
        }
      } else if (e.kind === 'powerRandomRamp') {
        if (ctx.powerOverride != null) return; // 已在伤害前选定（B02）
        var rv = e.min + Math.floor(self.rng() * (e.max - e.min + 1));
        rv = Math.min(e.cap, rv + e.inc * actor.streak);
        ctx.powerOverride = rv;
      } else if (e.kind === 'itemFlip') {
        target.itemFlip = Math.max(target.itemFlip || 0, e.turns);
        self.push('对手 ' + e.turns + ' 回合内使用药剂会反噬。');
      } else if (e.kind === 'cosmetic') {
        self.push(self.tag(side) + '战斗结束可获得' + e.note + '（场外收益，不影响对战）。');
      } else if (e.kind === 'mirrorStat') {
        actor.mirrorStat = Math.max(actor.mirrorStat || 0, e.turns);
        self.push(self.tag(side) + e.turns + ' 回合内对手的能力变化会同步到自己身上。');
      } else if (e.kind === 'powerPerBench') {
        var bench = Math.max(0, self.aliveCount(side) - 1);
        self.push('场下存活 ' + bench + ' 只，威力提升 ' + (e.value * bench) + ' 点。');
      } else if (e.kind === 'ignoreDefPctTurns') {
        actor.ignoreDefPctTurns = { turns: e.turns, pct: e.pct };
        self.push(self.tag(side) + e.turns + ' 回合内忽略对手 ' + e.pct + '% 双防。');
      } else if (e.kind === 'regenRandom') {
        actor.regenRandom = { turns: e.turns, min: e.min, max: e.max };
      } else if (e.kind === 'takenTurns') {
        actor.guards.push({ turns: e.turns, mul: 1 - e.pct / 100, scope: 'all' });
        self.push(self.tag(side) + e.turns + ' 回合内受到的伤害减少 ' + e.pct + '%。');
      } else if (e.kind === 'flatDrainSelf') {
        var fd = Math.max(1, Math.floor(actor.maxHp * e.pct / 100));
        if (target.hp > 0) {
          target.hp = Math.max(0, target.hp - fd);
          var fdh = Math.min(fd, actor.maxHp - actor.hp);
          if (fdh > 0) actor.hp += fdh;
          self.push('造成 ' + fd + ' 点伤害并回复等量体力。');
        }
      } else if (e.kind === 'noPpCost') {
        actor.noPpCost = e.threshold;
        self.push(self.tag(side) + '残血时不消耗 PP。');
      } else if (e.kind === 'perTurnStatUp') {
        actor.perTurnStatUp = { turns: e.turns, stats: e.stats, stages: e.stages };
        self.push(self.tag(side) + e.turns + ' 回合内每回合能力提升。');
      } else if (e.kind === 'costHalfStats') {
        var halfCost = Math.floor(actor.hp / 2);
        actor.hp = Math.max(1, actor.hp - halfCost);
        e.stats.forEach(function (st) { actor.stages[st] = clampStage(actor.stages[st] + e.stages); });
        self.push(self.tag(side) + '损失 ' + halfCost + ' 点体力，能力提升。');
      } else if (e.kind === 'selfCostDamage' && e.costPct) {
        var cCost = Math.max(1, Math.floor(actor.maxHp * e.costPct));
        cCost = Math.min(cCost, Math.max(0, actor.hp - 1));
        actor.hp -= cCost;
        if (target.hp > 0) {
          target.hp = Math.max(0, target.hp - cCost);
          self.push('损失 ' + cCost + ' 点体力，对手受到同等伤害。');
        }
      } else if (e.kind === 'critIfLower') {
        if (actor.hp < target.hp) actor.critBonus += e.chance;
        self.push(self.tag(side) + '暴击率提升 ' + e.chance + '%。');
      } else if (e.kind === 'useHighestStat') {
        actor.useHighestStat = true;
        self.push(self.tag(side) + '用攻击与特攻中较高的一项结算。');
      } else if (e.kind === 'typePower') {
        actor.typePower = { turns: e.turns, typeName: e.typeName, mul: e.mul };
        self.push(self.tag(side) + e.turns + ' 回合内' + e.typeName + '系技能威力 ×' + e.mul + '。');
      } else if (e.kind === 'clearBothBoth') {
        var cbb = false;
        [actor, target].forEach(function (cc2) {
          Object.keys(cc2.stages).forEach(function (k12) {
            if (cc2.stages[k12] !== 0) { cc2.stages[k12] = 0; cbb = true; }
          });
        });
        ctx.clearSuccess = cbb;
        self.push(cbb ? '双方的能力变化都被清空了！' : '双方都没有能力变化。');
      } else if (e.kind === 'swapType') {
        var aC = actor.combo, tC = target.combo;
        actor.typeOriginal = aC; target.typeOriginal = tC;
        actor.combo = tC; target.combo = aC;
        actor.typeSwap = { turns: e.turns, mode: 'swap', partner: target };
        self.push('双方属性暂时互换。');
      } else if (e.kind === 'copyType') {
        actor.typeOriginal = actor.combo;
        actor.combo = target.combo;
        actor.typeSwap = { turns: e.turns, mode: 'copy', partner: null };
        self.push(self.tag(side) + '的属性暂时与对手相同。');
      } else if (e.kind === 'clearBoth') {
        var cb = false;
        [actor, target].forEach(function (cc) {
          Object.keys(cc.stages).forEach(function (k8) {
            if (cc.stages[k8] > 0) { cc.stages[k8] = 0; cb = true; }
          });
        });
        ctx.clearSuccess = cb;
        self.push(cb ? '双方的能力提升都被消除了！' : '双方都没有能力提升。');
      } else if (e.kind === 'onDeathClearFoe') {
        actor.onDeathClearFoe = e.turns;
      } else if (e.kind === 'endInvertFoe') {
        actor.endInvertFoe = Math.max(actor.endInvertFoe || 0, e.turns);
        self.push(self.tag(side) + '每回合结束会反转对手的能力提升。');
      } else if (e.kind === 'onHitRandomStatDown') {
        actor.onHitRandomStatDown = { count: e.count, stages: e.stages };
        self.push(self.tag(side) + '下回合受击会削弱对手 ' + e.count + ' 项能力。');
      } else if (e.kind === 'nextGuard') {
        actor.nextGuard = { times: e.times, pct: e.pct };
        self.push(self.tag(side) + '接下来 ' + e.times + ' 次受伤减少 ' + e.pct + '%。');
      } else if (e.kind === 'onKillAttackBlock') {
        actor.killAttackBlock = e.times;
        self.push('击败对手后，对手下 ' + e.times + ' 次攻击技能会失效。');
      } else if (e.kind === 'drainFlat') {
        var dv = e.value;
        if (e.selfBelow && actor.hp / actor.maxHp < e.selfBelow) dv *= 2;
        if (e.doubleIfLower && actor.hp < target.hp) dv *= 2;
        if (e.bonusIfFirst && ctx.isFirst) dv += e.bonusIfFirst;
        if (e.bonusIfPpZero) {
          var zc = target.skills.filter(function (s6) { return s6.pp === 0; }).length;
          if (zc >= e.bonusIfPpZero.count) dv += e.bonusIfPpZero.value;
        }
        if (target.hp > 0) {
          target.hp = Math.max(0, target.hp - dv);
          var dh2 = Math.min(dv, actor.maxHp - actor.hp);
          if (dh2 > 0) actor.hp += dh2;
          self.push('吸取了对手 ' + dv + ' 点体力。');
        }
      } else if (e.kind === 'priorityIfHpBelow') {
        actor.priorityIfHpBelow = e.value;
        self.push(self.tag(side) + '体力低于 ' + e.value + ' 时必定先手。');
      } else if (e.kind === 'maxHpDown') {
        target.maxHp = Math.max(1, target.maxHp - e.value);
        target.hp = Math.min(target.hp, target.maxHp);
        self.push('对手体力上限降低了 ' + e.value + ' 点。');
      } else if (e.kind === 'onMissHeal') {
        actor.onMissHeal = { num: e.num, den: e.den };
      } else if (e.kind === 'endDamageIfStatus') {
        actor.endDamageIfStatus = { num: e.num, den: e.den };
        self.push('对手有异常时每回合结束会损失体力。');
      } else if (e.kind === 'noWeak') {
        ctx.noWeak = true;
      } else if (e.kind === 'critIfPositive') {
        if (hasStatUp(actor)) ctx.critAdd = Math.max(ctx.critAdd || 0, e.chance);
      } else if (e.kind === 'blockSwitch') {
        target.blockSwitch = Math.max(target.blockSwitch || 0, e.turns);
        self.push('对手 ' + e.turns + ' 回合内无法主动切换精灵。');
      } else if (e.kind === 'protectStats') {
        actor.protectStats = Math.max(actor.protectStats || 0, e.turns);
        self.push(self.tag(side) + e.turns + ' 回合内能力提升无法被消除。');
      } else if (e.kind === 'costHpStats') {
        var costHp = Math.max(1, Math.floor(actor.maxHp * e.num / e.den));
        costHp = Math.min(costHp, Math.max(0, actor.hp - 1));
        actor.hp -= costHp;
        var upk = Object.keys(actor.stages).filter(function (k6) { return actor.stages[k6] < 6; });
        for (var uj = 0; uj < 2 && upk.length; uj++) {
          var pk = upk.splice(Math.floor(self.rng() * upk.length), 1)[0];
          actor.stages[pk] = clampStage(actor.stages[pk] + 1);
        }
        self.push(self.tag(side) + '损失 ' + costHp + ' 点体力，能力提升。');
      } else if (e.kind === 'ppCostMul') {
        target.ppCostMul = { turns: e.turns, mul: e.mul };
        self.push('对手 ' + e.turns + ' 回合内使用技能消耗 ' + e.mul + ' 倍 PP。');
      } else if (e.kind === 'firstNullify') {
        if (ctx.isFirst) {
          target.skillNull = (target.skillNull || 0) + 1;
          self.push('先手压制：对手下一次技能无效。');
        }
      } else if (e.kind === 'ppRestoreSelf') {
        if (self.rng() * 100 < e.chance) {
          actor.skills.forEach(function (s2) { s2.pp = Math.min(s2.maxPp, s2.pp + e.value); });
          self.push('自身所有技能 PP 恢复 ' + e.value + ' 点。');
        }
      } else if (e.kind === 'minDamage') {
        ctx.minDamage = Math.max(ctx.minDamage || 0, e.value);
      } else if (e.kind === 'ignoreGuards') {
        ctx.ignoreGuards = true;
      } else if (e.kind === 'ignoreImmune') {
        ctx.ignoreImmune = true;
      } else if (e.kind === 'ignoreDefUp') {
        ctx.ignoreDefUp = true;
      } else if (e.kind === 'stealStats' || e.kind === 'stealPositive') {
        var moved = 0;
        var keys = Object.keys(target.stages);
        for (var ki = 0; ki < keys.length && moved < (e.count || 99); ki++) {
          var k2 = keys[ki];
          if (target.stages[k2] > 0) {
            var amt = target.stages[k2];
            target.stages[k2] = 0;
            actor.stages[k2] = clampStage(actor.stages[k2] + amt);
            moved++;
          }
        }
        ctx.clearSuccess = moved > 0;
        self.push(moved ? ('吸取了对手 ' + moved + ' 项能力提升。') : '对手没有能力提升。');
      } else if (e.kind === 'priorityIfPositive') {
        var hasUp = Object.keys(actor.stages).some(function (k3) { return actor.stages[k3] > 0; });
        if (hasUp) {
          actor.priorityBuff = { turns: 1, value: e.value };
          self.push('自身处于能力提升，本回合先制 +' + e.value + '。');
        }
      } else if (e.kind === 'reflectNext') {
        actor.reflectNext = e.pct;
        self.push(self.tag(side) + '下次受击将反馈 ' + e.pct + '% 的伤害。');
      } else if (e.kind === 'reflectDamage') {
        actor.reflectDamage = { turns: e.turns, num: e.num, den: e.den };
        self.push(self.tag(side) + e.turns + ' 回合内反弹受到的伤害。');
      } else if (e.kind === 'healBlockPunish') {
        target.healBlock = Math.max(target.healBlock || 0, e.turns);
        target.healBlockPunish = { num: e.num || 1, den: e.den || 3 };
        self.push('对手 ' + e.turns + ' 回合内无法回复体力，且恢复被阻断时受到 1/' + (e.den || 3) + ' 的百分比伤害。');
      } else if (e.kind === 'healBlock') {
        target.healBlock = Math.max(target.healBlock || 0, e.turns);
        self.push('对手 ' + e.turns + ' 回合内无法回复体力。');
      } else if (e.kind === 'randomStatDown') {
        var downKeys = Object.keys(target.stages).filter(function (k4) { return target.stages[k4] > -6; });
        for (var di = 0; di < e.count && downKeys.length; di++) {
          var pick2 = downKeys.splice(Math.floor(self.rng() * downKeys.length), 1)[0];
          target.stages[pick2] = clampStage(target.stages[pick2] - e.stages);
        }
        self.push('对手 ' + e.count + ' 项能力下降。');
      } else if (e.kind === 'evadeIfFirst') {
        if (ctx.isFirst) {
          target.attackMiss = (target.attackMiss || 0) + 1;
          self.push('先手闪避：对手下一次攻击落空。');
        }
      } else if (e.kind === 'priorityDown') {
        target.priorityDown = { turns: e.turns, value: e.value };
        self.push('对手 ' + e.turns + ' 回合内先制 -' + e.value + '。');
      } else if (e.kind === 'critIfFirst') {
        if (ctx.isFirst) ctx.forceCrit = true;
      } else if (e.kind === 'targetDamageDown') {
        target.dealtMul *= e.num / e.den;
        self.push('对手造成的伤害被削弱了。');
      } else if (e.kind === 'mustHit') {
        actor.mustHitTurns = Math.max(actor.mustHitTurns, e.turns);
        self.push(self.tag(side) + e.turns + ' 回合内攻击必定命中。');
      } else if (e.kind === 'flatByMaxHp') {
        if (target.immuneFixedPct || hasStack(target, 4)) { self.push('对手免疫了百分比伤害。'); return; }
        if (target.hp > 0) {
          var fm = Math.max(1, Math.floor(actor.maxHp * e.pct / 100));
          fm = self.directDamage(target, fm, 'percent');
          self.push('追加 ' + fm + ' 点百分比伤害。');
        }
      } else if (e.kind === 'flatByStats') {
        if (target.hp > 0) {
          var fs = Math.max(1, Math.floor((actor.stats.def + actor.stats.spDef) * e.pct / 100));
          fs = self.directDamage(target, fs, 'percent');
          self.push('追加 ' + fs + ' 点百分比伤害。');
        }
      } else if (e.kind === 'healChance') {
        if (self.rng() * 100 < e.chance && actor.healBlock <= 0) {
          var hc = Math.min(Math.floor(actor.maxHp * e.num / e.den), actor.maxHp - actor.hp);
          if (hc > 0) { actor.hp += hc; self.push(self.tag(side) + '恢复了 ' + hc + ' 点体力。'); }
        }
      } else if (e.kind === 'damageFlat') {
        actor.damageFlat = { turns: e.turns, value: e.value };
        self.push(self.tag(side) + '接下来受到的伤害降低 ' + e.value + ' 点。');
      } else if (e.kind === 'attackBlockFirst') {
        if (ctx.isFirst) {
          target.attackBlock = Math.max(target.attackBlock || 0, 1);
          self.push('先手压制：对手本回合攻击技能无效。');
        }
      } else if (e.kind === 'drainIfStatus') {
        if (target.status && dealt > 0 && actor.healBlock <= 0) {
          var ds = Math.min(Math.max(1, Math.floor(dealt * e.pct / 100)), actor.maxHp - actor.hp);
          if (ds > 0) { actor.hp += ds; self.push(self.tag(side) + '恢复了 ' + ds + ' 点体力。'); }
        }
      } else if (e.kind === 'survive') {
        actor.survive = { turns: e.turns, hp: e.hp };
        self.push(self.tag(side) + e.turns + ' 回合内受到致死攻击会保留 ' + e.hp + ' 点体力。');
      } else if (e.kind === 'ppZeroOnFoeAtk') {
        actor.ppZeroOnFoeAtk = { turns: e.turns, count: e.count || 1 };
        self.push(self.tag(side) + e.turns + ' 回合内对手使用攻击技能则随机技能 PP 归零。');
      } else if (e.kind === 'roundLock') {
        var rlTurns = e.turns + (ctx && ctx.isFirst === false ? (e.slowAdd || 0) : 0);
        actor.starRoundLock = Math.max(actor.starRoundLock || 0, rlTurns);
        self.push(self.tag(side) + rlTurns + ' 回合内自身的回合类效果无法被消除。');
      } else if (e.kind === 'capOnStatus') {
        actor.capOnStatus = { turns: e.turns, capTurns: e.capTurns, value: e.value };
        self.push(self.tag(side) + e.turns + ' 回合内对手使用属性技能，则之后 ' + e.capTurns + ' 回合自身受到伤害不超过 ' + e.value + '。');
      } else if (e.kind === 'attackHitStatusTimed') {
        actor.attackHitStatus = { statusId: e.statusId, chance: e.chance, turns: e.turns };
        self.push(self.tag(side) + e.turns + ' 回合内自身攻击技能命中时有 ' + e.chance + '% 概率令对手陷入异常。');
      } else if (e.kind === 'buffGoneAttrBlock') {
        actor.buffGoneAttr = { turns: e.turns, seen: true };
        self.push(self.tag(side) + e.turns + ' 回合内能力提升消失则对手属性技能失效。');
      } else if (e.kind === 'attrBlockIfHit') {
        actor.attrBlockIfHit = { turns: e.turns, block: e.block || 2 };
        self.push('对手命中自身时，其 ' + (e.block || 2) + ' 回合内属性技能无效。');
      } else if (e.kind === 'ppZeroOnHit') {
        actor.ppZeroOnHit = Math.max(actor.ppZeroOnHit || 0, e.count || 1);
        self.push('若本回合受到攻击，额外清零对手 ' + (e.count || 1) + ' 个技能 PP。');
      } else if (e.kind === 'onHitStatusTimed') {
        actor.onHitStatus = { statusId: e.statusId, chance: e.chance, turns: e.turns };
        self.push(self.tag(side) + e.turns + ' 回合内受到攻击有 ' + e.chance + '% 概率令对手陷入异常。');
      } else if (e.kind === 'damageCap') {
        actor.damageCap = { turns: e.turns, value: e.value };
        self.push(self.tag(side) + e.turns + ' 回合内单次受伤不超过 ' + e.value + '。');
      } else if (e.kind === 'randomStatUp') {
        var upKeys = Object.keys(actor.stages).filter(function (k5) { return actor.stages[k5] < 6; });
        for (var ui = 0; ui < e.count && upKeys.length; ui++) {
          var kp = upKeys.splice(Math.floor(self.rng() * upKeys.length), 1)[0];
          actor.stages[kp] = clampStage(actor.stages[kp] + e.stages);
        }
        self.push('自身 ' + e.count + ' 项能力提升。');
      } else if (e.kind === 'ignoreDefPct') {
        ctx.ignoreDefPct = Math.max(ctx.ignoreDefPct || 0, e.pct);
      } else if (e.kind === 'ppDrainFirst') {
        if (ctx.isFirst) {
          target.skills.forEach(function (s3) { s3.pp = Math.max(0, s3.pp - e.value); });
          self.push('先手压制：对手全技能 PP -' + e.value + '。');
        }
      } else if (e.kind === 'dodge') {
        actor.dodge = { turns: e.turns, chance: e.chance };
        self.push(self.tag(side) + e.turns + ' 回合内 ' + e.chance + '% 闪避攻击。');
      } else if (e.kind === 'critBonusTurns') {
        actor.critTimed = { turns: e.turns, add: e.add };
        self.push(self.tag(side) + e.turns + ' 回合内暴击率 +' + Math.round(e.add) + '%。');
      } else if (e.kind === 'healDown') {
        target.healMul *= (1 - e.pct / 100);
        self.push('对手的回复效果被削弱了。');
      } else if (e.kind === 'randomStatus') {
        var pool = ['poison', 'burn', 'frost', 'paralyze'];
        for (var ri = 0; ri < e.count; ri++) {
          var sid2 = pool[Math.floor(self.rng() * pool.length)];
          self.applyStatus(target, sid2, 1, side === 'me' ? '对手' : '我方');
        }
      } else if (e.kind === 'priorityChance') {
        if (self.rng() * 100 < e.chance) {
          actor.priorityBuff = { turns: 1, value: e.value };
          self.push('抢得先机，先制 +' + e.value + '。');
        }
      } else if (e.kind === 'priorityAlways') {
        if (e.req && !checkCond(e.req, ctx)) return;
        actor.priorityBonus += e.value;
        self.push(self.tag(side) + ' 先制 +' + e.value + '。');
      } else if (e.kind === 'rampDamage') {
        // 计数与当回合标记已在伤害前处理（见 pre-ramp 扫描），这里只兜底无伤害的写法
        actor.rampInc = Math.max(actor.rampInc, e.inc);
        actor.rampCap = Math.max(actor.rampCap, e.cap);
        actor.rampActive = true;
      } else if (e.kind === 'firstReviveTurn') {
        if (!ctx || ctx.isFirst) {
          actor.firstReviveTurn = self.turn;
          self.push(self.tag(side) + '本回合对手出手后若倒下，体力将回满（堕世）。');
        }
      } else if (e.kind === 'attackBlock') {
        target.attackBlock = Math.max(target.attackBlock || 0, e.turns);
        self.push('对手 ' + e.turns + ' 回合内无法使用攻击技能。');
      } else if (e.kind === 'drainMax') {
        if (e.req && !checkCond(e.req, ctx)) return;
        if (actor.healBlock > 0) { self.push(self.tag(side) + '无法回复体力，吸取失败。'); return; }
        var dm = Math.max(1, Math.floor(target.maxHp * e.num / e.den));
        if (target.hp > 0) {
          target.hp = Math.max(0, target.hp - dm);
          var dheal = Math.min(dm, actor.maxHp - actor.hp);
          if (dheal > 0) actor.hp += dheal;
          self.push('吸取了对手 ' + dm + ' 点体力。');
        }
      } else if (e.kind === 'perTurnStatDown') {
        actor.teStatDown = { turns: e.turns, stats: e.stats, value: e.value, last: -1 };
        self.push('接下来 ' + e.turns + ' 回合，每回合开始时对手 ' + e.stats.map(function (st) { return STAT_LABEL[st]; }).join('/') + ' ' + e.value + '。');
      } else if (e.kind === 'flatPerEqualStat') {
        var eqN = 0;
        SIX_STATS.forEach(function (kq) { if (actor.stages[kq] === target.stages[kq]) eqN++; });
        var eqFlat = Math.floor(eqN / Math.max(1, e.per)) * e.value;
        if (eqFlat > 0 && target.hp > 0) {
          eqFlat = self.directDamage(target, eqFlat, 'fixed');
          self.push('能力等级相同的项数：' + eqN + '，附加 ' + eqFlat + ' 点固定伤害。');
        }
      } else if (e.kind === 'clearOrFearDrain') {
        if (!ctx.clearSuccess) {
          var drainOD = Math.max(1, Math.floor(target.maxHp * e.num / e.den));
          drainOD = self.directDamage(target, drainOD, 'percent');
          if (drainOD > 0) self.push('未消除回合效果：吸取对手 1/' + e.den + ' 最大体力（' + drainOD + '）。');
        } else {
          self.applyStatus(target, e.statusId || 'fear', 1, '对手');
        }
      } else if (e.kind === 'benchQuarterOnClear') {
        var foeSideBQ = side === 'me' ? 'foe' : 'me';
        var benchB = self[foeSideBQ].team.filter(function (x2) { return x2 && x2 !== self.activeOf(foeSideBQ) && x2.hp > 0; });
        if (benchB.length) {
          var bq = benchB[Math.floor(self.rng() * benchB.length)];
          var dq = Math.max(1, Math.floor(bq.maxHp * 1 / e.den));
          bq.hp = Math.max(e.residue != null ? e.residue : 1, bq.hp - dq);
          self.push('消除强化成功：对手场下 ' + bq.pet.name + ' 损失 ' + dq + ' 点体力。');
        }
      } else if (e.kind === 'critBonus') {
        ctx.critBonus = (ctx.critBonus || 0) + e.value;
      } else if (e.kind === 'critHealDealt') {
        ctx.critHealDealt = { num: e.num, den: e.den };
      } else if (e.kind === 'junPunish') {
        actor.junPunish = { turns: e.turns || 3, threshold: e.threshold || 300, bench: e.bench || 100, residue: 1 };
        self.push(self.tag(side) + e.turns + ' 回合内：对手攻击伤害低于 ' + e.threshold + ' 则其场下损失 ' + e.bench + ' 点体力。');
      } else if (e.kind === 'junGuard') {
        actor.junGuard = { turns: e.turns || 3, threshold: e.threshold || 280, count: e.statusCount || 2 };
        actor.guards.push({ turns: e.turns || 3, mul: e.mul || 0.5, scope: 'all' });
        self.push(self.tag(side) + e.turns + ' 回合减伤，受伤高于 ' + (e.threshold || 280) + ' 时随机附加 2 种异常。');
      } else if (e.kind === 'allStatChanceDouble') {
        // 基础：全属性 +N
        Object.keys(actor.stages).forEach(function (kJ) {
          if (kJ !== 'eva') actor.stages[kJ] = clampStage(actor.stages[kJ] + e.stages);
        });
        if (self.rng() * 100 < (e.chance || 50)) {
          Object.keys(actor.stages).forEach(function (kJ2) {
            if (kJ2 !== 'eva') actor.stages[kJ2] = clampStage(actor.stages[kJ2] + e.stages);
          });
          self.push('全属性 +' + e.stages + '，并触发强化翻倍（共 +' + (e.stages * 2) + '）！');
        } else {
          var stolen = 0;
          Object.keys(target.stages).forEach(function (kK) {
            if (target.stages[kK] > 0) { actor.stages[kK] = clampStage(actor.stages[kK] + target.stages[kK]); target.stages[kK] = 0; stolen++; }
          });
          self.push(stolen ? ('未翻倍：全属性 +' + e.stages + '，并吸取了对手 ' + stolen + ' 项强化。') : ('未翻倍：全属性 +' + e.stages + '（对手无强化可吸取）。'));
        }
      } else if (e.kind === 'invertSelfDowns') {
        var invS = 0;
        Object.keys(actor.stages).forEach(function (kL) {
          if (actor.stages[kL] < 0) { actor.stages[kL] = -actor.stages[kL]; invS++; }
        });
        if (invS) { actor.pendingFoeAttackBlock = 1; self.push('反转自身 ' + invS + ' 项能力下降。'); }
      } else if (e.kind === 'benchScaleHeal') {
        var own = self.teamOf ? self.teamOf(side) : self[side].team;
        var alive = own.filter(function (x3) { return x3.hp > 0; }).length;
        var dead = own.length - alive;
        var hv = alive * e.perAlive, fv = dead * e.perDead;
        if (hv > 0) { actor.hp = Math.min(actor.maxHp, actor.hp + hv); self.push('回复 ' + hv + ' 点体力（存活 ' + alive + '）。'); }
        if (fv > 0) {
          var flatB = self.resistDamage(target, fv, 'fixed');
          target.hp = Math.max(0, target.hp - flatB);
          self.push('附加 ' + flatB + ' 点固定伤害（阵亡 ' + dead + '）。');
        }
      } else if (e.kind === 'lowDamageBenchStrike') {
        ctx.lowDamageBench = { threshold: e.threshold, value: e.value, residue: e.residue };
      } else if (e.kind === 'benchHealAll') {
        var ownH = self[side].team;
        var healedH = 0;
        ownH.forEach(function (x4) { if (x4 && x4 !== actor && x4.hp > 0 && x4.hp < x4.maxHp) { x4.hp = Math.min(x4.maxHp, x4.hp + e.value); healedH++; } });
        if (healedH) self.push('己方场下 ' + healedH + ' 只精灵各回复 ' + e.value + ' 点体力。');
      } else if (e.kind === 'junNoWeakenNext') {
        actor.junNoWeaken = true;
      } else if (e.kind === 'stacksOnResult') {
        ctx.stacksOnResult = { crit: e.crit || 2, base: e.base || 1 };
      } else if (e.kind === 'stacksOnKill') {
        ctx.stacksOnKill = e.value || 2;
      } else if (e.kind === 'foePriorityDown') {
        target.priorityDown = { turns: e.turns || 1, value: e.value || 2 };
        self.push('对手下 ' + (e.turns || 1) + ' 回合先制 -' + (e.value || 2) + '。');
      } else if (e.kind === 'attrPunishPP') {
        actor.attrPunishPP = { turns: e.turns || 4, amount: e.amount || 2 };
        self.push('对手 ' + (e.turns || 4) + ' 回合内使用属性技能会被扣除全技能 PP。');
      } else if (e.kind === 'lastFoeAttackBlock') {
        actor.lastFoeAttackBlockPending = true;
      } else if (e.kind === 'reflectIfAlive') {
        actor.reflectIfAlivePending = { num: e.num || 1, den: e.den || 2, turns: e.turns || 1 };
      } else if (e.kind === 'starRageMode') {
        actor.starRageModeCur = e.mode;
      } else if (e.kind === 'starRageBonus') {
        actor.starRageChanceBonus = e.bonus || 20;
        actor.starRageChanceTurns = e.turns || 2;
        self.push(self.tag(side) + (e.turns || 2) + ' 回合内星皇之怒触发概率 +' + (e.bonus || 20) + '%。');
      } else if (e.kind === 'starRageDouble') {
        actor.starRageDouble = e.n || 2;
        self.push(self.tag(side) + '下 ' + (e.n || 2) + ' 次星皇之怒概率翻倍。');
      } else if (e.kind === 'starPunish') {
        actor.punish3291 = { turns: e.turns || 3 };
        self.push('对手 ' + (e.turns || 3) + ' 回合内使用属性技将被扣 PP、使用攻击技将受到 1/3 百分比伤害。');
      } else if (e.kind === 'starLowDamage') {
        actor.starLowDamage = { threshold: e.threshold || 280, statusId: e.statusId || 'tired' };
      } else if (e.kind === 'starPowerKeep') {
        actor.starPowerKeepPending = true;
      } else if (e.kind === 'lowPowerPunish') {
        actor.teLowPower = { turns: e.turns, threshold: e.threshold, statusId: e.statusId };
        self.push(self.tag(side) + e.turns + ' 回合内对手使用威力 ≤' + e.threshold + ' 的攻击技能时令其陷入异常，未触发则抵挡当次攻击。');
      } else if (e.kind === 'attrTriggerStatus') {
        actor.teAttrTrigger = { turns: e.turns, chance: e.chance, statusId: e.statusId };
        self.push(self.tag(side) + e.turns + ' 回合内对手使用属性技能时有 ' + e.chance + '% 概率令其陷入异常。');
      } else if (e.kind === 'drainTimed') {
        actor.teDrain = { turns: e.turns, num: e.num, den: e.den, lowHalf: e.lowHalf || 0, bench: e.bench || 0 };
        self.push(self.tag(side) + e.turns + ' 回合内使用技能吸取对手最大体力 1/' + e.den + '。');
      } else if (e.kind === 'selfKoHalfShield') {
        actor.pendingSelfKo = { pct: e.pct || 50 };
        self.push(self.tag(side) + '消耗自身全部体力，己方下只精灵将获得消耗值 ' + (e.pct || 50) + '% 的护盾与护罩。');
      } else if (e.kind === 'ppZero') {
        if (e.chance && self.rng() * 100 >= e.chance) return;
        var cand = target.skills.filter(function (s) { return s.pp > 0; });
        for (var pi = 0; pi < e.count && cand.length; pi++) {
          var pick = cand.splice(Math.floor(self.rng() * cand.length), 1)[0];
          pick.pp = 0;
        }
        self.push('对手 ' + e.count + ' 个技能的 PP 被清零。');
      } else if (e.kind === 'critPercent') {
        if (ctx.crit && target.hp > 0) {
          var cp = Math.max(1, Math.floor(target.maxHp * e.num / e.den));
          cp = self.directDamage(target, cp, 'percent');
          self.push('致命一击追加 ' + cp + ' 点百分比伤害。');
        }
      } else if (e.kind === 'immuneReflectStatus') {
        actor.immuneStatus = Math.max(actor.immuneStatus, e.turns);
        actor.reflectStatus = Math.max(actor.reflectStatus, e.turns);
        self.push(self.tag(side) + e.turns + ' 回合内免疫并反弹异常状态。');
      } else if (e.kind === 'healRandom') {
        if (actor.healBlock > 0) { self.push(self.tag(side) + '无法回复体力。'); return; }
        var hr = Math.floor(e.min + self.rng() * (e.max - e.min + 1));
        hr = Math.min(hr, actor.maxHp - actor.hp);
        if (hr > 0) {
          actor.hp += hr;
          self.push(self.tag(side) + '恢复了 ' + hr + ' 点体力。');
        }
      } else if (e.kind === 'flatRandom') {
        var frMin = e.min, frMax = e.max;
        if (e.min2 != null) {
          var hasUpF = false;
          ALL_STATS.forEach(function (k) { if (actor.stages[k] > 0) hasUpF = true; });
          if (hasUpF) { frMin = e.min2; frMax = e.max2; }
        }
        var fr = self.resistDamage(target, Math.floor(frMin + self.rng() * (frMax - frMin + 1)), 'fixed');
        if (target.hp > 0 && fr > 0) {
          target.hp = Math.max(0, target.hp - fr);
          self.push('附加 ' + fr + ' 点固定伤害。');
        }
      } else if (e.kind === 'swapPos') {
        var tmpP = actor.mainPos; actor.mainPos = actor.subPos; actor.subPos = tmpP;
        self.push(self.tag(side) + '交换主副位：主位帝皇之' + actor.mainPos + '。');
      } else if (e.kind === 'wudaoAdvance') {
        var ORDER = ['血', '邪', '天'];
        var idxW = ORDER.indexOf(actor.wudao || '血');
        var wrapped = idxW >= ORDER.length - 1;
        actor.wudao = ORDER[(idxW + 1) % ORDER.length];
        if (wrapped && actor.wudaoPP) {
          actor.skills.forEach(function (slW) { slW.pp = slW.max_pp || 99; });
          self.push(self.tag(side) + '魂印：完成一轮武道衍化，恢复全部 PP，进入' + actor.wudao + '之道。');
        } else {
          self.push(self.tag(side) + '魂印：武道衍化为' + actor.wudao + '之道。');
        }
      } else if (e.kind === 'formSwitch') {
        actor.form = (actor.form === e.form) ? '强击' : e.form;
        self.push(self.tag(side) + '形态转换为' + actor.form + '。');
      } else if (e.kind === 'summonZhan') {
        actor.yuTurns = 0;
        actor.zhanTurns = Math.max(actor.zhanTurns, e.turns);
        self.push(self.tag(side) + '召唤龙神：获得 ' + e.turns + ' 回合战之龙魂。');
      } else if (e.kind === 'summonYu') {
        actor.zhanTurns = 0;
        actor.yuTurns = Math.max(actor.yuTurns, e.turns);
        self.push(self.tag(side) + '召唤龙神：获得 ' + e.turns + ' 回合御之龙魂。');
      } else if (e.kind === 'skillNullNext') {
        target.skillNull = Math.max(target.skillNull || 0, 1);
        self.push(self.tag(side) + '令对手下次使用的技能无效。');
      } else if (e.kind === 'blessGainOnHit') {
        var gbh = 1 + ((typeof dealt === 'number' && dealt > e.high) ? 1 : 0);
        actor.bless = (actor.bless || 0) + gbh;
        self.push(self.tag(side) + '获得 ' + gbh + ' 层自然祝福（当前 ' + actor.bless + ' 层）。');
      } else if (e.kind === 'blessGain') {
        var bg = actor.blessGain || null;
        actor.bless = (actor.bless || 0) + e.n;
        self.push(self.tag(side) + '获得 ' + e.n + ' 层自然祝福（当前 ' + actor.bless + ' 层）。');
      } else if (e.kind === 'blessConsumePp') {
        var nBl = actor.bless || 0;
        actor.bless = 0;
        var poolBl = target.skills.filter(function (sl) { return sl.pp > 0; });
        for (var bi = 0; bi < nBl && poolBl.length; bi++) {
          poolBl.splice(Math.floor(self.rng() * poolBl.length), 1)[0].pp = 0;
        }
        self.push(self.tag(side) + '消耗 ' + nBl + ' 层自然祝福，令对手 ' + Math.min(nBl, nBl) + ' 个技能 PP 归零。');
      } else if (e.kind === 'critBuff') {
        if (e.needAlive && target.hp <= 0) return;
        if (e.req && !checkCond(e.req, ctx)) return;
        actor.critBuffTurns = Math.max(actor.critBuffTurns, e.turns);
        self.push(self.tag(side) + e.turns + ' 回合内攻击必定致命一击。');
      } else if (e.kind === 'priorityBuff') {
        var pb = actor.priorityBuff || { turns: 0, value: 0 };
        actor.priorityBuff = { turns: Math.max(pb.turns, e.turns), value: Math.max(pb.value, e.value) };
        self.push(self.tag(side) + ' 接下来 ' + e.turns + ' 回合先制 +' + e.value + '。');
      } else if (e.kind === 'nextCrit') {
        if (target.hp > 0) {
          actor.guaranteeCrit = (actor.guaranteeCrit || 0) + e.times;
          self.push('接下来的 ' + e.times + ' 次攻击必定致命一击。');
        }
      } else if (e.kind === 'invertStages') {
        if (actor.statDownLock > 0) {
          self.push(actor.pet.name + ' 的能力下降无法被反转。');
          return;
        }
        var mult = e.dbl ? 2 : 1;
        var flipped = false;
        Object.keys(actor.stages).forEach(function (k) {
          if (actor.stages[k] < 0) {
            actor.stages[k] = Math.min(6, -actor.stages[k] * mult);
            flipped = true;
          }
        });
        self.push(flipped ? '自身能力下降被反转了！' : '自身没有能力下降。');
        ctx.clearSuccess = flipped;
      } else if (e.kind === 'prevDamageFlat') {
        var pd = Math.max(1, actor.lastTaken || 0);
        if (target.hp > 0) {
          pd = self.directDamage(target, pd, 'fixed');
          self.push('附加 ' + pd + ' 点固定伤害。');
        }
      } else if (e.kind === 'damageBuff') {
        // 带条件且只持续本回合的，已经在伤害结算前用掉（ctx.attackBuffMul），不再挂持久 buff
        if (e.req && e.turns <= 1) return;
        if (e.needAlive && target.hp <= 0) return;
        var db = actor.damageBuff || { turns: 0, mul: 1 };
        actor.damageBuff = { turns: Math.max(db.turns, e.turns), mul: Math.max(db.mul, e.mul) };
        self.push(self.tag(side) + e.turns + ' 回合内攻击伤害 ×' + e.mul + '。');
      } else if (e.kind === 'recoil') {
        if (dealt > 0 && actor.hp > 0) {
          var rc = Math.max(1, Math.floor(dealt * e.num / e.den));
          actor.hp = Math.max(1, actor.hp - rc);
          self.push('受到反作用力，损失 ' + rc + ' 点体力。');
        }
      } else if (e.kind === 'selfCostDamage') {
        var cost = Math.min(e.cost, Math.max(0, actor.hp - 1));
        actor.hp -= cost;
        if (target.hp > 0) {
          target.hp = Math.max(0, target.hp - e.value);
          self.push('消耗 ' + cost + ' 点体力，造成 ' + e.value + ' 点固定伤害。');
        }
      }
    });

    // —— 第四批：现代技能的高频特殊句式 ——
    fx.forEach(function (e) {
      if (e.req && !checkCond(e.req, ctx)) return;
      if (e.cond === 'last' && ctx.isFirst) return;
      if (e.cond === 'first' && !ctx.isFirst) return;
      var rn;

      if (e.kind === 'flatByDef') {
        var fd = Math.max(1, target.stats.def);
        if (target.hp > 0) { fd = self.directDamage(target, fd, 'percent'); self.push('造成 ' + fd + ' 点固定伤害（对手防御值）。'); }
      } else if (e.kind === 'flatByCurHp') {
        if (target.immuneFixedPct || hasStack(target, 4)) { self.push('对手免疫了百分比伤害。'); return; }
        var fch = Math.max(1, Math.floor(actor.hp * e.pct / 100));
        if (target.hp > 0) { fch = self.directDamage(target, fch, 'percent'); self.push('追加 ' + fch + ' 点百分比伤害。'); }
      } else if (e.kind === 'flatByTargetCurHp') {
        var ftc = Math.max(1, Math.floor(target.hp * e.pct / 100));
        if (target.hp > 0) { ftc = self.directDamage(target, ftc, 'percent'); self.push('追加 ' + ftc + ' 点百分比伤害。'); }
      } else if (e.kind === 'flatByTargetDefPct') {
        var ftd = Math.max(1, Math.floor(target.stats.def * e.pct / 100));
        if (target.hp > 0) { ftd = self.directDamage(target, ftd, 'percent'); self.push('追加 ' + ftd + ' 点百分比伤害。'); }
      } else if (e.kind === 'flatByOwnDefs') {
        var fod = Math.max(1, Math.floor((actor.stats.def + actor.stats.spDef) * e.pct / 100));
        if (target.hp > 0) { fod = self.directDamage(target, fod, 'percent'); self.push('追加 ' + fod + ' 点百分比伤害。'); }
      } else if (e.kind === 'flatRandomHeal') {
        rn = Math.floor(e.min + self.rng() * (e.max - e.min + 1));
        if (target.hp > 0) target.hp = Math.max(0, target.hp - rn);
        if (actor.healBlock <= 0) {
          var frh = Math.min(rn, actor.maxHp - actor.hp);
          if (frh > 0) actor.hp += frh;
        }
        self.push('附加 ' + rn + ' 点固定伤害并恢复等量体力。');
      } else if (e.kind === 'flatRandomCond') {
        var useAlt = e.req2 ? checkCond(e.req2, ctx) : false;
        rn = useAlt ? Math.floor(e.min2 + self.rng() * (e.max2 - e.min2 + 1))
                    : Math.floor(e.min + self.rng() * (e.max - e.min + 1));
        if (target.hp > 0) { rn = self.directDamage(target, rn, 'fixed'); self.push('附加 ' + rn + ' 点固定伤害。'); }
      } else if (e.kind === 'drainRandom') {
        rn = Math.floor(e.min + self.rng() * (e.max - e.min + 1));
        if (target.hp > 0) {
          var drn = Math.min(rn, target.hp);
          target.hp -= drn;
          var dry = Math.min(drn, actor.maxHp - actor.hp);
          if (dry > 0 && actor.healBlock <= 0) actor.hp += dry;
          self.push('吸取了对手 ' + drn + ' 点体力。');
        }
      } else if (e.kind === 'drainFlat') {
        if (target.hp > 0) {
          var dfv = Math.min(e.value, target.hp);
          target.hp -= dfv;
          var dfh = Math.min(dfv, actor.maxHp - actor.hp);
          if (dfh > 0 && actor.healBlock <= 0) actor.hp += dfh;
          self.push('吸取了对手 ' + dfv + ' 点体力。');
        }
      } else if (e.kind === 'hpCutRandom') {
        if (target.hp > 0) {
          var frac = e.from + self.rng() * (e.to - e.from);
          var cut = Math.max(1, Math.floor(target.hp * frac));
          target.hp = Math.max(1, target.hp - cut);
          self.push('削减了对手 ' + cut + ' 点当前体力。');
        }
      } else if (e.kind === 'shieldToDamage') {
        if (actor.shield > 0 && target.hp > 0) {
          var sdv = actor.shield;
          actor.shield = 0;
          sdv = self.directDamage(target, sdv, 'fixed');
          self.push('消耗 ' + sdv + ' 点护盾，造成等量固定伤害。');
        }
      } else if (e.kind === 'selfCostPercent') {
        var costP = Math.max(1, Math.floor(actor.hp * e.num / e.den));
        costP = Math.min(costP, Math.max(0, actor.hp - 1));
        actor.hp -= costP;
        if (target.hp > 0) {
          costP = self.directDamage(target, costP, 'percent');
          self.push('消耗 ' + costP + ' 点体力，造成等量百分比伤害。');
        }
      } else if (e.kind === 'execOnHit') {
        if (target.hp > 0 && self.rng() * 100 < e.chance) {
          target.hp = 0;
          self.push('一击必杀！对手倒下了。');
        }
      } else if (e.kind === 'healByLost') {
        if (actor.healBlock > 0) { self.push(self.tag(side) + '无法回复体力。'); return; }
        var lostHp = actor.maxHp - actor.hp;
        var hb = Math.min(Math.max(1, Math.floor(lostHp * e.num / e.den)), actor.maxHp - actor.hp);
        if (hb > 0) { actor.hp += hb; self.push(self.tag(side) + '恢复了 ' + hb + ' 点体力。'); }
      } else if (e.kind === 'healBoth') {
        if (actor.hp > 0) actor.hp = actor.maxHp;
        if (target.hp > 0) target.hp = target.maxHp;
        self.push('双方体力全部恢复。');
      } else if (e.kind === 'ppRestoreAll') {
        actor.skills.forEach(function (s2) { s2.pp = Math.min(s2.maxPp, s2.pp + e.value); });
        self.push('自身所有技能 PP 恢复 ' + e.value + ' 点。');
      } else if (e.kind === 'invertToFoe') {
        var movedDown = 0;
        Object.keys(actor.stages).forEach(function (k5) {
          if (actor.stages[k5] < 0) {
            var amt5 = -actor.stages[k5] * (e.dbl ? 2 : 1);
            actor.stages[k5] = 0;
            target.stages[k5] = clampStage(target.stages[k5] - amt5);
            movedDown++;
          }
        });
        self.push(movedDown ? '自身能力下降被反馈给了对手。' : '自身没有能力下降。');
      } else if (e.kind === 'doubleStages') {
        if (e.needAlive && target.hp <= 0) return;
        var dblOk = false;
        Object.keys(actor.stages).forEach(function (k6) {
          if (actor.stages[k6] > 0) {
            actor.stages[k6] = clampStage(actor.stages[k6] * 2);
            dblOk = true;
          }
        });
        self.push(dblOk ? '自身能力提升状态翻倍！' : '自身没有能力提升。');
      } else if (e.kind === 'priorityCond') {
        actor.priorityCond = { req: e.req || null, value: e.value };
        self.push(self.tag(side) + ' 先制 +' + e.value + '。');
      } else if (e.kind === 'priorityStreak') {
        actor.priorityStreak = Math.max(actor.priorityStreak || 0, e.value);
      } else if (e.kind === 'foeMiss') {
        target.missTurns = Math.max(target.missTurns || 0, e.turns);
        self.push('对手 ' + e.turns + ' 回合内攻击必定落空。');
      } else if (e.kind === 'immuneAbove') {
        actor.immuneAbove = { turns: e.turns, value: e.value };
        self.push(self.tag(side) + e.turns + ' 回合内免疫高于 ' + e.value + ' 的伤害。');
      } else if (e.kind === 'ignoreShield') {
        ctx.ignoreShield = true;
      } else if (e.kind === 'critChance') {
        ctx.critAdd = (ctx.critAdd || 0) + e.value;
      } else if (e.kind === 'drainOnCrit') {
        if (ctx.crit && dealt > 0 && actor.hp > 0 && actor.healBlock <= 0) {
          var dch = Math.min(Math.max(1, Math.floor(dealt * e.pct / 100)), actor.maxHp - actor.hp);
          if (dch > 0) { actor.hp += dch; self.push(self.tag(side) + '恢复了 ' + dch + ' 点体力。'); }
        }
      } else if (e.kind === 'rampPct') {
        actor.rampPctInc = Math.max(actor.rampPctInc || 0, e.inc);
        actor.rampPctCap = Math.max(actor.rampPctCap || 0, e.cap);
      } else if (e.kind === 'flatByTargetCurHpRamp') {
        var trPct = e.pct + Math.min(e.inc * actor.streak, e.cap);
        var trDmg = Math.max(1, Math.floor(target.hp * trPct / 100));
        if (target.hp > 0) { trDmg = self.directDamage(target, trDmg, 'percent'); self.push('追加 ' + trDmg + ' 点百分比伤害（' + trPct + '%）。'); }
      } else if (e.kind === 'drainFlatRamp') {
        var dv = e.value + Math.min(e.inc * actor.streak, e.cap);
        if (target.hp > 0) {
          var dvv = Math.min(dv, target.hp);
          target.hp -= dvv;
          var dhh = Math.min(dvv, actor.maxHp - actor.hp);
          if (dhh > 0 && actor.healBlock <= 0) actor.hp += dhh;
          self.push('吸取了对手 ' + dvv + ' 点体力。');
        }
      } else if (e.kind === 'chanceImmune') {
        actor.chanceImmune = { turns: e.turns, chance: e.chance };
        self.push(self.tag(side) + e.turns + ' 回合内有 ' + e.chance + '% 概率免疫攻击伤害。');
      } else if (e.kind === 'useHeal') {
        actor.teUseHeal = { turns: e.turns, num: e.num, den: e.den, last: -1, lowHalf: e.lowHalf || 0, percent: !!e.percent };
        self.push(self.tag(side) + e.turns + ' 回合内每回合使用技能恢复自身最大体力的 ' + e.num + '/' + e.den + '。');
        self.applyTeUseHeal(side, actor);   // 施放这一回合也算「使用了技能」
      } else if (e.kind === 'immuneCrit') {
        actor.immuneCrit = e.turns;
        self.push(self.tag(side) + e.turns + ' 回合内免疫致命一击伤害。');
      } else if (e.kind === 'invertFoeNegative') {
        var invN = 0;
        Object.keys(target.stages).forEach(function (k7) {
          if (target.stages[k7] > 0) { target.stages[k7] = -target.stages[k7]; invN++; }
        });
        self.push(invN ? '对手的能力提升被反转了！' : '对手没有能力提升。');
      } else if (e.kind === 'foeNoStatUp') {
        target.noStatUp = Math.max(target.noStatUp || 0, e.turns);
        self.push('对手 ' + e.turns + ' 回合内无法提升能力。');
      } else if (e.kind === 'delayedFlat') {
        actor.delayed = actor.delayed || [];
        actor.delayed.push({ dueTurn: self.turn + e.turns, value: e.value });
        self.push(e.turns + ' 回合后将对对手造成 ' + e.value + ' 点固定伤害。');
      } else if (e.kind === 'reflectIfHit') {
        actor.reflectIfHit = 1;
      } else if (e.kind === 'oneHitIfLower') {
        if (actor.hp < target.hp) {
          actor.oneHit += e.times;
          self.push(self.tag(side) + '体力低于对手，获得 ' + e.times + ' 次挡击。');
        }
      } else if (e.kind === 'dodgeTimes') {
        if (e.needAlive && target.hp <= 0) return;
        actor.dodgeTimes = { times: e.times, chance: e.chance };
        self.push(self.tag(side) + '接下来 ' + e.times + ' 次被攻击有 ' + e.chance + '% 概率闪避。');
      } else if (e.kind === 'convertTaken') {
        actor.convertTaken = Math.max(actor.convertTaken || 0, e.turns);
        self.push(self.tag(side) + e.turns + ' 回合内受到的攻击伤害转化为体力。');
      } else if (e.kind === 'flatByTargetMaxHp') {
        var tm = self.resistDamage(target, Math.max(1, Math.floor(target.maxHp * e.num / e.den)), 'percent');
        if (target.hp > 0 && tm > 0) { target.hp = Math.max(0, target.hp - tm); self.push('追加 ' + tm + ' 点百分比伤害。'); }
      } else if (e.kind === 'flatByTargetMaxHpRamp') {
        var tp2 = e.pct + Math.min(e.inc * actor.streak, e.cap);
        var td2 = self.resistDamage(target, Math.max(1, Math.floor(target.maxHp * tp2 / 100)), 'percent');
        if (target.hp > 0 && td2 > 0) { target.hp = Math.max(0, target.hp - td2); self.push('追加 ' + td2 + ' 点百分比伤害（' + tp2 + '%）。'); }
      } else if (e.kind === 'flatByOwnStat') {
        var ov = Math.max(1, Math.floor(actor.stats[e.stat] * e.pct / 100));
        if (target.hp > 0) { ov = self.directDamage(target, ov, 'percent'); self.push('追加 ' + ov + ' 点百分比伤害。'); }
      } else if (e.kind === 'swapHpPct') {
        var ap = actor.hp / actor.maxHp, tpp = target.hp / target.maxHp;
        actor.hp = Math.max(1, Math.round(tpp * actor.maxHp));
        target.hp = Math.max(1, Math.round(ap * target.maxHp));
        self.push('双方体力百分比对调了！');
      } else if (e.kind === 'benchHeal') {
        var team = self[side].team;
        var healedN = 0;
        team.forEach(function (c3) {
          if (c3 && c3 !== actor && c3.hp > 0 && c3.hp < c3.maxHp) {
            c3.hp = Math.min(c3.maxHp, c3.hp + e.value);
            healedN++;
          }
        });
        if (healedN) self.push('替补精灵恢复了 ' + e.value + ' 点体力。');
      }
    });

    // 自爆 / 牺牲类
    var selfDied = false;
    fx.forEach(function (e) {
      if (e.req && !checkCond(e.req, ctx)) return;
      if (e.kind === 'oppTo1') {
        if (target.hp > 1) {
          target.hp = 1;
          self.push('对手的体力被压到 1 点！');
        }
      } else if (e.kind === 'skillBlock') {
        target.skillBlock = Math.max(target.skillBlock || 0, e.turns);
        self.push('对手 ' + e.turns + ' 回合内无法使用属性技能。');
      } else if (e.kind === 'nextPet') {
        self.sideBuff[side] = self.sideBuff[side] || { crit: 0, prio: 0, miracle: 0 };
        if (e.grant === 'critPrio') {
          self.sideBuff[side].crit += e.times;
          self.sideBuff[side].prio += e.times;
          self.push('我方下一只精灵前 ' + e.times + ' 次出手必定先手、必定暴击。');
        } else if (e.grant === 'miracle') {
          self.sideBuff[side].miracle += e.times;
          self.push('我方下一只精灵获得 ' + e.times + ' 次奇迹之力。');
        }
      } else if (e.kind === 'foePercentSelf') {
        var pdmg = Math.max(1, Math.floor(actor.hp * e.num / e.den));
        if (target.hp > 0) {
          pdmg = self.directDamage(target, pdmg, 'percent');
          self.push('对手受到 ' + pdmg + ' 点百分比伤害。');
        }
      } else if (e.kind === 'desperate') {
        if (actor.hp > target.hp) {
          actor.hp = Math.max(1, e.residual);
          var d2 = Math.floor(e.dmgMin + self.rng() * (e.dmgMax - e.dmgMin + 1));
          target.hp = Math.max(0, target.hp - d2);
          self.push('消耗体力，对手受到 ' + d2 + ' 点伤害。');
        } else {
          var consumed = actor.hp;
          actor.hp = 0;
          selfDied = true;
          consumed = self.directDamage(target, consumed, 'fixed');
          self.push('消耗全部体力，对手受到 ' + consumed + ' 点固定伤害。');
          if (target.hp > 0) self.applyStatus(target, 'paralyze', e.paraTurns, '对手');
        }
      } else if (e.kind === 'starGift') {
        if (actor.starGift > 0) {
          ['atk', 'def', 'spAtk', 'spDef', 'spd', 'acc'].forEach(function (k) { actor.stages[k] = clampStage(actor.stages[k] + 1); });
          self.push('已处于星赐，改为全属性 +1。');
        } else {
          actor.starGift = Math.max(actor.starGift, e.turns || 2);
          self.push('获得星赐 ' + (e.turns || 2) + ' 回合。');
        }
      } else if (e.kind === 'starPhil') {
        if (actor.starPhil > 0) {
          ['atk', 'def', 'spAtk', 'spDef', 'spd', 'acc'].forEach(function (k) { actor.stages[k] = clampStage(actor.stages[k] + 1); });
          self.push('已处于星哲，改为全属性 +1。');
        } else {
          actor.starPhil = Math.max(actor.starPhil, e.turns || 2);
          self.push('获得星哲 ' + (e.turns || 2) + ' 回合。');
        }
      } else if (e.kind === 'selfKo') {
        selfDied = true;
        if (actor.pendingSelfKo) {
          var consumedSK = Math.max(0, actor.hp);
          self.nextAllyShield = { side: actor.side, value: Math.max(1, Math.floor(consumedSK * actor.pendingSelfKo.pct / 100)) };
          self.push('自爆：己方下一只精灵获得 ' + self.nextAllyShield.value + ' 点护盾与护罩。');
          actor.pendingSelfKo = null;
        }
      }
    });

    // 天启星魂：物理攻击使用后吸取对手双防总和 30% 的体力
    if (actor.starPhysDrain && skill.category && skill.category.id === 1 && target.hp > 0 && actor.hp > 0) {
      var sdDrain = Math.max(1, Math.floor((target.stats.def + target.stats.spDef) * actor.starPhysDrain / 100));
      sdDrain = Math.min(sdDrain, target.hp);
      target.hp -= sdDrain;
      actor.hp = Math.min(actor.maxHp, actor.hp + sdDrain);
      this.push('天启星魂的物理攻击吸取了 ' + sdDrain + ' 点体力。');
    }

    // 马尔修斯 3393：王·异甲同心形态加成 / 切换
    if (actor.morphUltimate && !selfDied && target.hp > 0 &&
      (skill.id === 25555 || /王[•·]异甲同心/.test(skill.name || ''))) {
      if (actor.morphMode === 'speed') {
        var ultDmg = target.hp < target.maxHp / 2
          ? Math.max(1, Math.floor(target.hp / 2))
          : Math.max(1, Math.floor(target.maxHp / 3));
        ultDmg = self.directDamage(target, ultDmg, 'percent');
        actor.morphSwitchNext = 'destroy';
        this.push('王·异甲同心（极速）：追加 ' + ultDmg + ' 点百分比伤害，下回合切换为毁灭形态。');
      } else if (actor.morphMode === 'destroy') {
        var ultDrain = Math.max(1, Math.floor(target.maxHp / 3));
        target.hp = Math.max(0, target.hp - ultDrain);
        actor.hp = Math.min(actor.maxHp, actor.hp + ultDrain);
        actor.morphSwitchNext = 'speed';
        this.push('王·异甲同心（毁灭）：吸取 ' + ultDrain + ' 点体力，下回合切换为极速形态。');
      }
    }

    // 马尔修斯毁灭 / 2882：对手残血时所有技能必定瞬杀
    if (actor.formExec && !selfDied && target.hp > 0) {
      target.hp = 0;
      this.push(actor.pet.name + ' 触发瞬杀，' + target.pet.name + ' 倒下了！');
    }

    // 孙悟空：对手残血时，使用技能后追加对手最大体力 1/3 的百分比伤害
    if (actor.wukongLow && !selfDied && actor.hp > 0 && target.hp > 0) {
      var wkWd = Math.max(1, Math.floor(target.maxHp / 3));
      wkWd = self.directDamage(target, wkWd, 'percent');
      this.push('孙悟空乘胜追击，追加 ' + wkWd + ' 点百分比伤害。');
    }

    // 3291 星皇：惩罚窗口、星皇之赐、星皇之怒
    this.applyPunish3291(actor, target, skill);
    this.afterSkill3291(actor, target, skill, ctx, selfDied);
    this.afterSkill4676(actor, target, skill, ctx);
    this.afterSkillGeneric(actor, target, skill, ctx);
    this.afterSkillStatusHooks(actor, target, skill);

    if (selfDied && actor.hp > 0) {
      actor.hp = 0;
      self.push(self.tag(side) + '倒下了！');
    }

    if (forceCrit && actor.guaranteeCrit > 0) actor.guaranteeCrit--;
    if (actor.guaranteePrio > 0 && num(skill.power) > 0) actor.guaranteePrio--;
    if (actor.starRagePriority > 0 && skill.category && skill.category.id !== 4) actor.starRagePriority--;

    if (num(skill.power) <= 0 && !fx.length) {
      this.push(skill.info ? ('「' + skill.name + '」' + skill.info) : '但什么也没发生…');
    }
  };

  /** 使用道具（消耗本回合） */
  Battle.prototype.useItem = function (side, id) {
    var c = this.activeOf(side);
    if (!c || c.hp <= 0) return false;
    var bag = this.items[side] || [];
    var slot = null;
    for (var i = 0; i < bag.length; i++) {
      if (bag[i].id === id) { slot = bag[i]; break; }
    }
    if (!slot || slot.count <= 0) {
      this.push(this.tag(side) + '没有可用的' + (slot ? slot.name : '道具') + '。');
      return false;
    }
    var def = ITEM_DEFS[id];
    if (!def) return false;

    slot.count--;
    if (def.kind === 'heal') {
      var heal = Math.min(Math.max(1, Math.floor(c.maxHp * def.value)), c.maxHp - c.hp);
      c.hp += heal;
      this.push(this.tag(side) + '使用了' + def.name + '，回复 ' + heal + ' 点体力。');
    } else if (def.kind === 'pp') {
      c.skills.forEach(function (sl) { sl.pp = Math.min(sl.maxPp, sl.pp + def.value); });
      this.push(this.tag(side) + '使用了' + def.name + '，技能 PP 回复 ' + def.value + ' 点。');
    } else if (def.kind === 'cure') {
      if (c.status) {
        this.push(this.tag(side) + '使用了' + def.name + '，解除了' + STATUS_DEF[c.status.id].name + '。');
        c.status = null;
      } else {
        this.push(this.tag(side) + '使用了' + def.name + '，但没有异常状态。');
      }
    }
    return true;
  };

  /** 抗性减免：kind = 'fixed' | 'percent'；返回实际伤害 */
  /** 固定/百分比伤害的统一入口：先过抗性再扣血，返回实际扣掉的点数（0 = 被抗性免疫） */
  Battle.prototype.directDamage = function (target, raw, kind) {
    if (!target || raw <= 0) return 0;
    var v = this.resistDamage(target, raw, kind || 'fixed');
    if (v <= 0 && (target.immuneFixedPct || hasStack(target, 4))) {
      var oppRf = this.activeOf(target.side === 'me' ? 'foe' : 'me');
      if (oppRf && oppRf.hp > 0) {
        var rf = Math.max(1, Math.floor(raw));
        oppRf.hp = Math.max(0, oppRf.hp - rf);
        this.push(target.pet.name + ' 的神耀能量反弹了 ' + rf + ' 点固定伤害给 ' + oppRf.pet.name + '。');
      }
    }
    if (target.turnFixedTakenMul != null && target.turnFixedTakenMul < 1 && target.turnFixedTakenMul > 0 && v > 0) {
      v = Math.max(1, Math.floor(v * target.turnFixedTakenMul));
    }
    if (target.yuTurns > 0 && target.yuBuff) v = Math.max(1, Math.floor(v * (1 - target.yuBuff.reduce / 100)));
    if (target.fixedPctTakenUp && target.fixedPctTakenUp.turns > 0) v = Math.max(1, Math.floor(v * (1 + target.fixedPctTakenUp.pct / 100)));
    if (target.fixedPctPersistMul != null && target.fixedPctPersistMul < 1 && v > 0) {
      v = Math.max(1, Math.floor(v * target.fixedPctPersistMul));
    }
    if (v <= 0) { this.push(this.tag(target.side) + target.pet.name + ' 的抗性免疫了伤害。'); return 0; }
    if (target.ward > 0) {
      var wa = Math.min(target.ward, v);
      target.ward -= wa;
      v -= wa;
      this.push(this.tag(target.side) + '的护罩吸收了 ' + wa + ' 点伤害。');
      if (v <= 0) return 0;
    }
    target.hp = Math.max(0, target.hp - v);
    return v;
  };

  /** 属性系直接伤害（B08 / PORT_NOTES D006）：按属性克制放大，由「护盾」吸收，不吃固百抗性与护罩 */
  Battle.prototype.attributeDamage = function (target, raw, elements) {
    if (!target || raw <= 0 || target.hp <= 0) return 0;
    var mul = 1;
    if (elements && elements.length && target.combo) {
      mul = effMul(this.chart, elements, comboElements(target.combo));
    }
    var dmg = Math.floor(raw * mul);
    if (dmg <= 0) {
      this.push(this.tag(target.side) + target.pet.name + ' 没有受到属性伤害。');
      return 0;
    }
    if (target.shield > 0) {
      var absorbed = Math.min(target.shield, dmg);
      target.shield -= absorbed;
      dmg -= absorbed;
      this.push(this.tag(target.side) + '的护盾吸收了 ' + absorbed + ' 点属性伤害。');
    }
    if (dmg > 0) {
      target.hp = Math.max(0, target.hp - dmg);
      this.push(this.tag(target.side) + target.pet.name + ' 受到 ' + dmg + ' 点属性伤害。');
    }
    return dmg;
  };

  Battle.prototype.resistDamage = function (target, raw, kind) {
    if (!target || raw <= 0) return 0;
    if (target.immuneFixedPct || hasStack(target, 4)) return 0;
    var r = kind === 'fixed' ? (target.fixedResist || 0) : (kind === 'percent' ? (target.percentResist || 0) : 0);
    r = Math.max(0, Math.min(100, r));
    if (r >= 100) return 0;
    return Math.max(1, Math.floor(raw * (1 - r / 100)));
  };

  /** 对某一方造成伤害，处理免疫 / 减伤 / 护盾；返回实际伤害 */
  Battle.prototype.applyDamage = function (side, raw, opts) {
    var c = this.activeOf(side);
    if (!c || raw <= 0 || c.hp <= 0) return 0;
    opts = opts || {};

    if (c.starAttackImmune && opts.attack) {
      this.push(this.tag(side) + c.pet.name + ' 处于星盘回返，免疫了这次攻击。');
      return 0;
    }

    if (c.immuneBelow && c.immuneBelow.turns > 0 && raw < c.immuneBelow.value && !opts.ignoreImmune) {
      this.push(this.tag(side) + '免疫了这次伤害！');
      return 0;
    }
    if (c.immuneAbove && c.immuneAbove.turns > 0 && raw > c.immuneAbove.value && !opts.ignoreImmune) {
      this.push(this.tag(side) + '免疫了这次伤害！');
      return 0;
    }
    if (c.immuneCrit > 0 && opts.crit && !opts.ignoreImmune) {
      this.push(this.tag(side) + '免疫了致命一击的伤害！');
      return 0;
    }
    if (c.chanceImmune && c.chanceImmune.turns > 0 && this.rng() * 100 < c.chanceImmune.chance && !opts.ignoreImmune) {
      this.push(this.tag(side) + '完全免疫了这次伤害！');
      return 0;
    }
    if (c.twinCorps && c.subFull && c.subPos && opts.crit && !opts.ignoreImmune) {
      this.push(this.tag(side) + '魂印：副位无空缺，免疫致命一击伤害。');
      return 0;
    }
    if (c.oneHit > 0 && !opts.ignoreImmune) {
      c.oneHit--;
      this.push(this.tag(side) + '完全挡下了这次攻击！');
      return 0;
    }

    if (opts.kind === 'fixed' || opts.kind === 'percent') {
      raw = this.resistDamage(c, raw, opts.kind);
      if (raw <= 0) {
        this.push(this.tag(side) + c.pet.name + ' 的抗性免疫了伤害。');
        return 0;
      }
    }

    // 护罩：抵挡固定伤害 / 百分比伤害
    if ((opts.kind === 'fixed' || opts.kind === 'percent') && c.ward > 0 && !opts.ignoreShield) {
      var wardAbs = Math.min(c.ward, raw);
      c.ward -= wardAbs;
      raw -= wardAbs;
      this.push(this.tag(side) + '的护罩吸收了 ' + wardAbs + ' 点伤害。');
      if (raw <= 0) return 0;
    }

    var mul = 1;
    if (!opts.ignoreGuards) {
      for (var i = 0; i < c.guards.length; i++) {
        var g = c.guards[i];
        if (g.turns <= 0) continue;
        if (g.scope === 'phys' && !opts.physical) continue;
        if (g.scope === 'spec' && opts.physical) continue;
        if (g.scope === 'type' && (opts.comboName || '').indexOf(g.typeName) < 0) continue;
        mul *= g.mul;
      }
    }

    var dmg = Math.max(1, Math.floor(raw * mul));
    if (c.mistikeGuardTurn > 0 && c.mistikeGuardTurn === this.turn) dmg = Math.max(1, Math.floor(dmg * 0.5));
    if (c.mistikeVuln && opts.attack) {
      dmg *= 2;
      c.mistikeVuln = false;
    }
    if (mul < 1) this.push(this.tag(side) + '受到的伤害被减免了。');

    // 「将受到的攻击伤害转化为自身体力」
    if (c.convertTaken > 0) {
      var healed = Math.min(dmg, c.maxHp - c.hp);
      c.hp += healed;
      this.push(c.pet.name + ' 把这次攻击伤害转化成了 ' + healed + ' 点体力。');
      return 0;
    }

    // 「本回合若受到伤害，则将伤害反馈给对手」
    if (c.reflectIfHit > 0) {
      c.reflectIfHit = 0;
      var rf = this.activeOf(c.side === 'me' ? 'foe' : 'me');
      if (rf && rf.hp > 0) {
        rf.hp = Math.max(0, rf.hp - dmg);
        this.push(c.pet.name + ' 把受到的伤害反馈给对手（' + dmg + ' 点）。');
      }
    }

    // 护盾只挡「攻击伤害」：显式 attack，或未标 fixed/percent 的常规伤害
    var isAtkDmg = !!opts.attack || (opts.kind !== 'fixed' && opts.kind !== 'percent');
    if (c.shield > 0 && !opts.ignoreShield && isAtkDmg) {
      var absorbed = Math.min(c.shield, dmg);
      c.shield -= absorbed;
      dmg -= absorbed;
      this.push(this.tag(side) + '的护盾吸收了 ' + absorbed + ' 点伤害。');
    }
    // 3568 魂印：护盾消失 → 断回合 + 清强化 + 随机清 PP
    if (c.shieldBreakArmed && c.shieldBreakClear && c.shield <= 0) {
      c.shieldBreakArmed = false;
      var foeSh = this.activeOf(c.side === 'me' ? 'foe' : 'me');
      if (foeSh) {
        this.clearRoundEffects(foeSh);
        var clrSh = false;
        Object.keys(foeSh.stages).forEach(function (kSh) { if (foeSh.stages[kSh] > 0) { foeSh.stages[kSh] = 0; clrSh = true; } });
        var poolSh = foeSh.skills.filter(function (sl) { return sl.pp > 0; });
        for (var ps = 0; ps < c.shieldBreakClear.ppCount && poolSh.length; ps++) {
          poolSh.splice(Math.floor(this.rng() * poolSh.length), 1)[0].pp = 0;
        }
        this.push(c.pet.name + ' 的护盾破碎：断回合' + (clrSh ? '、清除强化' : '') + '、对手随机 ' + c.shieldBreakClear.ppCount + ' 个技能 PP 归零。');
      }
    }
    if (c.morphGuard && c.shieldActive && c.shield <= 0) {
      c.shieldActive = false;
      c.shieldRecharge = c.morphGuard.recharge || 2;
      this.push(this.tag(side) + c.pet.name + ' 的坚壁护盾破碎，将在 ' + c.shieldRecharge + ' 回合后重新激活。');
    }

    if (c.guardFlat && c.guardFlat.turns > 0) {
      dmg = Math.max(1, dmg - c.guardFlat.value);
    }

    if (c.nextGuard && c.nextGuard.times > 0) {
      dmg = Math.max(1, Math.floor(dmg * (1 - c.nextGuard.pct / 100)));
      c.nextGuard.times--;
      this.push('伤害被额外减免了 ' + c.nextGuard.pct + '%。');
    }

    if (c.damageFlat && c.damageFlat.turns > 0) {
      dmg = Math.max(1, dmg - c.damageFlat.value);
    }

    if (c.damageCap && c.damageCap.turns > 0 && dmg > c.damageCap.value) {
      dmg = c.damageCap.value;
      this.push('伤害被限制在 ' + dmg + ' 点。');
    }

      if (dmg >= c.hp && c.reflectLethal > 0) {
        var rl = dmg;
        var foeOf = this.activeOf(c.side === 'me' ? 'foe' : 'me');
        if (foeOf && foeOf.hp > 0) {
          rl = this.directDamage(foeOf, rl, 'fixed');
          this.push(c.pet.name + ' 的魂印将致命伤害以 ' + rl + ' 点固定伤害反弹给对手！');
        }
      }

    // 免死：一定回合内受到致死伤害会保留体力
    // B06：致死判定按「严格大于当前体力」（godot battle_core.gd:714 `damage > target.hp`）
    if (dmg > c.hp && c.survive && c.survive.turns > 0) {
      c.hp = Math.max(1, c.survive.hp);
      c.survive = null;
      this.push(c.pet.name + ' 撑住了这一击，保留 ' + c.hp + ' 点体力！');
      if (c.nextGuardByDealt) {
      var nb = Math.min(dmg, 99999);
      c.nextGuard = { times: 1, pct: 0 };
      c.damageFlat = { turns: 1, value: Math.max(c.lastTaken || 0, 0) };
      c.nextGuardByDealt = false;
    }
    return dmg;
    }

    // 轮回类魂印：首次致死伤害保留 1 点体力（godot battle_generic_souls.gd:75，>= 且此时不能有 survive 生效）
    if (dmg >= c.hp && c.hasRebirth && !c.rebirthUsed && !(c.survive && c.survive.turns > 0)) {
      c.rebirthUsed = true;
      c.hp = 1;
      c.pendingRestore = c.turnSnapshot || null;
      this.push(this.tag(side) + c.pet.name + ' 的魂印保留了 1 点体力！');
      return 0;
    }

    c.hp = Math.max(0, c.hp - dmg);
    c.lastTaken = dmg;
    c.tookDamageThisTurn = true;
    if (c.twinCorps && c.yuMain && c.mainPos === '御' && opts.attack) {
      var atkY = this.activeOf(side === 'me' ? 'foe' : 'me');
      if (atkY && atkY.hp > 0) {
        this.directDamage(atkY, dmg, 'true');
        this.push(this.tag(side) + '魂印：御主位反弹 ' + dmg + ' 点真实伤害。');
      }
    }
    if (opts.attack) c.tookAtkDmgTurn = true;
    var atk0 = this.activeOf(side === 'me' ? 'foe' : 'me');
    if (atk0) atk0.lastDealt = dmg;

    // 魂印：受击后获得一次伤害免疫
    if (dmg > 0 && c.onHitImmune && c.hp > 0 && c.oneHit <= 0) {
      c.oneHit = 1;
      this.push(this.tag(side) + '的魂印生效：获得一次伤害免疫。');
    }

    // 魂印：受击伤害超过阈值时给对方挂异常
    if (dmg > 0 && c.onHitCondStatus && dmg > c.onHitCondStatus.threshold) {
      var atkC = this.activeOf(side === 'me' ? 'foe' : 'me');
      if (atkC && atkC.hp > 0) this.applyStatus(atkC, c.onHitCondStatus.statusId, 1, side === 'me' ? '我方' : '对手');
    }

    // 魂印：受击后按概率给对方挂异常
    // 3482 魂印：受击反馈百分比伤害，超过阈值自身全属性+
    if (dmg > 0 && c.reflectOnHitPct && c.hp > 0) {
      var rAtk = this.activeOf(side === 'me' ? 'foe' : 'me');
      if (rAtk && rAtk.hp > 0) {
        var rVal = Math.max(1, Math.floor(dmg * c.reflectOnHitPct.num / c.reflectOnHitPct.den));
        var rHit = this.directDamage(rAtk, rVal, 'percent');
        this.push(c.pet.name + ' 的魂印反馈了 ' + rHit + ' 点百分比伤害。');
        if (rHit > c.reflectOnHitPct.threshold) {
          var KEYS2 = ['atk', 'def', 'spAtk', 'spDef', 'spd'];
          KEYS2.forEach(function (k2) { c.stages[k2] = clampStage(c.stages[k2] + c.reflectOnHitPct.stages); });
          this.push(c.pet.name + ' 反馈伤害超过 ' + c.reflectOnHitPct.threshold + '，全属性提升。');
        }
      }
    }
    if (dmg > 0 && c.reflectTakenPct && c.reflectTakenPct.turns > 0 && c.hp > 0) {
      var ra = this.activeOf(side === 'me' ? 'foe' : 'me');
      if (ra) {
        var rv = Math.max(1, Math.floor(dmg * c.reflectTakenPct.num / c.reflectTakenPct.den));
        ra.hp = Math.max(0, ra.hp - rv);
        this.push(c.pet.name + ' 反弹了 ' + rv + ' 点伤害给 ' + ra.pet.name + '。');
      }
    }
    if (dmg > 0 && c.ppZeroOnHit > 0) {
      var pk = this.activeOf(side === 'me' ? 'foe' : 'me');
      if (pk) {
        var pc = pk.skills.filter(function (x) { return x.pp > 0; });
        if (pc.length) { pc[Math.floor(this.rng() * pc.length)].pp = 0; this.push('受到攻击，额外清零对手 1 个技能的 PP。'); }
      }
      c.ppZeroOnHit = 0;
    }
    if (dmg > 0 && c.attrBlockIfHit && c.attrBlockIfHit.turns > 0) {
      var ab = this.activeOf(side === 'me' ? 'foe' : 'me');
      if (ab) {
        ab.skillBlock = Math.max(ab.skillBlock || 0, c.attrBlockIfHit.block);
        this.push('对手命中自身，其 ' + c.attrBlockIfHit.block + ' 回合内属性技能无效。');
      }
      c.attrBlockIfHit = null;
    }
    if (dmg > 0 && c.onHitStatus) {
      var attacker = this.activeOf(side === 'me' ? 'foe' : 'me');
      if (attacker && attacker.hp > 0 && this.rng() * 100 < c.onHitStatus.chance) {
        this.applyStatus(attacker, c.onHitStatus.statusId, 1, side === 'me' ? '对手' : '我方');
      }
    }

    // 受击后削弱对手能力（多项）
    if (dmg > 0 && c.onHitMultiStatDown && c.onHitMultiStatDown.turns > 0) {
      var atkMS = this.activeOf(side === 'me' ? 'foe' : 'me');
      if (atkMS) {
        c.onHitMultiStatDown.stats.forEach(function (pair) {
          atkMS.stages[pair[0]] = clampStage(atkMS.stages[pair[0]] - pair[1]);
        });
        this.push('对手的能力被削弱了。');
      }
    }

    // 受击后自身获得暴击提升
    if (dmg > 0 && c.onHitCritBuff && c.onHitCritBuff.turns > 0) {
      c.critBuffTurns = Math.max(c.critBuffTurns || 0, c.onHitCritBuff.critTurns);
      c.onHitCritBuff.turns--;
    }

    if (dmg > 0 && c.onHitPercentHp && c.onHitPercentHp.turns > 0) {
      var atkPH = this.activeOf(side === 'me' ? 'foe' : 'me');
      if (atkPH && atkPH.hp > 0) {
        var ph = this.resistDamage(atkPH, Math.max(1, Math.floor(atkPH.maxHp * c.onHitPercentHp.num / c.onHitPercentHp.den)), 'percent');
        if (ph > 0) {
          atkPH.hp = Math.max(0, atkPH.hp - ph);
          this.push('对手损失 ' + ph + ' 点体力。');
        }
      }
    }
    if (dmg > 0 && c.onHitHealChance && c.onHitHealChance.turns > 0 && this.rng() * 100 < c.onHitHealChance.chance) {
      var hc2 = Math.min(Math.max(1, Math.floor(c.maxHp * c.onHitHealChance.num / c.onHitHealChance.den)), c.maxHp - c.hp);
      if (hc2 > 0) { c.hp += hc2; this.push(c.pet.name + ' 恢复了 ' + hc2 + ' 点体力。'); }
    }

    if (dmg > 0 && c.onHitMaxHpDown && c.onHitMaxHpDown.turns > 0) {
      var atkMH = this.activeOf(side === 'me' ? 'foe' : 'me');
      if (atkMH && atkMH.hp > 0) {
        var cut3 = Math.max(1, Math.floor(atkMH.maxHp * c.onHitMaxHpDown.num / c.onHitMaxHpDown.den));
        atkMH.maxHp = Math.max(1, atkMH.maxHp - cut3);
        atkMH.hp = Math.min(atkMH.hp, atkMH.maxHp);
        this.push('对手体力上限降低 ' + cut3 + ' 点。');
      }
    }

    if (dmg > 0 && c.onHitReflect) {
      var atkRF = this.activeOf(side === 'me' ? 'foe' : 'me');
      if (atkRF && atkRF.hp > 0) {
        var rfd = Math.max(1, Math.floor(dmg * c.onHitReflect.num / c.onHitReflect.den));
        atkRF.hp = Math.max(0, atkRF.hp - rfd);
        this.push('反馈了 ' + rfd + ' 点伤害。');
      }
    }

    if (dmg > 0 && c.onHitStatUp && c.onHitStatUp.turns > 0 && this.rng() * 100 < c.onHitStatUp.chance) {
      c.stages[c.onHitStatUp.stat] = clampStage(c.stages[c.onHitStatUp.stat] + c.onHitStatUp.stages);
      this.push(c.pet.name + ' 的能力提升了。');
    }
    if (c.counterMul && this.rng() < 1) {
      var atkCM = this.activeOf(side === 'me' ? 'foe' : 'me');
      if (atkCM && atkCM.hp > 0) {
        atkCM.hp = Math.max(0, atkCM.hp - Math.floor(dmg * c.counterMul));
        this.push('反击了 ' + Math.floor(dmg * c.counterMul) + ' 点伤害。');
      }
      c.counterMul = 0;
    }

    if (dmg > 0 && c.onHitReflectPct && c.onHitReflectPct.turns > 0) {
      var atkRP = this.activeOf(side === 'me' ? 'foe' : 'me');
      if (atkRP && atkRP.hp > 0) {
        var rp = Math.max(1, Math.floor(dmg * c.onHitReflectPct.pct / 100));
        atkRP.hp = Math.max(0, atkRP.hp - rp);
        this.push('反馈了 ' + rp + ' 点伤害。');
      }
    }

    // 受击后让对手下回合受伤翻倍
    if (dmg > 0 && c.onHitDamageUp > 0) {
      var atkUp = this.activeOf(side === 'me' ? 'foe' : 'me');
      if (atkUp) atkUp.damageBuff = { turns: 1, mul: 2 };
    }

    // 受击后削弱对手能力
    if (dmg > 0 && c.onHitRandomStatDown) {
      var atkSD = this.activeOf(side === 'me' ? 'foe' : 'me');
      if (atkSD) {
        var kk = Object.keys(atkSD.stages).filter(function (k9) { return atkSD.stages[k9] > -6; });
        for (var si2 = 0; si2 < c.onHitRandomStatDown.count && kk.length; si2++) {
          var pk2 = kk.splice(Math.floor(this.rng() * kk.length), 1)[0];
          atkSD.stages[pk2] = clampStage(atkSD.stages[pk2] - c.onHitRandomStatDown.stages);
        }
        this.push('对手 ' + c.onHitRandomStatDown.count + ' 项能力被削弱。');
      }
      c.onHitRandomStatDown = null;
    }

    // 反弹伤害
    if (dmg > 0 && c.reflectDamage && c.reflectDamage.turns > 0) {
      var back = this.activeOf(side === 'me' ? 'foe' : 'me');
      if (back && back.hp > 0) {
        var rb = Math.max(1, Math.floor(dmg * c.reflectDamage.num / c.reflectDamage.den));
        back.hp = Math.max(0, back.hp - rb);
        this.push(this.tag(side === 'me' ? 'foe' : 'me') + '被反弹了 ' + rb + ' 点伤害。');
      }
    }

    // 下次受击反馈（剑挥四方这类）：延迟到伤害日志之后结算
    if (dmg > 0 && c.reflectNext > 0) {
      this._reflectQueue = (this._reflectQueue || 0) + Math.max(1, Math.floor(dmg * c.reflectNext / 100));
      c.reflectNext = 0;
    }

    return dmg;
  };

  /** 施加异常状态 */
  Battle.prototype.applyStatus = function (target, id, turns, label) {
    if (target && target.starGuard > 0) {
      this.push(target.pet.name + ' 的星皇之佑免疫了异常状态！');
      return;
    }
    if (target && target.immuneStatusIfNoDefUp && target.stages.def <= 0 && target.stages.spDef <= 0) {
      this.push(target.pet.name + ' 的魂印免疫了异常状态！');
      return;
    }
    if (target && target.mistikeNoDebuff > 0) {
      this.push(target.pet.name + ' 的「秘」免疫了异常状态！');
      return;
    }
    var sr = target && target.statusResistById && target.statusResistById[id] != null
      ? target.statusResistById[id]
      : (target ? target.statusResist : 0);
    if (sr > 0 && this.rng() * 100 < Math.min(100, sr)) {
      this.push(target.pet.name + ' 的异常抗性抵消了异常状态！');
      return;
    }
    if (target && (hasStack(target, 2) || target.junYu)) {
      this.push((label || '对手') + '免疫了异常状态（神耀能量）。');
      return;
    }
    if (target && target.chanceImmuneStatus && this.rng() * 100 < target.chanceImmuneStatus) {
      this.push((label || '对手') + '免疫了异常状态！');
      return;
    }
    var def = STATUS_DEF[id];
    if (!def) return;
    if (target.permImmuneStatus) {
      this.push(target.pet.name + ' 的魂印免疫了异常状态！');
      return;
    }
    if (target.immuneStatusIds && target.immuneStatusIds.indexOf(id) >= 0) {
      this.push(target.pet.name + ' 的魂印免疫了' + (STATUS_DEF[id] ? STATUS_DEF[id].name : id) + '！');
      return;
    }
    if (target.starGift > 0 && id === 'tired') {
      this.push(target.pet.name + ' 的星赐免疫了疲惫！');
      return;
    }
    if (target.starPhil > 0 && id === 'fear') {
      this.push(target.pet.name + ' 的星哲免疫了害怕！');
      return;
    }
    if (target.starGift > 0 && target.starPhil > 0 &&
      ['tired', 'fear', 'paralyze', 'sleep', 'confuse', 'petrify'].indexOf(id) >= 0) {
      this.push(target.pet.name + ' 同时处于星赐/星哲，免疫控制类异常！');
      return;
    }
    if (target.immuneStatus > 0) {
      this.push(target.pet.name + ' 免疫了异常状态！');
      return;
    }
    if (target.status) {
      this.push('对手已经处于' + STATUS_DEF[target.status.id].name + '状态。');
      return;
    }
    if (target.statusGuard > 0) {
      target.statusGuard--;
      this.push(target.pet.name + ' 的坚壁形态免疫了这次异常状态。');
      return;
    }
    var dur = def.limited ? Math.max(1, num(turns) || 1) : 999;
    // 害怕：随机 1~2 回合无法行动
    if (id === 'fear' && dur <= 1) dur = 1 + (this.rng() < 0.5 ? 1 : 0);
    target.status = { id: id, turns: dur };
    this.push((label || '对手') + '陷入了' + def.name + '状态！' + (dur < 900 ? '（' + dur + ' 回合）' : ''));
  };

  /** 本回合能否行动 */
  Battle.prototype.canAct = function (c) {
    if (!c || !c.status) return { ok: true };
    var def = STATUS_DEF[c.status.id];
    if (!def) return { ok: true };

    if (c.status.id === 'sleep') {
      c.status.turns--;
      if (c.status.turns <= 0) {
        this.push(c.pet.name + ' 醒来了！');
        c.status = null;
        return { ok: true };
      }
      return { ok: false, msg: c.pet.name + ' 正在睡觉，无法行动。' };
    }

    if (def.limited && def.skip) {
      c.status.turns--;
      if (c.status.turns <= 0) c.status = null;
      return { ok: false, msg: c.pet.name + ' 因' + def.name + '无法行动！' };
    }

    if (def.skip && this.rng() < def.skip) {
      return { ok: false, msg: c.pet.name + ' 因' + def.name + '无法行动！' };
    }
    return { ok: true };
  };

  /** 回合结束：状态伤害、持续伤害结算 */
  Battle.prototype.endOfTurn = function () {
    var self = this;
    ['me', 'foe'].forEach(function (side) {
      var c0 = self.activeOf(side);
      if (c0 && c0.skillBlock > 0) c0.skillBlock--;
      if (c0 && c0.attackBlock > 0) c0.attackBlock--;
      if (c0 && c0.healBlock > 0) c0.healBlock--;
      if (c0 && c0.mustHitTurns > 0) c0.mustHitTurns--;
      if (c0 && c0.ppCostMul && c0.ppCostMul.turns > 0) {
        c0.ppCostMul.turns--;
        if (c0.ppCostMul.turns <= 0) c0.ppCostMul = null;
      }
      if (c0 && c0.teUseHeal && c0.teUseHeal.turns > 0) {
        c0.teUseHeal.turns--;
        if (c0.teUseHeal.turns <= 0) {
          c0.teUseHeal = null;
          self.push(self.tag(side) + '「用技能回血」的回合类效果结束了。');
        }
      }
      if (c0 && c0.pendingSkillBlock) {
        c0.skillBlock = Math.max(c0.skillBlock || 0, c0.pendingSkillBlock);
        c0.pendingSkillBlock = 0;
      }
      if (c0 && c0.twinCorps && c0.subPos === '钺' && c0.yueSub && (c0.dmgCounter || 0) >= c0.yueSub.threshold) {
        c0.dmgCounter = 0;
        var foeDh = self.activeOf(side === 'me' ? 'foe' : 'me');
        if (foeDh && foeDh.hp > 0) {
          var CTRL2 = ['sleep', 'fear', 'tired', 'paralyze', 'confuse', 'petrify'];
          var pickDh = CTRL2[Math.floor(self.rng() * CTRL2.length)];
          self.applyStatus(foeDh, pickDh, 1, side === 'me' ? '对手' : '我方');
          self.push(self.tag(side) + '魂印：钺副位累计 300 伤害，对手陷入控制异常。');
        }
      }
      if (c0 && c0.wudaoHeal) {
        var healWd = Math.min(Math.floor(c0.maxHp / c0.wudaoHeal) * (c0.wudao === '血' ? 2 : 1), c0.maxHp - c0.hp);
        if (healWd > 0) { c0.hp += healWd; self.push(self.tag(side) + '魂印：武道恢复 ' + healWd + ' 点体力。'); }
      }
      if (c0 && c0.bladeTurns > 0) {
        c0.bladeTurns--;
        if (c0.bladeTurns === 0) c0.blade = '北冥之刃';
      }
      if (c0 && c0.nyxHpBranch) {
        if (c0.hp > c0.turnStartHp) c0.critBuffTurns = Math.max(c0.critBuffTurns || 0, 2);
        else if (c0.hp === c0.turnStartHp) c0.pendingNextPrio = Math.max(c0.pendingNextPrio || 0, c0.nyxHpBranch.equal || 1);
        else {
          var healNx = Math.min(Math.floor(c0.maxHp / (c0.nyxHpBranch.low || 3)), c0.maxHp - c0.hp);
          if (healNx > 0) c0.hp += healNx;
        }
      }
      if (c0 && c0.nyxFieldTurns > 0) {
        c0.nyxFieldTurns--;
        c0.skills.forEach(function (sl) { sl.pp = Math.min(sl.max_pp || 99, sl.pp + (c0.nyxField ? c0.nyxField.pp : 1)); });
      }
      if (c0 && c0.nyxField) {
        var foeNx = self.activeOf(side === 'me' ? 'foe' : 'me');
        if (foeNx) {
          var sumFoe = ['atk', 'def', 'spAtk', 'spDef', 'spd'].reduce(function (sN, kN) { return sN + foeNx.stages[kN]; }, 0);
          var sumSelf = ['atk', 'def', 'spAtk', 'spDef', 'spd'].reduce(function (sN, kN) { return sN + c0.stages[kN]; }, 0);
          if (Math.abs(sumFoe - sumSelf) >= c0.nyxField.diff && c0.nyxFieldTurns <= 0) {
            c0.nyxFieldTurns = c0.nyxField.turns;
            self.push(self.tag(side) + '开启倪克斯结界 ' + c0.nyxField.turns + ' 回合。');
          }
        }
      }
      if (c0 && c0.fateWheel) {
        var foeFate = self.activeOf(side === 'me' ? 'foe' : 'me');
        if (!c0.fateBothThisEntry) self.applyFateJie(c0, foeFate);
      }
      if (c0 && c0.fixedPctTakenUp && c0.fixedPctTakenUp.turns > 0) c0.fixedPctTakenUp.turns--;
      if (c0 && c0.burnEndBranch) {
        var foeAn = self.activeOf(side === 'me' ? 'foe' : 'me');
        if (foeAn && foeAn.hp > 0) {
          if (foeAn.status && foeAn.status.id === 'burn') {
            ['atk', 'def', 'spAtk', 'spDef', 'spd'].forEach(function (kAn) { foeAn.stages[kAn] = clampStage(foeAn.stages[kAn] - 1); });
            c0.priorityBuff = { turns: 1, value: c0.burnEndBranch.prio };
            self.push(self.tag(side) + '魂印：对手烧伤，全属性 -1 且下回合先制 +' + c0.burnEndBranch.prio + '。');
          } else {
            var nAnClr = self.clearRoundEffects(foeAn);
            if (nAnClr === 0) {
              var healAn = Math.min(Math.floor(c0.maxHp / c0.burnEndBranch.den), c0.maxHp - c0.hp);
              if (healAn > 0) {
                c0.hp += healAn;
                self.directDamage(foeAn, healAn, 'percent');
                self.push(self.tag(side) + '魂印：对手无回合类效果，恢复 ' + healAn + ' 体力并附加等量百分比伤害。');
              }
            }
          }
        }
      }
      if (c0 && c0.pendingEndFixed) {
        var foeHao = self.activeOf(side === 'me' ? 'foe' : 'me');
        if (foeHao && foeHao.hp > 0) {
          var rngHao = c0.pendingEndFixed.low + Math.floor(self.rng() * (c0.pendingEndFixed.high - c0.pendingEndFixed.low + 1));
          var dmgHao = self.directDamage(foeHao, rngHao, 'fixed');
          self.push(self.tag(side) + '魂印：对手使用攻击技能，附加 ' + dmgHao + ' 点固定伤害。');
        }
        c0.pendingEndFixed = null;
      }
      if (c0 && c0.yuTurns > 0) c0.yuTurns--;
      if (c0 && c0.zhanTurns > 0) c0.zhanTurns--;
      if (c0 && c0.endShieldBranch) {
        var foeE2 = self.activeOf(side === 'me' ? 'foe' : 'me');
        if (!c0.tookAtkDmgTurn) {
          var healE2 = Math.min(c0.endShieldBranch.heal, c0.maxHp - c0.hp);
          if (healE2 > 0) {
            c0.hp += healE2;
            if (foeE2 && foeE2.hp > 0) self.directDamage(foeE2, healE2, 'fixed');
            self.push(self.tag(side) + '魂印：未受攻击伤害，恢复 ' + healE2 + ' 点体力并造成等量固定伤害。');
          }
        } else {
          c0.oneHit = (c0.oneHit || 0) + 1;
          self.push(self.tag(side) + '魂印：受到攻击伤害，免疫下 1 次受到的攻击伤害。');
        }
      }
      if (c0 && c0.blessTurnEnd) {
        if (c0.actedThisTurn) { if (c0.bless > 0) c0.bless--; }
        else c0.bless = (c0.bless || 0) + 1;
        self.push(self.tag(side) + c0.pet.name + ' 的自然祝福：' + c0.bless + ' 层。');
      }
      if (c0 && c0.blessKillFlag) { c0.bless = Math.max(0, c0.bless - 1); c0.blessKillFlag = false; }
      if (c0) c0.actedThisTurn = false;
      if (c0 && c0.reflectDamage && c0.reflectDamage.turns > 0) c0.reflectDamage.turns--;
      if (c0 && c0.priorityDown && c0.priorityDown.turns > 0) c0.priorityDown.turns--;
      if (c0 && c0.survive && c0.survive.turns > 0) c0.survive.turns--;
      if (c0 && c0.damageCap && c0.damageCap.turns > 0) c0.damageCap.turns--;
      if (c0 && c0.dodge && c0.dodge.turns > 0) c0.dodge.turns--;
      if (c0 && c0.critTimed && c0.critTimed.turns > 0) c0.critTimed.turns--;
      if (c0 && c0.missTurns > 0) c0.missTurns--;
      if (c0 && c0.immuneAbove && c0.immuneAbove.turns > 0) c0.immuneAbove.turns--;
      if (c0 && c0.chanceImmune && c0.chanceImmune.turns > 0) c0.chanceImmune.turns--;
      if (c0 && c0.immuneCrit > 0) c0.immuneCrit--;
      if (c0 && c0.noStatUp > 0) c0.noStatUp--;
      if (c0 && c0.reflectLethal > 0) c0.reflectLethal--;
      if (c0 && c0.convertTaken > 0) c0.convertTaken--;
      if (c0 && c0.wukongFormTurns > 0) c0.wukongFormTurns--;
      if (c0 && c0.guardFlat && c0.guardFlat.turns > 0) c0.guardFlat.turns--;
      if (c0 && c0.typePower && c0.typePower.turns > 0) c0.typePower.turns--;
      if (c0 && c0.perTurnPpZero && c0.perTurnPpZero.turns > 0) {
        var foePZ = self.activeOf(side === 'me' ? 'foe' : 'me');
        if (foePZ) {
          var cand2 = foePZ.skills.filter(function (s4) { return s4.pp > 0; });
          for (var zi = 0; zi < c0.perTurnPpZero.count && cand2.length; zi++) {
            var zk = cand2.splice(Math.floor(self.rng() * cand2.length), 1)[0];
            zk.pp = 0;
          }
        }
        c0.perTurnPpZero.turns--;
      }
      if (c0 && c0.blockCrit > 0) c0.blockCrit--;
      if (c0 && c0.itemFlip > 0) c0.itemFlip--;
      if (c0 && c0.statusSkillMiss > 0) c0.statusSkillMiss--;
      if (c0 && c0.punishByCategory && c0.punishByCategory.turns > 0) c0.punishByCategory.turns--;
      if (c0 && c0.punishStatSkill && c0.punishStatSkill.turns > 0) c0.punishStatSkill.turns--;
      if (c0 && c0.onHitReflectPct && c0.onHitReflectPct.turns > 0) c0.onHitReflectPct.turns--;
      if (c0 && c0.statusPriority && c0.statusPriority.turns > 0) c0.statusPriority.turns--;
      if (c0 && c0.immuneKindReflect && c0.immuneKindReflect.turns > 0) c0.immuneKindReflect.turns--;
      if (c0 && c0.perTurnFlat && c0.perTurnFlat.turns > 0) {
        var foePF = self.activeOf(side === 'me' ? 'foe' : 'me');
        var okPF = !c0.perTurnFlat.req || (c0.perTurnFlat.req.type === 'targetStatUp' ? hasStatUp(foePF) : (hasStatDown(c0) || !!c0.status));
        if (foePF && foePF.hp > 0 && okPF) {
          foePF.hp = Math.max(0, foePF.hp - c0.perTurnFlat.value);
          self.push('追加 ' + c0.perTurnFlat.value + ' 点固定伤害。');
        }
        c0.perTurnFlat.turns--;
      }
      if (c0 && c0.onHitStatUp && c0.onHitStatUp.turns > 0) c0.onHitStatUp.turns--;
      if (c0 && c0.genderImmune && c0.genderImmune.turns > 0) c0.genderImmune.turns--;
      if (c0 && c0.mirrorHeal && c0.mirrorHeal.turns > 0) c0.mirrorHeal.turns--;
      if (c0 && c0.perTurnDrain && c0.perTurnDrain.turns > 0) {
        var foeD = self.activeOf(side === 'me' ? 'foe' : 'me');
        if (foeD && foeD.hp > 0) {
          foeD.hp = Math.max(0, foeD.hp - c0.perTurnDrain.value);
          c0.hp = Math.min(c0.maxHp, c0.hp + c0.perTurnDrain.value);
        }
        c0.perTurnDrain.turns--;
      }
      if (c0 && c0.onHitMaxHpDown && c0.onHitMaxHpDown.turns > 0) c0.onHitMaxHpDown.turns--;
      if (c0 && c0.endDamagePerSpeed) {
        var foeES = self.activeOf(side === 'me' ? 'foe' : 'me');
        var spdUp = Math.max(0, c0.stages.spd);
        if (foeES && foeES.hp > 0 && spdUp > 0) {
          var esd = Math.max(1, Math.floor(foeES.maxHp * c0.endDamagePerSpeed.num / c0.endDamagePerSpeed.den * (spdUp / c0.endDamagePerSpeed.per)));
          foeES.hp = Math.max(0, foeES.hp - esd);
          self.push('速度压制，对手损失 ' + esd + ' 点体力。');
        }
      }
      if (c0 && c0.punishStatusSkill && c0.punishStatusSkill.turns > 0) c0.punishStatusSkill.turns--;
      if (c0 && c0.chanceImmuneReflect && c0.chanceImmuneReflect.turns > 0) c0.chanceImmuneReflect.turns--;
      if (c0 && c0.onHitPercentHp && c0.onHitPercentHp.turns > 0) c0.onHitPercentHp.turns--;
      if (c0 && c0.onHitHealChance && c0.onHitHealChance.turns > 0) c0.onHitHealChance.turns--;
      if (c0 && c0.drainTurns && c0.drainTurns.turns > 0) c0.drainTurns.turns--;
      if (c0 && c0.immuneAndReflect && c0.immuneAndReflect.turns > 0) c0.immuneAndReflect.turns--;
      if (c0 && c0.healOnFoeMiss && c0.healOnFoeMiss.turns > 0) c0.healOnFoeMiss.turns--;
      if (c0 && c0.buffDisabled > 0) c0.buffDisabled--;
      if (c0 && c0.skillBlockChance && c0.skillBlockChance.turns > 0) c0.skillBlockChance.turns--;
      if (c0 && c0.perTurnFlatByStats && c0.perTurnFlatByStats.turns > 0) {
        var foeFS = self.activeOf(side === 'me' ? 'foe' : 'me');
        if (foeFS && foeFS.hp > 0) {
          var fsd = Math.max(1, Math.floor((c0.stats.def + c0.stats.spDef) * c0.perTurnFlatByStats.pct / 100));
          fsd = self.directDamage(foeFS, fsd, 'percent');
          self.push('追加 ' + fsd + ' 点百分比伤害。');
        }
        c0.perTurnFlatByStats.turns--;
      }
      if (c0 && c0.perTurnPriorityDown && c0.perTurnPriorityDown.turns > 0) {
        var foePD2 = self.activeOf(side === 'me' ? 'foe' : 'me');
        if (foePD2) foePD2.priorityDown = { turns: 1, value: c0.perTurnPriorityDown.value };
        c0.perTurnPriorityDown.turns--;
      }
      if (c0 && c0.copyAtkTurns > 0) {
        c0.copyAtkTurns--;
        if (c0.copyAtkTurns <= 0 && c0.atkOriginal) { c0.stats.atk = c0.atkOriginal; c0.atkOriginal = 0; }
      }
      if (c0 && c0.mirrorStat > 0) c0.mirrorStat--;
      if (c0 && c0.perTurnSteal > 0) {
        var foePS = self.activeOf(side === 'me' ? 'foe' : 'me');
        if (foePS) {
          Object.keys(foePS.stages).forEach(function (k14) {
            if (foePS.stages[k14] > 0) {
              c0.stages[k14] = clampStage(c0.stages[k14] + foePS.stages[k14]);
              foePS.stages[k14] = 0;
            }
          });
        }
        c0.perTurnSteal--;
      }
      if (c0 && c0.perTurnStealStats && c0.perTurnStealStats.turns > 0) {
        var foePSS = self.activeOf(side === 'me' ? 'foe' : 'me');
        if (foePSS) {
          var ks = Object.keys(foePSS.stages).filter(function (kk) { return foePSS.stages[kk] > -6; });
          for (var pi2 = 0; pi2 < c0.perTurnStealStats.count && ks.length; pi2++) {
            var kp2 = ks.splice(Math.floor(self.rng() * ks.length), 1)[0];
            foePSS.stages[kp2] = clampStage(foePSS.stages[kp2] - c0.perTurnStealStats.stages);
            c0.stages[kp2] = clampStage(c0.stages[kp2] + c0.perTurnStealStats.stages);
          }
        }
        c0.perTurnStealStats.turns--;
      }
      if (c0 && c0.immuneCritReflect > 0) c0.immuneCritReflect--;
      if (c0 && c0.ignoreDefPctTurns && c0.ignoreDefPctTurns.turns > 0) c0.ignoreDefPctTurns.turns--;
      if (c0 && c0.perTurnStatUp && c0.perTurnStatUp.turns > 0) {
        c0.perTurnStatUp.stats.forEach(function (st2) {
          c0.stages[st2] = clampStage(c0.stages[st2] + c0.perTurnStatUp.stages);
        });
        c0.perTurnStatUp.turns--;
      }
      if (c0 && c0.perTurnStatDown2 && c0.perTurnStatDown2.turns > 0) {
        var foePD = self.activeOf(side === 'me' ? 'foe' : 'me');
        if (foePD) {
          c0.perTurnStatDown2.stats.forEach(function (st3) {
            foePD.stages[st3] = clampStage(foePD.stages[st3] - c0.perTurnStatDown2.stages);
          });
        }
        c0.perTurnStatDown2.turns--;
      }
      if (c0 && c0.endInvertFoe) {
        c0.endInvertFoe--;
        var foeIv = self.activeOf(side === 'me' ? 'foe' : 'me');
        if (foeIv) {
          Object.keys(foeIv.stages).forEach(function (k11) {
            if (foeIv.stages[k11] > 0) foeIv.stages[k11] = -foeIv.stages[k11];
          });
        }
      }
      if (c0 && c0.endDamageIfStatus) {
        var foeDS = self.activeOf(side === 'me' ? 'foe' : 'me');
        if (foeDS && foeDS.status && foeDS.hp > 0) {
          var ed = Math.max(1, Math.floor(foeDS.maxHp * c0.endDamageIfStatus.num / c0.endDamageIfStatus.den));
          foeDS.hp = Math.max(0, foeDS.hp - ed);
          self.push('异常状态让 ' + foeDS.pet.name + ' 损失 ' + ed + ' 点体力。');
        }
      }
      if (c0 && c0.typeSwap) {
        c0.typeSwap.turns--;
        if (c0.typeSwap.turns <= 0) {
          c0.combo = c0.typeOriginal || c0.combo;
          if (c0.typeSwap.partner) {
            var pp2 = c0.typeSwap.partner;
            pp2.combo = pp2.typeOriginal || pp2.combo;
          }
          c0.typeSwap = null;
        }
      }
      if (c0 && c0.onHitDamageUp && c0.onHitDamageUp > 0) c0.onHitDamageUp--;
      if (c0 && c0.perTurnStatDown && c0.perTurnStatDown.turns > 0) {
        var foeSt = self.activeOf(side === 'me' ? 'foe' : 'me');
        if (foeSt) foeSt.stages[c0.perTurnStatDown.stat] = clampStage(foeSt.stages[c0.perTurnStatDown.stat] - c0.perTurnStatDown.stages);
        c0.perTurnStatDown.turns--;
      }
      if (c0 && c0.copyDefTurns > 0) c0.copyDefTurns--;
      if (c0 && c0.delayedKill) {
        if ((self.turn || 0) >= c0.delayedKill.due) {
          var foeDK = self.activeOf(side === 'me' ? 'foe' : 'me');
          if (foeDK && foeDK.hp > 0) {
            foeDK.hp = 0;
            self.push(c0.pet.name + ' 的镇魂曲生效，' + foeDK.pet.name + ' 倒下了！');
          }
          c0.delayedKill = null;
        }
      }
      if (c0 && c0.priorityCond) c0.priorityCond = null;
    });
    ['me', 'foe'].forEach(function (side) {
      var c = self.activeOf(side);
      if (!c || c.hp <= 0) return;

      // 天启星魂：星赐/星哲递减；异常结束转星盘；回返期覆宙星回
      if (c.junWei) {
        var foesideJW = c.side === 'me' ? 'foe' : 'me';
        var ownAlive = (self[c.side].team || []).filter(function (x) { return x && x.hp > 0; }).length;
        var foeAlive = (self[foesideJW].team || []).filter(function (x) { return x && x.hp > 0; }).length;
        if (ownAlive === 1) c.starRoundLock = Math.max(c.starRoundLock || 0, 1);
        var foeJW = self.activeOf(foesideJW);
        if (foeAlive === 1 && foeJW) foeJW.healBlock = Math.max(foeJW.healBlock || 0, 1);
      }
      if (c.starGift > 0) c.starGift--;
      if (c.starPhil > 0) c.starPhil--;
      if (c.starGuard > 0) c.starGuard--;
      if (c.starRoundLock > 0) c.starRoundLock--;
      if (c.mistikeNoDebuff > 0) c.mistikeNoDebuff--;
      if (c.statDownLock > 0) c.statDownLock--;
      if (c.lockStacks > 0 && c.lockAddedTurn !== self.turn) {
        c.lockStacks--;
        if (c.lockStacks <= 0) c.lockStacks = 0;
      }
      if (c.mistikeSoul && c.mistikeEntryTurn === self.turn && !c.mistikeFoeActed) {
        var lockFoe = self.activeOf(side === 'me' ? 'foe' : 'me');
        if (lockFoe) {
          var lockAdd = Math.min(2, Math.max(0, 3 - (lockFoe.lockStacks || 0)));
          lockFoe.lockStacks = (lockFoe.lockStacks || 0) + lockAdd;
          lockFoe.lockAddedTurn = self.turn;
          if (lockAdd) self.push('秘：对手当回合未出手，附加 ' + lockAdd + ' 道蚩庸之锁。');
        }
      }
      c.mistikeEntryTurn = 0;
      if (c.starRageChanceTurns > 0) {
        c.starRageChanceTurns--;
        if (c.starRageChanceTurns <= 0) c.starRageChanceBonus = 0;
      }
      if (c.drain3291 && c.drain3291.turns > 0) {
        var drainFoe = self.activeOf(side === 'me' ? 'foe' : 'me');
        if (drainFoe && drainFoe.hp > 0) {
          var dnum = c.drain3291.num;
          var dden = c.drain3291.den;
          if (c.hp < c.maxHp / 2) dnum *= 2;
          var drainAmt = Math.max(1, Math.floor(drainFoe.maxHp * dnum / dden));
          drainAmt = Math.min(drainAmt, drainFoe.hp);
          drainFoe.hp -= drainAmt;
          c.hp = Math.min(c.maxHp, c.hp + drainAmt);
          self.push(self.tag(side) + '命宇轮回吸取了 ' + drainAmt + ' 点体力。');
        }
        c.drain3291.turns--;
        if (c.drain3291.turns <= 0) c.drain3291 = null;
      }
      if (c.lowPowerBlock) c.lowPowerBlock = false;
      if (c.teLowPower && c.teLowPower.turns > 0) { c.teLowPower.turns--; if (c.teLowPower.turns <= 0) c.teLowPower = null; }
      if (c.teAttrTrigger && c.teAttrTrigger.turns > 0) { c.teAttrTrigger.turns--; if (c.teAttrTrigger.turns <= 0) c.teAttrTrigger = null; }
      if (c.teStatDown && c.teStatDown.turns > 0) {
        var tsdFoe = self.activeOf(side === 'me' ? 'foe' : 'me');
        if (tsdFoe && tsdFoe.hp > 0) {
          c.teStatDown.stats.forEach(function (st) { tsdFoe.stages[st] = clampStage(tsdFoe.stages[st] + c.teStatDown.value); });
          self.push(self.tag(side) + '回合类效果：对手 ' + c.teStatDown.stats.map(function (st) { return STAT_LABEL[st]; }).join('/') + ' ' + c.teStatDown.value + '。');
        }
        c.teStatDown.turns--;
        if (c.teStatDown.turns <= 0) c.teStatDown = null;
      }
      if (c.teDrain && c.teDrain.turns > 0) {
        var tdFoe = self.activeOf(side === 'me' ? 'foe' : 'me');
        if (tdFoe && tdFoe.hp > 0 && c.hp > 0) {
          var tdDmg = Math.max(1, Math.floor(tdFoe.maxHp / c.teDrain.den));
          if (c.teDrain.lowHalf && c.hp * c.teDrain.lowHalf < c.maxHp) tdDmg *= 2;
          var tdBefore = tdFoe.hp;
          tdDmg = self.directDamage(tdFoe, tdDmg, 'percent');
          var tdHeal = Math.min(tdDmg, c.maxHp - c.hp);
          if (tdHeal > 0) c.hp += tdHeal;
          self.push(self.tag(side) + '回合类效果：吸取 ' + tdDmg + ' 点体力。');
          if (tdFoe.hp === tdBefore && c.teDrain.bench > 0) {
            (c.side === 'me' ? self.me : self.foe).team.forEach(function (ally) {
              if (ally !== c && ally.hp > 0) ally.hp = Math.min(ally.maxHp, ally.hp + c.teDrain.bench);
            });
            self.push('对手体力未减少：己方场下精灵各恢复 ' + c.teDrain.bench + ' 点体力。');
          }
        }
        c.teDrain.turns--;
        if (c.teDrain.turns <= 0) c.teDrain = null;
      }
      if (c.drain4676 && c.drain4676.turns > 0) {
        var drainFoe2 = self.activeOf(side === 'me' ? 'foe' : 'me');
        if (drainFoe2 && drainFoe2.hp > 0) {
          var dnum2 = c.drain4676.num;
          if (c.hp < c.maxHp / 2) dnum2 *= 2;
          var drainAmt2 = Math.max(1, Math.floor(drainFoe2.maxHp * dnum2 / c.drain4676.den));
          var beforeHp2 = drainFoe2.hp;
          drainAmt2 = Math.min(drainAmt2, drainFoe2.hp);
          drainFoe2.hp -= drainAmt2;
          c.hp = Math.min(c.maxHp, c.hp + drainAmt2);
          self.push(self.tag(side) + '魂劫骇咒吸取了 ' + drainAmt2 + ' 点体力。');
          if (beforeHp2 === drainFoe2.hp) {
            var own2 = self[side].team;
            own2.forEach(function (b2) {
              if (b2 && b2 !== self.activeOf(side) && b2.hp > 0) b2.hp = Math.min(b2.maxHp, b2.hp + 200);
            });
          }
        }
        c.drain4676.turns--;
        if (c.drain4676.turns <= 0) c.drain4676 = null;
      }
      if (c.starDialCfg) {
        var rotated = false;
        if (c.starStatusEnded || (c.starHadStatus && !c.status)) {
          c.starStatusEnded = false;
          rotated = self.starRotate(c);
        }
        if (c.starReEntryDue && self.turn >= c.starReEntryDue) {
          c.starReEntryDue = 0;
          self.starInit(c);
        }
        if (c.starWasReturn && c.starReturn && !rotated && c.starDial > 0) {
          var rDmg = Math.max(1, c.starDialCfg.returnDmg || 120);
          var foeStar = self.activeOf(side === 'me' ? 'foe' : 'me');
          if (foeStar && foeStar.hp > 0) {
            foeStar.hp = Math.max(0, foeStar.hp - rDmg);
            self.push(self.tag(side) + c.pet.name + ' 触发覆宙星回：' + rDmg + ' 点真实伤害，星盘回返 1 刻。');
          }
          c.starDial--;
          if (c.starDial <= 0) {
            c.starReturn = false;
            self.push(self.tag(side) + c.pet.name + ' 的星盘回返至 0。');
          }
        }
        if (c.starPpZero) {
          c.starPpZero = false;
          var foePp = self.activeOf(side === 'me' ? 'foe' : 'me');
          if (foePp) {
            var ppCand = foePp.skills.filter(function (sl) { return sl.pp > 0; });
            if (ppCand.length) {
              ppCand[Math.floor(self.rng() * ppCand.length)].pp = 0;
              self.push(self.tag(side) + '的星盘余威令对手 1 项技能 PP 归零。');
            }
          }
        }
      }

      // 神印：主动换人后的首个战斗阶段结束时，按层数受到启灵元神最大体力的真实伤害
      if (c.holyMarks > 0 && c.holyMarkDue === self.turn) {
        var ratio = c.holyMarks >= 3 ? 4 : (c.holyMarks === 2 ? 6 : 8);
        var mDmg = Math.max(1, Math.floor((c.holyMarkSrcMax || 0) / ratio));
        c.hp = Math.max(0, c.hp - mDmg);
        self.push(self.tag(side) + c.pet.name + ' 的神圣印记爆发，受到 ' + mDmg + ' 点真实伤害（' + Math.min(3, c.holyMarks) + ' 层）。');
        c.holyMarkDue = 0;
      }

      // 沙悟净：战斗阶段结束的递增固伤（150 起，每回合 +100，最高 250；对手有强化时翻倍）
      if (c.endRampFlat) {
        var foeER = self.activeOf(side === 'me' ? 'foe' : 'me');
        if (foeER && foeER.hp > 0) {
          var erVal = Math.min(c.endRampFlat.cap || 99999, (c.endRampFlat.base || 0) + (c.endRampFlat.inc || 0) * (c.endRampTurns || 0));
          if (c.endRampFlat.dbl && hasStatUp(foeER)) erVal *= 2;
          var erHit = self.resistDamage(foeER, erVal, 'fixed');
          if (erHit <= 0) {
            self.push(foeER.pet.name + ' 的抗性免疫了固定伤害。');
          } else {
            foeER.hp = Math.max(0, foeER.hp - erHit);
            self.push(self.tag(side) + c.pet.name + ' 的战斗阶段结束效果：追加 ' + erHit + ' 点固定伤害。');
          }
        }
        c.endRampTurns = (c.endRampTurns || 0) + 1;
      }

      // 马尔修斯坚壁：战斗阶段结束时护盾未激活则回复最大体力 1/3
      if (c.morphGuard && !c.shieldActive && c.hp > 0 && c.hp < c.maxHp) {
        var mgHeal = Math.min(Math.floor(c.maxHp * (c.morphGuard.healNum || 1) / (c.morphGuard.healDen || 3)), c.maxHp - c.hp);
        if (mgHeal > 0) {
          c.hp += mgHeal;
          self.push(self.tag(side) + c.pet.name + ' 的坚壁形态恢复了 ' + mgHeal + ' 点体力。');
        }
      }

      // 王·雷伊（3142）魂印「雷」：回合开始体力高 → 回合末强化；回合结束再吸一次
      if (c.leiEndBoost && c.leiEndBoostLead) {
        c.leiEndBoostLead = false;
        var leiN = 0;
        ['atk', 'spd', 'acc'].forEach(function (kk) {
          var addL = kk === 'atk' ? c.leiEndBoost.atk : (kk === 'spd' ? c.leiEndBoost.spd : c.leiEndBoost.acc);
          if (addL > 0) { c.stages[kk] = clampStage(c.stages[kk] + addL); leiN += addL; }
        });
        if (leiN) self.push(self.tag(side) + c.pet.name + ' 的魂印在战斗阶段结束时强化了 ' + leiN + ' 级。');
      }
      if (c.leiEndBoost && c.leiEndBoostLead === false && c.leiSteal) {
        var foeLS = self.activeOf(side === 'me' ? 'foe' : 'me');
        if (foeLS && foeLS.hp > 0) self.leiStealBoosts(c, foeLS);
      }
      if (c.capOnStatus && c.capOnStatus.turns > 0) c.capOnStatus.turns--;
      if (c.ppZeroOnFoeAtk && c.ppZeroOnFoeAtk.turns > 0) c.ppZeroOnFoeAtk.turns--;
      if (c.onHitStatus && c.onHitStatus.turns != null) {
        c.onHitStatus.turns--;
        if (c.onHitStatus.turns <= 0) c.onHitStatus = null;
      }
      if (c.attackHitStatus) {
        c.attackHitStatus.turns--;
        if (c.attackHitStatus.turns <= 0) c.attackHitStatus = null;
      }
      if (c.attrBlockIfHit) {
        c.attrBlockIfHit.turns--;
        if (c.attrBlockIfHit.turns <= 0) c.attrBlockIfHit = null;
      }
      // 3541 魂印：体力低于 1/2 时回合末回复
      if (c.pendingHalfHeal && c.hp > 0 && c.healBlock <= 0) {
        var phh = Math.min(Math.floor(c.maxHp * c.pendingHalfHeal.num / c.pendingHalfHeal.den), c.maxHp - c.hp);
        c.pendingHalfHeal = null;
        if (phh > 0) { c.hp += phh; self.push(self.tag(side) + '魂印：恢复 ' + phh + ' 点体力。'); }
      }
      // 3539 魂印：回合末令对手害怕 / 未闪避则附加攻击值百分比伤害
      self.resolveEndTurnFear(side, c);
      if (c.dodgeFailedThisTurn) {
        c.dodgeFailedThisTurn = false;
        var foeC5 = self.activeOf(side === 'me' ? 'foe' : 'me');
        if (foeC5 && foeC5.hp > 0 && c.hp > 0) {
          var cdv = Math.max(1, Math.floor((c.stats.atk || 0) * c.dodgeCounterPct / 100));
          var cdh = self.directDamage(foeC5, cdv, 'percent');
          self.push(self.tag(side) + '魂印：未闪避，附加 ' + cdh + ' 点百分比伤害。');
        }
      }
      // 3514 魂印：体力低于对手，回合末吸取对手最大体力
      if (c.endDrainIfLow && c.hp > 0) {
        var foeD5 = self.activeOf(side === 'me' ? 'foe' : 'me');
        if (foeD5 && foeD5.hp > 0 && c.hp < foeD5.hp) {
          var drVal = Math.max(1, Math.floor(foeD5.maxHp * c.endDrainIfLow.num / c.endDrainIfLow.den));
          var drHit = self.directDamage(foeD5, drVal, 'percent');
          var drHeal = Math.min(drHit, c.maxHp - c.hp);
          if (drHeal > 0) c.hp += drHeal;
          self.push(self.tag(side) + '魂印：吸取对手 ' + drHit + ' 点体力（回复 ' + drHeal + '）。');
        }
      }
      // 3482 魂印：属性技后回血 + 等量百分比伤害（低血翻倍）
      if (c.pendingStatusHeal && c.hp > 0 && c.healBlock <= 0) {
        var psh = c.pendingStatusHeal;
        c.pendingStatusHeal = null;
        var pshMul = (psh.doubleLow && c.hp < c.maxHp / 2) ? 2 : 1;
        var pshHeal = Math.min(Math.floor(c.maxHp * psh.num * pshMul / psh.den), c.maxHp - c.hp);
        if (pshHeal > 0) {
          c.hp += pshHeal;
          self.push(self.tag(side) + '魂印：恢复 ' + pshHeal + ' 点体力。');
          var foeP = self.activeOf(side === 'me' ? 'foe' : 'me');
          if (foeP && foeP.hp > 0) {
            var hitP = self.directDamage(foeP, pshHeal, 'percent');
            self.push(self.tag(side) + '魂印：造成 ' + hitP + ' 点等量百分比伤害。');
          }
        }
      }
      // 3482 魂印：体力低于对手时按当回合造成伤害回血 + 等量百分比伤害
      if (c.endHealByDealtActive && c.hp > 0 && c.lastDealt > 0) {
        var ebd = Math.min(c.lastDealt, c.maxHp - c.hp);
        if (ebd > 0) {
          c.hp += ebd;
          self.push(self.tag(side) + '魂印：恢复等同于造成伤害的 ' + ebd + ' 点体力。');
          var foeQ = self.activeOf(side === 'me' ? 'foe' : 'me');
          if (foeQ && foeQ.hp > 0) {
            var hitQ = self.directDamage(foeQ, ebd, 'percent');
            self.push(self.tag(side) + '魂印：造成 ' + hitQ + ' 点等量百分比伤害。');
          }
        }
      }
      // 3414 魂印：回合末有强化则回血 + 等量百分比伤害（上限为已损失体力）
      if (c.endHealIfUp && c.hp > 0 && c.healBlock <= 0) {
        var hasUpE = ['atk', 'def', 'spAtk', 'spDef', 'spd', 'acc', 'eva'].some(function (k15) { return c.stages[k15] > 0; });
        if (hasUpE) {
          var lostE = c.maxHp - c.hp;
          var healE = Math.min(Math.floor(c.maxHp * c.endHealIfUp.num / c.endHealIfUp.den), lostE);
          if (healE > 0) {
            c.hp += healE;
            self.push(self.tag(side) + '魂印：恢复 ' + healE + ' 点体力。');
            var foeE3 = self.activeOf(side === 'me' ? 'foe' : 'me');
            if (foeE3 && foeE3.hp > 0) {
              var hitE3 = self.directDamage(foeE3, healE, 'percent');
              self.push(self.tag(side) + '魂印：附加 ' + hitE3 + ' 点等量百分比伤害。');
            }
          }
        }
      }
      // 3421 魂印：回合末低血回复 + 等量百分比伤害
      if (c.endHealLowPct && c.hp > 0 && c.hp < c.maxHp / 2 && c.healBlock <= 0) {
        var ehl = Math.min(Math.floor(c.maxHp * c.endHealLowPct.num / c.endHealLowPct.den), c.maxHp - c.hp);
        if (ehl > 0) {
          c.hp += ehl;
          self.push(self.tag(side) + '魂印：恢复 ' + ehl + ' 点体力。');
          var foeE2 = self.activeOf(side === 'me' ? 'foe' : 'me');
          if (foeE2 && foeE2.hp > 0) {
            var hitE2 = self.directDamage(foeE2, ehl, 'percent');
            self.push(self.tag(side) + '魂印：造成 ' + hitE2 + ' 点等量百分比伤害。');
          }
        }
      }
      if (c.regenShield > 0) c.shield += c.regenShield;
      if (c.regenPerSibling) {
        // 桃园三结义：只统计刘备 / 关羽 / 张飞三兄弟（诸葛不占层数，只提升每层回复）
        var GROUP_NAMES = { '三兄弟': ['刘备', '关羽', '张飞'] };
        var names5 = GROUP_NAMES[c.regenPerSibling.group] || [];
        var cnt5 = 0;
        names5.forEach(function (n5) {
          var roster5 = self[c.side].team.concat(self.reserve[c.side] || []);
          if (roster5.some(function (m5) { return m5 && m5.pet && (m5.pet.name || '').indexOf(n5) >= 0; })) cnt5++;
        });
        if (cnt5 > 0) {
          var per5 = self.auraHeal(c.side, c, c.regenPerSibling.value);
          var hv5 = per5 * cnt5;
          var cap5 = c.regenPerSibling.cap || 0;
          var aur5 = self.benchAuras && self.benchAuras[c.side];
          if (aur5 && aur5.healFix) {
            aur5.healFix.forEach(function (h5) {
              var applies = !h5.names || !h5.names.length || h5.names.some(function (n5) { return normName(c.pet.name).indexOf(normName(n5)) >= 0; });
              if (applies && h5.cap) cap5 = Math.max(cap5, h5.cap);
            });
          }
          if (cap5) hv5 = Math.min(hv5, cap5);
          var add5 = Math.min(hv5, c.maxHp - c.hp);
          if (add5 > 0) { c.hp += add5; self.push(self.tag(side) + '恢复了 ' + add5 + ' 点体力（桃园结义）。'); }
        }
      }
      if (hasStack(c, 3)) {
        var h3 = Math.min(Math.floor(c.maxHp / 3), c.maxHp - c.hp);
        if (h3 > 0) { c.hp += h3; self.push(self.tag(side) + '恢复了 ' + h3 + ' 点体力（神耀）。'); }
      }
      if (hasStack(c, 4)) c.immuneFixedPct = true;
      if (c.endClearStatus && c.status) {
        c.status = null;
        self.push(self.tag(side) + '的异常状态被解除了。');
      }
      if (c.foeHealEnd) {
        var foeHE = self.activeOf(side === 'me' ? 'foe' : 'me');
        if (foeHE && foeHE.hp > 0) {
          var heh = Math.min(Math.floor(foeHE.maxHp * c.foeHealEnd.num / c.foeHealEnd.den), foeHE.maxHp - foeHE.hp);
          if (heh > 0) foeHE.hp += heh;
        }
        c.foeHealEnd = null;
      }
      if (c.endHealCond && hasStatUp(c)) {
        var ehc = Math.min(c.endHealCond, c.maxHp - c.hp);
        if (ehc > 0) { c.hp += ehc; self.push(self.tag(side) + '恢复了 ' + ehc + ' 点体力。'); }
      }
      if (c.mirrorHeal && c.mirrorHeal.turns > 0 && c.healedThisTurn) {
        var mh2 = Math.floor(c.healedThisTurn * c.mirrorHeal.num / c.mirrorHeal.den);
        if (mh2 > 0 && c.maxHp - c.hp > 0) {
          c.hp += Math.min(mh2, c.maxHp - c.hp);
          self.push(self.tag(side) + '同步恢复了体力。');
        }
      }
      if (c.regenRandom && c.regenRandom.turns > 0) {
        var rrHp = Math.floor(c.regenRandom.min + self.rng() * (c.regenRandom.max - c.regenRandom.min + 1));
        rrHp = Math.min(rrHp, c.maxHp - c.hp);
        if (rrHp > 0) { c.hp += rrHp; self.push(self.tag(side) + '恢复了 ' + rrHp + ' 点体力。'); }
        c.regenRandom.turns--;
      }
      if (c.critBuffTurns > 0) c.critBuffTurns--;
      if (c.priorityBuff && c.priorityBuff.turns > 0) c.priorityBuff.turns--;
      if (c.reflectStatus > 0) c.reflectStatus--;
      if (c.firstReviveTurn && c.firstReviveTurn !== self.turn) c.firstReviveTurn = 0;
      c.rampActive = false;   // 佛晓跃金破式「当回合」增伤，回合末失效
      if (c.damageBuff && c.damageBuff.turns > 0) c.damageBuff.turns--;

      // 「失明」是异常状态但不是控制类：回合末按回合数递减，不清行动
      if (c.status && c.status.id === 'blind') {
        c.status.turns--;
        if (c.status.turns <= 0) { c.status = null; self.push(self.tag(side) + c.pet.name + ' 的失明解除了。'); }
      }

      if (c.status) {
        var def = STATUS_DEF[c.status.id];
        if (def && def.tick) {
          var dmg = Math.max(1, Math.floor(c.maxHp / def.tick));
          c.hp = Math.max(0, c.hp - dmg);
          self.push(self.tag(side) + c.pet.name + ' 受到' + def.name + '伤害 ' + dmg + ' 点。');
        }
      }

      if (c.dot && c.dot.turns > 0 && c.hp > 0) {
        c.hp = Math.max(0, c.hp - c.dot.value);
        self.push(self.tag(side) + c.pet.name + ' 受到持续伤害 ' + c.dot.value + ' 点。');
        c.dot.turns--;
        if (c.dot.turns <= 0) c.dot = null;
      }

      // 魂印每回合回复
      if ((c.regen || c.regenRatio) && c.hp > 0 && c.hp < c.maxHp) {
        var rg = Math.floor((c.regen || 0) + c.maxHp * (c.regenRatio || 0));
        if (rg > 0) {
          var ah = Math.min(rg, c.maxHp - c.hp);
          c.hp += ah;
          self.push(self.tag(side) + '的魂印恢复了 ' + ah + ' 点体力。');
        }
      }

      // 魂印：回合结束的回血 / 回 PP / 百分比伤害
      if (c.endHealNum && c.hp > 0 && c.hp < c.maxHp) {
        var eh = Math.min(Math.floor(c.maxHp * c.endHealNum / (c.endHealDen || 1)), c.maxHp - c.hp);
        if (eh > 0) {
          c.hp += eh;
          self.push(self.tag(side) + '的魂印恢复了 ' + eh + ' 点体力。');
        }
      }
      // 测试模式：手动添加的回合类效果「每回合回复 1/3 体力」（持续 N 回合）
      if (c.teHeal && c.teHeal.turns > 0) {
        if (c.hp > 0 && c.hp < c.maxHp) {
          var teh = Math.min(Math.floor(c.maxHp * c.teHeal.pct), c.maxHp - c.hp);
          if (teh > 0) {
            c.hp += teh;
            self.push(self.tag(side) + '的回合类效果回复了 ' + teh + ' 点体力（剩 ' + c.teHeal.turns + ' 回合）。');
          }
        }
        c.teHeal.turns--;
        if (c.teHeal.turns <= 0) {
          c.teHeal = null;
          self.push(self.tag(side) + '的回合类效果结束了。');
        }
      }
      if (c.endPpRestore) {
        var restored = 0;
        c.skills.forEach(function (sl) {
          if (restored >= c.endPpRestore) return;
          if (sl.pp < sl.maxPp) { sl.pp++; restored++; }
        });
      }
      if (c.endDamageLost) {
        var foeC = self.activeOf(side === 'me' ? 'foe' : 'me');
        if (foeC && foeC.hp > 0) {
          var pd = Math.floor((c.maxHp - c.hp) * c.endDamageLost);
          if (pd > 0) {
            pd = self.directDamage(foeC, pd, 'percent');
            self.push(self.tag(side) + '的魂印造成 ' + pd + ' 点百分比伤害。');
          }
        }
      }

      // 条件型魂印：若…则… / 满体力时… 的回合结束效果
      if (c.condPassives && c.condPassives.length) {
        var cctx2 = { actor: c, target: self.activeOf(side === 'me' ? 'foe' : 'me'), turn: self.turn, isFirst: false };
        c.condPassives.forEach(function (p) {
          var f = p.fx || {};
          if (!checkCond(p.req, cctx2)) return;
          if (f.kind === 'regen' || f.kind === 'endHeal') {
            var amt = f.kind === 'regen' ? f.value : Math.floor(c.maxHp * f.num / (f.den || 1));
            if (c.hp > 0 && c.hp < c.maxHp && amt > 0) {
              var hh = Math.min(amt, c.maxHp - c.hp);
              c.hp += hh;
              self.push(self.tag(side) + '的魂印恢复了 ' + hh + ' 点体力。');
            }
          } else if (f.kind === 'regenRatio') {
            if (c.hp > 0 && c.hp < c.maxHp) {
              var h2 = Math.min(Math.floor(c.maxHp * f.num / f.den), c.maxHp - c.hp);
              if (h2 > 0) {
                c.hp += h2;
                self.push(self.tag(side) + '的魂印恢复了 ' + h2 + ' 点体力。');
              }
            }
          } else if (f.kind === 'endDamageLost') {
            var foeC2 = cctx2.target;
            if (foeC2 && foeC2.hp > 0) {
              var d2 = Math.floor((c.maxHp - c.hp) * f.value);
              if (d2 > 0) {
                d2 = self.directDamage(foeC2, d2, 'percent');
                self.push(self.tag(side) + '的魂印造成 ' + d2 + ' 点百分比伤害。');
              }
            }
          }
        });
      }

      // 延迟固定伤害到期结算
      if (c.delayed && c.delayed.length) {
        var due = [];
        c.delayed = c.delayed.filter(function (d) {
          if (d.dueTurn > self.turn) return true;
          due.push(d);
          return false;
        });
        var foeD = self.activeOf(side === 'me' ? 'foe' : 'me');
        due.forEach(function (d) {
          if (foeD && foeD.hp > 0) {
            foeD.hp = Math.max(0, foeD.hp - d.value);
            self.push(self.tag(side) + '的延迟效果造成 ' + d.value + ' 点固定伤害。');
          }
        });
      }

      // 场地效果
      if (self.field) {
        if (self.field.healPerTurn && c.hp > 0 && c.hp < c.maxHp) {
          var fh = Math.min(self.field.healPerTurn, c.maxHp - c.hp);
          c.hp += fh;
          self.push(self.tag(side) + '受场地效果恢复 ' + fh + ' 点体力。');
        }
        if (self.field.ppRestore) {
          c.skills.forEach(function (sl) { sl.pp = Math.min(sl.maxPp, sl.pp + self.field.ppRestore); });
        }
      }

      // 护盾类状态的回合数递减
      if (c.immuneStatus > 0) c.immuneStatus--;
      if (c.immuneStat > 0) c.immuneStat--;
      if (c.immuneBelow) {
        c.immuneBelow.turns--;
        if (c.immuneBelow.turns <= 0) c.immuneBelow = null;
      }
      if (c.thorns) {
        c.thorns.turns--;
        if (c.thorns.turns <= 0) c.thorns = null;
      }
      if (c.guards.length) {
        c.guards.forEach(function (g) { g.turns--; });
        c.guards = c.guards.filter(function (g) { return g.turns > 0; });
      }
      if (c.pendingRestore) {
        var snap = c.pendingRestore;
        c.hp = Math.min(snap.hp, c.maxHp);
        c.stages = JSON.parse(JSON.stringify(snap.stages));
        c.skills.forEach(function (sl, i) { if (snap.pp[i] != null) sl.pp = snap.pp[i]; });
        c.pendingRestore = null;
        self.push(self.tag(side) + '的魂印回到了本回合开始时的状态。');
      }
    });

    // 场地持续回合递减
    if (this.field && this.field.turns > 0) {
      this.field.turns--;
      if (this.field.turns <= 0) this.clearField();
    }

    this.resolveDtzfSoul();
    this.checkFaints();
  };

  Battle.prototype.pickAiSwitch = function () {
    var foe = this.foe;
    var me = this.activeOf('me');
    var best = -1;
    var bestScore = -Infinity;
    var self = this;
    foe.team.forEach(function (c, i) {
      if (i === foe.active || c.hp <= 0) return;
      var score = self.matchupScore(c, me) + (c.hp / c.maxHp) * 2;
      if (score > bestScore) { bestScore = score; best = i; }
    });
    return best;
  };

  Battle.prototype.bestOffense = function (c, targetCombo) {
    var best = 0;
    for (var i = 0; i < c.skills.length; i++) {
      var sk = c.skills[i].skill;
      if (num(sk.power) <= 0) continue;
      var eff = effMul(this.chart, comboElements(this.comboOf(sk.type && sk.type.id)), comboElements(targetCombo));
      var val = num(sk.power) * eff;
      if (val > best) best = val;
    }
    return best;
  };

  Battle.prototype.matchupScore = function (c, target) {
    if (!target) return 0;
    var mine = this.bestOffense(c, target.combo);
    var theirs = this.bestOffense(target, c.combo);
    return (mine || 1) / Math.max(1, theirs || 1);
  };

  Battle.prototype.scoreSkill = function (actor, target, skill) {
    if (num(skill.power) > 0) {
      var r = calcDamage({
        actor: actor,
        target: target,
        skill: skill,
        skillCombo: this.comboOf(skill.type && skill.type.id),
        actorCombo: actor.combo,
        targetCombo: target.combo,
        chart: this.chart,
        level: actor.level || this.level,
        rng: function () { return 0.5; }
      });
      return r.damage;
    }
    return 25; // 变化技能给一个基础分
  };

  Battle.prototype.aiChoose = function () {
    var foe = this.activeOf('foe');
    var me = this.activeOf('me');
    if (!foe || foe.hp <= 0) return { type: 'pass' };

    var usable = [];
    for (var i = 0; i < foe.skills.length; i++) if (foe.skills[i].pp > 0) usable.push(i);
    if (!usable.length) return { type: 'pass' };

    if (this.difficulty === 'easy') {
      return { type: 'skill', index: usable[Math.floor(this.rng() * usable.length)] };
    }

    var bestIdx = usable[0];
    var bestScore = -Infinity;
    for (var j = 0; j < usable.length; j++) {
      var sc = this.scoreSkill(foe, me, foe.skills[usable[j]].skill);
      if (sc > bestScore) { bestScore = sc; bestIdx = usable[j]; }
    }

    if (this.difficulty === 'hard' && me && foe.hp / foe.maxHp < 0.35) {
      var idx = this.pickAiSwitch();
      if (idx >= 0) {
        var cur = this.matchupScore(foe, me);
        var alt = this.matchupScore(this.foe.team[idx], me);
        if (alt > cur * 1.5) return { type: 'switch', index: idx };
      }
    }
    return { type: 'skill', index: bestIdx };
  };

  Battle.prototype.perform = function (side, action, ctx) {
    var actor = this.activeOf(side);
    if (!actor || actor.hp <= 0) return;

    if (!action || action.type === 'pass') {
      this.push(this.tag(side) + '按兵不动。');
      return;
    }
    if (action.type === 'switch') {
      var team = this[side].team;
      var t = team[action.index];
      if (!t || t.hp <= 0 || action.index === this[side].active) return;
      if (actor.status && actor.status.id === 'bind') {
        this.push(this.tag(side) + '处于束缚状态，无法主动换人。');
        return;
      }
      if (actor.blockSwitch > 0) {
        this.push(this.tag(side) + '被封锁了主动切换，无法换人。');
        return;
      }
      if (this.isExiled(side, action.index)) {
        this.push(this.tag(side) + t.pet.name + ' 被神秘结界放逐，本回合无法主动切换上场。');
        return;
      }
      this[side].active = action.index;
      t.stages = freshStages();
      this.push(this.tag(side) + '换上了 ' + t.pet.name + '！');
      this.onEnter(t);
      this.addHolyMarks(side, t);
      return;
    }
    if (action.type === 'item') { this.useItem(side, action.id); return; }
    if (action.type === 'skill') this.useSkill(side, action.index, ctx);
  };

  /** 清掉一只精灵身上「回合类效果」这一层（消除回合类效果 / 「渡」共用）；返回清掉的条数 */
  Battle.prototype.clearRoundEffects = function (c) {
    if (!c) return 0;
    if (c.starRoundLock > 0) return 0;
    var n = 0;
    if (c.guards && c.guards.length) { c.guards = []; n++; }
    if (c.immuneStatus > 0) { c.immuneStatus = 0; n++; }
    if (c.immuneStat > 0) { c.immuneStat = 0; n++; }
    if (c.oneHit > 0) { c.oneHit = 0; n++; }
    if (c.thorns) { c.thorns = null; n++; }
    if (c.dot) { c.dot = null; n++; }
    if (c.shield > 0) { c.shield = 0; n++; }
    if (c.ward > 0) { c.ward = 0; n++; }
    if (c.skillBlock > 0) { c.skillBlock = 0; n++; }
    if (c.critBuffTurns > 0) { c.critBuffTurns = 0; n++; }
    if (c.priorityBuff) { c.priorityBuff = null; n++; }
    if (c.damageBuff) { c.damageBuff = null; n++; }
    if (c.ppCostMul) { c.ppCostMul = null; n++; }
    if (c.noStatUp > 0) { c.noStatUp = 0; n++; }
    if (c.immuneCrit > 0) { c.immuneCrit = 0; n++; }
    if (c.immuneCritReflect > 0) { c.immuneCritReflect = 0; n++; }
    if (c.damageCap) { c.damageCap = null; n++; }
    if (c.survive) { c.survive = null; n++; }
    if (c.dodge) { c.dodge = null; n++; }
    if (c.chanceImmune) { c.chanceImmune = null; n++; }
    if (c.mustHitTurns > 0) { c.mustHitTurns = 0; n++; }
    if (c.perTurnFlat) { c.perTurnFlat = null; n++; }
    if (c.perTurnDrain) { c.perTurnDrain = null; n++; }
    if (c.reflectDamage) { c.reflectDamage = null; n++; }
    if (c.critTimed) { c.critTimed = null; n++; }
    if (c.guardFlat) { c.guardFlat = null; n++; }
    if (c.typePower) { c.typePower = null; n++; }
    if (c.regenRandom) { c.regenRandom = null; n++; }
    if (c.teHeal) { c.teHeal = null; n++; }
    if (c.teUseHeal) { c.teUseHeal = null; n++; }
    return n;
  };

  /* ---- 技能测试模式（js/skilltest.js）用的脚本化操作，逻辑集中在这里便于测试 ---- */
  Battle.prototype.testForceFaint = function (side) {
    if (this.over) return false;
    var c = this.activeOf(side);
    if (!c || c.hp <= 0) return false;
    c.hp = 0;
    this.push(this.tag(side) + c.pet.name + ' 自爆（按被' + (side === 'me' ? '对手' : '我方') + '击败结算）');
    this.checkFaints();
    // 手动击杀不会走 endOfTurn，这里补上「被击败后」的待结算效果（如 3033 渡、3539 回合末害怕）
    this.resolveFaintPending();
    return true;
  };

  Battle.prototype.testRoundHeal = function (side, turns, pct) {
    var c = this.activeOf(side);
    if (!c) return false;
    var t = turns == null ? 3 : Math.max(1, turns | 0);
    var p = pct == null ? 1 / 3 : pct;
    c.teHeal = { turns: t, pct: p };
    this.push(this.tag(side) + c.pet.name + ' 获得回合类效果：每回合结束回复 ' +
      Math.round(p * 100) + '% 最大体力，持续 ' + t + ' 回合。');
    return true;
  };

  Battle.prototype.testClearRound = function (side) {
    var c = this.activeOf(side);
    if (!c) return 0;
    var n = this.clearRoundEffects(c);
    this.push(this.tag(side) + '消除回合类效果：共消除 ' + n + ' 个。');
    return n;
  };

  Battle.prototype.testShiftStats = function (side, delta) {
    var c = this.activeOf(side);
    if (!c) return false;
    ['atk', 'def', 'spAtk', 'spDef', 'spd', 'acc'].forEach(function (k) {
      c.stages[k] = clampStage((c.stages[k] || 0) + delta);
    });
    this.push(this.tag(side) + c.pet.name + ' 全属性 ' + (delta > 0 ? '+1' : '-1') + '。');
    return true;
  };

  /** 帝天战佛（3033）魂印「渡」：被击败的回合结束后 → 消回合 → 吸强并交接 → 清空对手 PP */
  /** 3539 魂印：被击败后保留 1 点体力，回合末令对手害怕 */
  Battle.prototype.resolveEndTurnFear = function (side, c) {
    if (!c || !c.endTurnFear) return;
    c.endTurnFear = false;
    var foe = this.activeOf(side === 'me' ? 'foe' : 'me');
    if (foe && foe.hp > 0) this.applyStatus(foe, 'fear', 1, side === 'me' ? '对手' : '我方');
  };

  /** 被击败后的待结算效果（渡 / 回合末害怕）。正常回合由 endOfTurn 收尾，自爆这类手动击杀走这里 */
  Battle.prototype.resolveFaintPending = function () {
    this.resolveDtzfSoul();
    this.resolveEndTurnFear('me', this.activeOf('me'));
    this.resolveEndTurnFear('foe', this.activeOf('foe'));
  };

  Battle.prototype.resolveDtzfSoul = function () {
    var self = this;
    ['me', 'foe'].forEach(function (side) {
      var list = self[side].team.filter(function (x) { return x && x.dtzfPending; });
      list.forEach(function (c) {
        c.dtzfPending = false;
        c.dtzfDone = true;
        var foe = self.activeOf(side === 'me' ? 'foe' : 'me');
        self.push(self.tag(side) + c.pet.name + ' 的魂印「渡」发动！');
        if (!foe || foe.hp <= 0) return;
        var rounds = self.clearRoundEffects(foe);
        if (rounds) self.push('「渡」消除了 ' + foe.pet.name + ' 的 ' + rounds + ' 个回合类效果。');
        var carry = {};
        var taken = 0;
        Object.keys(foe.stages).forEach(function (k) {
          if (foe.stages[k] > 0) {
            carry[k] = foe.stages[k];
            c.stages[k] = clampStage((c.stages[k] || 0) + carry[k]);
            taken += carry[k];
            foe.stages[k] = 0;
          }
        });
        if (taken) self.push('「渡」吸取了 ' + foe.pet.name + ' ' + taken + ' 级能力提升。');
        var pps = 0;
        foe.skills.forEach(function (sl) {
          if (sl.pp > 0) { sl.pp = 0; pps++; }
        });
        if (pps) self.push('「渡」令 ' + foe.pet.name + ' 的 ' + pps + ' 个技能 PP 归 0。');
        var keys = Object.keys(carry);
        if (!keys.length) return;
        var nxt = self.activeOf(side);
        if (nxt && nxt !== c && nxt.hp > 0) {
          var got = 0;
          keys.forEach(function (k) { nxt.stages[k] = clampStage((nxt.stages[k] || 0) + carry[k]); got += carry[k]; });
          self.push(nxt.pet.name + ' 继承了「渡」吸取的 ' + got + ' 级能力提升。');
        } else {
          self.dtzfCarry = self.dtzfCarry || {};
          self.dtzfCarry[side] = carry;
        }
      });
    });
  };

  Battle.prototype.checkFaints = function () {
    var self = this;
    // 堕世（561）：濒死前先判定「本回合回满」，避免直接进入阵亡结算
    this.resolveFirstRevive();
    ['me', 'foe'].forEach(function (side) {
      var c = self.activeOf(side);
      if (!c || c.hp > 0) return;
      // 3539 魂印：首次死亡保留 1 点体力，回合末令对手害怕
      if (c.firstDeathSurvive && !c.firstDeathUsed) {
        c.firstDeathUsed = true;
        c.hp = 1;
        c.endTurnFear = !!c.deathFear;
        self.push(self.tag(side) + c.pet.name + ' 的魂印残留了 1 点体力！');
        return;
      }
      // 4648 魂印：满级致死复活（每场 1 次）
      if (c.level100Revive && !c.revivedOnce && self.level >= 100) {
        c.revivedOnce = true;
        var foeRv2 = self.activeOf(side === 'me' ? 'foe' : 'me');
        if (foeRv2) {
          Object.keys(foeRv2.stages).forEach(function (kRv2) { if (foeRv2.stages[kRv2] > 0) foeRv2.stages[kRv2] = 0; });
          self.clearRoundEffects(foeRv2);
        }
        c.hp = c.maxHp;
        c.skills.forEach(function (slRv2) { slRv2.pp = slRv2.max_pp || 99; });
        c.shield = (c.shield || 0) + c.maxHp;
        c.ward = (c.ward || 0) + c.maxHp;
        self.push(self.tag(side) + c.pet.name + ' 的魂印：满级致死复活，清对手强化与回合效果，回满体力 PP 并获得等量护盾护罩。');
        return;
      }
      // 3311 魂印：死亡后 100% 重生一次
      if (c.reviveOnce && !c.reviveUsed) {
        c.reviveUsed = true;
        c.hp = c.maxHp;
        self.push(self.tag(side) + c.pet.name + ' 的魂印发动：重生！');
        var foeRv = self.activeOf(side === 'me' ? 'foe' : 'me');
        if (foeRv && c.reviveOnce.clear) {
          var clrRv = false;
          Object.keys(foeRv.stages).forEach(function (kRv) { if (foeRv.stages[kRv] > 0) { foeRv.stages[kRv] = 0; clrRv = true; } });
          if (clrRv) self.push('重生时清除了对手的能力提升。');
          self.clearRoundEffects(foeRv);
          if (c.reviveOnce.immune) { c.immuneStatus = Math.max(c.immuneStatus || 0, 1); self.push('重生时消除成功，自身免疫下 1 次异常状态。'); }
        }
        if (c.revivePowerBuff) {
          c.damageBuff = { turns: c.revivePowerBuff.turns, mul: c.revivePowerBuff.mul };
          self.push(c.pet.name + ' 重生后 ' + c.revivePowerBuff.turns + ' 回合内技能威力提升。');
        }
        return;
      }
      // 2987 重生之翼：被击败后按概率复活 1 只阵亡队友（专属特性里没有此效果的）
      if (c.reviveTeammate && !c.reviveMateUsed) {
        c.reviveMateUsed = true;
        if (self.rng() * 100 < c.reviveTeammate) {
          var poolRv = (self[side].team || []).concat(self.reserve[side] || []);
          var tgtRv = poolRv.filter(function (x) {
            return x && x !== c && x.hp <= 0 && !x.reviveTeammate;
          })[0];
          if (tgtRv) {
            tgtRv.hp = Math.max(1, Math.floor(tgtRv.maxHp / 2));
            self.push(self.tag(side) + '神耀能量发动：复活了 ' + tgtRv.pet.name + '（' + tgtRv.hp + ' 体力）！');
          }
        } else {
          self.push(self.tag(side) + c.pet.name + ' 的复活效果未触发。');
        }
      }
      self.push(self.tag(side) + c.pet.name + ' 倒下了！');
      // 天启帝君「帝君之殒」：被击败后 30% 令对手 1 只在场下精灵死亡
      if (c.junYun) {
        var foeSideJY = side === 'me' ? 'foe' : 'me';
        var benchJY = self[foeSideJY].team.filter(function (x) { return x && x !== self.activeOf(foeSideJY) && x.hp > 0; });
        if (benchJY.length && self.rng() * 100 < c.junYun) {
          var vic = benchJY[Math.floor(self.rng() * benchJY.length)];
          vic.hp = 0;
          self.push(self.tag(side) + '帝君之殒：对方场下 ' + vic.pet.name + ' 倒下了。');
        }
      }
      // 天启帝君「帝君之阵」：刷新双方阵亡数
      ['me', 'foe'].forEach(function (sd) {
        var dl = (self[sd].team || []).filter(function (x) { return x && x.hp <= 0; }).length;
        (self[sd].team || []).forEach(function (x) { if (x) x.deadAllies = dl; });
      });
      if (c.status && c.status.id === 'blind') c.status = null;   // 「失明」阵亡即解除
      if (c.dtzfSoul && !c.dtzfDone) c.dtzfPending = true;
      // 亡语：被击败时让对手损失体力
      if (c.deathCurse) {
        var killer = self.activeOf(side === 'me' ? 'foe' : 'me');
        if (killer && killer.hp > 0) {
          killer.hp = Math.max(0, killer.hp - c.deathCurse.value);
          self.push(c.pet.name + ' 的亡语让 ' + killer.pet.name + ' 损失 ' + c.deathCurse.value + ' 点体力。');
        }
        c.deathCurse = null;
      }
      // 被击败时清除对手强化
      if (c.onDeathClearFoe) {
        var killer2 = self.activeOf(side === 'me' ? 'foe' : 'me');
        if (killer2) {
          var clr = false;
          Object.keys(killer2.stages).forEach(function (k10) {
            if (killer2.stages[k10] > 0) { killer2.stages[k10] = 0; clr = true; }
          });
          if (clr) self.push(c.pet.name + ' 倒下时清除了对手的能力提升。');
        }
        c.onDeathClearFoe = 0;
      }
      // 击杀者：让对手下 N 次攻击技能无效
      var killer3 = self.activeOf(side === 'me' ? 'foe' : 'me');
      if (killer3 && killer3.onKillNextPriorityDown) {
        self.nextPetPriorityDown = { side: side, turns: killer3.onKillNextPriorityDown.turns, value: killer3.onKillNextPriorityDown.value };
        killer3.onKillNextPriorityDown = null;
      }
      if (killer3 && killer3.onKillHealNext) {
        var okh = Math.min(Math.floor(killer3.maxHp * killer3.onKillHealNext.num / killer3.onKillHealNext.den), killer3.maxHp - killer3.hp);
        if (okh > 0) killer3.hp += okh;
        killer3.nextAttackFlatPct = killer3.onKillHealNext.pct;
        killer3.onKillHealNext = null;
      }
      if (killer3 && killer3.onKillPriority) {
        killer3.priorityBuff = { turns: 1, value: killer3.onKillPriority };
      }
      if (killer3 && killer3.onKillSkillBlock) {
        self.killSkillBlock = { side: side, times: killer3.onKillSkillBlock };
        killer3.onKillSkillBlock = 0;
      }
      if (killer3 && killer3.doubleStagesOnKill) {
        Object.keys(killer3.stages).forEach(function (k16) {
          if (killer3.stages[k16] > 0) killer3.stages[k16] = Math.min(6, killer3.stages[k16] * 2);
        });
        self.push(killer3.pet.name + ' 的能力提升翻倍了！');
      }
      if (killer3 && killer3.killAttackBlock) {
        self.killAttackBlock = { side: side, times: killer3.killAttackBlock };
        killer3.killAttackBlock = 0;
      }
      if (c.deathTeamGuard) {
        self.deathGuard[side] = { turns: c.deathTeamGuard.turns, mul: c.deathTeamGuard.mul };
      }
      if (self.aliveCount(side) === 0) {
        self.over = true;
        self.winner = side === 'me' ? 'foe' : 'me';
        self.push(side === 'me' ? '你的队伍全灭，对战失败…' : '对手全灭，你赢了！');
        return;
      }
      if (side === 'me') {
        self.needPlayerSwitch = true;
        self.needSwitch.me = true;
      } else if (self.pvp) {
        // 联机对战：对手是真人，等他自己换人
        self.needSwitch.foe = true;
      } else {
        var idx = self.pickAiSwitch();
        if (idx >= 0) {
          self.foe.active = idx;
          self.foe.team[idx].stages = freshStages();
          self.push('对手换上了 ' + self.foe.team[idx].pet.name + '！');
          self.onEnter(self.foe.team[idx]);
        }
      }
    });
  };

  Battle.prototype.actionPriority = function (actor, action) {
    if (!action) return 0;
    if (action.type === 'switch') return 99;
    var bonus = actor ? (actor.priorityBonus || 0) : 0;
    if (actor && actor.priorityBuff && actor.priorityBuff.turns > 0) bonus += actor.priorityBuff.value;
    if (actor && actor.priorityDown && actor.priorityDown.turns > 0) bonus -= actor.priorityDown.value;
    if (actor && actor.starRagePriority > 0 && action.type === 'skill') {
      var srSlot = actor.skills[action.index];
      if (srSlot && srSlot.skill.category && srSlot.skill.category.id !== 4) bonus += 2;
    }
    if (hasStack(actor, 5)) bonus += 1;
    if (actor && actor.morphMode === 'speed' && actor.morphSpeed) bonus += actor.morphSpeed.priority || 1;
    if (actor && actor.priorityIfLow && actor.hp / actor.maxHp < actor.priorityIfLow.threshold) bonus += actor.priorityIfLow.value;
    if (actor && actor.priorityIfHpBelow && actor.hp < actor.priorityIfHpBelow) bonus += 10;
    // 魂印：体力高于对手时必定先手
    if (actor && actor.priorityIfHigher && actor.side) {
      var foe = this.activeOf(actor.side === 'me' ? 'foe' : 'me');
      if (foe && actor.hp > foe.hp) bonus += 10;
    }
    // 技能自带的「条件先制」（若对手处于异常状态则先制 +N 等）
    if (actor && actor.priorityCond) {
      var pcFoe = this.activeOf(actor.side === 'me' ? 'foe' : 'me');
      if (checkCond(actor.priorityCond.req, { actor: actor, target: pcFoe, isFirst: false })) {
        bonus += actor.priorityCond.value;
      }
    }
    // 「连续使用时先制 +N」
    if (actor && actor.priorityStreak > 0 && actor.streak > 0) bonus += actor.priorityStreak;
    // 条件被动里的「若…则…先制 +N」
    if (actor && actor.condPassives && actor.condPassives.length) {
      var pfoe = this.activeOf(actor.side === 'me' ? 'foe' : 'me');
      var pctx = { actor: actor, target: pfoe, turn: this.turn, isFirst: false };
      for (var pi2 = 0; pi2 < actor.condPassives.length; pi2++) {
        var pp = actor.condPassives[pi2];
        if (pp.fx && pp.fx.kind === 'priority' && checkCond(pp.req, pctx)) bonus += pp.fx.value;
      }
    }
    if (action.type === 'skill') {
      var slot = actor && actor.skills[action.index];
      var g = (actor && actor.guaranteePrio > 0) ? 6 : 0;
      if (actor && actor.starSpecialPrio && slot && slot.skill.category && slot.skill.category.id === 2) {
        bonus += actor.starSpecialPrio;
      }
      return (slot ? num(slot.skill.priority) : 0) + bonus + g;
    }
    return bonus;
  };

  /** 结算一个回合：actions = { me: 动作, foe: 动作 } */
  /** 堕世（22745 / id 561）：先出手本回合内，对手技能把自己打倒时回满体力 */
  Battle.prototype.resolveFirstRevive = function () {
    var self = this;
    ['me', 'foe'].forEach(function (side) {
      var c = self.activeOf(side);
      if (!c || c.hp > 0 || !c.firstReviveTurn || c.firstReviveTurn !== self.turn) return;
      c.hp = c.maxHp;
      c.firstReviveTurn = 0;
      self.push(self.tag(side) + c.pet.name + ' 触发「堕世」，体力回满！');
    });
  };

  Battle.prototype.resolveTurn = function (actions) {
    if (this.over) return this.log;

    this.turn++;
    this.lastCrit = null;
    this.push('');
    this.push('—— 第 ' + this.turn + ' 回合 ——');
    this.startOfTurn();
    this.leiTurnStart();

    // 轮回类魂印：记录本回合开始时的状态，供致死时回滚
    var self0 = this;
    ['me', 'foe'].forEach(function (side) {
      var c0s = self0.activeOf(side);
      if (c0s) {
        c0s.turnStartStages = JSON.parse(JSON.stringify(c0s.stages));
        c0s.tookDamageLastTurn = !!c0s.tookDamageThisTurn;
        c0s.tookDamageThisTurn = false;
      }
      var c = self0.activeOf(side);
      if (c && c.hasRebirth && !c.rebirthUsed) {
        c.turnSnapshot = {
          hp: c.hp,
          stages: JSON.parse(JSON.stringify(c.stages)),
          pp: c.skills.map(function (s) { return s.pp; })
        };
      }
    });

    var self = this;
    var orders = [];
    if (actions.me) orders.push({ side: 'me', action: actions.me });
    if (actions.foe) orders.push({ side: 'foe', action: actions.foe });

    orders.forEach(function (o) {
      var c = self.activeOf(o.side);
      o.priority = self.actionPriority(c, o.action);
      o.speed = self.effSpeed(c);
      o.tie = self.rng();
    });

    orders.sort(function (a, b) {
      if (b.priority !== a.priority) return b.priority - a.priority;
      if (b.speed !== a.speed) return b.speed - a.speed;
      return a.tie - b.tie;
    });

    for (var i = 0; i < orders.length; i++) {
      if (this.over || this.needPlayerSwitch || this.needSwitch.foe) break;
      var actor = this.activeOf(orders[i].side);
      if (!actor || actor.hp <= 0) continue;

      var can = this.canAct(actor);
      if (!can.ok) {
        if (can.msg) this.push(this.tag(orders[i].side) + can.msg);
        continue;
      }

      this.perform(orders[i].side, orders[i].action, { isFirst: i === 0 });
      this.resolveFirstRevive();
      this.checkFaints();
    }

    if (!this.over) {
      this.endOfTurn();
      var mAct = this.activeOf('me'), fAct = this.activeOf('foe');
      if (!this.over && !this.needPlayerSwitch && !this.needSwitch.foe &&
        ((mAct && mAct.hp <= 0) || (fAct && fAct.hp <= 0))) this.checkFaints();
    }
    return this.log;
  };

  /** 推进一回合（对手由 AI 操作）；返回完整日志 */
  Battle.prototype.step = function (playerAction) {
    if (this.over || this.needPlayerSwitch) return this.log;
    return this.resolveTurn({ me: playerAction, foe: this.aiChoose() });
  };

  /** 联机对战：双方各自提交动作 */
  Battle.prototype.stepPvp = function (meAction, foeAction) {
    if (this.over) return this.log;
    return this.resolveTurn({ me: meAction, foe: foeAction });
  };

  /** 开启场地（5 回合） */
  Battle.prototype.setField = function (id) {
    var f = FIELD_PRESETS[id];
    if (!f) return;
    this.field = {
      id: id,
      name: f.name,
      mustHit: !!f.mustHit,
      healPerTurn: f.healPerTurn || 0,
      ppRestore: f.ppRestore || 0,
      damageMul: f.damageMul || 1,
      turns: 5
    };
    this.push('场地变为「' + f.name + '」（持续 5 回合）。');
  };

  Battle.prototype.clearField = function () {
    if (!this.field) return;
    this.push('「' + this.field.name + '」场地效果结束。');
    this.field = null;
  };

  /** 精灵登场：带有「次元之琴」的魂印会按回合奇偶开场地 */
  Battle.prototype.enterField = function (c) {
    if (!c || !c.fieldOnEnter) return;
    if (this.field) return; // 己方已有场地时不覆盖
    var entryTurn = this.turn + 1;
    this.setField(entryTurn % 2 === 1 ? 1 : 2);
  };

  /** 精灵下场：开启场地的精灵离场时消除己方场地 */
  Battle.prototype.exitField = function (c) {
    if (c && c.fieldOnEnter && this.field) this.clearField();
    if (c && c.morphGuard) {
      c.shield = 0;
      c.shieldActive = false;
      c.shieldRecharge = 0;
      c.morphMode = null;
      c.morphSwitchNext = null;
    }
    if (c && c.wukongFormTurns > 0) {
      c.wukongFormTurns = 0;
      c.immuneStatus = 0;
      c.critBuffTurns = 0;
      if (c.priorityBuff && c.priorityBuff.value <= 1) c.priorityBuff = null;
      this.push(c.pet.name + ' 的「法天象地·圣」因下场而消失。');
    }
    if (c && c.switchOutShield) {
      this.pendingShield = this.pendingShield || { me: 0, foe: 0 };
      this.pendingShield[c.side] = (this.pendingShield[c.side] || 0) + c.switchOutShield;
      c.switchOutShield = 0;
    }
  };

  /** 精灵登场时的各类魂印效果 */
  Battle.prototype.onEnter = function (c) {
    // 天启帝君「帝君之援」：满体力登场 → 当回合所有技能先制 +1
    if (c && (this[c.side].team || []).some(function (x) { return x && x.junYuan && x.hp > 0; }) && c.hp >= c.maxHp) {
      c.priorityBuff = { turns: 1, value: 1 };
      this.push(this.tag(c.side) + '帝君之援：满体力登场，当回合技能先制 +1。');
    }
    // 4950 魂印：团体精灵主副位
    if (c.twinCorps) {
      if (!c.posChosen) {
        var teamLead = (c.side === 'me' ? this.me : this.foe).team[0] === c;
        c.mainPos = teamLead ? '钺' : '御';
        c.subPos = c.mainPos === '钺' ? '御' : '钺';
        c.posChosen = true;
      }
      this.push(c.pet.name + '：主位帝皇之' + c.mainPos + '，副位帝皇之' + c.subPos + '。');
      if (c.subPos === '御' && c.yuSub) {
        c.status = null;
        var foeY = this.activeOf(c.side === 'me' ? 'foe' : 'me');
        if (foeY) foeY.status = null;
        c.immuneStatus = Math.max(c.immuneStatus || 0, 2);
        c.priorityBuff = { turns: 1, value: 2 };
        this.push(c.pet.name + ' 的魂印：解除双方异常，免疫异常 2 回合且先制 +2。');
      }
    }
    // 4766 魂印：登场开启武道（血之道）
    if (c.wudaoOpen) {
      if (!c.wudaoStarted) { c.wudao = '血'; c.wudaoStarted = true; }
      this.push(c.pet.name + ' 开启武道：当前 ' + c.wudao + '之道。');
    }
    // 4648 魂印：登场附加星海之浸
    if (c.starSeaMark) {
      var foeLs = this.activeOf(c.side === 'me' ? 'foe' : 'me');
      if (foeLs) { foeLs.starSea = { turns: c.starSeaMark.turns }; this.push(c.pet.name + ' 的魂印：对手附加 ' + c.starSeaMark.turns + ' 回合星海之浸。'); }
    }
    // 4515 魂印：首次出战进入强击形态
    if (c.formSystem) {
      if (!c.formUsed) { c.form = '强击'; c.formUsed = true; }
      this.push(c.pet.name + ' 当前形态：' + c.form + '（' + c.blade + '）。');
    }
    // 3994 魂印：登场召唤狂怒雷电（首次攻击必暴）
    if (c.rageCrit) {
      c.rageChance = c.rageUsed ? c.rageCrit.later : c.rageCrit.first;
      c.rageUsed = true;
      this.push(c.pet.name + ' 的魂印：召唤狂怒雷电，本次登场暴击概率 ' + c.rageChance + '%。');
    }
    // 3740 魂印：登场获得 400 点护盾
    if (c.entryShieldFlat) {
      c.shield = (c.shield || 0) + c.entryShieldFlat.value;
      this.push(c.pet.name + ' 的魂印：获得 ' + c.entryShieldFlat.value + ' 点护盾。');
    }
    // 3711 魂印：登场获得自然祝福
    if (c.enterBless) {
      var gainBl = c.blessEnterUsed ? c.enterBless.later : c.enterBless.first;
      c.bless = (c.bless || 0) + gainBl;
      c.blessEnterUsed = true;
      this.push(c.pet.name + ' 的魂印：获得 ' + gainBl + ' 层自然祝福（当前 ' + c.bless + ' 层）。');
    }
    // 3683 魂印：登场让对手随机进入异常
    if (c.enterRandomStatus) {
      var foeHz = this.activeOf(c.side === 'me' ? 'foe' : 'me');
      if (foeHz && foeHz.hp > 0) {
        var CTRL = ['sleep', 'fear', 'tired', 'paralyze', 'confuse', 'petrify'];
        var ALL = ['sleep', 'fear', 'tired', 'paralyze', 'confuse', 'petrify', 'freeze', 'burn', 'poison', 'bleed'];
        var poolHz = (c.enterRandomStatus.first && !c.enterStatusUsed) ? CTRL : ALL;
        var pickHz = poolHz[Math.floor(this.rng() * poolHz.length)];
        this.applyStatus(foeHz, pickHz, 1, c.side === 'me' ? '对手' : '我方');
        this.push(c.pet.name + ' 的魂印：对手随机陷入' + (STATUS_DEF[pickHz] ? STATUS_DEF[pickHz].name : '异常') + '。');
      }
      c.enterStatusUsed = true;
    c.enterThisTurn = true;
    }
    // 3568 魂印：登场获得 1/2 最大体力护盾 + 免疫异常
    if (c.enterShieldImmune) {
      var shV = Math.floor(c.maxHp * c.enterShieldImmune.num / c.enterShieldImmune.den);
      c.shield = (c.shield || 0) + shV;
      c.shieldBreakArmed = true;
      c.immuneStatus = Math.max(c.immuneStatus || 0, 1);
      this.push(c.pet.name + ' 的魂印：获得 ' + shV + ' 点护盾并免疫本回合异常。');
    }
    // 3541 魂印：首次登场无效对手下次攻击并断回合，成功则对手害怕
    if (c.firstEntryNullAttack && !c.firstEntryUsed) {
      c.firstEntryUsed = true;
      var foeS5 = this.activeOf(c.side === 'me' ? 'foe' : 'me');
      if (foeS5) {
        foeS5.skillNull = Math.max(foeS5.skillNull || 0, 1);
        this.push(c.pet.name + ' 的魂印：对手下次攻击技能无效。');
        var cleared5 = this.clearRoundEffects(foeS5);
        if (cleared5 > 0) { c.pendingFoeFear = true; this.push('断回合成功，回合开始时令对手害怕。'); }
      }
    }
    // 3414 魂印：登场消除对手强化，成功则封印其强化与属性技
    if (c.enterClearLock && !c.enterClearUsed) {
      c.enterClearUsed = true;
      var foeEn = this.activeOf(c.side === 'me' ? 'foe' : 'me');
      if (foeEn) {
        var clrEn = false;
        Object.keys(foeEn.stages).forEach(function (kEn) { if (foeEn.stages[kEn] > 0) { foeEn.stages[kEn] = 0; clrEn = true; } });
        if (clrEn) {
          this.push(c.pet.name + ' 的魂印消除了对手的能力提升。');
          foeEn.noStatUp = Math.max(foeEn.noStatUp || 0, c.enterClearLock.turns);
          foeEn.statusSkillNull = Math.max(foeEn.statusSkillNull || 0, c.enterClearLock.statusSkills);
          this.push('对手 ' + c.enterClearLock.turns + ' 回合内无法提升能力，下 ' + c.enterClearLock.statusSkills + ' 次属性技能失效。');
        }
      }
    }
    if (!c) return;
    c.enterTurn = Math.max(1, this.turn + 1);
    this.enterField(c);
    if (this.nextAllyShield && this.nextAllyShield.side === c.side) {
      var nas = this.nextAllyShield.value;
      this.nextAllyShield = null;
      c.shield += nas;
      c.ward += nas;
      this.push(this.tag(c.side) + c.pet.name + ' 获得了 ' + nas + ' 点护盾与护罩。');
    }
    if (this.dtzfCarry && this.dtzfCarry[c.side]) {
      var cg = this.dtzfCarry[c.side];
      delete this.dtzfCarry[c.side];
      var cgN = 0;
      Object.keys(cg).forEach(function (k) {
        if (cg[k] > 0) { c.stages[k] = clampStage(c.stages[k] + cg[k]); cgN += cg[k]; }
      });
      if (cgN) this.push(this.tag(c.side) + c.pet.name + ' 继承了「渡」吸取的 ' + cgN + ' 级能力提升。');
    }

    // 登场窗口：「首次登场之后前 N 回合…」
    if (c.entryBuffs && c.entryBuffs.length) {
      var self0 = this;
      var applied = [];
      c.entryBuffs.forEach(function (b) {
        if (b.once && c.entryUsed) return;
        var fx = b.fx || {};
        if (fx.kind === 'immuneStatus') c.immuneStatus = Math.max(c.immuneStatus, b.turns);
        else if (fx.kind === 'immuneStat') c.immuneStat = Math.max(c.immuneStat, b.turns);
        else if (fx.kind === 'survive') c.survive = { turns: b.turns, hp: fx.hp || 1 };
        else if (fx.kind === 'reflectLethal') c.reflectLethal = Math.max(c.reflectLethal, b.turns);
        else if (fx.kind === 'priority') {
          var pb0 = c.priorityBuff || { turns: 0, value: 0 };
          c.priorityBuff = { turns: Math.max(pb0.turns, b.turns), value: Math.max(pb0.value, fx.value) };
        } else if (fx.kind === 'taken') c.guards.push({ turns: b.turns, mul: fx.value, scope: 'all' });
        else if (fx.kind === 'foeStatDown') {
          var fo = self0.activeOf(c.side === 'me' ? 'foe' : 'me');
          if (fo) fo.stages[fx.stat] = clampStage(fo.stages[fx.stat] - fx.stages);
        } else if (fx.kind === 'entryStatus') {
          var fo2 = self0.activeOf(c.side === 'me' ? 'foe' : 'me');
          if (fo2 && self0.rng() * 100 < fx.chance) self0.applyStatus(fo2, fx.statusId, 1, c.side === 'me' ? '对手' : '我方');
        } else if (fx.kind === 'critBonus') {
          c.critBonus += fx.value;
        } else if (fx.kind === 'flat') {
          c.entryFlat = { turns: b.turns, value: fx.value };
        }
        else return;
        applied.push(fx.kind);
      });
      if (applied.length) {
        self0.push(self0.tag(c.side) + c.pet.name + ' 的魂印生效（' + c.entryBuffs[0].turns + ' 回合）：' +
          applied.map(function (k) {
            return { immuneStatus: '免疫异常', immuneStat: '免疫能力下降', survive: '免死', reflectLethal: '致死反弹', priority: '先制', taken: '减伤' }[k] || k;
          }).join('、'));
      }
      c.entryUsed = true;
    }

    // 上一只倒下时留下的「下只出场精灵减伤」
    if (this.deathGuard && this.deathGuard[c.side]) {
      var g = this.deathGuard[c.side];
      c.guards.push({ turns: g.turns, mul: g.mul, scope: 'all' });
      this.deathGuard[c.side] = null;
      this.push(this.tag(c.side) + c.pet.name + ' 继承了减伤效果（' + g.turns + ' 回合）。');
    }

    if (c.benchStrike) {
      var foeSide2 = c.side === 'me' ? 'foe' : 'me';
      var pk = this;
      var benchFoe = this[foeSide2].team.filter(function (b2) {
        return b2 && b2 !== pk.activeOf(foeSide2) && b2.hp > 0;
      });
      var stNum = c.benchStrike.num, stDen = c.benchStrike.den;
      if (!benchFoe.length) {
        pk.push('帝君之罚：对手没有场下精灵，本次没有目标（对战中需对手仍有后备精灵）。');
      } else {
        benchFoe.forEach(function (b2) {
          var dmgB = Math.max(1, Math.floor(b2.maxHp * stNum / stDen));
          pk.benchDamage(foeSide2, b2, dmgB);
          pk.push('帝君之罚：' + b2.pet.name + ' 受到 ' + dmgB + ' 点真实伤害（1/' + stDen + ' 最大体力）。');
        });
        c.benchStrike.num = Math.max(1, Math.floor(stNum / 3));
      }
    }
    if (c.benchHeal) {
      var ownTeam = this[c.side].team;
      var pk2 = this;
      var hNum = c.benchHeal.num, hDen = c.benchHeal.den;
      var benchOwn = ownTeam.filter(function (b3) { return b3 && b3 !== pk2.activeOf(c.side) && b3.hp > 0; });
      var healed = 0;
      if (!benchOwn.length) {
        pk2.push('帝君之赐：己方没有场下精灵，本次没有目标。');
      } else {
        benchOwn.forEach(function (b3) {
          var healB = Math.max(1, Math.floor(b3.maxHp * hNum / hDen));
          var real = Math.min(healB, b3.maxHp - b3.hp);
          b3.hp += real; healed += real;
        });
        c.benchHeal.num = Math.max(1, Math.floor(hNum / 3));
        pk2.push('帝君之赐：己方场下精灵各回复 1/' + hDen + ' 最大体力（合计 ' + healed + ' 点）。');
      }
    }
    if (c.entrySkillBlock) {
      var foeSB = this.activeOf(c.side === 'me' ? 'foe' : 'me');
      if (foeSB) foeSB.skillBlock = Math.max(foeSB.skillBlock || 0, c.entrySkillBlock);
      this.push(this.tag(c.side) + '的魂印封住了对手的属性技能。');
    }
    if (c.mistikeSoul) {
      var foeM = this.activeOf(c.side === 'me' ? 'foe' : 'me');
      if (foeM) {
        foeM.skillBlock = Math.max(foeM.skillBlock || 0, 2);
      }
      c.mistikeNoDebuff = 2;
      c.mistikeEntryTurn = this.turn;
      c.mistikeFoeActed = false;
      this.push(this.tag(c.side) + c.pet.name + ' 的「秘」：对手 2 回合属性技能无效。');
    }
    if (c.entryImmuneStatus) {
      c.immuneStatus = Math.max(c.immuneStatus, c.entryImmuneStatus);
      this.push(this.tag(c.side) + c.pet.name + ' 登场首回合免疫异常状态。');
    }

    // 登场类魂印：开场护盾 / 削对手能力 / 附加异常
    if (c.entryShield) {
      c.shield += c.entryShield;
      this.push(this.tag(c.side) + c.pet.name + ' 登场获得了 ' + c.entryShield + ' 点护盾。');
    }

    // 神照：启灵元神在背包时，己方首发精灵首次登场获得 30% 启灵元神最大体力的护盾
    var fsAura = this.benchAuras && this.benchAuras[c.side] && this.benchAuras[c.side].firstShield;
    if (fsAura && c === this[c.side].team[0] && !c.firstShieldUsed) {
      var fsVal = Math.max(1, Math.round((fsAura.srcMaxHp || c.maxHp) * fsAura.pct / 100));
      c.shield += fsVal;
      c.firstShieldUsed = true;
      this.push(this.tag(c.side) + c.pet.name + ' 首次登场，获得 ' + fsVal + ' 点护盾（神照）。');
    }

    // 西游师徒：四人同队时，我方首发精灵首次登场全属性 +1（本作按 PvE 处理）
    var westAura = this.benchAuras && this.benchAuras[c.side] && this.benchAuras[c.side].westward;
    if (westAura && !this.pvp && c === this[c.side].team[0] && !c.westwardUsed) {
      ['atk', 'def', 'spAtk', 'spDef', 'spd', 'acc'].forEach(function (k) {
        c.stages[k] = clampStage(c.stages[k] + 1);
      });
      c.westwardUsed = true;
      this.push(this.tag(c.side) + '的师徒羁绊生效：' + c.pet.name + ' 全属性 +1（西游师徒）。');
    }

    // 马尔修斯 3393：登场开启坚壁护盾与极速形态
    if (c.morphGuard) {
      c.shield = Math.max(c.shield, c.morphGuard.shield);
      c.shieldActive = true;
      c.shieldRecharge = 0;
      c.statusGuard = Math.max(c.statusGuard, 1);
      this.push(this.tag(c.side) + c.pet.name + ' 开启坚壁形态：' + c.morphGuard.shield + ' 点护盾，并免疫下 1 次异常。');
    }
    if (c.morphSpeed) {
      c.morphMode = 'speed';
      c.morphSwitchNext = null;
      this.push(this.tag(c.side) + c.pet.name + ' 开启极速形态。');
    }
    if (c.starEntry) this.starInit(c);
    var foe2 = this.activeOf(c.side === 'me' ? 'foe' : 'me');
    if (foe2) {
      if (c.entryStatDown) {
        foe2.stages[c.entryStatDown.stat] = clampStage(foe2.stages[c.entryStatDown.stat] - c.entryStatDown.stages);
        this.push(this.tag(c.side) + '的魂印降低了对手的能力。');
      }
      if (c.entryStatus && this.rng() * 100 < c.entryStatus.chance) {
        this.applyStatus(foe2, c.entryStatus.statusId, 1, c.side === 'me' ? '对手' : '我方');
      }
    }

    if (c.onEnterClear) {
      var foe = this.activeOf(c.side === 'me' ? 'foe' : 'me');
      if (foe) {
        var cleared = false;
        if (foe.guards.length) { foe.guards = []; cleared = true; }
        if (foe.immuneStatus) { foe.immuneStatus = 0; cleared = true; }
        if (foe.immuneStat) { foe.immuneStat = 0; cleared = true; }
        if (foe.immuneBelow) { foe.immuneBelow = null; cleared = true; }
        if (foe.thorns) { foe.thorns = null; cleared = true; }
        if (foe.dot) { foe.dot = null; cleared = true; }
        if (foe.shield) { foe.shield = 0; cleared = true; }
        if (cleared) {
          foe.skillNull = 1;
          this.push(this.tag(c.side) + '的魂印消除了对手的回合类效果，对手下 1 次技能无效！');
        } else {
          this.push(this.tag(c.side) + '的魂印没有可消除的回合类效果。');
        }
      }
    }
  };

  /** 换人（不消耗回合，用于精灵倒下后的补充） */
  Battle.prototype.applyFateHeng = function (c, foe) {
    ['atk', 'def', 'spAtk', 'spDef', 'spd'].forEach(function (kF) { c.stages[kF] = clampStage(c.stages[kF] + 1); });
    var hdF = c.fateHengDef || {};
    c.shield = Math.max(c.shield || 0, hdF.shield || 200);
    c.ward = Math.max(c.ward || 0, hdF.ward || 200);
    if (foe && foe.hp > 0) {
      var poolF = foe.skills.filter(function (sl) { return sl.pp > 0; });
      for (var fi = 0; fi < (hdF.pp || 1) && poolF.length; fi++) poolF.splice(Math.floor(this.rng() * poolF.length), 1)[0].pp = 0;
      foe.healBlock = Math.max(foe.healBlock || 0, 1);
    }
    this.push(this.tag(c.side) + '命运之轮·恒：全属性 +1、护盾护罩各 ' + (hdF.shield || 200) + '，对手随机清 PP 且本回合无法回血。');
  };
  Battle.prototype.applyFateJie = function (c, foe) {
    var jdF = c.fateJieDef || {};
    if (foe && foe.hp > 0) {
      ['atk', 'def', 'spAtk', 'spDef', 'spd'].forEach(function (kJ) { foe.stages[kJ] = clampStage(foe.stages[kJ] - 1); });
      foe.fixedPctTakenUp = { turns: 1, pct: jdF.pct || 30 };
    }
    var healF = Math.min(Math.floor(c.maxHp / (jdF.den || 3)), c.maxHp - c.hp);
    if (healF > 0) c.hp += healF;
    c.pendingNextPrio = jdF.prio || 1;
    this.push(this.tag(c.side) + '命运之轮·界：对手全属性 -1、固伤百分比受伤 +' + (jdF.pct || 30) + '%，自身回 ' + healF + ' 血并下回合先制 +' + (jdF.prio || 1) + '。');
  };
  Battle.prototype.switchIn = function (side, index) {
    var c = this[side].team[index];
    if (!c || c.hp <= 0) return false;
    this.exitField(this.activeOf(side));
    this[side].active = index;
    c.stages = freshStages();
    this.needSwitch[side] = false;
    if (side === 'me') this.needPlayerSwitch = false;
    this.push(this.tag(side) + '换上了 ' + c.pet.name + '！');

    var oppFate = this.activeOf(side === 'me' ? 'foe' : 'me');
    if (oppFate && oppFate.fateWheel && oppFate.fateOnSwitch) {
      oppFate.fateBothThisEntry = true;
      this.push(c.pet.name + ' 登场：命运之轮·恒与界同时触发。');
    }
    if (this.pendingShield && this.pendingShield[side]) {
      c.ward += this.pendingShield[side];
      this.push(this.tag(side) + c.pet.name + ' 获得了 ' + this.pendingShield[side] + ' 点护罩。');
      this.pendingShield[side] = 0;
    }
    if (this.killSkillBlock && this.killSkillBlock.side === side) {
      c.skillBlock = Math.max(c.skillBlock || 0, this.killSkillBlock.times);
      this.push(c.pet.name + ' 的属性技能暂时失效。');
      this.killSkillBlock = null;
    }
    if (this.nextPetPriorityDown && this.nextPetPriorityDown.side === side) {
      c.priorityDown = { turns: this.nextPetPriorityDown.turns, value: this.nextPetPriorityDown.value };
      this.push(c.pet.name + ' 登场时先制下降。');
      this.nextPetPriorityDown = null;
    }
    if (this.nextPetHpDown && side === 'foe') {
      var cut = Math.floor(c.maxHp * this.nextPetHpDown.pct / 100);
      c.maxHp = Math.max(1, c.maxHp - cut);
      c.hp = Math.min(c.hp, c.maxHp);
      this.push(c.pet.name + ' 的体力上限被削减了 ' + cut + ' 点。');
      this.nextPetHpDown = null;
    }

    // 上一只被击败后留下的「攻击技能失效」
    if (this.killAttackBlock && this.killAttackBlock.side === side) {
      c.attackBlock = Math.max(c.attackBlock || 0, this.killAttackBlock.times);
      this.push(this.tag(side) + '的攻击技能暂时失效。');
      this.killAttackBlock = null;
    }

    var buff = this.sideBuff && this.sideBuff[side];
    if (buff) {
      if (buff.crit) c.guaranteeCrit = (c.guaranteeCrit || 0) + buff.crit;
      if (buff.prio) c.guaranteePrio = (c.guaranteePrio || 0) + buff.prio;
      if (buff.miracle) {
        c.stages.atk = 1;
        c.stages.spAtk = 1;
        c.stages.spd = 1;
      }
      this.sideBuff[side] = null;
      this.push(c.pet.name + ' 继承了强化效果！');
    }
    this.onEnter(c);
    return true;
  };

  /** 精灵倒下后玩家手动换人（不消耗回合） */
  Battle.prototype.playerSwitch = function (index) {
    return this.switchIn('me', index);
  };

  /** 收集某一方队伍里所有「背包光环」 */
  Battle.prototype.collectBenchAuras = function (side) {
    var s = this[side];
    var out = { healFix: [], teamStat: [], note: [] };
    if (!s || !s.team) return out;
    var self2 = this;
    s.team.forEach(function (c) {
      if (!c || !c.benchAura) return;
      c.benchAura.forEach(function (a) {
        if (!a.fx) return;
        if (a.fx.type === 'healFix') out.healFix.push({ names: a.names, from: a.fx.from, to: a.fx.to, cap: a.fx.cap || 0 });
        else if (a.fx.type === 'teamStat') out.teamStat.push({ stat: a.fx.stat, pct: a.fx.pct });
        else if (a.fx.type === 'benchFloor') out.benchFloor = Math.max(out.benchFloor || 0, a.fx.pct);
        else if (a.fx.type === 'firstShield') {
          var fsA = { pct: a.fx.pct, srcMaxHp: c.maxHp, srcName: c.pet.name };
          if (!out.firstShield || fsA.pct > out.firstShield.pct) out.firstShield = fsA;
        } else if (a.fx.type === 'markOnSwitch') {
          if (!out.markOnSwitch) out.markOnSwitch = { value: 0, srcMaxHp: 0, srcName: c.pet.name };
          out.markOnSwitch.value += a.fx.value;
          out.markOnSwitch.srcMaxHp = Math.max(out.markOnSwitch.srcMaxHp, c.maxHp);
          out.markOnSwitch.srcName = c.pet.name;
        }
        else if (a.fx.type === 'attackBuff') {
          out.attackBuff = { chance: a.fx.chance, mul: a.fx.mul, min: a.fx.min, max: a.fx.max, srcName: c.pet.name };
        }
        else out.note.push({ names: a.names, text: a.fx.text });
      });
    });
    // 备战格：只有桃园/西游的组队光环在备战格也生效（healFix / attackBuff）
    (this.reserve[side] || []).forEach(function (r) {
      var rAura = r.benchAura || (r.passives || []).filter(function (p) { return p.kind === 'benchAura'; }).map(function (p) { return { names: p.names, fx: p.fx }; });
      rAura.forEach(function (a) {
        if (!a.fx) return;
        if (a.fx.type === 'healFix') out.healFix.push({ names: a.names, from: a.fx.from, to: a.fx.to, cap: a.fx.cap || 0 });
        else if (a.fx.type === 'attackBuff') out.attackBuff = { chance: a.fx.chance, mul: a.fx.mul, min: a.fx.min, max: a.fx.max, srcName: r.pet.name };
      });
    });
    // 西游师徒：蒙奇多克（孙悟空，2727） / 三藏 / 沙悟净 / 天河神将（猪八戒）四人同队（出战+备战）
    var WEST_IDS = [2727, 3409, 3519, 2735];
    var allPets = s.team.concat(this.reserve[side] || []);
    out.westward = WEST_IDS.every(function (id) {
      return allPets.some(function (c) { return c && c.pet && c.pet.id === id; });
    });
    return out;
  };

  /** 队伍建好后收集背包光环，并把全队属性光环一次性加到面板上 */
  Battle.prototype.refreshBenchAuras = function () {
    var self = this;
    this.benchAuras = { me: this.collectBenchAuras('me'), foe: this.collectBenchAuras('foe') };
    ['me', 'foe'].forEach(function (sd) {
      var aur = self.benchAuras[sd];
      if (!aur || !aur.teamStat.length) return;
      aur.teamStat.forEach(function (st) {
        self[sd].team.forEach(function (c) {
          if (!c || !c.stats || c.stats[st.stat] == null) return;
          c.stats[st.stat] = Math.round(c.stats[st.stat] * (1 + st.pct / 100));
          if (st.stat === 'hp') { c.maxHp = Math.round(c.maxHp * (1 + st.pct / 100)); c.hp = c.maxHp; }
        });
      });
    });
  };

  /** 光环：某个精灵的回血量修正 */
  Battle.prototype.auraHeal = function (side, combatant, base) {
    var a = this.benchAuras && this.benchAuras[side];
    if (!a || !a.healFix.length) return base;
    var name = combatant && combatant.pet ? combatant.pet.name : '';
    var nameN = normName(name);
    var val = base;
    a.healFix.forEach(function (h) {
      if (!h.names || !h.names.length || h.names.some(function (n) { return nameN.indexOf(normName(n)) >= 0; })) {
        if (base >= h.from) val = Math.max(val, h.to);
        if (h.cap) val = Math.min(val, h.cap);
      }
    });
    return val;
  };

  /** 神殇：某个场下精灵本回合是否被放逐（不能主动切换） */
  Battle.prototype.isExiled = function (side, index) {
    return !!(this.exiled && this.exiled[side] && this.exiled[side].indexOf(index) >= 0);
  };

  /** 神印：对方主动换人登场时，给新上场的精灵叠 1 层神圣印记 */
  Battle.prototype.addHolyMarks = function (side, target) {
    if (!target) return;
    var other = side === 'me' ? 'foe' : 'me';
    var aura = this.benchAuras && this.benchAuras[other] && this.benchAuras[other].markOnSwitch;
    if (!aura) return;
    var before = target.holyMarks || 0;
    target.holyMarks = Math.min(3, before + (aura.value || 1));
    target.holyMarkDue = this.turn;
    target.holyMarkSrcMax = aura.srcMaxHp || 0;
    if (target.holyMarks > before) {
      this.push(this.tag(side) + target.pet.name + ' 被附加了 ' + target.holyMarks + ' 层神圣印记。');
    }
  };

  /** 场下扣血：受神谕保护时，体力低于 1/2 的场下精灵不会再被削减 */
  Battle.prototype.benchDamage = function (side, target, amount) {
    if (!target) return 0;
    if (amount <= 0) return target.hp;
    var aur = this.benchAuras && this.benchAuras[side];
    var floor = aur && aur.benchFloor ? Math.floor(target.maxHp * aur.benchFloor / 100) : 0;
    var next = target.hp - amount;
    if (floor > 0 && next < floor) next = Math.max(next, Math.min(target.hp, floor));
    target.hp = Math.max(0, next);
    return target.hp;
  };

  /** 回合开始时结算：神殇（结界放逐）与神启（按体力分支） */
  /** 王·雷伊（3142）魂印「雷」：回合开始的四条规则 */
  Battle.prototype.leiTurnStart = function () {
    var self = this;
    ['me', 'foe'].forEach(function (side) {
      var c = self.activeOf(side);
      if (!c || c.hp <= 0) return;
      var foe = self.activeOf(side === 'me' ? 'foe' : 'me');
      if (!foe || foe.hp <= 0) return;
      if (c.leiSteal) self.leiStealBoosts(c, foe);
      if (c.leiRoundToOne) self.leiShortenRounds(foe);
      if (c.leiEndBoost) c.leiEndBoostLead = c.hp > foe.hp;
      if (c.leiRoundLock && c.hp < foe.hp) {
        c.starRoundLock = Math.max(c.starRoundLock || 0, 1);
        self.push(self.tag(side) + c.pet.name + ' 体力低于对手，本回合自身回合类效果无法被消除。');
      }
    });
  };

  /** 吸取对手能力提升（雷魂印用） */
  Battle.prototype.leiStealBoosts = function (c, foe) {
    var KEYS = ['atk', 'def', 'spAtk', 'spDef', 'spd', 'acc', 'eva'];
    var n = 0;
    KEYS.forEach(function (k) {
      if (foe.stages[k] > 0) { c.stages[k] = clampStage(c.stages[k] + foe.stages[k]); n += foe.stages[k]; foe.stages[k] = 0; }
    });
    if (n) this.push(this.tag(c.side) + c.pet.name + ' 的魂印吸取了 ' + foe.pet.name + ' ' + n + ' 级能力提升。');
    return n;
  };

  /** 对手所有「回合类效果」剩余回合数压到 1（雷魂印用） */
  Battle.prototype.leiShortenRounds = function (foe) {
    if (!foe || foe.starRoundLock > 0) return 0;
    var n = 0;
    var dec = function (key) { if (foe[key] && foe[key].turns > 1) { foe[key].turns = 1; n++; } };
    ['ppCostMul', 'damageCap', 'survive', 'priorityBuff', 'damageBuff', 'critTimed', 'guardFlat', 'typePower',
      'regenRandom', 'perTurnFlat', 'perTurnDrain', 'reflectDamage', 'dodge', 'chanceImmune', 'mirrorHeal', 'dot', 'thorns', 'capOnStatus'].forEach(dec);
    if (foe.immuneStatus > 1) { foe.immuneStatus = 1; n++; }
    if (foe.immuneStat > 1) { foe.immuneStat = 1; n++; }
    if (foe.immuneCrit > 1) { foe.immuneCrit = 1; n++; }
    if (foe.mustHitTurns > 1) { foe.mustHitTurns = 1; n++; }
    if (foe.noStatUp > 1) { foe.noStatUp = 1; n++; }
    (foe.guards || []).forEach(function (g) { if (g.turns > 1) { g.turns = 1; n++; } });
    if (n) this.push(this.tag(foe.side) + foe.pet.name + ' 身上的回合类效果剩余回合数被压到 1。');
    return n;
  };

  Battle.prototype.startOfTurn = function () {
    var selfMul = this;
    ['me', 'foe'].forEach(function (sideS) {
      var cS = selfMul.activeOf(sideS);
      if (!cS || cS.hp <= 0) return;
      var foeS = selfMul.activeOf(sideS === 'me' ? 'foe' : 'me');
      if (!foeS || foeS.hp <= 0) return;
      // 「能力提升状态消失则对手属性技能失效」：回合开始判定（此时上回合增益已结算）
      if (cS.buffGoneAttr) {
        if (hasStatUp(cS)) cS.buffGoneAttr.seen = true;
        else if (cS.buffGoneAttr.seen) {
          foeS.skillBlock = Math.max(foeS.skillBlock || 0, 2);
          cS.buffGoneAttr = null;
          selfMul.push(cS.pet.name + ' 的能力提升消失，对手 2 回合内属性技能失效。');
        }
        if (cS.buffGoneAttr) { cS.buffGoneAttr.turns--; if (cS.buffGoneAttr.turns <= 0) cS.buffGoneAttr = null; }
      }
      if (cS.nyxEnter && cS.enterThisTurn && foeS) {
        var foeHasUp = ['atk', 'def', 'spAtk', 'spDef', 'spd'].some(function (kN) { return foeS.stages[kN] > 0; });
        if (foeHasUp) {
          cS.nyxTakenMul = 1 - cS.nyxEnter.reduce / 100;
          foeS.pendingSkillBlock = 1;
          selfMul.push(selfMul.tag(sideS) + '魂印：对手有强化，本回合受到攻击伤害 -' + cS.nyxEnter.reduce + '%。');
        }
      }

      cS.enterThisTurn = false;
      cS.turnStartHp = cS.hp;
      if (cS.nyxFieldTurns > 0) {
        cS.mustHitTurns = Math.max(cS.mustHitTurns || 0, 2);
        if (foeS) foeS.priorityDown = { turns: 1, value: 10 };
      }
      if (cS.fateWheel) {
        if (cS.fateBothThisEntry) {
          selfMul.applyFateHeng(cS, foeS);
          selfMul.applyFateJie(cS, foeS);
          cS.fateBothThisEntry = false;
        } else if (selfMul.rng() < 0.5) {
          selfMul.applyFateHeng(cS, foeS);
        }
      }
      if (cS.fenjinOnClear) {
        var posNow = ['atk', 'def', 'spAtk', 'spDef', 'spd'].filter(function (kA) { return cS.stages[kA] > 0; }).length;
        if (cS.prevPosStages > 0 && posNow === 0 && foeS && foeS.hp > 0) {
          if (foeS.immuneStatus > 0) {
            cS.pendingZhuoxin = true;
            selfMul.push(selfMul.tag(sideS) + '魂印：焚烬未触发，下回合攻击将获得灼心之焰。');
          } else {
            selfMul.applyStatus(foeS, 'burn', 1, sideS === 'me' ? '对手' : '我方');
            selfMul.push(selfMul.tag(sideS) + '魂印：自身强化被消除，对手陷入焚烬。');
          }
        }
        cS.prevPosStages = posNow;
      }
      if (cS.hpHalfRage) {
        cS.hpHalfHighB = cS.hp * 2 > cS.maxHp;
        cS.hpHalfLowB = cS.hp * 2 < cS.maxHp;
      }
      if (cS.pendingNextPrio) {
        cS.priorityBuff = { turns: 1, value: cS.pendingNextPrio };
        cS.pendingNextPrio = 0;
      }
      if (cS.foeTypeBranch && foeS) {
        if (foeS.lastSkillCategory === 4) {
          cS.immuneStatus = Math.max(cS.immuneStatus || 0, 1);
          cS.immuneStat = Math.max(cS.immuneStat || 0, 1);
          selfMul.push(selfMul.tag(sideS) + '魂印：对手使用属性技能，本回合免疫异常与能力下降。');
        } else if (foeS.lastSkillCategory === 1 || foeS.lastSkillCategory === 2) {
          cS.pendingEndFixed = { low: cS.foeTypeBranch.low, high: cS.foeTypeBranch.high };
        }
      }
      if (cS.startStageBranch) {
        var hasUpS = ['atk', 'def', 'spAtk', 'spDef', 'spd'].some(function (kU) { return cS.stages[kU] > 0; });
        if (!hasUpS) {
          cS.priorityBuff = { turns: 1, value: cS.startStageBranch.prio };
          selfMul.push(selfMul.tag(sideS) + '魂印：无强化，本回合所有技能先制 +' + cS.startStageBranch.prio + '。');
        } else {
          cS.damageBuff = { turns: 1, mul: 1 + cS.startStageBranch.dealtPct / 100 };
          selfMul.push(selfMul.tag(sideS) + '魂印：有强化，本回合攻击伤害 +' + cS.startStageBranch.dealtPct + '%。');
        }
      }
      if (cS.entryShieldFlat && cS.shield > 0) {
        cS.priorityBuff = { turns: 1, value: cS.entryShieldFlat.prio };
        selfMul.push(selfMul.tag(sideS) + '魂印：存在护盾，本回合所有技能先制 +' + cS.entryShieldFlat.prio + '。');
      }
      cS.tookAtkDmgTurn = false;
      if (cS.deadAllyPriority) {
        var teamS = (sideS === 'me' ? selfMul.me : selfMul.foe).team || [];
        var deadS = teamS.filter(function (x) { return x && x.hp === 0; }).length;
        var prioS = Math.min(cS.deadAllyPriority.cap, deadS * cS.deadAllyPriority.per);
        if (prioS > 0) cS.priorityBuff = { turns: 1, value: prioS };
      }
      if (cS.highHpImmuneAllDown && cS.hp > foeS.hp) {
        cS.immuneStatus = Math.max(cS.immuneStatus || 0, 1);
        if (selfMul.rng() * 100 < cS.highHpImmuneAllDown.chance) {
          ['atk', 'def', 'spAtk', 'spDef', 'spd'].forEach(function (k7) { foeS.stages[k7] = clampStage(foeS.stages[k7] - 1); });
          selfMul.push(selfMul.tag(sideS) + '魂印：体力高于对手，对手全属性 -1。');
        }
      }
      cS.hpDiffReduceMul = (cS.lowHpReduceAllDown && cS.hp < foeS.hp) ? (1 - cS.lowHpReduceAllDown.pct / 100) : 1;
      if (cS.lowHpReduceAllDown && cS.hp < foeS.hp) {
        cS.turnFixedTakenMul = 1 - cS.lowHpReduceAllDown.pct / 100;
        if (selfMul.rng() * 100 < cS.lowHpReduceAllDown.chance) {
          ['atk', 'def', 'spAtk', 'spDef', 'spd'].forEach(function (k8) { foeS.stages[k8] = clampStage(foeS.stages[k8] - 1); });
          selfMul.push(selfMul.tag(sideS) + '魂印：体力低于对手，减伤 ' + cS.lowHpReduceAllDown.pct + '% 且对手全属性 -1。');
        }
      }
      if (cS.shieldPriority && cS.shield > 0) {
        cS.priorityBuff = { turns: 1, value: cS.shieldPriority };
        selfMul.push(selfMul.tag(sideS) + '魂印：存在护盾，本回合先制 +' + cS.shieldPriority + '。');
      }
      if (cS.pendingFoeFear) {
        cS.pendingFoeFear = false;
        if (foeS.hp > 0) selfMul.applyStatus(foeS, 'fear', 1, sideS === 'me' ? '对手' : '我方');
      }
      if (cS.halfHpRoundLock && cS.hp > cS.maxHp / 2) {
        cS.starRoundLock = Math.max(cS.starRoundLock || 0, 1);
        selfMul.push(selfMul.tag(sideS) + '魂印：体力高于 1/2，本回合回合类效果无法被消除。');
      }
      if (cS.halfHpPrioHeal && cS.hp < cS.maxHp / 2) {
        cS.priorityBuff = { turns: 1, value: cS.halfHpPrioHeal.prio };
        cS.pendingHalfHeal = { num: cS.halfHpPrioHeal.num, den: cS.halfHpPrioHeal.den };
        selfMul.push(selfMul.tag(sideS) + '魂印：体力低于 1/2，本回合技能先制 +' + cS.halfHpPrioHeal.prio + '。');
      }
      if (cS.dodgeBuffPending) {
        cS.dodgeBuffPending = false;
        cS.damageBuff = { turns: 1, mul: 1 + cS.dodgeBuffPct / 100 };
        selfMul.push(selfMul.tag(sideS) + '魂印：闪避成功，本回合攻击伤害提升 ' + cS.dodgeBuffPct + '%。');
      }
      if (cS.highHpPrioImmune && cS.hp > foeS.hp) {
        cS.priorityBuff = { turns: 1, value: cS.highHpPrioImmune.prio };
        cS.immuneStatus = Math.max(cS.immuneStatus || 0, 1);
        selfMul.push(selfMul.tag(sideS) + '魂印：体力高于对手，本回合先制 +' + cS.highHpPrioImmune.prio + ' 且免疫异常。');
      }
      if (cS.randomUpFoeDown && cS.hp > foeS.hp) {
        var KEYS6 = ['atk', 'def', 'spAtk', 'spDef', 'spd', 'acc', 'eva'];
        var pool6 = KEYS6.slice();
        var picked6 = [];
        for (var pi6 = 0; pi6 < cS.randomUpFoeDown.count && pool6.length; pi6++) {
          picked6.push(pool6.splice(Math.floor(selfMul.rng() * pool6.length), 1)[0]);
        }
        picked6.forEach(function (k6) {
          cS.stages[k6] = clampStage(cS.stages[k6] + cS.randomUpFoeDown.stages);
          foeS.stages[k6] = clampStage(foeS.stages[k6] - cS.randomUpFoeDown.stages);
        });
        selfMul.push(selfMul.tag(sideS) + '魂印：体力高于对手，' + picked6.join('/') + ' +' + cS.randomUpFoeDown.stages + '，对手同项 -' + cS.randomUpFoeDown.stages + '。');
      }
      cS.lowHpReduceMul = (cS.lowHpExtraReduce && cS.hp < foeS.hp) ? (1 - cS.lowHpExtraReduce.num / cS.lowHpExtraReduce.den) : 1;
      if (cS.lowHpReduceMul < 1) {
        selfMul.push(selfMul.tag(sideS) + '魂印：体力低于对手，当回合受到的攻击伤害额外减少。');
      }
    });
    ['me', 'foe'].forEach(function (sideD) {
      var cD = selfMul.activeOf(sideD);
      if (!cD || cD.hp <= 0) return;
      var foeD = selfMul.activeOf(sideD === 'me' ? 'foe' : 'me');
      if (!foeD || foeD.hp <= 0) return;
      if (cD.startDamageDouble && cD.hp > foeD.hp) {
        cD.damageBuff = { turns: 1, mul: 2 };
        selfMul.push(selfMul.tag(sideD) + '魂印：体力高于对手，本回合造成伤害翻倍。');
      }
      cD.endHealByDealtActive = !!(cD.endHealByDealt && cD.hp < foeD.hp);
    });
    ['me', 'foe'].forEach(function (sideM) {
      var cM = selfMul.activeOf(sideM);
      if (!cM || cM.hp <= 0) return;
      cM.turnTakenMul = ((cM.startTakenMulPct && cM.hp > cM.maxHp / 2) ? (1 - cM.startTakenMulPct / 100) : 1) * (cM.lowHpReduceMul || 1) * (cM.hpDiffReduceMul || 1) * (cM.nyxTakenMul || 1);
      cM.nyxTakenMul = 1;
      var oppAura = selfMul.activeOf(sideM === 'me' ? 'foe' : 'me');
      cM.auraDealtMul = (oppAura && oppAura.dragonAura && selfMul.rng() < 0.5) ? 0.75 : 1;
      if (oppAura && oppAura.dragonAura && cM.auraDealtMul < 1) { cM.priorityDown = { turns: 1, value: 1 }; }
    });
    // 3414 魂印：镜像能力等级 / 无强化时 50% 免一击或减伤
    var KEYS13 = ['atk', 'def', 'spAtk', 'spDef', 'spd', 'acc', 'eva'];
    ['me', 'foe'].forEach(function (sideA) {
      var cA = selfMul.activeOf(sideA);
      if (!cA || cA.hp <= 0) return;
      var foeA = selfMul.activeOf(sideA === 'me' ? 'foe' : 'me');
      if (!foeA || foeA.hp <= 0) return;
      if (cA.mirrorFoeStages) {
        var mir = 0;
        KEYS13.forEach(function (k13) {
          if (foeA.stages[k13] > cA.stages[k13]) { mir += foeA.stages[k13] - cA.stages[k13]; foeA.stages[k13] = cA.stages[k13]; }
        });
        if (mir) selfMul.push(selfMul.tag(sideA) + '魂印：对手能力等级被拉平到与自身相同。');
      }
      if (cA.immuneNextOrHalve) {
        var hasUp13 = false;
        KEYS13.forEach(function (k14) { if (cA.stages[k14] > 0) hasUp13 = true; });
        if (!hasUp13) {
          if (selfMul.rng() * 100 < cA.immuneNextOrHalve.chance) {
            cA.oneHit += 1;
            selfMul.push(selfMul.tag(sideA) + '魂印：本回合免疫对手下次攻击伤害。');
          } else {
            cA.turnTakenMul = 1 - cA.immuneNextOrHalve.pct / 100;
            selfMul.push(selfMul.tag(sideA) + '魂印：本回合受到的攻击伤害减少 ' + cA.immuneNextOrHalve.pct + '%。');
          }
        }
      }
    });
    var self = this;
    this.exiled = { me: [], foe: [] };

    ['me', 'foe'].forEach(function (side) {
      var c = self.activeOf(side);
      if (!c || c.hp <= 0 || !c.exileAura) return;
      var foeSide = side === 'me' ? 'foe' : 'me';
      var o = self[foeSide];
      var alive = self.aliveCount(foeSide);
      var cap = Math.max(0, alive - (c.exileAura.capAliveMinus == null ? 2 : c.exileAura.capAliveMinus));
      if (cap <= 0) return;
      var hi = alive >= 5 ? c.exileAura.max : c.exileAura.lowMax;
      var lo = c.exileAura.min || 1;
      var n = Math.min(cap, lo + Math.floor(self.rng() * Math.max(1, hi - lo + 1)));
      var pool = [];
      o.team.forEach(function (m, i) {
        if (i !== o.active && m.hp > 0) pool.push(i);
      });
      var picked = [];
      for (var k = 0; k < n && pool.length; k++) {
        picked.push(pool.splice(Math.floor(self.rng() * pool.length), 1)[0]);
      }
      self.exiled[foeSide] = picked;
      if (picked.length) {
        var names = picked.map(function (i) { return o.team[i].pet.name; });
        self.push(self.tag(side) + '的神秘结界放逐了 ' + names.join('、') + '（本回合无法主动切换）。');
      }
    });

    ['me', 'foe'].forEach(function (side) {
      var c = self.activeOf(side);
      if (!c || c.hp <= 0) return;
      c.turnDealt = 0;
      c.turnDealtCrit = 0;
      c.wukongLow = false;
      c.starHadStatus = !!c.status;
      c.starWasReturn = c.starReturn;
      c.starAttackImmune = false;

      // 天启星魂：星盘转动后的 1 回合减伤；回返期间免疫攻击
      if (c.starGuardTurns > 0) {
        c.guards.push({ turns: 1, mul: 1 - (c.starDialCfg ? c.starDialCfg.reducePct : 99) / 100, scope: 'all' });
        c.starPpZero = true;
        c.starGuardTurns = 0;
        self.push(self.tag(side) + c.pet.name + ' 的星盘余威：本回合受伤减少 99%。');
      }
      if (c.starReturn && c.starDial > 0) {
        c.starAttackImmune = true;
        self.push(self.tag(side) + c.pet.name + ' 处于星盘回返，本回合免疫对手攻击。');
      }

      // 孙悟空：法天象地·圣（每场一次；异常 + 半血以下触发）
      if (c.wukongForm && !c.wukongFormUsed && c.status && c.hp < c.maxHp / 2) {
        c.wukongFormUsed = true;
        c.wukongFormTurns = 3;
        c.hp = c.maxHp;
        c.status = null;
        c.skills.forEach(function (sl) { sl.pp = sl.maxPp; });
        c.immuneStatus = Math.max(c.immuneStatus, 3);
        c.critBuffTurns = Math.max(c.critBuffTurns, 3);
        var pbF = (c.priorityBuff && c.priorityBuff.turns > 0) ? c.priorityBuff : { turns: 0, value: 0 };
        c.priorityBuff = { turns: Math.max(pbF.turns, 3), value: Math.max(pbF.value, 1) };
        self.push(self.tag(side) + c.pet.name + ' 触发「法天象地·圣」：体力、PP、异常状态全部重置！');
      }

      // 孙悟空：按对手体力分支
      if (c.wukongTurn) {
        var foeW = self.activeOf(side === 'me' ? 'foe' : 'me');
        if (foeW && foeW.hp > foeW.maxHp / 2) {
          c.turnDealt = 1.5;
          c.turnDealtCrit = 2;
          self.push(self.tag(side) + c.pet.name + ' 的攻势提升：本回合攻击伤害 +50%（暴击时 +100%）。');
        } else if (foeW && foeW.hp < foeW.maxHp / 2) {
          c.wukongLow = true;
          var pbW = (c.priorityBuff && c.priorityBuff.turns > 0) ? c.priorityBuff : { turns: 0, value: 0 };
          c.priorityBuff = { turns: Math.max(pbW.turns, 1), value: Math.max(pbW.value, 1) };
          self.push(self.tag(side) + c.pet.name + ' 乘胜追击：本回合全技能先制 +1，使用后追加百分比伤害。');
        }
      }

      // 沙悟净：回合开始时满体力 → 当回合受到的攻击伤害减半
      if (c.fullHpGuardPct > 0 && c.hp === c.maxHp) {
        c.guards.push({ turns: 1, mul: 1 - c.fullHpGuardPct / 100, scope: 'all' });
        self.push(self.tag(side) + c.pet.name + ' 满体力护体：本回合受到的攻击伤害减少 ' + c.fullHpGuardPct + '%。');
      }

      // 马尔修斯：形态切换 / 护盾重激活 / 低血秒杀
      if (c.morphSwitchNext) {
        c.morphMode = c.morphSwitchNext;
        c.morphSwitchNext = null;
        self.push(self.tag(side) + c.pet.name + ' 切换为' + (c.morphMode === 'destroy' ? '毁灭形态' : '极速形态') + '。');
      }
      if (c.morphGuard && !c.shieldActive) {
        if (c.shieldRecharge > 0) c.shieldRecharge--;
        if (c.shieldRecharge <= 0) {
          c.shieldActive = true;
          c.shield = Math.max(c.shield, c.morphGuard.shield);
          c.statusGuard = Math.max(c.statusGuard, 1);
          self.push(self.tag(side) + c.pet.name + ' 的坚壁护盾重新激活（' + c.morphGuard.shield + ' 点）。');
        }
      }
      var foeM = self.activeOf(side === 'me' ? 'foe' : 'me');
      c.formExec = false;
      if (c.lowHpExecPct > 0 && foeM && foeM.hp > 0) {
        var execOk = !c.morphDestroy || c.morphMode === 'destroy';
        if (execOk && foeM.hp < foeM.maxHp * c.lowHpExecPct / 100) c.formExec = true;
      }
      if (c.pendingSpeedUp) {
        c.stages.spd = clampStage(c.stages.spd + 1);
        c.pendingSpeedUp = false;
        self.push(self.tag(side) + c.pet.name + ' 先手追击：速度 +1。');
      }
    });

    ['me', 'foe'].forEach(function (side) {
      var c = self.activeOf(side);
      if (!c || c.hp <= 0 || !c.divineTurn) return;
      var half = c.maxHp / 2;
      if (c.hp > half) {
        c.immuneStatus = Math.max(c.immuneStatus, 1);
        c.immuneStat = Math.max(c.immuneStat, 1);
        self.push(self.tag(side) + c.pet.name + ' 的神启生效：本回合免疫异常与能力下降。');
      } else if (c.hp < half) {
        var sh = Math.max(1, Math.round(c.maxHp * c.divineTurn.shieldPct / 100));
        c.shield += sh;
        self.push(self.tag(side) + c.pet.name + ' 的神启生效：获得 ' + sh + ' 点护盾。');
      }
    });
  };

  /** 天启星魂：星启（清异常，按双攻高低附加星赐/星哲） */
  Battle.prototype.starInit = function (c) {
    if (!c || !c.starEntry) return;
    var had = !!c.status;
    c.status = null;
    if (had) c.starStatusEnded = true;
    var st;
    if (c.stats.atk > c.stats.spAtk) st = 'gift';
    else if (c.stats.spAtk > c.stats.atk) st = 'phil';
    else st = this.rng() < 0.5 ? 'gift' : 'phil';
    if (st === 'gift') c.starGift = Math.max(c.starGift, 2);
    else c.starPhil = Math.max(c.starPhil, 2);
    this.push(this.tag(c.side) + c.pet.name + ' 进行星启：' + (st === 'gift' ? '星赐' : '星哲') + ' 2 回合。');
  };

  /** 天启星魂：星盘转动 1 刻 */
  Battle.prototype.starRotate = function (c) {
    if (!c || !c.starDialCfg || c.starReturn) return false;
    c.starDial = Math.min(c.starDialCfg.maxTicks, c.starDial + 1);
    c.starGuardTurns = 1;
    c.starReEntryDue = this.turn + 1;
    if (c.starDial >= c.starDialCfg.maxTicks) c.starReturn = true;
    this.push(this.tag(c.side) + c.pet.name + ' 的星盘转动至 ' + c.starDial + ' 刻。');
    return true;
  };

  Battle.prototype.snapshot = function () {
    var self = this;
    function sideOf(s) {
      var o = self[s];
      return {
        active: o.active,
        team: o.team.map(function (c, i) {
          return {
            index: i,
            id: c.pet.id,
            name: c.pet.name,
            hp: c.hp,
            maxHp: c.maxHp,
            alive: c.hp > 0,
            active: i === o.active,
            exiled: (self.exiled && self.exiled[s] || []).indexOf(i) >= 0,
            level: c.level,
            soulmarks: (c.soulmarks || []).map(function (m) {
              return { id: m && m.id, name: (m && m.name) || '', desc: (m && m.desc) || '' };
            }),
            combo: c.combo ? c.combo.name : '',
            comboId: c.combo ? c.combo.id : null,
            stages: {
              atk: c.stages.atk, def: c.stages.def, spAtk: c.stages.spAtk,
              spDef: c.stages.spDef, spd: c.stages.spd, acc: c.stages.acc, eva: c.stages.eva
            },
            effects: effectsOf(c),
            status: c.status ? {
              id: c.status.id,
              name: STATUS_DEF[c.status.id].name,
              short: STATUS_DEF[c.status.id].short,
              turns: c.status.turns
            } : null,
            shield: c.shield || 0,
            holyMarks: c.holyMarks || 0,
            guard: c.guards.length > 0,
            immune: (c.immuneStatus > 0 || c.immuneStat > 0 || !!c.immuneBelow || c.oneHit > 0),
            skills: c.skills.map(function (sl) {
              return {
                id: sl.skill.id,
                name: sl.skill.name,
                pp: sl.pp,
                maxPp: sl.maxPp,
                power: num(sl.skill.power),
                category: sl.skill.category ? sl.skill.category.id : 1,
                type: sl.skill.type ? sl.skill.type.id : null
              };
            })
          };
        })
      };
    }
    return {
      over: this.over,
      winner: this.winner,
      turn: this.turn,
      needPlayerSwitch: this.needPlayerSwitch,
      needSwitch: { me: this.needSwitch.me, foe: this.needSwitch.foe },
      field: this.field ? { name: this.field.name, turns: this.field.turns } : null,
      lastCrit: this.lastCrit || null,
      items: {
        me: this.items.me.map(function (x) { return { id: x.id, name: x.name, desc: x.desc, count: x.count }; }),
        foe: this.items.foe.map(function (x) { return { id: x.id, name: x.name, desc: x.desc, count: x.count }; })
      },
      me: sideOf('me'),
      foe: sideOf('foe')
    };
  };

  // 技能面板「结算补充」：这些技能的效果由专门代码结算（不在 parseSkillEffects 的 fx 里），
  // 面板按 id 追加显示，避免出现「效果原文 4 条、已接入结算只有 1 条」的误解。
  var SKILL_IMPL_NOTES = {
    30376: ['消除对手回合类效果（成功则随机 2 个技能 PP 归零）', '消除对手能力提升（成功则下 2 回合星皇之怒概率 +20%）', '技能结束后对手体力 >0 时 50% 额外行动（星怒：对手无强化则追加最大体力 1/3 百分比伤害）'],
    25294: ['3 回合内对手用属性技 → 命中前随机 1-3 个技能各降 1-3 点 PP', '3 回合内对手用攻击技 → 使用后受其最大体力 1/3 百分比伤害', '己方免疫下 2 次受到的异常状态', '星怒：2 回合内回合类效果不可被消除、下 2 回合自身先制 +2'],
    25295: ['全属性 +1（当前体力低于 1/2 时翻倍）', '4 回合内每回合使用技能吸对手最大体力 1/3（低于 1/2 翻倍）', '下 2 次星皇之怒概率翻倍', '星怒：下 2 回合攻击伤害翻倍、受到攻击伤害额外 -50%'],
    30380: ['攻击伤害低于 280 → 令对手疲惫', '未击败对手 → 对手下 1 回合攻击技能无效', '星怒：50% 令对手失明，未触发则 2 回合内对手属性技能无效'],
    30381: ['暴击率提升 20%，每次使用再 +20%（上限 100%）', '打出暴击后下 2 次星皇之怒威力不再减少', '星怒：下 2 次攻击技能先制 +2'],
    37509: ['消除对手强化，成功则令对手疲惫；未触发则回复自身最大体力 1/3', '下 2 回合自身造成的攻击伤害翻倍'],
    37510: ['断回合成功 → 令对手疲惫', '消耗自身全部体力，己方下只精灵获得消耗值 50% 的护盾与护罩', '为对手附加 3 层蚩庸之锁（超上限则对手下 2 回合先制 -1）', '己方免疫下 1 次受到的异常状态'],
    37511: ['每层蚩庸之锁令对手随机 1 个攻击技能 PP 归零', '对手有 PP 的攻击技能数不足锁层时，本次伤害 +100%', '击败对手 → 对手下 1 次属性技能无效'],
    28808: ['对手处于能力下降时先制 +2', '4 回合内对手能力下降不可被解除/反转'],
    28809: ['4 回合内使用技能吸对手 1/3 最大体力（低于 1/2 翻倍）', '为对手附加 1 层蚩庸之锁（超上限则对手下 2 回合先制 -1）', '下 2 回合自身所有技能先制 +2'],
    24833: ['降低对手所有 PP 1 点，并恢复自身所有 PP 1 点', '3 回合内对手使用技能消耗的 PP 变为 2 倍'],
  };
  function skillImplNotes(skill) {
    if (!skill || skill.id == null) return [];
    return SKILL_IMPL_NOTES[skill.id] || [];
  }

  return {
    STAT_LABEL: STAT_LABEL,
    STATUS_DEF: STATUS_DEF,
    FIELD_PRESETS: FIELD_PRESETS,
    clampStage: clampStage,
    stageMul: stageMul,
    accuracyMul: accuracyMul,
    computeStats: computeStats,
    buildChart: buildChart,
    comboElements: comboElements,
    effectiveness: effectiveness,
    pcEffectiveness: pcEffectiveness,
    setPcRules: function (on) { pcRules = !!on; return pcRules; },
    getPcRules: function () { return pcRules; },
    parseEffectInfo: parseEffectInfo,
    parseOneEffect: parseOneEffect,
    parseSkillEffects: parseSkillEffects,
    parseSoulmark: parseSoulmark,
    skillImplNotes: skillImplNotes,
    KEYWORD_DEFS: KEYWORD_DEFS,
    soulmarkDisabled: soulmarkDisabled,
    keywordHits: keywordHits,
    calcDamage: calcDamage,
    Battle: Battle
  };
});
