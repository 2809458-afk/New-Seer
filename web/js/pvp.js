/* 联机房间协议（房主权威）
 *
 * 角色：
 *   host  —— 创建房间，跑战斗模拟，广播结果
 *   guest —— 加入房间，发动作，收结果
 * 双方各自选自己的 6 只精灵，互不影响。
 */
(function (root) {
  'use strict';

  function Session(opts) {
    var NetCtor = (root.SeerNet && root.SeerNet.Net);
    var BattleCtor = (root.SeerBattle && root.SeerBattle.Battle);

    this.role = opts.role;               // 'host' | 'guest'
    this.code = opts.code;
    this.clientId = opts.clientId || root.SeerNet.makeClientId();
    this.onEvent = opts.onEvent || function () { };
    this.buildEntry = opts.buildEntry;   // async (petId) => 战斗条目
    this.chart = opts.chart || {};
    this.comboOf = opts.comboOf || function () { return null; };
    this.autoReady = opts.autoReady !== false;

    this.battle = null;
    this.started = false;
    this.over = false;

    this.selfTeamIds = null;
    this.peerTeamIds = null;
    this.selfReady = false;
    this.peerReady = false;
    this.peerSeen = false;

    this.pendingSelf = null;
    this.pendingPeer = null;
    this.sentLogCount = 0;
    this.needSwitch = { me: false, foe: false };

    var self = this;
    this.net = opts.net || new NetCtor({
      code: this.code,
      clientId: this.clientId,
      pollMs: opts.pollMs
    });
    // 统一在这里接线，注入的自定义传输层也能收到消息
    this.net.onMessage = function (m) { self.handle(m); };
    this.net.onStatus = function (state, message) {
      self.emit('status', { state: state, message: message, mode: self.net.mode });
    };
    this._Battle = BattleCtor;
  }

  Session.prototype.emit = function (type, payload) {
    try { this.onEvent(type, payload || {}); } catch (e) { console.error(e); }
  };

  Session.prototype.open = function () {
    this.net.start();
    this.emit('opened', { role: this.role, code: this.code, clientId: this.clientId });
    if (this.role === 'guest') this.sendJoin();
  };

  Session.prototype.sendJoin = function () {
    var self = this;
    this.net.send({ t: 'join', role: 'guest' });
    if (!this._joinTimer) {
      this._joinTimer = setInterval(function () {
        if (self.peerSeen || self.started) {
          clearInterval(self._joinTimer);
          self._joinTimer = null;
          return;
        }
        self.net.send({ t: 'join', role: 'guest' });
      }, 3000);
    }
  };

  Session.prototype.close = function () {
    try { this.net.send({ t: 'bye' }); } catch (e) { }
    this.net.stop();
    if (this._joinTimer) { clearInterval(this._joinTimer); this._joinTimer = null; }
    this.emit('closed', {});
  };

  // ---------- 队伍 ----------
  Session.prototype.setTeam = function (ids) {
    this.selfTeamIds = (ids || []).slice(0, 12).filter(Boolean);
    this.net.send({ t: 'team', team: this.selfTeamIds });
    this.emit('self-team', { team: this.selfTeamIds });
    if (this.autoReady) this.ready();
  };

  Session.prototype.ready = function () {
    if (!this.selfTeamIds || !this.selfTeamIds.length) {
      this.emit('error', { message: '请先选择队伍' });
      return;
    }
    this.selfReady = true;
    this.net.send({ t: 'ready', team: this.selfTeamIds });
    this.emit('ready', { self: true, peer: this.peerReady });
    this.maybeStart();
  };

  // ---------- 房主：开局 ----------
  Session.prototype.maybeStart = async function () {
    if (this.role !== 'host' || this.started) return;
    if (!this.selfReady || !this.peerReady) return;
    if (!this.selfTeamIds || !this.peerTeamIds) return;

    this.emit('status', { state: 'building', message: '正在准备技能数据…' });
    try {
      var meTeam = [];
      var meBattle = this.selfTeamIds.slice(0, 6);
      for (var i = 0; i < meBattle.length; i++) {
        meTeam.push(await this.buildEntry(meBattle[i], 'me'));
      }
      var meReserve = [];
      var myBench = this.selfTeamIds.slice(6);
      for (var r = 0; r < myBench.length; r++) meReserve.push(await this.buildEntry(myBench[r], 'me'));

      var foeTeam = [];
      var foeBattle = this.peerTeamIds.slice(0, 6);
      for (var j = 0; j < foeBattle.length; j++) {
        foeTeam.push(await this.buildEntry(foeBattle[j], 'foe'));
      }
      var foeReserve = [];
      var foeBench = this.peerTeamIds.slice(6);
      for (var q = 0; q < foeBench.length; q++) foeReserve.push(await this.buildEntry(foeBench[q], 'foe'));

      this.battle = new this._Battle({
        pvp: true,
        chart: this.chart,
        comboOf: this.comboOf,
        level: 100,
        meTeam: meTeam,
        meReserve: meReserve,
        foeTeam: foeTeam,
        foeReserve: foeReserve
      });
      this.started = true;
      this.sentLogCount = this.battle.log.length;

      var payload = {
        t: 'start',
        lines: this.battle.log.slice(),
        snap: this.battle.snapshot()
      };
      this.net.send(payload);
      this.emit('start', payload);
      this.emitTurnState(payload.snap);
      this.emit('status', { state: 'battle', message: '对战开始' });
    } catch (e) {
      this.emit('error', { message: '准备对战失败：' + e.message });
    }
  };

  // ---------- 动作 ----------
  Session.prototype.submit = function (action) {
    if (this.role === 'host') return this.hostSubmit(action);
    return this.guestSubmit(action);
  };

  Session.prototype.hostSubmit = function (action) {
    if (!this.battle || this.battle.over) return false;
    if (this.battle.needSwitch.me) {
      if (!action || action.type !== 'switch') return false;
      this.battle.switchIn('me', action.index);
      this.broadcast();
      return true;
    }
    this.pendingSelf = action;
    this.emit('waiting', { self: true, peer: !!this.pendingPeer });
    this.tryResolve();
    return true;
  };

  Session.prototype.guestSubmit = function (action) {
    if (!this.started || this.over) return false;
    if (this.needSwitch && this.needSwitch.mine) {
      this.net.send({ t: 'switch', index: action.index });
      this.needSwitch.mine = false;
      this.emit('waiting', { self: true, peer: false });
      return true;
    }
    this.net.send({ t: 'action', action: action });
    this.emit('waiting', { self: true, peer: false });
    return true;
  };

  Session.prototype.tryResolve = function () {
    if (!this.battle || !this.pendingSelf || !this.pendingPeer) return;
    var a = this.pendingSelf;
    var b = this.pendingPeer;
    this.pendingSelf = null;
    this.pendingPeer = null;
    this.battle.stepPvp(a, b);
    this.broadcast();
  };

  Session.prototype.broadcast = function () {
    if (!this.battle) return;
    var lines = this.battle.log.slice(this.sentLogCount);
    this.sentLogCount = this.battle.log.length;
    var snap = this.battle.snapshot();
    this.over = snap.over;
    var payload = {
      t: 'sync',
      turn: snap.turn,
      lines: lines,
      snap: snap,
      over: snap.over,
      winner: snap.winner
    };
    this.net.send(payload);
    this.emit('sync', payload);
    this.emitTurnState(snap);
  };

  Session.prototype.emitTurnState = function (snap) {
    var mySide = this.role === 'host' ? 'me' : 'foe';
    var peerSide = this.role === 'host' ? 'foe' : 'me';
    this.needSwitch = {
      mine: !!(snap.needSwitch && snap.needSwitch[mySide]),
      theirs: !!(snap.needSwitch && snap.needSwitch[peerSide])
    };
    if (snap.over) {
      this.over = true;
      this.emit('over', { winner: snap.winner, snap: snap });
      return;
    }
    if (this.needSwitch.mine) this.emit('need-switch', { side: 'self', snap: snap });
    else if (this.needSwitch.theirs) this.emit('waiting-peer-switch', { snap: snap });
    else this.emit('turn-ready', { snap: snap });
  };

  // ---------- 收包 ----------
  Session.prototype.handle = function (m) {
    this.peerSeen = true;

    switch (m.t) {
      case 'join':
        if (this.role === 'host') {
          this.net.send({ t: 'hello', role: 'host' });
          this.emit('peer', { joined: true });
        }
        break;
      case 'hello':
        this.emit('peer', { joined: true });
        break;
      case 'team':
        this.peerTeamIds = m.team || [];
        this.emit('peer-team', { team: this.peerTeamIds });
        this.maybeStart();
        break;
      case 'ready':
        this.peerReady = true;
        if (m.team) this.peerTeamIds = m.team;
        this.emit('ready', { self: this.selfReady, peer: true });
        this.maybeStart();
        break;
      case 'start':
        if (this.role === 'guest') {
          this.started = true;
          this.sentLogCount = (m.lines || []).length;
          this.emit('start', m);
          if (m.snap) this.emitTurnState(m.snap);
        }
        break;
      case 'sync':
        if (this.role === 'guest' && m.snap) {
          this.over = !!m.over;
          this.emit('sync', m);
          this.emitTurnState(m.snap);
        }
        break;
      case 'action':
        if (this.role === 'host') {
          this.pendingPeer = m.action;
          this.emit('peer-action', {});
          this.tryResolve();
        }
        break;
      case 'switch':
        if (this.role === 'host' && this.battle) {
          var ok = this.battle.switchIn('foe', m.index);
          if (ok) this.broadcast();
        }
        break;
      case 'bye':
        this.emit('peer-left', {});
        break;
      default:
        break;
    }
  };

  /** 房主：把对方的真实动作透传给引擎（用于调试） */
  Session.prototype.debugState = function () {
    return {
      role: this.role,
      started: this.started,
      over: this.over,
      peerSeen: this.peerSeen,
      selfReady: this.selfReady,
      peerReady: this.peerReady,
      turn: this.battle ? this.battle.turn : 0
    };
  };

  root.SeerPvp = { Session: Session };
})(typeof self !== 'undefined' ? self : this);
