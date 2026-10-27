/* 联机房间协议测试（内存传输，不依赖网络）：node test/pvp.test.js */
global.self = global;
global.window = global;

const B = require('../js/battle.js');
global.SeerBattle = B;
require('../js/net.js');
require('../js/pvp.js');

let fails = 0;
function ok(cond, msg) {
  if (cond) console.log('  ok  ' + msg);
  else { fails++; console.error('  FAIL ' + msg); }
}
function eq(a, b, msg) {
  ok(a === b, msg + ' (期望 ' + b + '，实际 ' + a + ')');
}

// ---------- 内存传输 ----------
function MockLink() { this.ends = []; }
MockLink.prototype.register = function (net) { this.ends.push(net); };
MockLink.prototype.deliver = function (from, msg) {
  const ends = this.ends;
  setTimeout(function () {
    ends.forEach(function (n) { if (n !== from && n.onMessage) n.onMessage(msg); });
  }, 3);
};

function MockNet(link, clientId) {
  this.link = link;
  this.clientId = clientId;
  this.mode = 'mock';
  this.onMessage = null;
  this.sent = [];
}
MockNet.prototype.start = function () { this.link.register(this); };
MockNet.prototype.stop = function () { };
MockNet.prototype.send = function (msg) {
  const body = Object.assign({}, msg, { from: this.clientId, ts: Date.now() });
  this.sent.push(body);
  this.link.deliver(this, body);
  return Promise.resolve(true);
};

// ---------- 假数据 ----------
const pets = {};
[1, 2, 3, 4, 5, 6].forEach(function (i) {
  pets[i] = { id: i, name: 'P' + i, base_stats: { hp: 70, atk: 85, def: 70, sp_atk: 80, sp_def: 70, spd: 60 } };
});
const combos = { 1: { id: 1, name: '草', primary: { id: 1 }, secondary: null } };
const chart = { 1: { 1: 1 } };

function buildEntry(id) {
  return Promise.resolve({
    pet: pets[id],
    combo: combos[1],
    skills: [{
      id: 1, name: '撞击', power: 35, max_pp: 30, accuracy: 100,
      crit_rate: 0, priority: 0, category: { id: 1 }, type: { id: 1 }, info: null
    }]
  });
}

(async function () {
  const link = new MockLink();
  const hostNet = new MockNet(link, 'host-1');
  const guestNet = new MockNet(link, 'guest-1');

  const seen = { host: [], guest: [] };
  let hostSynced = 0;
  let guestSynced = 0;
  let finished = false;
  let resolveDone;
  const doneP = new Promise(function (r) { resolveDone = r; });

  let host, guest;

  function handle(who, t, p) {
    seen[who].push(t);
    if (t === 'start') console.log('    [' + who + '] 开局 turn=' + p.snap.turn);
    if (t === 'sync') { if (who === 'host') hostSynced++; else guestSynced++; }
    if (t === 'error') { console.error('    [' + who + '] 错误 ' + p.message); fails++; }
    if (t === 'turn-ready') {
      if (who === 'host') host.submit({ type: 'skill', index: 0 });
      else guest.submit({ type: 'skill', index: 0 });
    }
    if (t === 'need-switch') {
      const team = who === 'host' ? p.snap.me.team : p.snap.foe.team;
      const idx = team.findIndex(function (x) { return x.alive && !x.active; });
      if (idx < 0) return;
      if (who === 'host') host.submit({ type: 'switch', index: idx });
      else guest.submit({ type: 'switch', index: idx });
    }
    if (t === 'over' && who === 'host' && !finished) {
      finished = true;
      resolveDone(p);
    }
  }

  host = new global.SeerPvp.Session({
    role: 'host', code: 'testroom', net: hostNet,
    buildEntry: buildEntry, chart: chart,
    comboOf: function (id) { return combos[id]; },
    onEvent: function (t, p) { handle('host', t, p); }
  });
  guest = new global.SeerPvp.Session({
    role: 'guest', code: 'testroom', net: guestNet,
    buildEntry: buildEntry, chart: chart,
    comboOf: function (id) { return combos[id]; },
    onEvent: function (t, p) { handle('guest', t, p); }
  });

  host.open();
  guest.open();

  // 双方各自选队（互不影响）
  host.setTeam([1, 2, 3]);
  guest.setTeam([4, 5, 6]);

  const result = await Promise.race([
    doneP,
    new Promise(function (_, rej) { setTimeout(function () { rej(new Error('超时')); }, 15000); })
  ]).catch(function (e) {
    console.error('测试失败:', e.message);
    return null;
  });

  // 给最后一条 sync 留出送达时间
  await new Promise(function (r) { setTimeout(r, 300); });

  console.log('');
  ok(!!result, '整场对战能够结束');
  if (result) {
    const snap = result.snap;
    ok(host.started && guest.started, '双方都进入对战');
    eq(snap.me.team.map(function (x) { return x.id; }).join(','), '1,2,3', '房主队伍 = 自己选的 1,2,3');
    eq(snap.foe.team.map(function (x) { return x.id; }).join(','), '4,5,6', '对手队伍 = 对方选的 4,5,6');
    ok(snap.turn > 1, '产生了多个回合：' + snap.turn);
    ok(guestSynced > 0, '客机收到同步：' + guestSynced + ' 次');
    ok(guestSynced === hostSynced, '主客同步次数一致：' + hostSynced);
    ok(snap.over, '战斗已结束');
    ok(snap.winner === 'me' || snap.winner === 'foe', '有胜负结果：' + snap.winner);

    const allHp = snap.me.team.concat(snap.foe.team);
    ok(allHp.every(function (x) { return x.hp >= 0 && x.hp <= x.maxHp; }), 'HP 始终合法');

    // 客机侧看到的状态应与房主一致（回合数）
    const lastSync = guestNet.sent.filter(function (m) { return m.t === 'action'; });
    ok(lastSync.length > 0, '客机确实发出了动作：' + lastSync.length + ' 次');
  }

  // 关闭房间后不再收发
  host.close();
  guest.close();

  console.log('');
  if (fails) { console.log('✗ ' + fails + ' 项失败'); process.exit(1); }
  console.log('✓ 全部通过');
  process.exit(0);
})();
