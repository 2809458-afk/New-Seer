/* 界面逻辑：图鉴 / 队伍 / 对战 / 数据同步 */
(function () {
  'use strict';

  var Api = window.SeerApi;
  var Db = window.SeerDb;
  var B = window.SeerBattle;

  var TYPE_COLORS = {
    grass: '#7ac74c', water: '#4d90fe', fire: '#ff6b3d', flying: '#a890f0',
    electric: '#f7d02c', steel: '#9aa7b8', ground: '#d9a066', normal: '#b8b8a8',
    ice: '#66d9ff', psychic: '#ff6fa5', fight: '#d0563a', light: '#ffe066',
    dark: '#5a4a6e', myth: '#c47bff', dragon: '#6a5acd', saint: '#e8f0ff',
    dimension: '#8f6bff', ancient: '#b08050', demon: '#7a3b5c', nature: '#8fbf5a',
    king: '#e0b040', chaos: '#6b4f8a', deity: '#ffd700', samsara: '#9ad0c2',
    insect: '#a8b820', void: '#3b3b5c'
  };
  var CAT_LABEL = { 1: '物理', 2: '特殊', 4: '属性' };
  // 常见套装的特效（属性加成走 suit.bonus.attribute；这里只补战斗钩子）
  var SUIT_PASSIVES = {
    365: [{ kind: 'dealt', value: 1.3 }, { kind: 'firstDealt', value: 1.3 }],       // 银翼骑士
    377: [{ kind: 'dealt', value: 1.4 }, { kind: 'critBonus', value: 12.5 }],        // 皇帝战铠
    393: [{ kind: 'critDamage', value: 1.15 }],                                     // 笑傲巅峰
    387: [{ kind: 'ignoreDefPctPassive', value: 15 }],                               // 腐蚀者
    // 2020 年至今（ID >= 400）：属性走 attribute，这里补可确定的特效
    401: [{ kind: 'firstDealt', value: 1.7 }],                                       // 零度
    402: [{ kind: 'firstDealt', value: 1.15 }],                                      // 瀚海（首击）
    411: [{ kind: 'regen', value: 50 }],                                             // 元神守护
    413: [{ kind: 'onHitExtraFlat', chance: 1, value: 2020 }],                       // 金狮祥瑞
    415: [{ kind: 'critBonus', value: 5 }],                                          // 勇者战甲
    421: [{ kind: 'critDamage', value: 1.15 }, { kind: 'critBonus', value: 6.25 }],  // 永夜玄铠
    425: [{ kind: 'onHitExtraFlat', chance: 100, value: 120 }],                      // 乾古
    430: [{ kind: 'firstDealt', value: 1.13 }],                                      // 圣乐
    431: [{ kind: 'firstDealt', value: 1.13 }],                                      // 圣乐典藏
    438: [{ kind: 'critBonus', value: 14 }],                                         // 祥龙
    447: [{ kind: 'dealt', value: 1.1 }, { kind: 'taken', value: 0.9 }],             // 晨曦（近似）
    448: [{ kind: 'dealt', value: 1.4 }],                                            // 漆黑天使（护盾/首暴暂未接）
    458: [{ kind: 'dealt', value: 1.15 }],                                           // 遗迹守护
    462: [{ kind: 'dealt', value: 1.4 }],                                            // 影翼裁决（护罩成长暂未接）
    465: [{ kind: 'critDamage', value: 1.35 }, { kind: 'critBonus', value: 25 }],    // 魔王克星
    474: [{ kind: 'taken', value: 0.9 }],                                            // 天人
    477: [{ kind: 'dealt', value: 1.25 }]                                            // 黄金的逆袭
  };
  var RESOURCES = [
    { name: 'element_type', label: '属性', store: 'types' },
    { name: 'element_type_combination', label: '属性组合', store: 'combos' },
    { name: 'nature', label: '性格', store: 'natures' },
    { name: 'soulmark', label: '魂印', store: 'soulmarks' },
    { name: 'mintmark', label: '刻印', store: 'mintmarks', format: 2, slim: function (m) {
      return { id: m.id, name: m.name, desc: m.desc, type: m.type && m.type.id, rarity: m.rarity && m.rarity.id, attr: m.max_attr_value, base: m.base_attr_value, skill: m.skill };
    } },
    { name: 'suit', label: '套装', store: 'suits', format: 2, slim: function (s) {
      return { id: s.id, name: s.name, desc: s.suit_desc, bonus: s.bonus };
    } },
    { name: 'pet', label: '精灵', store: 'pets', format: 2 },
    { name: 'skill', label: '技能', store: 'skills' }
  ];
  var TEAM_KEY = 'seer-fan-team';
  var LOADOUT_KEY = 'seer-fan-loadout';
  var BUILD_KEY = 'seer-fan-build';
  var SUIT_KEY = 'seer-fan-suit';

  var state = {
    pets: [],
    petById: {},
    combos: {},
    typesArr: [],
    typeById: {},
    natures: [],
    natureById: {},
    soulmarkById: {},
    petSoulmarks: {},
    mintmarks: [],
    mintmarkById: {},
    suits: [],
    suitById: {},
    loadouts: {},
    builds: {},
    suitId: null,
    team: new Array(12).fill(null),
    skillCache: {},
    classCache: {},
    detailId: null,
    search: '',
    typeFilter: '',
    listLimit: 200,
    renderedCount: 0,
    configId: null,
    battle: null,
    chart: null,
    busy: false
  };
  var dragFrom = null;
  // ---------- 小工具 ----------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function toast(msg, isErr) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.className = 'toast'; }, 2600);
  }
  function fmtTime(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function comboOf(pet) { return pet && pet.type ? state.combos[pet.type.id] : null; }
  function typeColor(combo) {
    if (!combo || !combo.primary) return '#8899bb';
    var t = state.typeById[combo.primary.id];
    return (t && TYPE_COLORS[t.name_en]) || '#8899bb';
  }
  function badge(combo) {
    var b = el('span', 'badge', combo ? combo.name : '未知');
    b.style.background = typeColor(combo);
    return b;
  }
  function wikiImage(prefix, id) {
    if (prefix === '套装' && window.SEER_SUIT_ART && window.SEER_SUIT_ART[id]) {
      return 'assets/suits/' + window.SEER_SUIT_ART[id];
    }
    if (prefix === '刻印' && window.SEER_MINTMARK_ART && window.SEER_MINTMARK_ART[id]) {
      return 'assets/mintmarks/' + window.SEER_MINTMARK_ART[id];
    }
    return 'https://wiki.biligame.com/seer/Special:Redirect/file/' + encodeURIComponent(prefix + '-' + id) + '.png';
  }
  function attrText(attr) {
    if (!attr) return '无属性加成';
    var m = { hp: '体力', atk: '攻击', def: '防御', sp_atk: '特攻', sp_def: '特防', spd: '速度' };
    var pct = attr.percent ? '%' : '';
    var arr = [];
    Object.keys(m).forEach(function (k) {
      var v = Number(attr[k] || 0);
      if (v) arr.push(m[k] + '+' + v + pct);
    });
    return arr.length ? arr.join(' · ') : '无属性加成';
  }
  function setProgress(pct) { $('#progressBar').style.width = Math.max(0, Math.min(100, pct)) + '%'; }
  function setProgressText(s) { $('#progressText').textContent = s; }

  // ---------- 启动 ----------
  document.addEventListener('DOMContentLoaded', function () {
    bindUI();
    boot();
  });


  /** #debugdex：把图鉴卡片的真实 DOM/样式打印到页面上，供排查 */
  function runDexDebug() {
    switchTab('pokedex');
    setTimeout(function () {
      var out = [];
      out.push('精灵总数: ' + (state.pets ? state.pets.length : 0));
      out.push('立绘索引: ' + (window.SEER_ART ? Object.keys(window.SEER_ART).length + ' 条' : '未加载'));
      var first = state.pets && state.pets[0];
      out.push('第一只: ' + (first ? JSON.stringify({ id: first.id, name: first.name, type: first.type && first.type.id }) : '无'));
      var card = document.querySelector('#petList .pet-card');
      if (!card) {
        out.push('没有渲染出 .pet-card');
        var anyChild = document.querySelector('#petList > *');
        out.push('列表第一个子元素: ' + (anyChild ? anyChild.className : '空'));
      } else {
        var thumb = card.querySelector('.pet-thumb');
        var name = card.querySelector('.pet-name');
        out.push('卡片高度: ' + Math.round(card.getBoundingClientRect().height));
        out.push('缩略图高度: ' + (thumb ? Math.round(thumb.getBoundingClientRect().height) : '不存在'));
        out.push('缩略图背景: ' + (thumb ? getComputedStyle(thumb).backgroundImage.slice(0, 60) : '-'));
        out.push('名字高度: ' + (name ? Math.round(name.getBoundingClientRect().height) : '不存在'));
        out.push('卡片 HTML: ' + card.outerHTML.replace(/\s+/g, ' ').slice(0, 260));
      }
      // 检查样式表里有没有关键规则
      var found = false;
      try {
        for (var i = 0; i < document.styleSheets.length; i++) {
          var rules = document.styleSheets[i].cssRules || [];
          for (var j = 0; j < rules.length; j++) {
            if (rules[j].selectorText === '.pet-thumb' && /104px|height/.test(rules[j].cssText)) found = true;
          }
        }
      } catch (e) { out.push('读取样式表失败: ' + e.message); }
      out.push('.pet-thumb 规则(104px): ' + (found ? '已加载' : '缺失'));
      out.push('样式表数量: ' + document.styleSheets.length);

      var pre = document.createElement('pre');
      pre.style.cssText = 'position:fixed;left:10px;top:10px;right:10px;max-height:70vh;overflow:auto;z-index:9999;' +
        'background:#0d1526;border:1px solid #24406e;border-radius:10px;padding:12px;white-space:pre-wrap;' +
        'font:13px/1.6 Consolas,monospace;color:#dbe8ff';
      pre.textContent = out.join('\n');
      document.body.appendChild(pre);
    }, 800);
  }

  async function boot() {
    try {
      // 可选规则口径（B10 双系克制）：默认关闭，URL 带 pcRules=1 才打开
      if (B && B.setPcRules && /[?&#]pcRules=1/.test(location.search + location.hash)) B.setPcRules(true);
      loadLoadouts();
      loadBuilds();
      await loadLocal();
      // 离线数据包：本地库为空时自动导入项目冻结数据（不改界面，只填数据）
      if (!state.pets.length && window.SeerLocalPack && window.SeerLocalPack.ready()) {
        try {
          await window.SeerLocalPack.importIntoDb();
          await loadLocal();
        } catch (e) { console.error(e); }
      }
      // 配置存档：schema1 快照优先；首次运行从旧四个 localStorage 键迁移
      var saveStore = saveApi();
      // 文件后端（Tauri）是异步的，启动时要等它读完
      var snapshot = null;
      if (saveStore && typeof saveStore.loadAsync === 'function') snapshot = await saveStore.loadAsync();
      else if (saveStore) snapshot = saveStore.load();
      if (snapshot) {
        if (snapshot.builds) state.builds = snapshot.builds;
        if (snapshot.loadouts) state.loadouts = snapshot.loadouts;
        state.suitId = snapshot.suit ? snapshot.suit : null;
        state.team = normalizeTeam(snapshot.team);
        if (saveStore.messageOf()) toast(saveStore.messageOf(), true);
      } else if (saveStore && !saveStore.isReadOnly()) {
        migrateLegacySave();
      } else if (saveStore && saveStore.messageOf()) {
        toast(saveStore.messageOf(), true);
      }
      if (state.suitId != null && !state.suitById[state.suitId]) state.suitId = null;
      renderAll();
      if (!state.pets.length) {
        toast('本地库是空的，先到「数据仓库」点快速同步');
      }

      // 邀请链接：#join=房间码
      var joinMatch = /[#?&]join=([a-z0-9]+)/i.exec(location.hash + location.search);
      if (joinMatch) {
        switchTab('online');
        $('#joinCode').value = joinMatch[1];
        setTimeout(function () { joinRoomByCode(joinMatch[1]); }, 500);
      }

      // 自检入口：#autotest —— 用假数据跑一局，检验渲染链路
      if (location.hash.indexOf('debugdex') >= 0) runDexDebug();

      if (/[#&?]autotest/.test(location.hash + location.search)) {
        runAutotest();
      }
    } catch (e) {
      console.error(e);
      toast('本地库打开失败：' + e.message, true);
    }
  }

  async function loadLocal() {
    var pets = await Db.getAll('pets');
    var combos = await Db.getAll('combos');
    var types = await Db.getAll('types');
    var natures = await Db.getAll('natures');
    var soulmarks = await Db.getAll('soulmarks');
    var mintmarks = await Db.getAll('mintmarks');
    var suits = await Db.getAll('suits');

    state.pets = pets.sort(function (a, b) { return a.id - b.id; });
    state.petById = {};
    state.pets.forEach(function (p) { state.petById[p.id] = p; });

    state.combos = {};
    combos.forEach(function (c) { state.combos[c.id] = c; });

    state.typesArr = types.sort(function (a, b) { return a.id - b.id; });
    state.typeById = {};
    state.typesArr.forEach(function (t) { state.typeById[t.id] = t; });

    state.natures = natures.sort(function (a, b) { return a.id - b.id; });
    state.natureById = {};
    state.natures.forEach(function (n) { state.natureById[n.id] = n; });
    state.skillCache = {};
    state.classCache = {};

    state.mintmarks = mintmarks.sort(function (a, b) { return a.id - b.id; });
    state.mintmarkById = {};
    state.mintmarks.forEach(function (m) { state.mintmarkById[m.id] = m; });
    state.suits = suits.sort(function (a, b) { return a.id - b.id; });
    state.suitById = {};
    state.suits.forEach(function (s) { state.suitById[s.id] = s; });
    if (state.suitId != null && !state.suitById[state.suitId]) state.suitId = null;

    // 魂印：建立 精灵 → 魂印 的反向索引
    state.soulmarkById = {};
    state.petSoulmarks = {};
    soulmarks.forEach(function (s) {
      state.soulmarkById[s.id] = s;
      (s.pets || []).forEach(function (pid) {
        if (B.soulmarkDisabled && B.soulmarkDisabled(pid, s.id)) return;   // 已废弃魂印（如 2987 的 372）
        if (!state.petSoulmarks[pid]) state.petSoulmarks[pid] = [];
        state.petSoulmarks[pid].push(s.id);
      });
    });
  }

  function renderAll() {
    renderTypeFilter();
    renderPetList();
    renderTeam();
    renderMeta();
    updateSyncState();
  }

  function updateSyncState() {
    var n = $('#syncState');
    if (state.pets.length) {
      n.textContent = '本地库 · ' + state.pets.length + ' 只精灵';
      n.className = 'sync-state ok';
    } else {
      n.textContent = '尚未同步数据';
      n.className = 'sync-state warn';
    }
  }

  // ---------- 事件绑定 ----------
  var BUILD_TAG = 'v20261022d';

  function bindUI() {
    var bt = document.getElementById('buildTag');
    if (bt) bt.textContent = BUILD_TAG;
    SeerStage.onSoul = showSoulSheet;
  SeerStage.onTip = function (text) { showTipSheet('名词解释', text); };
    $('#sheetClose').addEventListener('click', function () { $('#sheet').classList.add('hidden'); });
    $('#sheet').addEventListener('click', function (e) {
      if (e.target.id === 'sheet') $('#sheet').classList.add('hidden');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') $('#sheet').classList.add('hidden');
    });
    $('#tabs').addEventListener('click', function (e) {
      var btn = e.target.closest('.tab');
      if (!btn) return;
      document.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('active', b === btn); });
      document.querySelectorAll('.panel').forEach(function (p) { p.classList.remove('active'); });
      var panel = $('#panel-' + btn.dataset.tab);
      if (panel) panel.classList.add('active');
    });

    $('#searchInput').addEventListener('input', function (e) {
      state.search = e.target.value.trim();
      state.listLimit = 200;
      renderPetList();
    });

    $('#typeFilter').addEventListener('change', function (e) {
      state.typeFilter = e.target.value;
      state.listLimit = 200;
      renderPetList();
    });

    $('#clearTeam').addEventListener('click', function () {
      state.team = new Array(12).fill(null);
      saveTeam();
      renderTeam();
      toast('背包已清空');
    });

    $('#toBattle').addEventListener('click', function () {
      document.querySelector('.tab[data-tab="battle"]').click();
    });

    $('#startBattle').addEventListener('click', startBattle);
    $('#quitBattle').addEventListener('click', function () {
      toggleAuto(false);
      state.battle = null;
      $('#battleView').classList.add('hidden');
      $('#battleSetup').classList.remove('hidden');
    });

    $('#checkUpdate').addEventListener('click', checkUpdate);
    $('#healthCheck').addEventListener('click', healthCheck);
    $('#syncQuick').addEventListener('click', function () { runSync(false); });
    $('#syncFull').addEventListener('click', function () { runSync(true); });
    $('#clearDb').addEventListener('click', async function () {
      if (!confirm('清空后需要重新同步才能玩，确定吗？')) return;
      await Db.clearAll();
      state.pets = []; state.petById = {}; state.combos = {}; state.typesArr = []; state.typeById = {}; state.natures = []; state.natureById = {};
      state.mintmarks = []; state.mintmarkById = {}; state.suits = []; state.suitById = {};
      state.skillCache = {}; state.classCache = {};
      renderAll();
      setProgress(0);
      setProgressText('本地库已清空');
      toast('本地库已清空');
    });

    $('#toggleAuto').addEventListener('click', function () { toggleAuto(); });
    document.querySelectorAll('.btn.speed').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.btn.speed').forEach(function (x) {
          x.classList.toggle('active', x === btn);
        });
        var v = Number(btn.dataset.speed);
        autoBattle.speed = v === 0 ? 8 : v;
        SeerStage.setSpeed(v);
      });
    });

    setupOnline();
  }

  var saveWarned = false;

  function saveApi() {
    if (typeof window === 'undefined' || !window.SeerSave) return null;
    // Tauri 客户端里优先用文件后端（异步 IO），浏览器里仍走 localStorage
    if (window.SeerSave.inTauri && window.SeerSave.inTauri()) {
      var file = window.SeerSave.tauriStore();
      if (file) return file;
    }
    return window.SeerSave.store ? window.SeerSave.store() : null;
  }

  /** #autotest 用的是假数据，绝不写进玩家存档 */
  function inAutotest() {
    return typeof location !== 'undefined' && /[#&?]autotest/.test(location.hash + location.search);
  }

  /** 整份配置写进 schema1 快照（队伍 / 培养 / 套装 / 配招） */
  function saveSnapshot() {
    if (inAutotest()) return { ok: true, skipped: true };
    var store = saveApi();
    if (!store) return { ok: false, message: '存档模块未加载' };
    var payload = {
      schema: 1,
      team: state.team.slice(0, 12),
      builds: state.builds,
      suit: state.suitId == null ? 0 : state.suitId,
      loadouts: state.loadouts
    };
    var r = store.save(payload);
    // 文件后端返回 Promise：失败时提示一次，成功不打扰
    if (r && typeof r.then === 'function') {
      r.then(function (res) {
        if (res && !res.ok && !saveWarned) { saveWarned = true; toast('存档未保存：' + res.message, true); }
      });
      return { ok: true, pending: true };
    }
    if (!r.ok && !saveWarned) {
      saveWarned = true;
      toast('存档未保存：' + r.message, true);
    }
    return r;
  }

  /** 旧版本的四个 localStorage 键 → schema1（只迁移一次，旧键保留不删） */
  function migrateLegacySave() {
    function read(key, fallback) {
      try {
        var raw = localStorage.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    }
    var legacyTeam = read(TEAM_KEY, null);
    var legacyBuilds = read(BUILD_KEY, null);
    var legacySuit = read(SUIT_KEY, null);
    var legacyLoadouts = read(LOADOUT_KEY, null);
    if (!legacyTeam && !legacyBuilds && legacySuit == null && !legacyLoadouts) return false;
    state.builds = legacyBuilds || {};
    state.loadouts = legacyLoadouts || {};
    state.suitId = legacySuit == null ? null : legacySuit;
    if (legacyTeam) state.team = normalizeTeam(legacyTeam);
    var r = saveSnapshot();
    if (r.ok) console.log('[save] 已把旧存档迁移到 schema1');
    return r.ok;
  }

  function saveTeam() {
    saveSnapshot();
  }

  function normalizeTeam(arr) {
    var out = new Array(12).fill(null);
    (arr || []).slice(0, 12).forEach(function (id, i) {
      if (id != null && state.petById[id]) out[i] = id;
    });
    return out;
  }

  function buildFor(petId) {
    var b = state.builds[petId] || {};
    var marks = (b.marks || []).slice(0, 3);
    while (marks.length < 3) marks.push(null);
    var ev = { hp: 0, atk: 0, def: 0, sp_atk: 0, sp_def: 0, spd: 0 };
    var evLeft = 510;
    Object.keys(ev).forEach(function (k) {
      var v = b.ev && b.ev[k] != null ? Math.max(0, Math.min(255, b.ev[k] | 0)) : 0;
      v = Math.min(v, evLeft);
      ev[k] = v;
      evLeft -= v;
    });
    var resist = {
      fixed: b.resist && b.resist.fixed != null ? Math.max(0, Math.min(35, b.resist.fixed | 0)) : 0,
      percent: b.resist && b.resist.percent != null ? Math.max(0, Math.min(35, b.resist.percent | 0)) : 0,
      crit: b.resist && b.resist.crit != null ? Math.max(0, Math.min(35, b.resist.crit | 0)) : 0,
      status: b.resist && b.resist.status != null ? Math.max(0, Math.min(50, b.resist.status | 0)) : 0
    };
    return {
      natureId: b.natureId == null ? null : b.natureId,
      talent: b.talent == null ? 31 : Math.max(0, Math.min(31, b.talent | 0)),
      level: b.level == null ? 100 : Math.max(1, Math.min(100, b.level | 0)),
      marks: marks,
      ev: ev,
      resist: resist
    };
  }

  // 值由 schema1 快照填充（见 boot / migrateLegacySave）
  function loadBuilds() {
    state.builds = {};
    state.suitId = null;
  }

  function saveBuild(petId, patch) {
    var b = buildFor(petId);
    if (patch) Object.keys(patch).forEach(function (k) { b[k] = patch[k]; });
    state.builds[petId] = b;
    saveSnapshot();
  }

  function saveSuit() {
    saveSnapshot();
  }

  // 值由 schema1 快照填充（见 boot / migrateLegacySave）
  function loadLoadouts() {
    state.loadouts = {};
  }

  function saveLoadouts() {
    saveSnapshot();
  }

  function normalizeLoadout(v) {
    if (!v) return { n: [], f: null };
    if (Array.isArray(v)) return { n: v.slice(0, 4), f: null };
    return { n: (v.n || []).slice(0, 4), f: v.f == null ? null : v.f };
  }

  function getLoadout(petId) {
    return normalizeLoadout(state.loadouts[petId]);
  }

  /** 按精灵清洗配招：普通位里不能出现第五技能，第五位也必须是合法候选 */
  function loadoutFor(pet) {
    var lo = getLoadout(pet.id);
    var fifthIds = pet.fifth || [];
    lo.n = lo.n.filter(function (id) { return fifthIds.indexOf(id) < 0; }).slice(0, 4);
    if (lo.f != null && fifthIds.indexOf(lo.f) < 0) lo.f = null;
    return lo;
  }

  function toggleNormal(petId, skillId) {
    var lo = getLoadout(petId);
    var i = lo.n.indexOf(skillId);
    if (i >= 0) {
      lo.n.splice(i, 1);
    } else {
      if (lo.n.length >= 4) { toast('普通技能最多选 4 个', true); return; }
      lo.n.push(skillId);
    }
    state.loadouts[petId] = lo;
    saveLoadouts();
    refreshPicks(petId);
  }

  function pickFifth(petId, skillId) {
    var lo = getLoadout(petId);
    lo.f = (lo.f === skillId) ? null : skillId;
    state.loadouts[petId] = lo;
    saveLoadouts();
    refreshPicks(petId);
  }

  function refreshPicks(petId) {
    var pet = state.petById[petId] || { id: petId };
    var lo = loadoutFor(pet);
    document.querySelectorAll('.pick').forEach(function (b) {
      var on = lo.n.indexOf(Number(b.dataset.skillId)) >= 0;
      b.textContent = on ? '已选' : '选用';
      b.classList.toggle('primary', on);
    });
    document.querySelectorAll('.pick5').forEach(function (b) {
      var on = lo.f === Number(b.dataset.skillId);
      b.textContent = on ? '携带中' : '携带';
      b.classList.toggle('primary', on);
    });
    ['#pickCount', '#teamPickCount'].forEach(function (sel) {
      var cnt = document.querySelector(sel);
      if (!cnt) return;
      var total = cnt.dataset.total ? ('共 ' + cnt.dataset.total + ' 个技能 · ') : '';
      cnt.textContent = total + '已选 ' + lo.n.length + ' / 4' + (lo.f ? ' · 第五技能已选' : '');
    });
    var tg = document.getElementById('teamSkillToggle');
    if (tg) tg.textContent = '技能配置 · 已选 ' + lo.n.length + '/4' + (lo.f ? ' + 第五' : '');
  }

  // ---------- 图鉴 ----------
  function renderTypeFilter() {
    var sel = $('#typeFilter');
    sel.innerHTML = '<option value="">全部属性</option>';
    state.typesArr.forEach(function (t) {
      var o = el('option', null, t.name);
      o.value = String(t.id);
      sel.appendChild(o);
    });
  }

  function petMatches(pet) {
    if (state.typeFilter) {
      var combo = comboOf(pet);
      var ids = B.comboElements(combo);
      if (ids.indexOf(Number(state.typeFilter)) < 0) return false;
    }
    if (!state.search) return true;
    var q = state.search;
    if (pet.name && pet.name.indexOf(q) >= 0) return true;
    if (String(pet.id).indexOf(q) === 0) return true;
    return false;
  }

  function filteredPets() {
    var out = [];
    for (var i = 0; i < state.pets.length; i++) {
      if (petMatches(state.pets[i])) out.push(state.pets[i]);
    }
    return out;
  }

  function renderPetList(append) {
    try { renderPetListInner(append); }
    catch (err) {
      var box = $('#petList');
      if (box) {
        box.innerHTML = '<div style="grid-column:1/-1;color:#ff8a99;padding:16px;font:13px/1.6 monospace">'
          + '图鉴渲染出错：' + (err && (err.message || err)) + '</div>';
      }
      console.error(err);
    }
  }

  function renderPetListInner(append) {
    var list = $('#petList');
    var pets = filteredPets();
    $('#petCount').textContent = '共 ' + pets.length + ' 只';

    if (!append) {
      list.innerHTML = '';
      state.renderedCount = 0;
    } else {
      var oldMore = list.querySelector('.pet-more');
      if (oldMore && oldMore.parentNode) oldMore.parentNode.removeChild(oldMore);
    }

    if (!pets.length) {
      list.appendChild(el('div', 'empty', state.pets.length ? '没有匹配的精灵' : '本地库为空，请先同步数据'));
      return;
    }

    var start = state.renderedCount || 0;
    var end = Math.min(pets.length, state.listLimit);
    if (end < start) { start = 0; }              // 过滤条件变了，重来
    var frag = document.createDocumentFragment();
    pets.slice(start, end).forEach(function (pet) {
      var combo = comboOf(pet);
      var card = el('div', 'pet-card' + (pet.id === state.detailId ? ' active' : ''));
      card.dataset.id = pet.id;

      var thumb = el('div', 'pet-thumb');
      var url = SeerStage.artUrl(pet.id);
      var placeholder = function () {
        var ph = el('div', 'pet-ph', (pet.name || '?').slice(0, 1));
        ph.style.background = combo ? typeColor(combo) : '#8899bb';
        thumb.innerHTML = '';
        thumb.appendChild(ph);
      };
      if (url) {
        thumb.style.backgroundImage = "url('" + url + "')";
        var probe = new Image();
        probe.onerror = placeholder;
        probe.src = url;
      } else {
        placeholder();
      }
      // 关键样式内联：不依赖外部样式表是否被缓存
      thumb.style.height = '104px';
      thumb.style.backgroundSize = 'contain';
      thumb.style.backgroundPosition = 'center';
      thumb.style.backgroundRepeat = 'no-repeat';
      thumb.style.backgroundOrigin = 'content-box';
      thumb.style.backgroundClip = 'content-box';
      thumb.style.padding = '6px';
      thumb.style.overflow = 'hidden';
      card.style.minHeight = '128px';
      card.appendChild(thumb);
      card.appendChild(el('span', 'pet-no', '#' + pet.id));
      var nameEl = el('div', 'pet-name', pet.name || ('#' + pet.id));
      nameEl.style.height = '22px';
      nameEl.style.lineHeight = '22px';
      nameEl.style.overflow = 'hidden';
      card.appendChild(nameEl);
      frag.appendChild(card);
    });
    list.appendChild(frag);
    state.renderedCount = end;

    if (pets.length > end) {
      var more = el('div', 'pet-more', '还有 ' + (pets.length - end) + ' 只，点击继续加载');
      more.addEventListener('click', function () {
        state.listLimit += 200;
        renderPetList(true);
      });
      list.appendChild(more);
    }
    list.onclick = function (e) {
      var item = e.target.closest('.pet-card');
      if (!item || !item.dataset.id) return;
      openDetail(Number(item.dataset.id));
    };
  }

  async function openDetail(id) {
    state.detailId = id;
    document.querySelectorAll('#petList .pet-card').forEach(function (n) {
      n.classList.toggle('active', Number(n.dataset.id) === id);
    });
    var pet = state.petById[id];
    if (!pet) return;
    renderDetail(pet);
    await fillDetail(pet);
  }

  function renderDetail(pet) {
    var box = $('#petDetail');
    box.innerHTML = '';
    var combo = comboOf(pet);

    var head = el('div', 'detail-head');
    var artUrl = SeerStage.artUrl(pet.id);
    if (artUrl) {
      var avArt = el('div', 'avatar art');
      var im = document.createElement('img');
      im.src = artUrl;
      im.alt = pet.name || '';
      avArt.appendChild(im);
      head.appendChild(avArt);
    } else {
      var av = el('div', 'avatar', (pet.name || '?').slice(0, 1));
      av.style.background = typeColor(combo);
      head.appendChild(av);
    }

    var title = el('div', 'detail-title');
    var h2 = el('h2', null, pet.name);
    title.appendChild(h2);
    var sub = el('div', 'sub', '编号 #' + pet.id + ' · 种族值合计 ' + ((pet.base_stats && pet.base_stats.total) || 0));
    title.appendChild(sub);
    var badges = el('div');
    badges.style.marginTop = '6px';
    badges.appendChild(badge(combo));
    title.appendChild(badges);
    head.appendChild(title);

    var add = el('button', 'btn primary', state.team.indexOf(pet.id) >= 0 ? '已在背包中' : '加入背包');
    add.style.marginLeft = 'auto';
    add.disabled = state.team.indexOf(pet.id) >= 0;
    add.addEventListener('click', function () { addToTeam(pet.id); });
    head.appendChild(add);
    box.appendChild(head);

    var grid = el('div', 'grid2');

    // 左：种族值
    var left = el('div');
    left.appendChild(el('h3', 'sec', '种族值'));
    var stats = pet.base_stats || {};
    var rows = [
      ['体力', stats.hp], ['攻击', stats.atk], ['防御', stats.def],
      ['特攻', stats.sp_atk], ['特防', stats.sp_def], ['速度', stats.spd]
    ];
    rows.forEach(function (r) {
      var row = el('div', 'stat-row');
      row.appendChild(el('span', 'k', r[0]));
      row.appendChild(el('span', 'v', String(r[1] || 0)));
      var bar = el('span', 'bar');
      var fill = el('i');
      fill.style.width = Math.min(100, (r[1] || 0) / 180 * 100) + '%';
      bar.appendChild(fill);
      row.appendChild(bar);
      left.appendChild(row);
    });

    var evo = el('div');
    evo.style.marginTop = '16px';
    evo.appendChild(el('h3', 'sec', '进化链'));
    var evoBox = el('div', 'evo', '加载中…');
    evoBox.id = 'evoBox';
    evo.appendChild(evoBox);
    left.appendChild(evo);

    // 魂印
    var markIds = state.petSoulmarks[pet.id] || [];
    if (markIds.length) {
      var mk = el('div');
      mk.style.marginTop = '16px';
      mk.appendChild(el('h3', 'sec', '魂印'));
      markIds.forEach(function (sid) {
        var m = state.soulmarkById[sid];
        if (!m) return;
        var row = el('div', 'skill-item');
        row.style.alignItems = 'flex-start';
        row.appendChild(el('span', 'sname', m.desc || ''));
        var passives = B.parseSoulmark(m.desc || '');
        var labels = passives.map(function (p) {
          if (p.kind === 'taken') return '减伤 ' + Math.round((1 - p.value) * 100) + '%';
          if (p.kind === 'dealt') return '增伤 ' + Math.round((p.value - 1) * 100) + '%';
          if (p.kind === 'regen') return '每回合回复 ' + p.value;
          if (p.kind === 'regenRatio') return '每回合回复 ' + Math.round(p.num / p.den * 100) + '% 体力';
          if (p.kind === 'priority') return '先制 +' + p.value;
          if (p.kind === 'speed') return '速度 +' + p.value;
          if (p.kind === 'immuneStatus') return '免疫异常';
          if (p.kind === 'immuneStat') return '免疫能力下降';
          if (p.kind === 'exile') return '神秘结界放逐';
          if (p.kind === 'divineTurn') return '神启（体力分支）';
          if (p.kind === 'benchAura') return '背包光环';
          return '';
        }).filter(Boolean);
        if (labels.length) row.appendChild(el('span', 'spow', '已生效：' + labels.join('、')));
        mk.appendChild(row);
      });
      // 名词解释：图鉴里也给出蚩庸之锁等专有名词的说明
      appendGlossary(mk, markIds.map(function (sid) {
        var m = state.soulmarkById[sid];
        return m && m.desc ? String(m.desc) : '';
      }).filter(Boolean));
      left.appendChild(mk);
    }

    grid.appendChild(left);

    // 右：技能
    var right = el('div');
    right.appendChild(el('h3', 'sec', '可习得技能'));
    var cnt = el('div', 'muted small');
    cnt.id = 'pickCount';
    cnt.textContent = '已选 ' + normalizeLoadout(state.loadouts[pet.id]).n.length + ' / 4 个技能（配招请在「精灵背包」里调整）';
    right.appendChild(cnt);
    var skBox = el('div');
    skBox.id = 'skillBox';
    skBox.appendChild(el('div', 'muted', '加载技能数据…'));
    right.appendChild(skBox);
    grid.appendChild(right);

    box.appendChild(grid);
  }

  var detailToken = 0;
  // 「技能配置」折叠状态：按精灵记，重渲染后仍保持展开（否则一选技能就被收起）
  var skillOpenByPet = Object.create(null);

  async function fillDetail(pet) {
    var token = ++detailToken;
    // 进化链
    try {
      var cls = state.classCache[pet.pet_class && pet.pet_class.id];
      if (!cls && pet.pet_class) {
        cls = await Api.getOne('pet_class', pet.pet_class.id);
        state.classCache[pet.pet_class.id] = cls;
      }
      var evoBox = $('#evoBox');
      if (evoBox && cls && cls.evolution_chain && cls.evolution_chain.length) {
        evoBox.innerHTML = '';
        cls.evolution_chain.forEach(function (ref, i) {
          if (i > 0) evoBox.appendChild(el('span', 'arrow', '→'));
          var target = state.petById[ref.id];
          var tag = el('span', null, target ? target.name : ('#' + ref.id));
          if (target) {
            tag.style.cursor = 'pointer';
            tag.style.color = target.id === pet.id ? '#35e2ff' : 'inherit';
            tag.addEventListener('click', function () { openDetail(target.id); });
          }
          evoBox.appendChild(tag);
        });
      } else if (evoBox) {
        evoBox.textContent = '无进化链数据';
      }
    } catch (e) {
      var eb = $('#evoBox');
      if (eb) eb.textContent = '进化链加载失败';
    }

    // 技能（普通技能与第五技能分开显示）
    var fifthIds = pet.fifth || [];
    var all = (pet.skill || []).slice().sort(function (a, b) {
      return (a.learning_level || 0) - (b.learning_level || 0);
    });
    var normalList = all.filter(function (x) { return fifthIds.indexOf(x.skill.id) < 0; });
    var fifthList = all.filter(function (x) { return fifthIds.indexOf(x.skill.id) >= 0; });

    var skBox = $('#skillBox');
    if (!skBox) return;
    skBox.innerHTML = '';
    if (!all.length) {
      skBox.appendChild(el('div', 'muted', '该精灵没有技能记录'));
      return;
    }

    var lo = loadoutFor(pet);
    // 顺手把旧数据里「第五技能被当成普通技能」的错误配招纠正并回写
    var raw = normalizeLoadout(state.loadouts[pet.id]);
    if (raw.n.length !== lo.n.length || raw.f !== lo.f) {
      state.loadouts[pet.id] = lo;
      saveLoadouts();
    }
    var cr = document.getElementById('pickCount');
    if (cr) {
      cr.dataset.total = String(all.length);
      cr.textContent = '共 ' + all.length + ' 个技能 · 已选 ' + lo.n.length + ' / 4' +
        (lo.f ? ' · 第五技能已选' : '') + '（配招请到「精灵背包」）';
    }

    var shown = normalList.slice(0, 200);
    var cache = {};
    shown.forEach(function (item) {
      var row = el('div', 'skill-item');
      row.appendChild(el('span', 'muted', 'Lv.' + (item.learning_level || 1)));
      var name = el('span', 'sname', '技能 #' + item.skill.id);
      name.style.cursor = 'pointer';
      name.title = '点击查看技能详情';
      name.addEventListener('click', function (sid) {
        return function () {
          var sk = state.skillCache[sid];
          if (sk) showSkillSheet(sk);
        };
      }(item.skill.id));
      row.appendChild(name);
      var meta = el('span', 'spow', '…');
      row.appendChild(meta);

      var picked = lo.n.indexOf(item.skill.id) >= 0;
      if (picked) row.appendChild(el('span', 'picked-tag', '已选'));

      skBox.appendChild(row);
      cache[item.skill.id] = { name: name, meta: meta };
    });

    if (!normalList.length) skBox.appendChild(el('div', 'muted small', '没有普通技能'));

    // 第五技能
    if (fifthList.length) {
      skBox.appendChild(el('h3', 'sec', '第五技能（最多携带 1 个）'));
      fifthList.forEach(function (item) {
        var row = el('div', 'skill-item');
        var name = el('span', 'sname', '技能 #' + item.skill.id);
      name.style.cursor = 'pointer';
      name.title = '点击查看技能详情';
      name.addEventListener('click', function (sid) {
        return function () {
          var sk = state.skillCache[sid];
          if (sk) showSkillSheet(sk);
        };
      }(item.skill.id));
        row.appendChild(name);
        var meta = el('span', 'spow', '…');
        row.appendChild(meta);

        var picked5 = lo.f === item.skill.id;
        if (picked5) row.appendChild(el('span', 'picked-tag', '携带中'));

        skBox.appendChild(row);
        cache[item.skill.id] = { name: name, meta: meta };
      });
    } else {
      skBox.appendChild(el('div', 'muted small', '该精灵没有第五技能'));
    }

    var wantIds = shown.map(function (x) { return x.skill.id; })
      .concat(fifthList.map(function (x) { return x.skill.id; }));
    var allSkills = await ensureSkills(wantIds);
    if (token !== detailToken) return; // 用户已经切到别的精灵了
    allSkills.forEach(function (s) {
      var slot = cache[s.id];
      if (!slot) return;
      slot.name.textContent = s.name;
      var cat = CAT_LABEL[s.category && s.category.id] || '';
      var pow = s.power ? ('威力 ' + s.power) : '变化';
      var pp = s.max_pp ? (' · PP ' + s.max_pp) : '';
      slot.meta.textContent = cat + ' · ' + pow + pp;
    });
    if (normalList.length > shown.length) {
      skBox.appendChild(el('div', 'muted small', '仅显示前 ' + shown.length + ' 个普通技能'));
    }
  }

  function fallbackSkill(id) {
    return {
      id: id, name: '技能#' + id, power: 0, max_pp: 0, accuracy: 100,
      crit_rate: 6.25, priority: 0, category: { id: 4 }, type: null, info: null
    };
  }

  /** 批量取技能：先查本地库，缺失的以 6 路并发抓取并回写 */
  async function ensureSkills(ids) {
    var uniq = [];
    var seen = {};
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      if (seen[id] || state.skillCache[id]) continue;
      seen[id] = 1;
      uniq.push(id);
    }

    var missing = [];
    for (var j = 0; j < uniq.length; j++) {
      var local = await Db.get('skills', uniq[j]);
      if (local) state.skillCache[uniq[j]] = local;
      else missing.push(uniq[j]);
    }

    // 离线技能包：能命中就不联网
    if (missing.length && window.SeerLocalPack && window.SeerLocalPack.ready()) {
      var packReady = await window.SeerLocalPack.loadSkills();
      if (packReady) {
        var stillMissing = [];
        for (var q = 0; q < missing.length; q++) {
          var packSkill = window.SeerLocalPack.skill(missing[q]);
          if (packSkill) state.skillCache[missing[q]] = packSkill;
          else stillMissing.push(missing[q]);
        }
        missing = stillMissing;
      }
    }

    var BATCH = 6;
    for (var k = 0; k < missing.length; k += BATCH) {
      var chunk = missing.slice(k, k + BATCH);
      var got = await Promise.all(chunk.map(function (sid) {
        return Api.getOne('skill', sid).catch(function () { return null; });
      }));
      var store = [];
      for (var m = 0; m < got.length; m++) {
        var sid2 = chunk[m];
        if (got[m]) {
          state.skillCache[sid2] = got[m];
          store.push(got[m]);
        } else {
          state.skillCache[sid2] = fallbackSkill(sid2);
        }
      }
      if (store.length) {
        Db.putAll('skills', store);
        await Db.flush();
      }
    }

    return ids.map(function (sid) { return state.skillCache[sid] || fallbackSkill(sid); });
  }

  // ---------- 队伍（12 格：前 6 出战，后 6 备战） ----------
  function firstEmptySlot() {
    for (var i = 0; i < 12; i++) if (state.team[i] == null) return i;
    return -1;
  }

  function addToTeam(id) {
    if (state.team.indexOf(id) >= 0) return;
    var idx = firstEmptySlot();
    if (idx < 0) { toast('精灵背包已满 12 格', true); return; }
    state.team[idx] = id;
    saveTeam();
    renderTeam();
    if (state.detailId === id) openDetail(id);
    toast(idx < 6 ? '已加入出战格' : '已加入备战格');
  }

  function renderSuitBar() {
    var bar = $('#suitBar');
    if (!bar) return;
    bar.innerHTML = '';
    var suit = state.suitId != null ? state.suitById[state.suitId] : null;
    var img = el('div', 'suit-icon');
    if (suit) {
      img.style.backgroundImage = 'url("' + wikiImage('套装', suit.id) + '")';
      img.title = suit.name;
    }
    bar.appendChild(img);
    var info = el('div', 'suit-info');
    info.appendChild(el('div', 'suit-name', suit ? suit.name : '未装备赛尔套装'));
    var desc = suit && suit.bonus && suit.bonus.desc ? suit.bonus.desc : (suit ? suit.desc : '套装可为出战精灵提供属性与效果');
    info.appendChild(el('div', 'suit-desc', desc || ''));
    if (suit && suit.bonus && suit.bonus.attribute) info.appendChild(el('div', 'suit-attr', attrText(suit.bonus.attribute)));
    bar.appendChild(info);
    var btn = el('button', 'btn', suit ? '更换套装' : '选择套装');
    btn.addEventListener('click', openSuitPicker);
    bar.appendChild(btn);
    if (suit) {
      var off = el('button', 'btn danger', '卸下');
      off.addEventListener('click', function () {
        state.suitId = null;
        saveSuit();
        renderTeam();
        renderTeamConfig();
      });
      bar.appendChild(off);
    }
  }

  function moveSlot(from, to) {
    if (from == null || to == null || from === to || from < 0 || to < 0 || from > 11 || to > 11) return;
    var tmp = state.team[from];
    state.team[from] = state.team[to];
    state.team[to] = tmp;
    saveTeam();
    renderTeam();
  }

  function attachDrop(node, index) {
    node.addEventListener('dragover', function (e) {
      e.preventDefault();
      node.classList.add('drop-target');
    });
    node.addEventListener('dragleave', function () { node.classList.remove('drop-target'); });
    node.addEventListener('drop', function (e) {
      e.preventDefault();
      node.classList.remove('drop-target');
      var from = Number(e.dataTransfer.getData('text/plain'));
      if (isNaN(from)) from = dragFrom;
      moveSlot(from, index);
    });
  }

  function renderTeam() {
    var detail = state.configId ? state.petById[state.configId] : null;
    var grid = $('#teamGrid');
    var suitBar = $('#suitBar');
    var box = $('#teamConfig');
    if (detail) {
      grid.classList.add('hidden');
      suitBar.classList.add('hidden');
      box.classList.remove('hidden');
      renderTeamConfig();
      return;
    }
    grid.classList.remove('hidden');
    suitBar.classList.remove('hidden');
    box.classList.add('hidden');
    box.innerHTML = '';
    renderSuitBar();

    grid.innerHTML = '';
    function section(text) {
      grid.appendChild(el('div', 'team-section-label', text));
    }
    for (var i = 0; i < 12; i++) {
      if (i === 0) section('出战格 · 最多 6 只，参与对战');
      if (i === 6) section('备战格 · 最多 6 只，不参战；桃园/西游羁绊仍生效');
      var id = state.team[i];
      var pet = id && state.petById[id];
      var card = el('div', 'bp-card' + (pet ? ' filled' : ' empty') + (i < 6 ? ' battle' : ' reserve'));
      card.dataset.index = String(i);
      var order = i < 6 ? ('出战 ' + (i + 1) + (i === 0 ? ' · 首发' : '')) : ('备战 ' + (i - 5));
      if (!pet) {
        card.appendChild(el('div', 'bp-order', order));
        card.appendChild(el('div', 'bp-plus', '+'));
        card.appendChild(el('div', 'bp-name', i < 6 ? '空出战位' : '空备战位'));
        card.appendChild(el('div', 'bp-sub', '拖拽精灵到此'));
        attachDrop(card, i);
        grid.appendChild(card);
        continue;
      }
      var bld = buildFor(id);
      var combo = comboOf(pet);
      card.draggable = true;
      card.title = '拖拽调整位置；点击查看详情';
      var orderEl = el('div', 'bp-order', order);
      card.appendChild(orderEl);
      var avatar = el('div', 'bp-avatar');
      var art = SeerStage.artUrl(id);
      if (art) {
        var img = document.createElement('img');
        img.src = art;
        img.alt = pet.name;
        img.draggable = false;
        avatar.appendChild(img);
      } else {
        avatar.style.background = typeColor(combo);
        avatar.appendChild(el('div', 'bp-initial', (pet.name || '?').slice(0, 1)));
      }
      card.appendChild(avatar);
      card.appendChild(el('div', 'bp-name', pet.name));
      var types = el('div', 'bp-types');
      if (combo) {
        if (combo.primary) types.appendChild(el('span', 'bp-type', comboName(combo.primary.id)));
        if (combo.secondary) types.appendChild(el('span', 'bp-type', comboName(combo.secondary.id)));
      }
      card.appendChild(types);
      card.appendChild(el('div', 'bp-lv', 'Lv.' + bld.level + ' · 天赋 ' + bld.talent));
      var dragged = false;
      card.addEventListener('dragstart', function (idx) {
        return function (e) {
          dragged = true;
          dragFrom = idx;
          card.classList.add('dragging');
          try { e.dataTransfer.setData('text/plain', String(idx)); } catch (err) { }
        };
      }(i));
      card.addEventListener('dragend', function () {
        card.classList.remove('dragging');
        setTimeout(function () { dragged = false; }, 250);
      });
      card.addEventListener('click', function (pid) {
        return function () {
          if (dragged) return;
          state.configId = pid;
          renderTeam();
        };
      }(id));
      attachDrop(card, i);
      grid.appendChild(card);
    }
  }

  /** 队伍页内联配招面板（不再跳转图鉴） */
  function renderBuildPanel(pet) {
    var wrap = el('div', 'build-panel');
    var bld = buildFor(pet.id);

    var natureRow = el('div', 'build-row');
    natureRow.appendChild(el('span', 'build-label', '性格'));
    var sel = el('select', 'input select');
    var opt0 = el('option', null, '无性格（不修正）');
    opt0.value = '';
    sel.appendChild(opt0);
    state.natures.forEach(function (n) {
      var o = el('option', null, n.name + '（' + natureText(n) + '）');
      o.value = String(n.id);
      sel.appendChild(o);
    });
    sel.value = bld.natureId == null ? '' : String(bld.natureId);
    sel.addEventListener('change', function () {
      saveBuild(pet.id, { natureId: sel.value ? Number(sel.value) : null });
      renderTeam();
      renderTeamConfig();
    });
    natureRow.appendChild(sel);
    wrap.appendChild(natureRow);

    var talentRow = el('div', 'build-row');
    talentRow.appendChild(el('span', 'build-label', '天赋'));
    var tin = el('input', 'input');
    tin.type = 'number';
    tin.min = '0';
    tin.max = '31';
    tin.step = '1';
    tin.value = String(bld.talent);
    tin.style.width = '80px';
    tin.addEventListener('change', function () {
      var v = Math.max(0, Math.min(31, Number(tin.value) || 0));
      saveBuild(pet.id, { talent: v });
      renderTeam();
      renderTeamConfig();
    });
    talentRow.appendChild(tin);
    talentRow.appendChild(el('span', 'muted small', '0–31，越高面板越高'));
    wrap.appendChild(talentRow);

    var lvRow = el('div', 'build-row');
    lvRow.appendChild(el('span', 'build-label', '等级'));
    var lin = el('input', 'input');
    lin.type = 'number';
    lin.min = '1';
    lin.max = '100';
    lin.step = '1';
    lin.value = String(bld.level);
    lin.style.width = '80px';
    lin.addEventListener('change', function () {
      var v = Math.max(1, Math.min(100, Number(lin.value) || 1));
      saveBuild(pet.id, { level: v });
      renderTeam();
      renderTeamConfig();
    });
    lvRow.appendChild(lin);
    lvRow.appendChild(el('span', 'muted small', '1–100，面板按原作等级公式'));
    wrap.appendChild(lvRow);

    var evRow = el('div', 'build-row build-ev');
    evRow.appendChild(el('span', 'build-label', '学习力'));
    var evTotal = el('span', 'muted small');
    function evUsed(ev) {
      return Object.keys(ev).reduce(function (n, k) { return n + (ev[k] || 0); }, 0);
    }
    [['hp', '体力'], ['atk', '攻击'], ['def', '防御'], ['sp_atk', '特攻'], ['sp_def', '特防'], ['spd', '速度']].forEach(function (x) {
      var lab = el('span', 'muted small', x[1]);
      var ein = el('input', 'input');
      ein.type = 'number';
      ein.min = '0';
      ein.max = '255';
      ein.step = '1';
      ein.value = String((bld.ev && bld.ev[x[0]]) || 0);
      ein.style.width = '58px';
      ein.title = x[1] + '学习力 0–255';
      ein.addEventListener('change', function () {
        var ev = buildFor(pet.id).ev;
        var v = Math.max(0, Math.min(255, Number(ein.value) || 0));
        ev[x[0]] = v;
        var total = evUsed(ev);
        if (total > 510) {
          ev[x[0]] = Math.max(0, v - (total - 510));
          ein.value = String(ev[x[0]]);
        }
        saveBuild(pet.id, { ev: ev });
        evTotal.textContent = '已用 ' + evUsed(ev) + ' / 510';
        renderTeam();
        renderTeamConfig();
      });
      evRow.appendChild(lab);
      evRow.appendChild(ein);
    });
    evTotal.textContent = '已用 ' + evUsed(bld.ev || {}) + ' / 510（单项≤255）';
    evRow.appendChild(evTotal);
    wrap.appendChild(evRow);

    var markRow = el('div', 'build-row build-marks');
    markRow.appendChild(el('span', 'build-label', '刻印'));
    for (var i = 0; i < 3; i++) {
      var mid = bld.marks[i];
      var m = mid != null ? state.mintmarkById[mid] : null;
      var card = el('button', 'mark-slot' + (m ? ' filled' : ''));
      var ic = el('div', 'mark-icon');
      if (m) ic.style.backgroundImage = 'url("' + wikiImage('刻印', m.id) + '")';
      card.appendChild(ic);
      card.appendChild(el('div', 'mark-name', m ? m.name : ('刻印槽 ' + (i + 1))));
      card.appendChild(el('div', 'mark-sub', m ? attrText(m.attr) : '点击选择'));
      card.addEventListener('click', function (slot) {
        return function () { openMintmarkPicker(pet.id, slot); };
      }(i));
      markRow.appendChild(card);
    }
    wrap.appendChild(markRow);

    var resistRow = el('div', 'build-row build-resist');
    resistRow.appendChild(el('span', 'build-label', '抗性'));
    [['fixed', '固伤'], ['percent', '百分比'], ['crit', '暴击'], ['status', '异常']].forEach(function (x) {
      var lab = el('span', 'muted small', x[1]);
      var rin = el('input', 'input');
      rin.type = 'number';
      rin.min = '0';
      rin.max = x[0] === 'status' ? '50' : '35';
      rin.step = '1';
      rin.value = String(bld.resist && bld.resist[x[0]] || 0);
      rin.style.width = '64px';
      rin.title = x[1] + '抗性 0–' + (x[0] === 'status' ? '50' : '35') + '%';
      if (pet.id === 3291 && (x[0] === 'fixed' || x[0] === 'percent')) {
        rin.title = '瀚宇星皇魂印：战斗中固定/百分比抗性始终视为 100%（此项只记录培养值）';
      }
      rin.addEventListener('change', function () {
        var cur = buildFor(pet.id).resist || {};
        var max = x[0] === 'status' ? 50 : 35;
        cur[x[0]] = Math.max(0, Math.min(max, Number(rin.value) || 0));
        saveBuild(pet.id, { resist: cur });
        renderTeam();
        renderTeamConfig();
      });
      resistRow.appendChild(lab);
      resistRow.appendChild(rin);
    });
    resistRow.appendChild(el('span', 'muted small', '固伤/百分比/暴击≤35%，异常≤50%'));
    wrap.appendChild(resistRow);
    return wrap;
  }

  function natureText(n) {
    if (!n || !n.attributes) return '—';
    var m = { atk: '攻击', def: '防御', sp_atk: '特攻', sp_def: '特防', spd: '速度', hp: '体力' };
    var arr = [];
    Object.keys(m).forEach(function (k) {
      var v = Number(n.attributes[k] || 0);
      if (v) arr.push(m[k] + (v > 0 ? '+' : '') + v + (n.attributes.percent ? '%' : ''));
    });
    return arr.join(' ') || '—';
  }

  function openMintmarkPicker(petId, slot) {
    openSheet('选择刻印 · 第 ' + (slot + 1) + ' 槽');
    var body = $('#sheetBody');
    body.innerHTML = '';
    var tools = el('div', 'row');
    var search = el('input', 'input');
    search.placeholder = '搜索刻印名称 / 属性…';
    search.style.flex = '1';
    tools.appendChild(search);
    var clear = el('button', 'btn danger', '清空该槽');
    clear.addEventListener('click', function () {
      var bld = buildFor(petId);
      bld.marks[slot] = null;
      saveBuild(petId, { marks: bld.marks });
      $('#sheet').classList.add('hidden');
      renderTeamConfig();
      renderTeam();
    });
    tools.appendChild(clear);
    body.appendChild(tools);
    var list = el('div', 'mark-list');
    body.appendChild(list);
    var note = el('div', 'muted small', '共 ' + state.mintmarks.length + ' 个刻印（只显示前 80 条，可搜索）');
    body.appendChild(note);

    function draw() {
      list.innerHTML = '';
      var q = search.value.trim();
      var rows = state.mintmarks.filter(function (m) {
        if (!q) return true;
        return (m.name || '').indexOf(q) >= 0 || (m.desc || '').indexOf(q) >= 0;
      }).slice(0, 80);
      rows.forEach(function (m) {
        var row = el('button', 'mark-row');
        var ic = el('div', 'mark-icon');
        ic.style.backgroundImage = 'url("' + wikiImage('刻印', m.id) + '")';
        row.appendChild(ic);
        var info = el('div', 'mark-row-info');
        info.appendChild(el('div', 'mark-name', m.name));
        info.appendChild(el('div', 'mark-sub', (m.desc || '') + '　' + attrText(m.attr)));
        row.appendChild(info);
        row.addEventListener('click', function () {
          var bld = buildFor(petId);
          bld.marks[slot] = m.id;
          saveBuild(petId, { marks: bld.marks });
          $('#sheet').classList.add('hidden');
          renderTeamConfig();
          renderTeam();
        });
        list.appendChild(row);
      });
      if (!rows.length) list.appendChild(el('div', 'muted', '没有匹配的刻印'));
    }
    search.addEventListener('input', draw);
    draw();
  }

  function openSuitPicker() {
    openSheet('选择赛尔套装');
    var body = $('#sheetBody');
    body.innerHTML = '';
    var search = el('input', 'input');
    search.placeholder = '搜索套装名称 / 效果…';
    body.appendChild(search);
    var list = el('div', 'mark-list');
    body.appendChild(list);
    var note = el('div', 'muted small', '共 ' + state.suits.length + ' 套（只显示前 80 条，可搜索）');
    body.appendChild(note);
    function draw() {
      list.innerHTML = '';
      var q = search.value.trim();
      var rows = state.suits.filter(function (s) {
        if (!q) return true;
        var d = (s.bonus && s.bonus.desc) || s.desc || '';
        return (s.name || '').indexOf(q) >= 0 || d.indexOf(q) >= 0;
      }).slice(0, 80);
      rows.forEach(function (s) {
        var row = el('button', 'mark-row');
        var ic = el('div', 'mark-icon suit-thumb');
        ic.style.backgroundImage = 'url("' + wikiImage('套装', s.id) + '")';
        row.appendChild(ic);
        var info = el('div', 'mark-row-info');
        info.appendChild(el('div', 'mark-name', s.name));
        var d = (s.bonus && s.bonus.desc) || s.desc || '';
        info.appendChild(el('div', 'mark-sub', d));
        if (s.bonus && s.bonus.attribute) info.appendChild(el('div', 'mark-sub', attrText(s.bonus.attribute)));
        row.appendChild(info);
        row.addEventListener('click', function () {
          state.suitId = s.id;
          saveSuit();
          $('#sheet').classList.add('hidden');
          renderTeam();
          renderTeamConfig();
        });
        list.appendChild(row);
      });
      if (!rows.length) list.appendChild(el('div', 'muted', '没有匹配的套装'));
    }
    search.addEventListener('input', draw);
    draw();
  }

  async function renderTeamConfig() {
    var box = $('#teamConfig');
    if (!box) return;
    var pet = state.configId ? state.petById[state.configId] : null;
    if (!pet) {
      box.classList.add('hidden');
      box.innerHTML = '';
      return;
    }
    box.classList.remove('hidden');
    box.innerHTML = '';

    var head = el('div', 'tc-head');
    var back = el('button', 'btn', '← 返回背包');
    back.addEventListener('click', function () {
      state.configId = null;
      renderTeam();
    });
    head.appendChild(back);
    head.appendChild(el('h3', null, pet.name));
    var cnt = el('span', 'muted small');
    cnt.id = 'teamPickCount';
    head.appendChild(cnt);
    var rm = el('button', 'btn danger', '移出背包');
    rm.addEventListener('click', function () {
      var idx = state.team.indexOf(pet.id);
      if (idx >= 0) state.team[idx] = null;
      state.configId = null;
      saveTeam();
      renderTeam();
    });
    head.appendChild(rm);
    box.appendChild(head);

    var bld = buildFor(pet.id);
    var nature = bld.natureId != null ? state.natureById[bld.natureId] : null;
    var sb = buildStatBonus(pet.id);
    var stats = B.computeStats(pet, {
      level: bld.level, iv: bld.talent, ev: bld.ev, nature: nature,
      bonus: sb.bonus, bonusPct: sb.bonusPct
    });
    var combo = comboOf(pet);
    var detail = el('div', 'bp-detail');
    var artCol = el('div', 'bp-detail-art');
    var art = SeerStage.artUrl(pet.id);
    if (art) {
      var artImg = document.createElement('img');
      artImg.src = art;
      artImg.alt = pet.name;
      artCol.appendChild(artImg);
    } else {
      artCol.classList.add('no-art');
      artCol.style.background = typeColor(combo);
      artCol.appendChild(el('div', 'bp-initial', (pet.name || '?').slice(0, 1)));
    }
    detail.appendChild(artCol);

    var info = el('div', 'bp-detail-info');
    var nameRow = el('div', 'bp-detail-name');
    nameRow.appendChild(el('h2', null, pet.name));
    nameRow.appendChild(el('span', 'muted small', '#' + pet.id));
    info.appendChild(nameRow);
    var types = el('div', 'bp-types');
    if (combo) {
      if (combo.primary) types.appendChild(el('span', 'bp-type', comboName(combo.primary.id)));
      if (combo.secondary) types.appendChild(el('span', 'bp-type', comboName(combo.secondary.id)));
    }
    info.appendChild(types);
    info.appendChild(el('div', 'muted small', 'Lv.' + bld.level + ' · 天赋 ' + bld.talent + ' · 性格 ' + (nature ? nature.name : '无')));

    var statGrid = el('div', 'bp-stat-grid');
    [['体力', 'hp'], ['攻击', 'atk'], ['防御', 'def'], ['特攻', 'spAtk'], ['特防', 'spDef'], ['速度', 'spd']].forEach(function (x) {
      var row = el('div', 'bp-stat');
      row.appendChild(el('span', 'k', x[0]));
      row.appendChild(el('span', 'v', String(stats[x[1]])));
      statGrid.appendChild(row);
    });
    info.appendChild(statGrid);

    var skin = el('div', 'skin-slot');
    skin.appendChild(el('div', 'skin-thumb', '皮肤'));
    var skinInfo = el('div');
    skinInfo.appendChild(el('div', 'bp-name', '皮肤栏位'));
    skinInfo.appendChild(el('div', 'muted small', '后期切换皮肤用，当前未开放'));
    skin.appendChild(skinInfo);
    info.appendChild(skin);

    detail.appendChild(info);
    box.appendChild(detail);
    box.appendChild(renderBuildPanel(pet));

    var skillWrap = el('div', 'skill-config');
    var skillHead = el('div', 'skill-config-head');
    var skillToggle = el('button', 'btn', '技能配置');
    skillToggle.id = 'teamSkillToggle';
    var skillBody = el('div', 'skill-config-body hidden');
    if (skillOpenByPet[pet.id]) {
      skillBody.classList.remove('hidden');
      skillToggle.classList.add('primary');
    }
    skillToggle.addEventListener('click', function () {
      skillBody.classList.toggle('hidden');
      var open = !skillBody.classList.contains('hidden');
      skillOpenByPet[pet.id] = open;
      skillToggle.classList.toggle('primary', open);
      // 展开时把列表滚进视野，收起时保持位置
      if (open) {
        try { skillWrap.scrollIntoView({ block: 'nearest' }); } catch (err) { }
      }
    });
    skillHead.appendChild(skillToggle);
    skillWrap.appendChild(skillHead);
    skillWrap.appendChild(skillBody);
    box.appendChild(skillWrap);

    var fifthIds = pet.fifth || [];
    var all = (pet.skill || []).slice().sort(function (a, b) {
      return (a.learning_level || 0) - (b.learning_level || 0);
    });
    var normalList = all.filter(function (x) { return fifthIds.indexOf(x.skill.id) < 0; });
    var fifthList = all.filter(function (x) { return fifthIds.indexOf(x.skill.id) >= 0; });
    var lo = loadoutFor(pet);
    cnt.dataset.total = String(all.length);
    cnt.textContent = '共 ' + all.length + ' 个技能 · 已选 ' + lo.n.length + ' / 4' + (lo.f ? ' · 第五技能已选' : '');
    skillToggle.textContent = '技能配置 · 已选 ' + lo.n.length + '/4' + (lo.f ? ' + 第五' : '');

    if (!all.length) {
      skillBody.appendChild(el('div', 'muted', '该精灵没有技能记录'));
      return;
    }

    var cache = {};
    function addRow(list, isFifth) {
      list.forEach(function (item) {
        var row = el('div', 'skill-item');
        row.appendChild(el('span', 'muted', isFifth ? '第五' : ('Lv.' + (item.learning_level || 1))));
        var name = el('span', 'sname', '技能 #' + item.skill.id);
        name.style.cursor = 'pointer';
        name.title = '点击查看技能详情';
        name.addEventListener('click', function (sid) {
          return function () {
            var sk = state.skillCache[sid];
            if (sk) showSkillSheet(sk);
          };
        }(item.skill.id));
        row.appendChild(name);
        var meta = el('span', 'spow', '…');
        row.appendChild(meta);

        var picked = isFifth ? (lo.f === item.skill.id) : (lo.n.indexOf(item.skill.id) >= 0);
        var btn = el('button', 'btn ' + (isFifth ? 'pick5' : 'pick'), picked ? (isFifth ? '携带中' : '已选') : (isFifth ? '携带' : '选用'));
        if (picked) btn.classList.add('primary');
        btn.dataset.skillId = item.skill.id;
        btn.style.padding = '2px 10px';
        btn.style.fontSize = '11px';
        btn.addEventListener('click', function (sid) {
          return function () {
            if (isFifth) pickFifth(pet.id, sid);
            else toggleNormal(pet.id, sid);
          };
        }(item.skill.id));
        row.appendChild(btn);

        skillBody.appendChild(row);
        cache[item.skill.id] = { name: name, meta: meta };      });
    }

    addRow(normalList.slice(0, 200), false);
    if (!normalList.length) skillBody.appendChild(el('div', 'muted small', '没有普通技能'));
    if (fifthList.length) {
      skillBody.appendChild(el('h3', 'sec', '第五技能（最多携带 1 个）'));
      addRow(fifthList, true);
    } else {
      skillBody.appendChild(el('div', 'muted small', '该精灵没有第五技能'));
    }

    var wantIds = normalList.slice(0, 200).map(function (x) { return x.skill.id; })
      .concat(fifthList.map(function (x) { return x.skill.id; }));
    var got = await ensureSkills(wantIds);
    if (state.configId !== pet.id) return;
    got.forEach(function (s) {
      var slot = cache[s.id];
      if (!slot) return;
      slot.name.textContent = s.name;
      var cat = CAT_LABEL[s.category && s.category.id] || '';
      var pow = s.power ? ('威力 ' + s.power) : '变化';
      var pp = s.max_pp ? (' · PP ' + s.max_pp) : '';
      slot.meta.textContent = cat + ' · ' + pow + pp;
    });
  }

  // ---------- 同步 ----------
  function prioOf(name) {
    switch (name) {
      case 'pets': return 0;
      case 'skills': return 1;
      case 'combos': return 2;
      case 'types': return 3;
      default: return 4;
    }
  }

  async function checkUpdate() {
    if (state.busy) return;
    state.busy = true;
    setProgressText('正在检查版本…');
    try {
      var changed = [];
      for (var i = 0; i < RESOURCES.length; i++) {
        var r = RESOURCES[i];
        var head = await Api.headHash(r.name);
        var meta = await Db.getMeta(r.name);
        var localHash = meta && meta.value ? meta.value.hash : null;
        var localFmt = meta && meta.value ? (meta.value.format || 1) : 0;
        if (localHash !== head.hash || localFmt !== (r.format || 1)) changed.push(r.label + '（' + (head.count || 0) + ' 条）');
        setProgress((i + 1) / RESOURCES.length * 100);
      }
      if (changed.length) {
        setProgressText('有更新：' + changed.join('、'));
        toast('发现更新，可以点「快速同步」');
      } else {
        setProgressText('已是最新');
        toast('数据已是最新');
      }
    } catch (e) {
      setProgressText('检查失败：' + e.message);
      toast('检查失败：' + e.message, true);
    } finally {
      state.busy = false;
      renderMeta();
    }
  }

  async function runSync(full) {
    if (state.busy) return;
    if (!state.pets.length && !confirm('首次同步会从 SeerAPI 下载数据（约几 MB），需要联网。开始吗？')) return;
    state.busy = true;
    var btnQ = $('#syncQuick'), btnF = $('#syncFull');
    btnQ.disabled = true; btnF.disabled = true;
    try {
      var tasks = RESOURCES.filter(function (r) { return full || r.name !== 'skill'; });
      for (var i = 0; i < tasks.length; i++) {
        var t = tasks[i];
        var head = await Api.headHash(t.name);
        var meta = await Db.getMeta(t.name);
        var fmt = t.format || 1;
        var metaFmt = meta && meta.value ? (meta.value.format || 1) : 0;
        if (meta && meta.value && meta.value.hash === head.hash && metaFmt === fmt) {
          setProgressText((i + 1) + '/' + tasks.length + ' · ' + t.label + ' 无变化，跳过');
          setProgress((i + 1) / tasks.length * 100);
          continue;
        }
        setProgressText('正在下载 ' + t.label + '…');
        var res = await Api.fetchAll(t.name, {
          expand: true,
          maxItems: t.name === 'skill' ? 5000 : 0,
          onProgress: function (label, idx) {
            return function (loaded, total) {
              var frac = total ? loaded / total : 0;
              setProgress((idx + frac) / tasks.length * 100);
              setProgressText('正在下载 ' + label + '… ' + loaded + ' / ' + total);
            };
          }(t.label, i)
        });
        setProgressText('正在写入 ' + t.label + '…');
        Db.clear(t.store);
        var rows = t.slim ? res.items.map(t.slim) : res.items;
        for (var k = 0; k < rows.length; k += 200) {
          Db.putAll(t.store, rows.slice(k, k + 200));
        }
        Db.setMeta(t.name, { hash: head.hash, count: rows.length, syncedAt: Date.now(), format: t.format || 1 });
        await Db.flush();
        setProgress((i + 1) / tasks.length * 100);
      }
      await loadLocal();
      state.team = normalizeTeam(state.team);
      saveTeam();
      renderAll();
      setProgressText('同步完成 · ' + fmtTime(Date.now()));
      toast('同步完成');
    } catch (e) {
      console.error(e);
      setProgressText('同步失败：' + e.message);
      toast('同步失败：' + e.message, true);
    } finally {
      state.busy = false;
      btnQ.disabled = false; btnF.disabled = false;
      updateSyncState();
    }
  }

  async function healthCheck() {
    var box = document.getElementById('healthReport');
    try {
      var pets = await Db.getAll('pets');
      var skills = await Db.count('skills');
      var marks = await Db.getAll('soulmarks');
      var noStats = pets.filter(function (p) { return !p.base_stats || !p.base_stats.total; });
      var noSkill = pets.filter(function (p) { return !p.skill || !p.skill.length; });
      var noMark = pets.filter(function (p) { return !(state.petSoulmarks[p.id] || []).length; });

      function names(list) {
        return list.slice(0, 5).map(function (p) { return p.name; }).join('、');
      }

      var lines = [];
      lines.push('精灵数据：' + pets.length + ' 只');
      lines.push('  种族值合计为 0：' + noStats.length + ' 只' + (noStats.length ? '（例：' + names(noStats) + '）' : ''));
      lines.push('  没有任何技能：' + noSkill.length + ' 只' + (noSkill.length ? '（例：' + names(noSkill) + '）' : ''));
      lines.push('  没有魂印：' + noMark.length + ' 只（魂印本来就只覆盖约 41% 的精灵）');
      lines.push('技能缓存：' + skills + ' 条');
      lines.push('魂印数据：' + marks.length + ' 条');
      lines.push('存储占用：' + (Db.usage() / 1048576).toFixed(2) + ' M 字符');
      lines.push('渲染模式：' + SeerStage.mode() + '　联机中继：ntfy.sh');
      if (!pets.length) lines.push('⚠ 本地库为空，先点「快速同步」');
      else if (noStats.length === pets.length) lines.push('⚠ 全部精灵都缺种族值，建议点「清空本地库」后重新同步');
      box.textContent = lines.join('\n');
    } catch (e) {
      box.textContent = '体检失败：' + e.message;
    }
  }

  async function renderMeta() {
    var tbody = $('#metaTable tbody');
    tbody.innerHTML = '';
    for (var i = 0; i < RESOURCES.length; i++) {
      var r = RESOURCES[i];
      var meta = await Db.getMeta(r.name);
      var cnt = await Db.count(r.store);
      var tr = el('tr');
      tr.appendChild(el('td', null, r.label));
      tr.appendChild(el('td', null, String(cnt)));
      tr.appendChild(el('td', 'hash', meta && meta.value ? meta.value.hash : '—'));
      tr.appendChild(el('td', null, meta && meta.value ? fmtTime(meta.value.syncedAt) : '—'));
      tbody.appendChild(tr);
    }
  }

  // ---------- 对战 ----------
  function emptyStats() {
    return { hp: 0, atk: 0, def: 0, spAtk: 0, spDef: 0, spd: 0 };
  }

  function addAttr(dst, attr, asPct) {
    if (!attr) return;
    var map = { hp: 'hp', atk: 'atk', def: 'def', sp_atk: 'spAtk', sp_def: 'spDef', spd: 'spd' };
    Object.keys(map).forEach(function (k) {
      var v = Number(attr[k] || 0);
      if (v) dst[map[k]] += asPct ? v : v;
    });
  }

  function buildStatBonus(petId) {
    var flat = emptyStats();
    var pct = emptyStats();
    var b = buildFor(petId);
    b.marks.forEach(function (id) {
      if (id == null) return;
      var m = state.mintmarkById[id];
      if (!m || !m.attr) return;
      addAttr(m.attr.percent ? pct : flat, m.attr, !!m.attr.percent);
    });
    var suit = state.suitId != null ? state.suitById[state.suitId] : null;
    if (suit && suit.bonus && suit.bonus.attribute) {
      var a = suit.bonus.attribute;
      addAttr(a.percent ? pct : flat, a, !!a.percent);
    }
    return { bonus: flat, bonusPct: pct, suit: suit };
  }

  async function buildEntry(pet, useBuild) {
    var withBuild = useBuild !== false;
    var fifthIds = pet.fifth || [];
    var lo = loadoutFor(pet);

    function dedupe(list) {
      var seen = {};
      return list.filter(function (s) {
        if (!s || s.id == null || seen[s.id]) return false;
        seen[s.id] = 1;
        return true;
      });
    }

    // 普通技能候选（严格排除第五技能）
    var normalItems = (pet.skill || []).filter(function (x) {
      return fifthIds.indexOf(x.skill.id) < 0;
    });

    var chosen = [];
    if (lo.n.length) {
      chosen = dedupe((await ensureSkills(lo.n)).filter(Boolean)).slice(0, 4);
    }

    // 不足 4 个就用候选池补满（候选池本身已排除第五技能）
    if (chosen.length < 4) {
      var list = normalItems.slice().sort(function (a, b) {
        return (b.learning_level || 0) - (a.learning_level || 0);
      }).slice(0, 16);
      var pool = dedupe((await ensureSkills(list.map(function (x) { return x.skill.id; }))).filter(Boolean));
      pool.sort(function (a, b) { return (b.power || 0) - (a.power || 0); });
      pool.forEach(function (s) {
        if (chosen.length >= 4) return;
        var dup = chosen.some(function (c) { return c.id === s.id; });
        if (!dup) chosen.push(s);
      });
    }

    if (!chosen.length) {
      chosen = [{ id: -1, name: '撞击', power: 35, max_pp: 35, accuracy: 95, crit_rate: 6.25, priority: 0, category: { id: 1 }, type: pet.type, info: null }];
    }

    // 第五技能：只在候选里取，且绝不能和普通位重复
    var fifthId = (lo.f != null && fifthIds.indexOf(lo.f) >= 0) ? lo.f : (fifthIds.length ? fifthIds[0] : null);
    if (fifthId != null) {
      chosen = chosen.filter(function (s) { return s.id !== fifthId; }).slice(0, 4);
      var f = await ensureSkills([fifthId]);
      if (f[0]) chosen.push(f[0]);
    }

    // 魂印
    var markIds = state.petSoulmarks[pet.id] || [];
    var marks = markIds.map(function (id) { return state.soulmarkById[id]; }).filter(Boolean);
    var passives = [];
    marks.forEach(function (m) {
      passives = passives.concat(B.parseSoulmark(m.desc || ''));
    });
    var suit = withBuild && state.suitId != null ? state.suitById[state.suitId] : null;
    if (suit && SUIT_PASSIVES[suit.id]) passives = passives.concat(SUIT_PASSIVES[suit.id]);

    var bld = withBuild ? buildFor(pet.id) : { natureId: null, talent: 31, level: 100, marks: [null, null, null] };
    var nature = bld.natureId != null ? state.natureById[bld.natureId] : null;
    var statBonus = withBuild ? buildStatBonus(pet.id) : { bonus: emptyStats(), bonusPct: emptyStats() };
    return {
      pet: pet, combo: comboOf(pet), skills: chosen, soulmarks: marks, passives: passives,
      iv: bld.talent, ev: bld.ev, level: bld.level, nature: nature, bonus: statBonus.bonus, bonusPct: statBonus.bonusPct,
      resist: bld.resist,
      mintmarks: bld.marks.map(function (id) { return id != null ? state.mintmarkById[id] : null; }),
      suitId: withBuild ? state.suitId : null
    };
  }

  function buildBenchEntry(pet) {
    var markIds = state.petSoulmarks[pet.id] || [];
    var marks = markIds.map(function (id) { return state.soulmarkById[id]; }).filter(Boolean);
    var passives = [];
    marks.forEach(function (m) { passives = passives.concat(B.parseSoulmark(m.desc || '')); });
    var benchAura = [];
    passives.forEach(function (p) { if (p.kind === 'benchAura') benchAura.push({ names: p.names, fx: p.fx }); });
    return { pet: pet, combo: comboOf(pet), soulmarks: marks, passives: passives, benchAura: benchAura };
  }

  function randomTeam(size, excludeIds) {
    var pool = state.pets.filter(function (p) { return excludeIds.indexOf(p.id) < 0; });
    if (!pool.length) pool = state.pets.slice();
    var picked = [];
    var used = {};
    var guard = 0;
    while (picked.length < size && guard < 5000) {
      guard++;
      var p = pool[Math.floor(Math.random() * pool.length)];
      if (!p || used[p.id]) continue;
      used[p.id] = 1;
      picked.push(p);
    }
    return picked;
  }

  async function startBattle() {
    if (!state.pets.length) { toast('本地库为空，请先同步数据', true); return; }
    var battleIds = state.team.slice(0, 6).filter(Boolean);
    if (!battleIds.length) { toast('请先在「出战格」放至少 1 只精灵', true); return; }

    var btn = $('#startBattle');
    btn.disabled = true;
    btn.textContent = '正在准备…';
    try {
      var allIds = state.team.filter(Boolean);
      var mePets = battleIds.map(function (id) { return state.petById[id]; }).filter(Boolean);
      var reservePets = state.team.slice(6, 12).filter(Boolean).map(function (id) { return state.petById[id]; }).filter(Boolean);
      var foePets = randomTeam(Math.max(3, mePets.length), allIds);

      var meTeam = [];
      for (var i = 0; i < mePets.length; i++) meTeam.push(await buildEntry(mePets[i], true));
      var meReserve = [];
      for (var r = 0; r < reservePets.length; r++) meReserve.push(buildBenchEntry(reservePets[r]));
      var foeTeam = [];
      for (var j = 0; j < foePets.length; j++) foeTeam.push(await buildEntry(foePets[j], false));

      var chart = B.buildChart(state.typesArr);
      state.chart = chart;
      var typeByName = {};
      state.typesArr.forEach(function (t) { typeByName[t.name] = t.id; });
      state.battle = new B.Battle({
        chart: chart,
        typeByName: typeByName,
        comboOf: function (id) { return state.combos[id]; },
        difficulty: $('#difficulty').value,
        level: 100,
        meTeam: meTeam,
        meReserve: meReserve,
        foeTeam: foeTeam
      });
      autoBattle.on = false;
      battleMenu = 'skill';
      clearTimeout(autoBattle.timer);
      $('#toggleAuto').classList.remove('primary');

      $('#battleSetup').classList.add('hidden');
      $('#battleView').classList.remove('hidden');
      SeerStage.reset();
      renderBattle();
    } catch (e) {
      console.error(e);
      toast('准备战斗失败：' + e.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = '开始对战';
    }
  }

  function sideVM(s) {
    var active = s.team[s.active] || {};
    var pet = state.petById[active.id];
    var combo = pet && pet.type ? state.combos[pet.type.id] : null;
    return {
      id: active.id,
      name: active.name || '—',
      level: active.level || 100,
      hp: active.hp == null ? 0 : active.hp,
      maxHp: active.maxHp || 1,
      color: combo ? typeColor(combo) : '#8899bb',
      comboId: combo ? combo.id : null,
      comboName: combo ? combo.name : '',
      soulmarks: active.soulmarks || [],
      soulNames: (active.soulmarks || []).map(function (m) {
        return m && (m.name || ('魂印 #' + m.id));
      }).filter(Boolean),
      effects: active.effects || [],
      stages: active.stages || null,
      status: active.status || null,
      shield: active.shield || 0,
      guard: !!active.guard,
      immune: !!active.immune,
      team: s.team
    };
  }

  /** 双方属性克制关系（按主属性对拼） */
  function matchupOf(meComboId, foeComboId) {
    var me = state.combos[meComboId];
    var foe = state.combos[foeComboId];
    if (!me || !foe || !state.chart) return null;
    var toFoe = B.effectiveness(state.chart, B.comboElements(me), B.comboElements(foe));
    var toMe = B.effectiveness(state.chart, B.comboElements(foe), B.comboElements(me));
    return { toFoe: toFoe, toMe: toMe };
  }

  function drawStage(selector, meSide, foeSide, opts) {
    var host = $(selector);
    if (!host) return;
    SeerStage.mount(host);
    var meVM = sideVM(meSide);
    var foeVM = sideVM(foeSide);
    SeerStage.render({
      turn: opts.turn || 0,
      over: !!opts.over,
      resultText: opts.resultText || '',
      resultWin: !!opts.resultWin,
      fieldName: opts.fieldName || '',
      crit: opts.crit || null,
      matchup: matchupOf(meVM.comboId, foeVM.comboId),
      me: meVM,
      foe: foeVM
    });
  }

  var autoBattle = { on: false, timer: null, speed: 1 };
  var battleMenu = 'skill';

  function toggleAuto(force) {
    autoBattle.on = (force == null) ? !autoBattle.on : !!force;
    var btn = $('#toggleAuto');
    if (btn) {
      btn.classList.toggle('primary', autoBattle.on);
      btn.textContent = autoBattle.on ? '自动战斗：开' : '自动战斗';
    }
    clearTimeout(autoBattle.timer);
    if (autoBattle.on) scheduleAuto(200);
  }

  function scheduleAuto(delay) {
    clearTimeout(autoBattle.timer);
    if (!autoBattle.on) return;
    var wait = delay == null ? Math.round(650 / (autoBattle.speed || 1)) : delay;
    autoBattle.timer = setTimeout(autoTick, wait);
  }

  function autoTick() {
    if (!autoBattle.on) return;
    var b = state.battle;
    if (!b || b.over) { toggleAuto(false); return; }

    if (b.needPlayerSwitch) {
      var idx = -1;
      b.me.team.forEach(function (c, i) {
        if (idx < 0 && c.hp > 0 && i !== b.me.active) idx = i;
      });
      if (idx >= 0) b.playerSwitch(idx);
      renderBattle();
      scheduleAuto();
      return;
    }

    var actor = b.activeOf('me');
    var target = b.activeOf('foe');
    if (!actor || !target) { toggleAuto(false); return; }

    var best = 0;
    var bestScore = -Infinity;
    for (var i = 0; i < actor.skills.length; i++) {
      if (actor.skills[i].pp <= 0) continue;
      var sc = b.scoreSkill(actor, target, actor.skills[i].skill);
      if (sc > bestScore) { bestScore = sc; best = i; }
    }

    b.step({ type: 'skill', index: best });
    renderBattle();
    if (!b.over) scheduleAuto();
  }

  function renderBattle() {
    var b = state.battle;
    if (!b) return;
    var snap = b.snapshot();
    state.lastSnap = snap;

    drawStage('#battleStage', snap.me, snap.foe, {
      turn: snap.turn,
      over: snap.over,
      resultText: snap.over ? (snap.winner === 'me' ? '胜利！' : '失败…') : '',
      resultWin: snap.winner === 'me',
      fieldName: snap.field ? snap.field.name : '',
      crit: snap.lastCrit || null
    });

    var log = $('#battleLog');
    log.innerHTML = '';
    b.log.forEach(function (line) {
      log.appendChild(el('div', /^——/.test(line) ? 'turn' : null, line));
    });
    log.scrollTop = log.scrollHeight;

    renderActions(snap);
  }

  function makeSkillCard(s, opts) {
    var btn = el('button', 'skill-btn');
    btn.disabled = s.pp <= 0;
    btn.appendChild(el('div', 'sk-name', s.name));

    var row1 = el('div', 'sk-row');
    row1.appendChild(el('span', null, '次数'));
    row1.appendChild(el('span', 'v', s.pp + ' / ' + s.maxPp));
    btn.appendChild(row1);

    var row2 = el('div', 'sk-row');
    row2.appendChild(el('span', null, '威力'));
    row2.appendChild(el('span', 'v', s.power ? String(s.power) : '—'));
    btn.appendChild(row2);

    var tag = el('div', 'sk-tag');
    tag.textContent = (CAT_LABEL[s.category] || '') + (s.type ? ' · ' + comboName(s.type) : '');
    var eff = s.power ? effLabel(s.type, opts.target) : null;
    if (eff) {
      var b = el('b', null, ' · ' + eff.text);
      b.style.color = eff.color;
      tag.appendChild(b);
    }
    if (s.power && opts.est > 0) tag.appendChild(el('span', 'est', ' · 约' + opts.est));
    btn.appendChild(tag);

    var info = el('i', 'sk-info', 'i');
    info.title = '查看技能详情';
    info.addEventListener('click', function (e) {
      e.stopPropagation();
      if (opts.onInfo) opts.onInfo();
    });
    btn.appendChild(info);

    btn.addEventListener('click', opts.onPick);
    return btn;
  }

  function renderActionPanel(box, snap, bag, handlers) {
    box.innerHTML = '';
    if (!snap) return;

    if (snap.over) {
      var res = el('div', 'result-bar');
      res.appendChild(el('b', null, snap.resultText || '对战结束'));
      var again = el('button', 'btn primary', snap.resultAction || '返回');
      again.addEventListener('click', handlers.flee);
      res.appendChild(again);
      box.appendChild(res);
      return;
    }

    if (snap.needPlayerSwitch) {
      box.appendChild(el('div', 'muted', '选择下一只上场的精灵（不消耗回合）'));
      snap.me.team.forEach(function (t) {
        if (!t.alive || t.active) return;
        var btn = el('button', 'skill-btn');
        btn.appendChild(el('div', 'sk-name', t.name));
        var r = el('div', 'sk-row');
        r.appendChild(el('span', null, '体力'));
        r.appendChild(el('span', 'v', t.hp + ' / ' + t.maxHp));
        btn.appendChild(r);
        btn.addEventListener('click', function () { handlers.forceSwitch(t.index); });
        box.appendChild(btn);
      });
      return;
    }

    var active = snap.me.team[snap.me.active];

    if (battleMenu === 'item') {
      if (!bag || !bag.length) box.appendChild(el('div', 'muted', '没有可用道具'));
      (bag || []).forEach(function (it) {
        var card = el('button', 'skill-btn');
        card.disabled = it.count <= 0;
        card.appendChild(el('div', 'sk-name', it.name));
        var r = el('div', 'sk-row');
        r.appendChild(el('span', null, '剩余'));
        r.appendChild(el('span', 'v', it.count));
        card.appendChild(r);
        card.appendChild(el('div', 'sk-tag', it.desc));
        card.addEventListener('click', function () { handlers.item(it.id); });
        box.appendChild(card);
      });
    } else if (battleMenu === 'switch') {
      snap.me.team.forEach(function (t) {
        if (!t.alive || t.active) return;
        var card = el('button', 'skill-btn');
        card.appendChild(el('div', 'sk-name', t.name));
        var r = el('div', 'sk-row');
        r.appendChild(el('span', null, '体力'));
        r.appendChild(el('span', 'v', t.hp + ' / ' + t.maxHp));
        card.appendChild(r);
        if (t.exiled) {
          card.disabled = true;
          card.appendChild(el('div', 'sk-tag', '被神秘结界放逐，本回合无法主动切换'));
        } else {
          card.appendChild(el('div', 'sk-tag', '换人消耗本回合'));
          card.addEventListener('click', function () { handlers.switchTurn(t.index); });
        }
        box.appendChild(card);
      });
    } else if (active) {
      function liveSkill(index) {
        var b = state.battle;
        var c = b && b.activeOf ? b.activeOf('me') : null;
        return c && c.skills[index] ? c.skills[index].skill : null;
      }
      active.skills.forEach(function (s, i) {
        box.appendChild(makeSkillCard(s, {
          target: snap.foe.team[snap.foe.active],
          est: handlers.est ? handlers.est(i) : 0,
          onInfo: function () { showSkillSheet(liveSkill(i) || s); },
          onPick: function () { handlers.skill(i); }
        }));
      });
    }

    var menu = el('div', 'battle-menu');
    [['战斗', 'skill'], ['道具', 'item'], ['精灵', 'switch'], ['撤退', 'flee']].forEach(function (m) {
      var btn = el('button', 'btn menu-btn' + (battleMenu === m[1] ? ' active' : ''), m[0]);
      btn.addEventListener('click', function () {
        if (m[1] === 'flee') { handlers.flee(); return; }
        battleMenu = m[1];
        handlers.rerender();
      });
      menu.appendChild(btn);
    });
    box.appendChild(menu);
  }

  function renderActions(snap) {
    var b = state.battle;
    renderActionPanel($('#battleActions'), {
      over: snap.over,
      resultText: snap.winner === 'me' ? '胜利！' : '失败…',
      resultAction: '再来一局',
      needPlayerSwitch: snap.needPlayerSwitch,
      me: snap.me,
      foe: snap.foe
    }, snap.items ? snap.items.me : [], {
      skill: function (i) { b.step({ type: 'skill', index: i }); renderBattle(); },
      item: function (id) { b.step({ type: 'item', id: id }); renderBattle(); },
      switchTurn: function (i) { b.step({ type: 'switch', index: i }); renderBattle(); },
      forceSwitch: function (i) { b.playerSwitch(i); renderBattle(); },
      flee: function () {
        toggleAuto(false);
        state.battle = null;
        $('#battleView').classList.add('hidden');
        $('#battleSetup').classList.remove('hidden');
      },
      rerender: renderBattle,
      est: function (i) {
        if (!state.battle) return 0;
        var ea = state.battle.activeOf('me');
        var et = state.battle.activeOf('foe');
        if (!ea || !et) return 0;
        return state.battle.scoreSkill(ea, et, ea.skills[i].skill);
      }
    });
  }

  function comboName(id) {
    var c = state.combos[id];
    return c ? c.name : '';
  }

  /** 当前招式打对面这只精灵的克制关系 */
  function effLabel(skillComboId, targetItem) {
    if (!state.chart || skillComboId == null) return null;
    var pet = targetItem ? state.petById[targetItem.id] : null;
    var targetCombo = pet && pet.type ? state.combos[pet.type.id] : null;
    var skillCombo = state.combos[skillComboId];
    if (!targetCombo || !skillCombo) return null;
    var m = B.effectiveness(state.chart, B.comboElements(skillCombo), B.comboElements(targetCombo));
    if (m === 0) return { text: '无效', color: '#7d8db3' };
    if (m > 1) return { text: '克制 ×' + m, color: '#7bffb2' };
    if (m < 1) return { text: '被克 ×' + m, color: '#ff8a99' };
    return null;
  }

  // ---------- 详情弹层 ----------
  var STAT_CN = { atk: '攻击', def: '防御', spAtk: '特攻', spDef: '特防', spd: '速度', acc: '命中', eva: '闪避' };
  var STATUS_CN = { poison: '中毒', burn: '烧伤', frost: '冻伤', paralyze: '麻痹', sleep: '睡眠', fear: '害怕', tired: '疲惫' };

  function describeFx(e) {
    if (!e) return '';
    var pre = e.req ? '（满足条件时）' : '';
    switch (e.kind) {
      case 'stat':
        return pre + (e.target === 'self' ? '自身' : '对手') + (STAT_CN[e.stat] || e.stat) +
          (e.stages > 0 ? '+' : '') + e.stages + (e.chance < 100 ? '（' + e.chance + '%）' : '');
      case 'status':
        return pre + (e.chance < 100 ? e.chance + '% ' : '') + '令对手' + (STATUS_CN[e.statusId] || e.statusId) +
          (e.turns > 1 ? ' ' + e.turns + ' 回合' : '');
      case 'flat': return pre + '附加 ' + e.value + ' 点固定伤害';
      case 'healFlat': return pre + '回复 ' + e.value + ' 点体力';
      case 'heal': return pre + '回复最大体力的 ' + e.num + '/' + e.den;
      case 'drain': return pre + '造成伤害的 ' + e.num + '/' + e.den + ' 回复自身';
      case 'shield': return pre + '获得 ' + e.value + ' 点护盾';
      case 'exile': return '回合开始时放逐对手场下 1~3 只（存活 <5 时 1~2 只，上限存活-2），本回合不能主动切换';
      case 'divineTurn': return '回合开始时：体力 >1/2 免疫异常与能力下降；体力 <1/2 获得 30% 最大体力护盾';
      case 'wukongTurn': return '回合开始：对手 >1/2 体力时攻击增伤 50%（暴击 100%）；<1/2 时全技能先制 +1 并追加 1/3 百分比伤害';
      case 'wukongForm': return '每场一次：异常且半血以下触发法天象地·圣（重置体力/PP/异常，3 回合免异常+先制+必暴）';
      case 'wukongFormDetail': return '法天象地·圣：重置体力/PP/异常，3 回合免异常+先制+必暴，下场消失';
      case 'morphGuard': return '坚壁形态：登场 ' + e.shield + ' 护盾 + 免疫下 1 次异常；破碎 ' + e.recharge + ' 回合后重激活，未激活时回合末回 ' + e.healNum + '/' + e.healDen + ' 体力';
      case 'morphSpeed': return '极速形态：全技能先制 +' + e.priority + '；先手攻击伤害结算前对手全属性 -' + e.statDown;
      case 'morphDestroy': return '毁灭形态：攻击伤害 ×' + e.dmgMul + '；对手 <' + e.execPct + '% 体力时所有技能秒杀';
      case 'morphUltimate': return '王·异甲同心：极速形态追加伤害并切毁灭；毁灭形态吸取体力并切极速';
      case 'firstHealBlock': return '先出手时对手本回合无法通过技能回血';
      case 'firstSpeedUp': return '先出手时下回合自身速度 +1';
      case 'defStatsPct': return '自身双防能力值 +' + e.pct + '%';
      case 'lowHpExec': return '回合开始时若对手体力 <' + e.pct + '%，本回合所有技能必定秒杀';
      case 'immuneStatusIds': return '免疫指定异常状态（' + (e.ids || []).join('、') + '）';
      case 'fullHpGuard': return '回合开始时满体力 → 当回合受到的攻击伤害 -' + e.pct + '%';
      case 'endRampFlat': return '战斗阶段结束固伤 ' + e.base + '，每回合 +' + e.inc + '，上限 ' + e.cap + (e.dbl ? '（对手有强化时翻倍）' : '');
      case 'onHitClearFoeStats': return '受到攻击时消除对手能力提升';
      case 'benchAura':
        if (e.fx && e.fx.type === 'benchFloor') return '己方场下体力低于 1/2 时不会被继续削减';
        if (e.fx && e.fx.type === 'firstShield') return '己方首发首次登场获得 ' + (e.fx.pct || 30) + '% 启灵元神最大体力护盾';
        if (e.fx && e.fx.type === 'markOnSwitch') return '对方主动换人时给新上场精灵附加 1 层神圣印记';
        if (e.fx && e.fx.type === 'attackBuff') return '在背包时己方攻击 ' + e.fx.chance + '% 增伤 ' + Math.round((e.fx.mul - 1) * 100) + '%，未触发吸取 ' + e.fx.min + '~' + e.fx.max + ' 体力';
        if (e.fx && e.fx.type === 'teamStat') return '背包内为全队提供属性加成';
        if (e.fx && e.fx.type === 'healFix') return '背包内提升指定精灵的回血量';
        return '背包光环';
      case 'guard': return pre + e.turns + ' 回合内受到伤害 ×' + e.mul;
      case 'immuneStatus': return pre + e.turns + ' 回合免疫异常状态';
      case 'immuneStat': return pre + e.turns + ' 回合免疫能力下降';
      case 'oneHit': return pre + '挡下下一次攻击';
      case 'thorns': return pre + e.turns + ' 回合受击反弹 ' + e.value;
      case 'dot': return pre + e.turns + ' 回合每回合额外 ' + e.value + ' 点伤害';
      case 'power': return pre + '威力倍率 ×' + (e.mul || 1) + (e.add ? ' +' + e.add : '');
      case 'exec': return pre + '直接秒杀';
      case 'selfKo': return '使用后自身倒下（自爆）';
      case 'oppTo1': return '对手体力降为 1 点';
      case 'skillBlock': return '对手 ' + e.turns + ' 回合内无法使用属性技能';
      case 'nextPet': return '下一只上场精灵获得强化（' + e.times + ' 次）';
      case 'foePercentSelf': return '造成等于自身消耗体力 ' + e.num + '/' + e.den + ' 的百分比伤害';
      case 'desperate': return '按双方体力高低选择消耗打法';
      case 'clear': return e.target === 'self' ? '解除自身能力下降' : '消除对手能力提升';
      case 'ppDrain': return '削减对手 ' + e.amount + ' 点 PP';
      case 'multiHit': return '攻击 ' + e.min + '~' + e.max + ' 次';
      case 'multiHitChance': return e.chance + '% 概率攻击 ' + e.times + ' 次';
      case 'ppZero': return '对手 ' + e.count + ' 个技能 PP 归零';
      case 'ppCostMul': return '对手 ' + e.turns + ' 回合内 PP 消耗 ×' + e.mul;
      case 'ppDrainFirst': return '先手时削减对手 ' + e.value + ' 点 PP';
      case 'ppRestoreSelf': return e.chance + '% 回复自身全技能 ' + e.value + ' 点 PP';
      case 'healRandom': return '随机回复 ' + e.min + '~' + e.max + ' 点体力';
      case 'healChance': return e.chance + '% 概率回复最大体力的 ' + e.num + '/' + e.den;
      case 'healByShield': return '回复等于双方护盾总和的体力';
      case 'healBlock': return '对手 ' + e.turns + ' 回合内无法回复体力';
      case 'healDown': return '对手回复效果降低 ' + e.pct + '%（' + e.turns + ' 回合）';
      case 'flatRandom': return '随机附加 ' + e.min + '~' + e.max + ' 点固定伤害';
      case 'flatByDealt': return '追加上次伤害 ' + e.pct + '% 的固伤';
      case 'flatByAtk': return '附加自身攻击 ' + e.pct + '% 的伤害';
      case 'flatBySelfLost': return '附加自身已损失体力 ' + e.pct + '% 的伤害';
      case 'flatByTargetMax': return '附加对手最大体力 ' + Math.round(e.pct) + '% 的伤害';
      case 'flatByMaxHp': return '附加自身最大体力 ' + e.pct + '% 的伤害';
      case 'flatByStats': return '附加双防总和 ' + e.pct + '% 的伤害';
      case 'flatByStatStages': return '附加能力提升等级 × ' + e.value + ' 的固伤';
      case 'flatByTargetLost': return '附加对手已损失体力 ' + e.pct + '% 的伤害';
      case 'minDamage': return '伤害不低于 ' + e.value;
      case 'percentHp': return '削减对手最大体力 ' + e.num + '/' + e.den;
      case 'ignoreGuards': return '无视对手减伤效果';
      case 'ignoreImmune': return '无视对手免疫效果';
      case 'ignoreDefUp': return '无视对手双防提升';
      case 'ignoreDefPct': return '忽略对手 ' + e.pct + '% 防御';
      case 'noWeak': return '伤害不会出现微弱';
      case 'critBuff': return e.turns + ' 回合内必定暴击';
      case 'critBonus': return '暴击率 +' + e.value + '%';
      case 'clearFoe': return '消除对手回合类效果';
      case 'clearOrFearDrain': return '消除回合成功 → 令对手害怕；未成功 → 吸取对手 1/' + e.den + ' 最大体力';
      case 'benchQuarterOnClear': return '消除强化成功 → 对手场下随机 1 只损失 1/' + e.den + ' 最大体力（残留 1 点）';
      case 'critHealDealt': return '暴击后按伤害的 ' + e.num + '/' + e.den + ' 回复体力';
      case 'junPunish': return e.turns + ' 回合内：对手攻击伤害低于 ' + e.threshold + ' 则其场下损失 ' + e.bench + ' 点体力';
      case 'junGuard': return e.turns + ' 回合受伤大幅降低，受到高于 ' + e.threshold + ' 的伤害时随机附加 ' + e.count + ' 种异常';
      case 'allStatChanceDouble': return '全属性 +' + e.stages + '，' + e.chance + '% 概率翻倍，未触发则吸取对手能力提升';
      case 'invertSelfDowns': return '反转自身能力下降，成功则令对手下 1 次攻击技能无效';
      case 'benchScaleHeal': return '每存活 1 只回复 ' + e.perAlive + ' 点体力，每阵亡 1 只附加 ' + e.perDead + ' 点固定伤害';
      case 'lowDamageBenchStrike': return '造成伤害低于 ' + e.threshold + ' 则对手场下损失 ' + e.value + ' 点体力（残留 1 点）';
      case 'benchHealAll': return '未击败对手 → 己方场下各回复 ' + e.value + ' 点体力';
      case 'junNoWeakenNext': return '击败对手后，下次登场时帝君之罚/赐不再削弱';
      case 'ignoreDefPctTurns': return e.turns + ' 回合内攻击忽略对手 ' + e.pct + '% 双防';
      case 'drainTimed': return e.turns + ' 回合内使用技能吸取对手 1/' + e.den;
      case 'roundLock': return e.turns + ' 回合内自身回合类效果无法被消除';
      case 'junYu': return '免疫固定伤害、百分比伤害与异常状态（抗性视为 100%）';
      case 'junWei': return '最后 1 只存活时回合效果不可清除；对手最后 1 只时无法用技能回血';
      case 'junYun': return '被击败后 ' + e.chance + '% 令对手 1 只场下精灵死亡';
      case 'critBonusTurns': return e.turns + ' 回合暴击率 +' + Math.round(e.add) + '%';
      case 'critRamp': return '暴击率逐步提升（最高 ' + e.cap + '%）';
      case 'critIfFirst': return '先手时必定暴击';
      case 'critIfPositive': return '有强化时 ' + e.chance + '% 暴击';
      case 'critPercent': return '暴击时附加对手最大体力 ' + e.num + '/' + e.den;
      case 'priorityBuff': return e.turns + ' 回合内先制 +' + e.value;
      case 'priorityChance': return e.chance + '% 概率先制 +' + e.value;
      case 'priorityAlways': return '先制 +' + e.value;
      case 'priorityDown': return '对手 ' + e.turns + ' 回合内先制 -' + e.value;
      case 'priorityDownNoDamage': return '本回合未受伤则对手先制 -' + e.value;
      case 'priorityIfLow': return '残血时先制 +' + e.value;
      case 'priorityIfPositive': return '有强化时先制 +' + e.value;
      case 'mustHit': return e.turns + ' 回合内必定命中';
      case 'dodge': return e.turns + ' 回合内 ' + e.chance + '% 闪避';
      case 'evadeIfFirst': return '先手时闪避对手攻击';
      case 'survive': return e.turns + ' 回合内免死（保留 ' + e.hp + ' 点）';
      case 'damageCap': return e.turns + ' 回合内单次受伤不超过 ' + e.value;
      case 'guardFlat': return e.turns + ' 回合内每回合减少 ' + e.value + ' 点伤害';
      case 'damageFlat': return '减伤 ' + e.value + ' 点';
      case 'damageBuff': return e.turns + ' 回合内伤害 ×' + e.mul;
      case 'targetDamageDown': return '对手伤害削弱';
      case 'reflectDamage': return e.turns + ' 回合内反弹 ' + e.num + '/' + e.den + ' 伤害';
      case 'reflectNext': return '下次受击反馈 ' + e.pct + '% 伤害';
      case 'immuneReflectStatus': return e.turns + ' 回合免疫并反弹异常';
      case 'immuneBelow': return e.turns + ' 回合免疫低于 ' + e.value + ' 的伤害';
      case 'immuneBelowPassive': return '免疫低于 ' + e.value + ' 的伤害';
      case 'onHitImmune': return '受击后免疫下一次伤害';
      case 'onHitStatus': return '受击后 ' + e.chance + '% 使对手' + (STATUS_CN[e.statusId] || e.statusId);
      case 'onHitFlatPct': return '每次攻击附加对手当前体力 ' + e.pct + '% 的固伤';
      case 'onHitDamageUp': return '受击后对手下回合受伤翻倍';
      case 'drainOnHit': return '造成伤害的 ' + Math.round(e.num / e.den * 100) + '% 回血';
      case 'drainMax': return '吸取对手最大体力 ' + e.num + '/' + e.den;
      case 'drainIfStatus': return '对手有异常时回复造成伤害的 ' + e.pct + '%';
      case 'attackBlock': return '对手 ' + e.turns + ' 回合内无法使用攻击技能';
      case 'attackBlockFirst': return '先手时对手攻击无效';
      case 'firstNullify': return '先手时令对手技能无效';
      case 'blockSwitch': return '对手 ' + e.turns + ' 回合内无法换人';
      case 'protectStats': return e.turns + ' 回合内能力提升不被消除';
      case 'invertStages': return '反转自身能力下降' + (e.dbl ? '（双倍）' : '');
      case 'stealStats': return '吸取对手 ' + e.count + ' 项属性';
      case 'stealPositive': return '吸取对手能力提升';
      case 'randomStatUp': return '随机 ' + e.count + ' 项能力 +' + e.stages;
      case 'randomStatDown': return '随机 ' + e.count + ' 项能力 -' + e.stages;
      case 'perTurnStatDown': return e.turns + ' 回合内每回合对手' + (STAT_CN[e.stat] || e.stat) + ' -' + e.stages;
      case 'randomStatus': return '随机附加 ' + e.count + ' 种异常';
      case 'delayedKill': return e.turns + ' 回合后对手未击败自己则死亡';
      case 'deathCurse': return '被击败时对手损失 ' + e.value + ' 点体力';
      case 'restoreStages': return '后手时能力等级回到回合初';
      case 'copyDef': return e.turns + ' 回合内防御力与对手相同';
      case 'oneHitIfFirst': return '先手时免疫当回合伤害并回血';
      case 'costHpStats': return '消耗体力提升能力';
      case 'rampDamage': return '连续使用伤害递增（上限 ' + Math.round(e.cap * 100) + '%）';
      case 'recoil': return '自身承受伤害 ' + e.num + '/' + e.den;
      case 'selfCostDamage': return '消耗 ' + e.cost + ' 体力造成 ' + e.value + ' 固伤';
      case 'prevDamageFlat': return '附加对手上次造成的伤害';
      case 'critBuffTurns': return e.turns + ' 回合暴击率提升';
      case 'randomStatuses': return '随机附加异常状态';
      default: return pre + '（' + e.kind + '）';
    }
  }

  function openSheet(title) {
    $('#sheetTitle').textContent = title;
    $('#sheetMeta').innerHTML = '';
    $('#sheetBody').innerHTML = '';
    $('#sheet').classList.remove('hidden');
  }

  function sheetMeta(k, v) {
    var s = document.createElement('span');
    var b = document.createElement('b');
    b.textContent = v;
    s.appendChild(document.createTextNode(k + ' '));
    s.appendChild(b);
    $('#sheetMeta').appendChild(s);
  }

  function showSkillSheet(skill, title) {
    if (!skill) return;
    // 战斗快照里的技能只有展示字段；按 id 回查完整技能，避免效果文本/属性为空
    if (skill.id != null && state.skillCache[skill.id]) {
      var fullSkill = state.skillCache[skill.id];
      var hasText = (fullSkill.effects && fullSkill.effects.length) || fullSkill.info ||
        (fullSkill.skill_effect && fullSkill.skill_effect.length);
      if (hasText) skill = fullSkill;
    }
    openSheet(title || skill.name || '技能详情');
    sheetMeta('属性', comboName(skill.type && skill.type.id) || '—');
    sheetMeta('分类', CAT_LABEL[skill.category && skill.category.id] || '—');
    sheetMeta('威力', skill.power ? String(skill.power) : '—');
    sheetMeta('命中', (skill.accuracy == null ? 100 : skill.accuracy) + '%');
    sheetMeta('暴击', (skill.crit_rate == null ? 6.25 : skill.crit_rate) + '%');
    sheetMeta('先制', String(skill.priority || 0));
    sheetMeta('次数', String(skill.max_pp || 0));

    var body = $('#sheetBody');

    // 效果原文：现代技能大多没有 info，文本在 skill_effect 里
    var effTexts = (skill.skill_effect || skill.effects || [])
      .map(function (x) { return x && (x.info || x.analyze_info); })
      .filter(Boolean);
    if (skill.info) {
      var raw = document.createElement('div');
      raw.className = 'raw';
      raw.textContent = skill.info;
      body.appendChild(raw);
    }
    if (effTexts.length) {
      var head = document.createElement('div');
      head.className = 'raw';
      head.style.marginTop = '6px';
      head.textContent = '效果原文：';
      body.appendChild(head);
      effTexts.forEach(function (t) {
        var d = document.createElement('div');
        d.className = 'raw';
        d.style.paddingLeft = '8px';
        d.textContent = '· ' + String(t).replace(/\[[^\]]*\]/g, '').replace(/\s*\n\s*/g, ' ').trim();
        body.appendChild(d);
      });
    }

    var fx = [];
    try { fx = B.parseSkillEffects(skill) || []; } catch (e) { fx = []; }
    var fxLines = [];
    var fxUnknown = 0;
    fx.forEach(function (e) {
      var line = describeFx(e);
      if (!line) { fxUnknown++; return; }
      fxLines.push(line);
    });
    var extraNotes = [];
    try { extraNotes = (B.skillImplNotes && B.skillImplNotes(skill)) || []; } catch (e2) { extraNotes = []; }
    if (fxLines.length || extraNotes.length) {
      var h2 = document.createElement('div');
      h2.className = 'raw';
      h2.style.marginTop = '10px';
      h2.textContent = '已接入结算：';
      body.appendChild(h2);
    }
    fxLines.forEach(function (line) {
      var d = document.createElement('span');
      d.className = 'fx';
      d.textContent = line;
      body.appendChild(d);
    });
    extraNotes.forEach(function (line) {
      var d = document.createElement('span');
      d.className = 'fx';
      d.textContent = line;
      body.appendChild(d);
    });
    if (extraNotes.length || fxUnknown > 0) {
      var tip2 = document.createElement('div');
      tip2.className = 'raw';
      tip2.style.marginTop = '6px';
      tip2.style.opacity = '0.75';
      tip2.textContent = '（以上为按技能/魂印专门代码结算的部分；' +
        (fxUnknown > 0 ? '另有 ' + fxUnknown + ' 项由引擎按条件触发、面板未逐条展开。' : '面板与 fx 解析结果一致。') + '）';
      body.appendChild(tip2);
    }

    appendGlossary(body, [String(skill.info || '')].concat(effTexts.map(function (t) { return String(t); })));

    if (!skill.info && !effTexts.length && !fx.length) {
      body.appendChild(document.createTextNode('（这条技能没有可用的效果数据）'));
    } else if (effTexts.length && !fx.length) {
      var tip = document.createElement('div');
      tip.className = 'raw';
      tip.style.marginTop = '10px';
      tip.textContent = '（这段效果暂未实现结算，目前只展示原文）';
      body.appendChild(tip);
    }
  }

  /** 名词解释：把文本里出现的专有名词（蚩庸之锁等）列出来 */
  function appendGlossary(body, texts) {
    var hits = [];
    texts.forEach(function (t) {
      try { (B.keywordHits ? B.keywordHits(t) : []).forEach(function (h) { hits.push(h); }); } catch (e) { }
    });
    var seen = {};
    hits = hits.filter(function (h) { if (seen[h.term]) return false; seen[h.term] = 1; return true; });
    if (!hits.length) return;
    var head = document.createElement('div');
    head.className = 'raw';
    head.style.marginTop = '10px';
    head.textContent = '名词解释：';
    body.appendChild(head);
    hits.forEach(function (h) {
      var d = document.createElement('div');
      d.className = 'raw';
      d.style.paddingLeft = '8px';
      d.style.marginTop = '2px';
      d.textContent = '· ' + h.term + '：' + h.def;
      body.appendChild(d);
    });
  }

  function showTipSheet(title, text) {
    openSheet(title || '名词解释');
    var body = $('#sheetBody');
    var d = document.createElement('div');
    d.className = 'raw';
    d.textContent = text || '';
    body.appendChild(d);
  }

  function showSoulSheet(side) {
    var snap = state.lastSnap;
    if (!snap) return;
    var s = side === 'me' ? snap.me : snap.foe;
    var active = s && s.team[s.active];
    if (!active) return;
    openSheet(active.name + ' · 魂印');
    sheetMeta('体力', active.hp + ' / ' + active.maxHp);
    sheetMeta('属性', active.combo || '—');

    var body = $('#sheetBody');
    var marks = active.soulmarks || [];
    if (!marks.length) {
      body.appendChild(document.createTextNode('这只精灵没有魂印数据。'));
      return;
    }
    marks.forEach(function (sm) {
      if (!sm) return;
      var h = document.createElement('div');
      h.className = 'fx';
      h.style.color = 'var(--cyan)';
      h.textContent = sm.name || ('魂印 #' + sm.id);
      body.appendChild(h);

      var parts = String(sm.desc || '')
        .split(/[；;|①②③④⑤\n]/)
        .map(function (x) { return x.trim(); })
        .filter(Boolean);
      var done = 0;
      parts.forEach(function (line) {
        var clean = line.replace(/^\[?[^\]：:]{1,12}\]?[：:]\s*/, '');
        if (!clean) return;
        var fx = [];
        try { fx = B.parseSoulmark(clean) || []; } catch (e) { fx = []; }
        // 神耀能量这类「N 层：」分条由引擎按层数统一判定，标为已实现
        if (!fx.length && /神耀能量/.test(String(sm.desc || '')) && /^\d+\s*层\s*[：:]/.test(clean)) {
          fx = [{ kind: 'stackThreshold' }];
        }
        var row = document.createElement('div');
        row.className = 'fxline ' + (fx.length ? 'on' : 'off');
        row.textContent = (fx.length ? '✓ ' : '○ ') + clean;
        if (fx.length) {
          done++;
          var sum = fx.map(describeFx).filter(Boolean).join('；');
          if (sum) row.title = sum;
        }
        body.appendChild(row);
      });
      var note = document.createElement('div');
      note.className = 'raw';
      note.style.margin = '4px 0 10px';
      note.textContent = '已实现 ' + done + ' / ' + parts.length + ' 条（○ 为暂未实现，仅展示原文）';
      body.appendChild(note);
      appendGlossary(body, [String(sm.desc || '')]);
    });
  }

  /** 只同步一个资源，供自检 / 手动修复使用 */
  async function syncOne(name) {
    var r = RESOURCES.filter(function (x) { return x.name === name; })[0];
    if (!r) throw new Error('未知资源 ' + name);
    var res = await Api.fetchAll(r.name, {
      expand: true,
      maxItems: r.name === 'skill' ? 5000 : 0
    });
    Db.clear(r.store);
    for (var k = 0; k < res.items.length; k += 200) {
      Db.putAll(r.store, res.items.slice(k, k + 200));
    }
    var head = await Api.headHash(r.name);
    Db.setMeta(r.name, { hash: head.hash, count: res.items.length, syncedAt: Date.now(), format: r.format || 1 });
    await Db.flush();
    return res.items.length;
  }

  // ---------- 联机对战 ----------
  var pvp = {
    session: null,
    role: null,
    code: null,
    log: [],
    snap: null,
    myIds: [],
    peerIds: [],
    waiting: false,
    showSwitch: false,
    started: false
  };

  function switchTab(name) {
    var btn = document.querySelector('.tab[data-tab="' + name + '"]');
    if (btn) btn.click();
  }

  function onlineStatus(text, cls) {
    var box = $('#onlineStatus');
    box.textContent = text || '';
    box.className = 'online-status' + (cls ? ' ' + cls : '');
  }

  function setRoomState(text, cls) {
    var box = $('#roomState');
    box.textContent = text;
    box.className = 'room-state' + (cls ? ' ' + cls : '');
  }

  function inviteLink(code) {
    return location.origin + location.pathname + '#join=' + code;
  }

  function createRoom() {
    if (!state.pets.length) { toast('本地库为空，请先同步数据', true); return; }
    startSession('host', SeerNet.makeCode(8));
  }

  function joinRoomByCode(code) {
    code = String(code || '').trim().toLowerCase();
    if (!code) { toast('请输入房间码', true); return; }
    if (!state.pets.length) { toast('本地库为空，请先同步数据', true); return; }
    startSession('guest', code);
  }

  function startSession(role, code) {
    if (pvp.session) { try { pvp.session.close(); } catch (e) { } pvp.session = null; }

    pvp.role = role;
    pvp.code = code;
    pvp.log = [];
    pvp.snap = null;
    pvp.started = false;
    pvp.waiting = false;
    pvp.showSwitch = false;
    battleMenu = 'skill';
    pvp.myIds = state.team.slice(0, 12).filter(Boolean);
    pvp.peerIds = [];

    $('#onlineLobby').classList.add('hidden');
    $('#onlineRoom').classList.remove('hidden');
    $('#onlineBattle').classList.add('hidden');
    $('#onlineBattle').dataset.built = '';
    $('#onlineBattle').innerHTML = '';
    SeerStage.reset();
    $('#roomCode').textContent = code;
    $('#peerOnlineTeam').innerHTML = '<span class="muted">等待加入…</span>';
    renderMyOnlineTeam();
    setRoomState(role === 'host' ? '等待对方加入…把房间码或邀请链接发给朋友' : '正在加入房间…');

    pvp.session = new SeerPvp.Session({
      role: role,
      code: code,
      buildEntry: function (id, side) { return buildEntry(state.petById[id], side === 'me'); },
      chart: (state.chart = B.buildChart(state.typesArr)),
      comboOf: function (id) { return state.combos[id]; },
      onEvent: onPvpEvent
    });
    pvp.session.open();

    if (role === 'guest') {
      setTimeout(function () {
        if (pvp.session && !pvp.started && !pvp.session.peerSeen) {
          setRoomState('没找到这个房间。确认房间码是否正确，或者让房主先创建房间。', 'err');
        }
      }, 20000);
    }
  }

  function leaveRoom() {
    if (pvp.session) { try { pvp.session.close(); } catch (e) { } }
    pvp.session = null;
    pvp.started = false;
    pvp.snap = null;
    pvp.log = [];
    $('#onlineRoom').classList.add('hidden');
    $('#onlineLobby').classList.remove('hidden');
    onlineStatus('');
  }

  function onPvpEvent(t, p) {
    switch (t) {
      case 'status':
        if (p.state === 'online') {
          setRoomState(p.mode === 'sse' ? '已连接中继（实时推送）' : '已连接中继（轮询）', 'ok');
        } else if (p.state === 'reconnecting') {
          setRoomState('连接不稳定，正在重连…', 'err');
        } else if (p.state === 'offline') {
          setRoomState('网络异常：' + (p.message || '无法连接'), 'err');
        } else if (p.state === 'busy') {
          setRoomState(p.message || '正在重试…', 'err');
        } else if (p.state === 'building') {
          setRoomState('正在准备技能数据…');
        } else if (p.state === 'battle') {
          setRoomState('对战开始', 'ok');
        }
        break;

      case 'peer':
        setRoomState('对方已加入，等双方点「用当前背包出战」', 'ok');
        break;

      case 'peer-team':
        pvp.peerIds = (p.team || []).slice();
        renderPeerTeam();
        break;

      case 'ready':
        if (p.peer) setRoomState('对方已就绪，等你也确认队伍');
        break;

      case 'self-team':
        pvp.myIds = (p.team || []).slice();
        renderMyOnlineTeam();
        break;

      case 'start':
        pvp.started = true;
        pvp.log = (p.lines || []).slice();
        pvp.snap = p.snap;
        $('#onlineBattle').classList.remove('hidden');
        renderOnlineBattle();
        break;

      case 'sync':
        if (p.lines && p.lines.length) pvp.log = pvp.log.concat(p.lines);
        pvp.snap = p.snap;
        pvp.waiting = false;
        pvp.showSwitch = false;
        renderOnlineBattle();
        break;

      case 'turn-ready':
        pvp.waiting = false;
        pvp.showSwitch = false;
        renderOnlineBattle();
        break;

      case 'waiting':
        pvp.waiting = true;
        renderOnlineBattle();
        break;

      case 'need-switch':
        pvp.snap = p.snap;
        pvp.waiting = false;
        pvp.showSwitch = false;
        renderOnlineBattle();
        break;

      case 'waiting-peer-switch':
        pvp.snap = p.snap;
        pvp.waiting = true;
        renderOnlineBattle();
        break;

      case 'over':
        pvp.snap = p.snap;
        pvp.waiting = false;
        renderOnlineBattle();
        break;

      case 'peer-left':
        setRoomState('对方离开了房间', 'err');
        break;

      case 'error':
        toast(p.message, true);
        break;

      default:
        break;
    }
  }

  function renderMyOnlineTeam() {
    var box = $('#myOnlineTeam');
    box.innerHTML = '';
    if (!pvp.myIds.length) {
      box.appendChild(el('span', 'muted', '还没选，先去图鉴加队伍'));
      return;
    }
    pvp.myIds.forEach(function (id) {
      var pet = state.petById[id];
      box.appendChild(el('div', 'mini-pet', pet ? pet.name : '#' + id));
    });
  }

  function renderPeerTeam() {
    var box = $('#peerOnlineTeam');
    box.innerHTML = '';
    if (!pvp.peerIds.length) {
      box.appendChild(el('span', 'muted', '等待…'));
      return;
    }
    pvp.peerIds.forEach(function (id) {
      var pet = state.petById[id];
      box.appendChild(el('div', 'mini-pet', pet ? pet.name : '#' + id));
    });
  }

  function viewOf(snap) {
    if (!snap) return null;
    return pvp.role === 'host'
      ? { me: snap.me, foe: snap.foe }
      : { me: snap.foe, foe: snap.me };
  }

  function ensureOnlineUI() {
    var box = $('#onlineBattle');
    if (box.dataset.built === '1') return;
    box.dataset.built = '1';
    box.innerHTML =
      '<div id="onlineStage" class="battle-stage"></div>' +
      '<div id="onlineActions" class="skill-bar"></div>' +
      '<div class="log battle-log" id="onlineLog"></div>';
  }

  function renderOnlineBattle() {
    var snap = pvp.snap;
    if (!snap) return;
    ensureOnlineUI();
    var v = viewOf(snap);

    var mineWon = pvp.role === 'host' ? (snap.winner === 'me') : (snap.winner === 'foe');
    var critSide = snap.lastCrit;
    if (critSide && pvp.role !== 'host') critSide = (critSide === 'me' ? 'foe' : 'me');
    state.lastSnap = v;
    drawStage('#onlineStage', v.me, v.foe, {
      turn: snap.turn,
      over: snap.over,
      resultText: snap.over ? (mineWon ? '你赢了！' : '你输了…') : '',
      resultWin: mineWon,
      fieldName: snap.field ? snap.field.name : '',
      crit: critSide || null
    });

    var log = $('#onlineLog');
    log.innerHTML = '';
    pvp.log.forEach(function (line) {
      log.appendChild(el('div', /^——/.test(line) ? 'turn' : null, line));
    });
    log.scrollTop = log.scrollHeight;

    var actions = $('#onlineActions');
    actions.innerHTML = '';

    var needMine = !!(pvp.session && pvp.session.needSwitch && pvp.session.needSwitch.mine);

    if (pvp.waiting && !snap.over && !needMine) {
      actions.appendChild(el('div', 'muted', '已出招，等待对手…'));
      return;
    }

    var bag = snap.items ? (pvp.role === 'host' ? snap.items.me : snap.items.foe) : [];
    renderActionPanel(actions, {
      over: snap.over,
      resultText: mineWon ? '你赢了！' : '你输了…',
      resultAction: '离开房间',
      needPlayerSwitch: needMine,
      me: v.me,
      foe: v.foe
    }, bag, {
      skill: function (i) {
        pvp.waiting = true;
        pvp.session.submit({ type: 'skill', index: i });
        renderOnlineBattle();
      },
      item: function (id) {
        pvp.waiting = true;
        pvp.session.submit({ type: 'item', id: id });
        renderOnlineBattle();
      },
      switchTurn: function (i) {
        pvp.waiting = true;
        pvp.session.submit({ type: 'switch', index: i });
        renderOnlineBattle();
      },
      forceSwitch: function (i) {
        pvp.waiting = true;
        pvp.session.submit({ type: 'switch', index: i });
        renderOnlineBattle();
      },
      flee: leaveRoom,
      rerender: renderOnlineBattle,
      est: function () { return 0; }
    });
  }

  async function netSelfTest() {
    if (pvp._testing) return;
    pvp._testing = true;
    var code = SeerNet.makeCode(8);
    var recv = null;
    var sender = null;
    function put(s) { setProgressText(s); }
    put('联机自检：创建临时房间 ' + code);
    try {
      var got = new Promise(function (resolve, reject) {
        var timer = setTimeout(function () { reject(new Error('10 秒内没收到回环消息（可能被网络限制）')); }, 10000);
        recv = new SeerNet.Net({
          code: code,
          clientId: 'selftest-recv',
          onMessage: function (m) { clearTimeout(timer); resolve(m); },
          onStatus: function () { }
        });
        recv.start();
      });

      await new Promise(function (r) { setTimeout(r, 1200); });

      sender = new SeerNet.Net({
        code: code,
        clientId: 'selftest-send',
        onMessage: function () { },
        onStatus: function () { }
      });
      await sender.send({ t: 'ping', n: 1 });
      put('已发出测试消息，等待中继回传…');

      var msg = await got;
      put('联机自检通过：收到回环消息（传输方式 ' + recv.mode + '）');
      toast('联机通道正常');
      return msg;
    } catch (e) {
      put('联机自检失败：' + e.message);
      toast('联机自检失败：' + e.message, true);
      throw e;
    } finally {
      try { recv && recv.stop(); } catch (e2) { }
      try { sender && sender.stop(); } catch (e3) { }
      pvp._testing = false;
    }
  }

  function setupOnline() {
    $('#netSelfTest').addEventListener('click', function () { netSelfTest().catch(function () { }); });
    $('#createRoom').addEventListener('click', createRoom);
    $('#joinRoom').addEventListener('click', function () { joinRoomByCode($('#joinCode').value); });
    $('#joinCode').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') joinRoomByCode($('#joinCode').value);
    });
    $('#confirmTeam').addEventListener('click', function () {
      var ids = state.team.slice(0, 12).filter(Boolean);
      if (!ids.length) { toast('请先在出战格放至少 1 只精灵', true); return; }
      pvp.myIds = ids;
      pvp.session.setTeam(ids);
      renderMyOnlineTeam();
      setRoomState('已提交队伍，等待对方…', 'ok');
    });
    $('#copyCode').addEventListener('click', function () {
      copyText(pvp.code || '', '房间码已复制');
    });
    $('#copyLink').addEventListener('click', function () {
      if (location.protocol === 'file:') {
        toast('本地文件方式的链接只有本机能打开，请把房间码发给朋友', true);
      }
      copyText(inviteLink(pvp.code || ''), '邀请链接已复制');
    });
    $('#leaveRoom').addEventListener('click', leaveRoom);
  }

  function copyText(text, okMsg) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(okMsg); }, function () { fallbackCopy(text, okMsg); });
    } else {
      fallbackCopy(text, okMsg);
    }
  }

  function fallbackCopy(text, okMsg) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast(okMsg); } catch (e) { toast('复制失败，请手动选择：' + text, true); }
    document.body.removeChild(ta);
  }

  async function runAutotest() {
    try {
      var combo = { id: 1, name: '草', primary: { id: 1 }, secondary: null };
      state.combos = { 1: combo };
      state.typesArr = [{ id: 1, name: '草', name_en: 'grass', relations: [{ target_type: { id: 1 }, multiple: 1 }] }];
      state.typeById = { 1: state.typesArr[0] };
      function mk(id, name) {
        return {
          id: id, name: name,
          base_stats: { hp: 80, atk: 90, def: 70, sp_atk: 80, sp_def: 70, spd: 60 },
          type: { id: 1 }, pet_class: { id: 1 }, skill: []
        };
      }
      // 构造「5 个普通技能 + 1 个第五技能」的精灵，并故意把第五技能也塞进普通配招
      function mkSkillCache(id, name, power) {
        state.skillCache[id] = {
          id: id, name: name, power: power, max_pp: 20, accuracy: 100, crit_rate: 6.25,
          priority: 0, category: { id: 1 }, type: { id: 1 }, info: null, effects: []
        };
        return state.skillCache[id];
      }
      for (var si = 1; si <= 5; si++) mkSkillCache(99000 + si, '普通技能' + si, 40 + si);
      mkSkillCache(99099, '第五技能', 120);
      // 让第一个技能带上 skill_effect 文本（测试详情弹层是否显示原文）
      state.skillCache[99001].skill_effect = [
        { info: '下次受到攻击伤害后于对手出手流程结束反馈伤害值100%的百分比伤害' }
      ];

      var tp = mk(5000, '圣灵谱尼');
      tp.skill = [1, 2, 3, 4, 5].map(function (i) {
        return { learning_level: i * 10, skill: { id: 99000 + i } };
      });
      tp.fifth = [99099];

      var tp2 = mk(4377, '蒂朵');
      state.pets = [tp, tp2];
      state.petById = { 5000: tp, 4377: tp2 };
      state.team = normalizeTeam([5000]);
      state.loadouts[5000] = { n: [99099, 99001, 99002, 99003], f: null };

      // 注入一条魂印，验证被动确实被挂上
      state.soulmarkById = {
        1: { id: 1, name: '测试魂印', desc: '自身受到的攻击伤害减少50%' },
        2: {
          id: 2, name: '示例魂印',
          desc: '战斗阶段结束时附加自身已损失体力50%的百分比伤害；受到的所有攻击伤害减少25%；登场时消除对手回合类效果；若自身体力低于对手则造成的伤害提升50%；免疫低于200的攻击伤害'
        }
      };
      state.petSoulmarks = { 5000: [1, 2] };

      // 验证本地编码：种族值合计不能丢（不写入真实存储）
      var probe = mk(9001, '测试甲');
      var back = Db._unpackPet(Db._packPet(probe));
      var totalOk = (back && back.base_stats && back.base_stats.total === 450) ? 1 : 0;

      switchTab('battle');
      await startBattle();

      // 打开自动战斗，让它把这一局打完（#autotest&pause 时不自动打，用于看界面）
      var autoBtn = document.querySelector('#toggleAuto');
      if (autoBtn && location.hash.indexOf('pause') < 0) autoBtn.click();

      // 界面自检：#autotest&sheet 打开技能详情、&soul 打开魂印详情
      if (location.hash.indexOf('sheet') >= 0) {
        var ac0 = state.battle && state.battle.activeOf('me');
        if (ac0 && ac0.skills[0]) showSkillSheet(ac0.skills[0].skill);
      }
      if (location.hash.indexOf('soul') >= 0) {
        setTimeout(function () { showSoulSheet('me'); }, 80);
      }
      // 界面自检：#autotest&team 看队伍页与内联配招
      if (location.hash.indexOf('team') >= 0) {
        try {
          state.team = normalizeTeam([5000, 4377]);
          switchTab('team');
          state.configId = 5000;
          renderTeam();
          renderTeamConfig();
        } catch (err) {
          document.title = 'AUTOTEST:teamError:' + (err && err.message);
          throw err;
        }
      }

      // 界面自检：#autotest&pokedex 看图鉴卡片
      if (location.hash.indexOf('pokedex') >= 0) {
        var ids = [5000, 4377, 3156, 4949, 4956, 4955, 4954, 4953, 4952, 4951, 4950, 4932];
        var demo = ids.map(function (id, i) { return mk(id, '示例' + (i + 1)); });
        demo[0].skill = [1, 2, 3, 4, 5].map(function (i) {
          return { learning_level: i * 10, skill: { id: 99000 + i } };
        });
        demo[0].fifth = [99099];
        state.pets = demo;
        state.petById = {};
        demo.forEach(function (p) { state.petById[p.id] = p; });
        state.listLimit = 200;
        switchTab('pokedex');
        renderPetList();
        openDetail(5000);
      }

      if (location.hash.indexOf('state') >= 0 && state.battle) {
        var mm = state.battle.activeOf('me');
        var ff = state.battle.activeOf('foe');
        if (mm) {
          mm.stages.atk = 2;
          mm.stages.spd = 1;
          mm.shield = 300;
          mm.immuneStatus = 3;
        }
        if (ff) {
          ff.stages.def = -1;
          ff.status = { id: 'burn', turns: 99 };
          ff.guards.push({ turns: 2, mul: 0.5, scope: 'all' });
        }
        renderBattle();
      }

      var started = Date.now();
      var tick = setInterval(function () {
        var b = state.battle;
        if (!b) return;
        if (!b.over && Date.now() - started < 20000) return;
        clearInterval(tick);
        var px = SeerStage.debugPixels();
        var me0 = b.me.team[0];
        var ids = me0 ? me0.skills.map(function (s) { return s.skill.id; }) : [];
        var seen = {}, dupCount = 0;
        ids.forEach(function (id) { if (seen[id]) dupCount++; seen[id] = 1; });
        var ovf = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        document.title = 'AUTOTEST:' + SeerStage.mode() + ':' + (px.sum || 0) +
          ':turn' + b.turn +
          (b.over ? (':over:' + b.winner) : '') +
          ':mk' + (me0 && me0.takenMul < 1 ? 1 : 0) +
          ':tot' + totalOk +
          ':sk' + ids.length +
          ':dup' + dupCount +
          ':art' + (px.art || 0) +
          ':ovf' + ovf;
      }, 250);
    } catch (e) {
      document.title = 'AUTOTEST:error:' + e.message;
    }
  }

  window.SeerApp = {
    state: state,
    showSkill: showSkillSheet,
    pvp: pvp,
    syncOne: syncOne,
    runSync: runSync,
    checkUpdate: checkUpdate,
    createRoom: createRoom,
    joinRoomByCode: joinRoomByCode
  };
})();
