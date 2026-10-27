/* schema1 存档：临时写入 + 上一份有效备份 + 未知版本拒写
 *
 * 语义对齐 godot/scripts/profile_store.gd：
 *   - 主存档 schema != 1 → 只读，不覆盖、不用旧备份替换
 *   - 主存档损坏 → 回退 .bak，并给出提示
 *   - 写存档先写临时键，成功后再提升为主存档；主存档有效时先转 .bak
 *
 * 存储后端可注入（浏览器 localStorage / Tauri 文件系统 / 测试内存），
 * 因此本模块不直接依赖 window，浏览器侧用 SeerSave.store。
 */
(function (root) {
  'use strict';

  var KEY = 'seer-save-schema1';
  var BAK = KEY + '.bak';
  var TMP = KEY + '.tmp';
  var SCHEMA = 1;

  function parse(text) {
    if (text == null) return null;
    try {
      var v = JSON.parse(text);
      return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
    } catch (e) { return null; }
  }

  function shapeOk(v) {
    return !!(v && v.schema === SCHEMA && Array.isArray(v.team) && v.builds && typeof v.builds === 'object' && !Array.isArray(v.builds));
  }

  function createStore(storage) {
    if (!storage) throw new Error('需要存储后端（getItem/setItem/removeItem）');
    var readOnly = false;
    var message = '';

    function load() {
      readOnly = false;
      message = '';
      var primaryRaw = storage.getItem(KEY);
      var backupRaw = storage.getItem(BAK);
      if (primaryRaw == null && backupRaw == null) return null; // 首次运行

      var primary = parse(primaryRaw);
      if (primary && primary.schema !== SCHEMA) {
        // 新版本存档不能自动降级覆盖，也不能用旧备份替换
        readOnly = true;
        message = '存档版本暂不支持，本次使用临时默认配置且禁用保存，原文件已保留。';
        return null;
      }
      if (shapeOk(primary)) return primary;

      var backup = parse(backupRaw);
      if (shapeOk(backup)) {
        message = '主存档无法读取，已从上一份有效备份恢复。';
        return backup;
      }
      readOnly = true;
      message = '存档及备份无法读取，本次使用临时默认配置且禁用保存，原文件已保留。';
      return null;
    }

    function save(data) {
      if (readOnly) return { ok: false, message: message || '存档处于只读状态。' };
      if (!shapeOk(data)) return { ok: false, message: '只接受 schema 1 存档（team 数组 + builds 对象）。' };

      var currentRaw = storage.getItem(KEY);
      var current = parse(currentRaw);
      if (current && current.schema !== SCHEMA) {
        return { ok: false, message: '已存在更高版本的存档，拒绝覆盖。' };
      }

      var text = JSON.stringify(data);
      // 临时写入：回读校验，模拟 Godot 的临时文件 + rename
      storage.setItem(TMP, text);
      if (storage.getItem(TMP) !== text) {
        storage.removeItem(TMP);
        return { ok: false, message: '存档写入未完成，旧存档已保留。' };
      }
      if (shapeOk(current)) storage.setItem(BAK, JSON.stringify(current));
      storage.setItem(KEY, text);
      storage.removeItem(TMP);
      return { ok: true, message: '配置已保存。' };
    }

    function exportText(data) { return JSON.stringify(data || load(), null, 1); }

    function importText(text) {
      var parsed = parse(text);
      if (!parsed) return { ok: false, message: '不是有效的 JSON 存档。' };
      if (parsed.schema !== SCHEMA) return { ok: false, message: '存档版本不支持（schema ' + parsed.schema + '）。' };
      if (!shapeOk(parsed)) return { ok: false, message: '存档缺少 team/builds 字段。' };
      return { ok: true, data: parsed, message: '存档已读取。' };
    }

    function clear() {
      storage.removeItem(KEY);
      storage.removeItem(BAK);
      storage.removeItem(TMP);
      readOnly = false;
      message = '';
    }

    return {
      load: load,
      save: save,
      exportText: exportText,
      importText: importText,
      clear: clear,
      isReadOnly: function () { return readOnly; },
      messageOf: function () { return message; },
      keys: { main: KEY, backup: BAK, temp: TMP }
    };
  }

  function memStorage() {
    var m = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
      setItem: function (k, v) { m[k] = String(v); },
      removeItem: function (k) { delete m[k]; }
    };
  }

  /* ---------- 文件后端（Tauri）：与 localStorage 同一套 schema1 语义，只是 IO 变成异步 ---------- */

  /** 测试用的内存文件系统：read/write/rename/remove 都是 Promise */
  function memFileIo() {
    var files = {};
    return {
      read: function (p) { return Promise.resolve(Object.prototype.hasOwnProperty.call(files, p) ? files[p] : null); },
      write: function (p, text) { files[p] = String(text); return Promise.resolve(true); },
      rename: function (a, b) {
        if (!Object.prototype.hasOwnProperty.call(files, a)) return Promise.resolve(false);
        files[b] = files[a];
        delete files[a];
        return Promise.resolve(true);
      },
      remove: function (p) { delete files[p]; return Promise.resolve(true); },
      files: files
    };
  }

  /**
   * 文件后端：语义与 createStore 一致（tmp 回读校验 → 主存档转 .bak → 提升），
   * 但 IO 是异步的，所以提供 loadAsync/saveAsync；同步 load() 只返回已缓存的数据。
   * 文件路径由调用方给出（Tauri 侧一般放到应用数据目录）。
   */
  function createFileStore(io, paths) {
    if (!io) throw new Error('需要文件 IO 后端（read/write/rename/remove）');
    paths = paths || {};
    var p = { main: paths.main || 'save.json', backup: paths.backup || 'save.json.bak', temp: paths.temp || 'save.json.tmp' };
    var cache = null;
    var readOnly = false;
    var message = '';

    function loadAsync() {
      return io.read(p.main).then(function (primaryRaw) {
        return io.read(p.backup).then(function (backupRaw) {
          readOnly = false;
          message = '';
          cache = null;
          if (primaryRaw == null && backupRaw == null) return null;
          var primary = parse(primaryRaw);
          if (primary && primary.schema !== SCHEMA) {
            readOnly = true;
            message = '存档版本暂不支持，本次使用临时默认配置且禁用保存，原文件已保留。';
            return null;
          }
          if (shapeOk(primary)) { cache = primary; return primary; }
          var backup = parse(backupRaw);
          if (shapeOk(backup)) {
            message = '主存档无法读取，已从上一份有效备份恢复。';
            cache = backup;
            return backup;
          }
          readOnly = true;
          message = '存档及备份无法读取，本次使用临时默认配置且禁用保存，原文件已保留。';
          return null;
        });
      });
    }

    function saveAsync(data) {
      if (readOnly) return Promise.resolve({ ok: false, message: message || '存档处于只读状态。' });
      if (!shapeOk(data)) return Promise.resolve({ ok: false, message: '只接受 schema 1 存档（team 数组 + builds 对象）。' });
      var text = JSON.stringify(data);
      return io.read(p.main).then(function (currentRaw) {
        var current = parse(currentRaw);
        if (current && current.schema !== SCHEMA) return { ok: false, message: '已存在更高版本的存档，拒绝覆盖。' };
        return io.write(p.temp, text).then(function () {
          return io.read(p.temp).then(function (back) {
            if (back !== text) {
              return io.remove(p.temp).then(function () { return { ok: false, message: '存档写入未完成，旧存档已保留。' }; });
            }
            var chain = Promise.resolve(true);
            if (shapeOk(current)) chain = io.write(p.backup, currentRaw);
            return chain.then(function () { return io.write(p.main, text); }).then(function () {
              return io.remove(p.temp);
            }).then(function () {
              cache = data;
              return { ok: true, message: '配置已保存。' };
            });
          });
        });
      });
    }

    function load() { return cache; }

    function clear() {
      return Promise.all([io.remove(p.main), io.remove(p.backup), io.remove(p.temp)]).then(function () {
        cache = null; readOnly = false; message = '';
        return true;
      });
    }

    return {
      kind: 'file',
      load: load,
      loadAsync: loadAsync,
      save: function (data) { return saveAsync(data); },
      saveAsync: saveAsync,
      clear: clear,
      isReadOnly: function () { return readOnly; },
      messageOf: function () { return message; },
      exportText: function (data) { return JSON.stringify(data || cache, null, 1); },
      importText: function (text) {
        var parsed = parse(text);
        if (!parsed) return { ok: false, message: '不是有效的 JSON 存档。' };
        if (parsed.schema !== SCHEMA) return { ok: false, message: '存档版本不支持（schema ' + parsed.schema + '）。' };
        if (!shapeOk(parsed)) return { ok: false, message: '存档缺少 team/builds 字段。' };
        return { ok: true, data: parsed, message: '存档已读取。' };
      },
      keys: p
    };
  }

  /** Tauri v2 的 fs 插件 IO（未在真实 Tauri 运行时验证过：本机没有 Rust 工具链，无法构建客户端） */
  function tauriIo() {
    var T = root.__TAURI__;
    var inv = T && T.core && T.core.invoke;
    if (!inv) return null;
    function call(cmd, args) {
      try { return Promise.resolve(inv(cmd, args)); } catch (e) { return Promise.reject(e); }
    }
    return {
      read: function (path) {
        return call('plugin:fs|read_text_file', { path: path }).then(function (v) { return v == null ? null : String(v); }).catch(function () { return null; });
      },
      write: function (path, text) {
        return call('plugin:fs|write_text_file', { path: path, contents: text }).then(function () { return true; });
      },
      remove: function (path) { return call('plugin:fs|remove', { path: path }).then(function () { return true; }).catch(function () { return true; }); },
      rename: function () { return Promise.resolve(true); }
    };
  }

  var tauriStore = null;
  function tauriStoreOf() {
    if (!tauriIo()) return null;
    if (!tauriStore) tauriStore = createFileStore(tauriIo());
    return tauriStore;
  }

  var browserStore = null;
  root.SeerSave = {
    createFileStore: createFileStore,
    memFileIo: memFileIo,
    tauriIo: tauriIo,
    tauriStore: tauriStoreOf,
    SCHEMA: SCHEMA,
    createStore: createStore,
    memStorage: memStorage,
    store: function () {
      if (!browserStore) browserStore = createStore(root.localStorage);
      return browserStore;
    },
    /** Tauri 是否在场（v2 用 __TAURI_INTERNALS__，v1 用 __TAURI__） */
    inTauri: function () { return !!(root.__TAURI__ || root.__TAURI_INTERNALS__); }
  };
})(typeof self !== 'undefined' ? self : this);
