/* 联机传输层：ntfy.sh 的 HTTP 发布 / SSE 订阅
 *
 * 为什么是 ntfy：本机网络只放行 443 的普通 HTTPS，WebSocket 与公共 broker 全部被拦，
 * 而 ntfy 用纯 HTTP 就能做「房间消息总线」—— 房间码直接当 topic 名。
 * 注意：ntfy 公共服务器上的消息是公开的，房间码就等于房间钥匙，必须足够随机。
 */
(function (root) {
  'use strict';

  var HOST = 'https://ntfy.sh/';
  var TOPIC_PREFIX = 'seerfan1-';
  var POLL_MS = 2500;

  function Net(opts) {
    this.code = opts.code;
    this.topic = TOPIC_PREFIX + opts.code;
    this.clientId = opts.clientId;
    this.onMessage = opts.onMessage || function () { };
    this.onStatus = opts.onStatus || function () { };
    this.pollMs = opts.pollMs || POLL_MS;
    this.es = null;
    this.timer = null;
    this.busy = false;
    this.stopped = false;
    this.cursor = null;
    this.mode = 'idle';
    this.sseTries = 0;
    this._lastError = '';
  }

  Net.prototype.start = function () {
    this.stopped = false;
    if (typeof EventSource !== 'undefined') {
      this.startSse();
    } else {
      this.startPolling();
    }
  };

  Net.prototype.stop = function () {
    this.stopped = true;
    if (this.es) {
      try { this.es.close(); } catch (e) { }
      this.es = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  };

  // ---------- SSE（首选，延迟低、几乎不占请求数） ----------
  Net.prototype.startSse = function () {
    var self = this;
    this.mode = 'sse';
    try {
      this.es = new EventSource(HOST + this.topic + '/sse');
    } catch (e) {
      this.startPolling();
      return;
    }
    this.es.onopen = function () {
      self.sseTries = 0;
      self.onStatus('online');
    };
    this.es.onmessage = function (ev) {
      self.handleLine(ev.data);
    };
    this.es.onerror = function () {
      self.sseTries++;
      self.onStatus('reconnecting');
      if (self.sseTries >= 3 && !self.stopped) {
        try { self.es.close(); } catch (e) { }
        self.es = null;
        self.startPolling();
      }
    };
  };

  // ---------- 轮询（SSE 不可用时的兜底） ----------
  Net.prototype.startPolling = function () {
    if (this.stopped) return;
    var self = this;
    this.mode = 'poll';
    this.onStatus('online');
    this.poll();
    if (!this.timer) {
      this.timer = setInterval(function () { self.poll(); }, this.pollMs);
    }
  };

  Net.prototype.poll = async function () {
    if (this.busy || this.stopped) return;
    this.busy = true;
    var url = HOST + this.topic + '/json?poll=1';
    if (this.cursor) url += '&since=' + encodeURIComponent(this.cursor);
    try {
      var res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var text = await res.text();
      if (text.trim()) {
        var lines = text.split('\n');
        for (var i = 0; i < lines.length; i++) this.handleLine(lines[i]);
      }
    } catch (e) {
      this.onStatus('offline', e.message);
    } finally {
      this.busy = false;
    }
  };

  // ---------- 收包 ----------
  Net.prototype.handleLine = function (line) {
    if (!line) return;
    var ev;
    try { ev = JSON.parse(line); } catch (e) { return; }
    if (!ev || typeof ev !== 'object') return;
    if (ev.id) this.cursor = ev.id;
    if (ev.event !== 'message') return;
    var packet;
    try { packet = JSON.parse(ev.message); } catch (e) { return; }
    if (!packet || typeof packet !== 'object') return;
    if (packet.from === this.clientId) return; // 自己发的不处理
    this.onMessage(packet);
  };

  // ---------- 发包（带队列与退避重试，避免被限流时丢消息） ----------
  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  Net.prototype.send = function (msg) {
    var body = {};
    for (var k in msg) if (Object.prototype.hasOwnProperty.call(msg, k)) body[k] = msg[k];
    body.from = this.clientId;
    body.ts = Date.now();

    var self = this;
    if (!this.queue) this.queue = [];
    return new Promise(function (resolve) {
      self.queue.push({ body: body, resolve: resolve, tries: 0 });
      self.drain();
    });
  };

  Net.prototype.postOnce = async function (body) {
    try {
      var res = await fetch(HOST + this.topic, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'text/plain' }
      });
      if (res.status === 429) return 'busy';
      if (!res.ok) return 'fail';
      return 'ok';
    } catch (e) {
      return 'fail';
    }
  };

  Net.prototype.drain = async function () {
    if (this.sending || !this.queue || !this.queue.length) return;
    this.sending = true;
    while (this.queue.length) {
      var item = this.queue[0];
      var r = await this.postOnce(item.body);
      if (r === 'ok') {
        this.queue.shift();
        item.resolve(true);
        continue;
      }
      item.tries++;
      if (item.tries > 8) {
        this.queue.shift();
        item.resolve(false);
        this.onStatus('offline', '消息发送失败，请检查网络');
        continue;
      }
      // 被限流就等一会儿再试
      this.onStatus('busy', r === 'busy' ? '服务器限流，正在重试…' : '发送失败，正在重试…');
      await sleep(Math.min(8000, 1200 * item.tries));
    }
    this.sending = false;
    if (!this.stopped) this.onStatus('online');
  };

  /** 生成房间码：去掉容易混淆的 0/o/1/l */
  function makeCode(len) {
    var alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
    var out = '';
    var buf = new Uint32Array(len || 8);
    if (root.crypto && root.crypto.getRandomValues) {
      root.crypto.getRandomValues(buf);
      for (var i = 0; i < buf.length; i++) out += alphabet[buf[i] % alphabet.length];
    } else {
      for (var j = 0; j < (len || 8); j++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return out;
  }

  function makeClientId() {
    return 'c' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }

  root.SeerNet = {
    Net: Net,
    makeCode: makeCode,
    makeClientId: makeClientId,
    HOST: HOST,
    TOPIC_PREFIX: TOPIC_PREFIX
  };
})(typeof self !== 'undefined' ? self : this);
