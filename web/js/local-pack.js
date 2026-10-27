/* 本地数据包加载器：离线时把 data/local-pack.gen.js 灌进本地库
 *
 * 旧 Web 的数据靠 SeerAPI 在线同步；单机场景下本地库为空，页面全是空状态。
 * 这个模块在本地库为空时自动导入项目冻结数据（只进内存，不主动落盘，避免撑爆 localStorage 配额）。
 * 技能体积大（约 10 MB），拆成 data/local-skills.gen.js，首次需要技能时再注入。
 */
(function (root) {
  'use strict';

  var imported = false;
  var skillIndex = null;
  var skillLoading = null;

  function pack() { return root.SEER_LOCAL_PACK || null; }

  function ready() {
    var p = pack();
    return !!(p && p.items && p.items.pets && p.items.pets.length);
  }

  function summary() {
    var p = pack();
    if (!ready()) return null;
    var it = p.items;
    return {
      generatedAt: p.generatedAt || '',
      pets: it.pets.length, types: (it.types || []).length, combos: (it.combos || []).length,
      natures: (it.natures || []).length, soulmarks: (it.soulmarks || []).length,
      mintmarks: (it.mintmarks || []).length, suits: (it.suits || []).length
    };
  }

  function ingestSkills() {
    if (skillIndex) return true;
    var arr = root.SEER_LOCAL_SKILLS;
    if (!arr || !arr.length) return false;
    skillIndex = Object.create(null);
    for (var i = 0; i < arr.length; i++) skillIndex[arr[i].id] = arr[i];
    return true;
  }

  function skill(id) {
    if (!ingestSkills()) return null;
    return skillIndex[id] || null;
  }

  function loadSkills() {
    if (ingestSkills()) return Promise.resolve(true);
    if (skillLoading) return skillLoading;
    skillLoading = new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = 'data/local-skills.gen.js?v=20261026a';
      s.onload = function () { resolve(ingestSkills()); };
      s.onerror = function () { skillLoading = null; resolve(false); };
      document.head.appendChild(s);
    });
    return skillLoading;
  }

  /* 只写内存：Db.putAll 会标记 dirty，但这里不调用 Db.flush，避免离线数据占满 localStorage */
  async function importIntoDb() {
    if (!ready()) return null;
    if (imported) return summary();
    var items = pack().items;
    var stores = ['pets', 'types', 'combos', 'natures', 'soulmarks', 'mintmarks', 'suits'];
    var db = root.SeerDb;
    for (var i = 0; i < stores.length; i++) {
      var store = stores[i];
      if (items[store] && items[store].length) db.putAll(store, items[store]);
    }
    var meta = pack().meta;
    if (meta) {
      db.setMeta('pack', meta.pack || '');
      db.setMeta('local', { source: '本地数据包', generatedAt: pack().generatedAt || '' });
    }
    imported = true;
    return summary();
  }

  root.SeerLocalPack = {
    ready: ready,
    summary: summary,
    importIntoDb: importIntoDb,
    skill: skill,
    loadSkills: loadSkills
  };
})(typeof self !== 'undefined' ? self : this);
