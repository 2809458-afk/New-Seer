/* SeerAPI 客户端：分页抓取、重试、版本哈希 */
(function (root) {
  'use strict';

  var BASE = 'https://api.seerapi.com/v1';
  var PAGE_SIZE = 200; // 实测 300 会返回 400

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  async function getJSON(url, retries) {
    if (retries == null) retries = 3;
    var lastErr = null;
    for (var i = 0; i <= retries; i++) {
      try {
        var res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status + ' · ' + url);
        return await res.json();
      } catch (e) {
        lastErr = e;
        if (i < retries) await sleep(500 * (i + 1));
      }
    }
    throw lastErr;
  }

  function resourceUrl(name) {
    return BASE + '/' + name + '/';
  }

  /** 只取一条，用于读取该资源的数据版本哈希（hash 是全局的，与分页无关） */
  async function headHash(name) {
    var j = await getJSON(resourceUrl(name) + '?limit=1');
    return { hash: j.hash, count: j.count };
  }

  async function getOne(name, id) {
    return await getJSON(resourceUrl(name) + id);
  }

  async function fetchPage(name, offset, limit, expand) {
    var url = resourceUrl(name) + '?offset=' + offset + '&limit=' + limit + (expand ? '&expand=true' : '');
    return await getJSON(url);
  }

  /**
   * 抓取某资源的全部条目
   * @param {string} name 资源名
   * @param {{expand?:boolean, limit?:number, onProgress?:function(number,number):void}} opts
   */
  async function fetchAll(name, opts) {
    opts = opts || {};
    var expand = opts.expand !== false;
    var limit = opts.limit || PAGE_SIZE;
    var items = [];
    var offset = 0;
    var total = 0;
    for (;;) {
      var page = await fetchPage(name, offset, limit, expand);
      total = page.count || 0;
      var rows = page.results || [];
      for (var i = 0; i < rows.length; i++) items.push(rows[i]);
      if (opts.maxItems && items.length >= opts.maxItems) {
        items = items.slice(0, opts.maxItems);
        if (opts.onProgress) opts.onProgress(items.length, opts.maxItems);
        break;
      }
      if (opts.onProgress) opts.onProgress(items.length, total);
      if (!page.next || rows.length === 0) break;
      offset += rows.length;
    }
    return { items: items, count: total };
  }

  root.SeerApi = {
    BASE: BASE,
    PAGE_SIZE: PAGE_SIZE,
    getJSON: getJSON,
    resourceUrl: resourceUrl,
    headHash: headHash,
    getOne: getOne,
    fetchPage: fetchPage,
    fetchAll: fetchAll
  };
})(typeof self !== 'undefined' ? self : this);
