/* 本地库：localStorage + 精简编码
 *
 * 为什么不用 IndexedDB：实测在 file:// 源下浏览器会挂起，且 http:// 下在部分环境也不可用。
 * 为什么能塞得下：把 {id,url} 引用、冗余字段全部压掉后，
 * 4941 只精灵只需约 99 万字符（原始 JSON 是 1736 万字符）。
 * 技能按需缓存并设上限，避免撑爆配额。
 *
 * 约定：内存里存「打包格式」（数组/精简对象），对外返回「接口格式」。
 */
(function (root) {
  'use strict';

  var PREFIX = 'sf.v1.';
  // 技能结构变了（新增 effects），旧缓存自动作废，其余资源不受影响
  var PREFIX_MAP = { skills: 'sf.v2.' };
  var STORES = ['pets', 'skills', 'types', 'combos', 'natures', 'soulmarks', 'mintmarks', 'suits', 'meta'];
  var SKILL_CACHE_LIMIT = 5000;

  function storeKey(store) {
    return (PREFIX_MAP[store] || PREFIX) + store;
  }

  var mem = {};
  var loaded = {};
  var dirty = {};

  function blank() { return { byId: Object.create(null), order: [] }; }

  // ---------- 打包 / 解包 ----------
  function fifthOf(p) {
    if (p.fifth && p.fifth.length) {
      return p.fifth.map(function (x) { return x && x.id != null ? x.id : x; });
    }
    var out = [];
    (p.skill || []).forEach(function (s) {
      if (s && s.is_fifth && s.skill && s.skill.id != null) out.push(s.skill.id);
    });
    return out;
  }

  function packPet(p) {
    var b = p.base_stats || {};
    return [
      p.id,
      p.name,
      b.hp, b.atk, b.def, b.sp_atk, b.sp_def, b.spd,
      p.type && p.type.id != null ? p.type.id : 0,
      p.pet_class && p.pet_class.id != null ? p.pet_class.id : 0,
      (p.skill || []).map(function (s) { return [s.learning_level || 0, s.skill.id]; }),
      fifthOf(p)
    ];
  }

  function unpackPet(a) {
    var hp = a[2], atk = a[3], def = a[4], spa = a[5], spd2 = a[6], spe = a[7];
    return {
      id: a[0],
      name: a[1],
      base_stats: {
        hp: hp, atk: atk, def: def, sp_atk: spa, sp_def: spd2, spd: spe,
        // total 不单独存储，直接由六项求和，保证旧缓存也能正确显示
        total: (hp || 0) + (atk || 0) + (def || 0) + (spa || 0) + (spd2 || 0) + (spe || 0)
      },
      type: { id: a[8] },
      pet_class: a[9] ? { id: a[9] } : null,
      skill: (a[10] || []).map(function (x) { return { learning_level: x[0], skill: { id: x[1] } }; }),
      fifth: a[11] || []
    };
  }

  function packCombo(c) {
    return [c.id, c.name, c.primary ? c.primary.id : null, c.secondary ? c.secondary.id : null];
  }

  function unpackCombo(a) {
    return {
      id: a[0],
      name: a[1],
      primary: a[2] != null ? { id: a[2] } : null,
      secondary: a[3] != null ? { id: a[3] } : null,
      is_double: a[3] != null
    };
  }

  function packType(t) {
    return [
      t.id, t.name, t.name_en,
      (t.relations || []).map(function (r) { return [r.target_type ? r.target_type.id : 0, r.multiple]; })
    ];
  }

  function unpackType(a) {
    return {
      id: a[0],
      name: a[1],
      name_en: a[2],
      relations: (a[3] || []).map(function (x) { return { target_type: { id: x[0] }, multiple: x[1] }; })
    };
  }

  function packSkill(s) {
    return {
      id: s.id, name: s.name, power: s.power, max_pp: s.max_pp,
      accuracy: s.accuracy, crit_rate: s.crit_rate, priority: s.priority,
      must_hit: s.must_hit, atk_num: s.atk_num, info: s.info,
      category: s.category ? { id: s.category.id } : null,
      type: s.type ? { id: s.type.id } : null,
      effects: (s.skill_effect || s.effects || []).map(function (e) {
        return {
          id: e.effect ? e.effect.id : (e.id == null ? null : e.id),
          info: e.info || '',
          args: e.args || null
        };
      })
    };
  }

  function packNature(n) {
    return { id: n.id, name: n.name, des: n.des, des2: n.des2, attributes: n.attributes || null };
  }

  function packSoulmark(s) {
    return {
      id: s.id,
      desc: s.desc || '',
      analyze: s.analyze_desc || '',
      pets: (s.pets || s.pet || []).map(function (r) { return r.id || r; })
    };
  }

  function pack(store, item) {
    if (store === 'pets') return packPet(item);
    if (store === 'combos') return packCombo(item);
    if (store === 'types') return packType(item);
    if (store === 'skills') return packSkill(item);
    if (store === 'natures') return packNature(item);
    if (store === 'soulmarks') return packSoulmark(item);
    return item;
  }

  function unpack(store, p) {
    if (store === 'pets') return unpackPet(p);
    if (store === 'combos') return unpackCombo(p);
    if (store === 'types') return unpackType(p);
    return p;
  }

  function keyOf(store, packed) {
    if (store === 'pets' || store === 'combos' || store === 'types') return packed[0];
    if (store === 'meta') return packed.k;
    return packed.id;
  }

  // ---------- 载入 ----------
  function ensure(store) {
    if (loaded[store]) return mem[store];
    loaded[store] = true;
    var bucket = blank();
    mem[store] = bucket;
    var raw = null;
    try { raw = localStorage.getItem(storeKey(store)); } catch (e) { raw = null; }
    if (!raw) return bucket;
    try {
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return bucket;
      for (var i = 0; i < arr.length; i++) {
        var p = arr[i];
        if (p == null) continue;
        var key = keyOf(store, p);
        if (key == null) continue;
        bucket.byId[key] = p;
        bucket.order.push(key);
      }
    } catch (e) {
      mem[store] = blank(); // 数据损坏就当空库，下次同步会重建
    }
    return mem[store];
  }

  // ---------- 读写 ----------
  function putAll(store, items) {
    var bucket = ensure(store);
    if (!items || !items.length) return 0;
    var n = 0;
    for (var i = 0; i < items.length; i++) {
      var packed = pack(store, items[i]);
      if (!packed) continue;
      var key = keyOf(store, packed);
      if (key == null) continue;
      if (bucket.byId[key] === undefined) bucket.order.push(key);
      bucket.byId[key] = packed;
      n++;
    }
    if (store === 'skills' && bucket.order.length > SKILL_CACHE_LIMIT) {
      var drop = bucket.order.splice(0, bucket.order.length - SKILL_CACHE_LIMIT);
      for (var d = 0; d < drop.length; d++) delete bucket.byId[drop[d]];
    }
    dirty[store] = true;
    return n;
  }

  function getAll(store) {
    var bucket = ensure(store);
    return bucket.order.map(function (id) { return unpack(store, bucket.byId[id]); });
  }

  function get(store, id) {
    var bucket = ensure(store);
    var p = bucket.byId[id];
    if (p === undefined) return undefined;
    return unpack(store, p);
  }

  function count(store) {
    return ensure(store).order.length;
  }

  function clear(store) {
    mem[store] = blank();
    loaded[store] = true;
    dirty[store] = true;
  }

  function flush() {
    var written = [];
    for (var i = 0; i < STORES.length; i++) {
      var store = STORES[i];
      if (!dirty[store]) continue;
      var bucket = ensure(store);
      var payload;
      if (store === 'meta') {
        payload = bucket.order.map(function (k) { return { k: k, value: bucket.byId[k] }; });
      } else {
        payload = bucket.order.map(function (id) { return bucket.byId[id]; });
      }
      try {
        localStorage.setItem(storeKey(store), JSON.stringify(payload));
      } catch (e) {
        throw new Error('本地存储写入失败（' + store + '）：' +
          (e && e.name === 'QuotaExceededError' ? '超出浏览器配额' : (e && e.message)));
      }
      dirty[store] = false;
      written.push(store);
    }
    return written;
  }

  function getMeta(k) {
    var bucket = ensure('meta');
    if (bucket.byId[k] === undefined) return undefined;
    return { k: k, value: bucket.byId[k] };
  }

  function setMeta(k, value) {
    putAll('meta', [{ k: k, value: value }]);
  }

  function clearAll() {
    STORES.forEach(function (s) { clear(s); });
    flush();
  }

  function usage() {
    var total = 0;
    for (var i = 0; i < STORES.length; i++) {
      try {
        var v = localStorage.getItem(storeKey(STORES[i]));
        if (v) total += v.length;
      } catch (e) { /* ignore */ }
    }
    return total;
  }

  root.SeerDb = {
    putAll: putAll,    getAll: getAll,
    get: get,
    count: count,
    clear: clear,
    flush: flush,
    getMeta: getMeta,
    setMeta: setMeta,
    clearAll: clearAll,
    usage: usage,
    STORES: STORES,
    // 供自检使用：验证编码往返是否丢字段
    _packPet: packPet,
    _unpackPet: unpackPet
  };
})(typeof self !== 'undefined' ? self : this);
