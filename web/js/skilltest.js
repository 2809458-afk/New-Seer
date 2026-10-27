/* 技能测试模块（2026-10-24）
 *
 * 目的：现在的「巅峰对战」里，对手是随机 6 只精灵，很难稳定造出
 *   「对手有回合类效果 / 有强化 / 刚被击败」这些前置条件，
 *   导致「消除回合类效果」「消除·反转强化」「击败后触发」这类效果没法验收。
 *
 * 做法：固定脚本化对局
 *   我方：直接用「精灵背包」出战格的精灵（最多 6 只）
 *   对手：6 只 1 号「布布种子」，技能只有「撞击」
 *   附加一组手动按钮：自爆 / 回合类效果（3 回合，每回合回 1/3）/ 全属性 ±1
 *
 * 只依赖 window.SeerBattle / SeerDb / SeerApi / SeerApp，不改动主对战逻辑。
 */
(function () {
  'use strict';

  var B = window.SeerBattle;
  var Db = window.SeerDb;
  var Api = window.SeerApi;

  var STATS = ['atk', 'def', 'spAtk', 'spDef', 'spd', 'acc'];
  var ROUND_HEAL_TURNS = 3;
  var BUBU_HP = 10000;   // 测试用「布布种子」血量：太脆会一回合打死，测不了持续效果

  var C = { byId: null, combos: null, types: null, souls: null, marks: null, skill: {} };
  var S = { b: null };

  function $(s) { return document.querySelector(s); }
  function msg(t) {
    var box = $('#stHint');
    if (box) box.textContent = t || '';
  }

  // ---------- 数据 ----------
  function loadBase() {
    if (C.byId) return true;
    var pets = Db.getAll('pets') || [];
    if (!pets.length) return false;
    C.byId = Object.create(null);
    pets.forEach(function (p) { C.byId[p.id] = p; });
    C.combos = Object.create(null);
    (Db.getAll('combos') || []).forEach(function (c) { C.combos[c.id] = c; });
    C.types = Db.getAll('types') || [];
    C.souls = Object.create(null);
    C.marks = Object.create(null);
    (Db.getAll('soulmarks') || []).forEach(function (m) {
      C.souls[m.id] = m;
      (m.pets || []).forEach(function (pid) {
        (C.marks[pid] = C.marks[pid] || []).push(m.id);
      });
    });
    return true;
  }

  function getSkill(id) {
    if (C.skill[id]) return Promise.resolve(C.skill[id]);
    var local = Db.get('skills', id);
    if (local) { C.skill[id] = local; return Promise.resolve(local); }
    return Api.getOne('skill', id).then(function (s) {
      if (s) { C.skill[id] = s; Db.putAll('skills', [s]); }
      return s || null;
    }).catch(function () { return null; });
  }

  function skillIdsOf(pet) {
    return (pet.skill || []).map(function (x) { return x.skill ? x.skill.id : x; });
  }

  function dedupeSkills(list) {
    var seen = Object.create(null), out = [];
    list.forEach(function (s) {
      if (!s || s.id == null || seen[s.id]) return;
      seen[s.id] = 1;
      out.push(s);
    });
    return out;
  }

  // 背包里配的招（与主界面共用 state.loadouts），没配过才回退到按威力自动选
  function loadoutIds(pet) {
    var App = window.SeerApp;
    var all = App && App.state ? App.state.loadouts : null;
    var lo = all ? all[pet.id] : null;
    if (!lo) return null;
    var fifth = pet.fifth || [];
    var n = (lo.n || []).filter(function (id) { return fifth.indexOf(id) < 0; }).slice(0, 4);
    var f = (lo.f != null && fifth.indexOf(lo.f) >= 0) ? lo.f : null;
    return { n: n, f: f, empty: !n.length && f == null };
  }

  // 我方：优先用背包配招（4 普通 + 第五），否则按威力自动选 4 个 + 第五
  function pickMySkills(pet) {
    var lo = loadoutIds(pet);
    if (lo && !lo.empty) {
      var ids = lo.n.concat(lo.f != null ? [lo.f] : []);
      return Promise.all(ids.map(getSkill)).then(function (list) {
        var got = list.filter(Boolean);
        if (got.length) return got;
        return autoSkills(pet);
      });
    }
    if (lo && lo.empty) msg('「' + pet.name + '」没有配招，已临时按威力自动选技能；可在「精灵背包」里配置。');
    return autoSkills(pet);
  }

  function autoSkills(pet) {
    var fifth = pet.fifth || [];
    var normal = skillIdsOf(pet).filter(function (id) { return fifth.indexOf(id) < 0; });
    return Promise.all(normal.map(getSkill)).then(function (list) {
      var pool = dedupeSkills(list.filter(Boolean));
      pool.sort(function (a, b) { return (b.power || 0) - (a.power || 0); });
      var chosen = pool.slice(0, 4);
      if (!fifth.length) return chosen;
      return getSkill(fifth[0]).then(function (f) {
        if (f && !chosen.some(function (c) { return c.id === f.id; })) chosen.push(f);
        return chosen;
      });
    }).then(function (chosen) {
      if (chosen.length) return chosen;
      // 技能没缓存且抓不到时给个占位，至少能进对局
      return [{ id: -2, name: '撞击（占位）', power: 35, max_pp: 35, accuracy: 95, crit_rate: 6.25,
        priority: 0, must_hit: false, category: { id: 1 }, type: pet.type, info: '', effects: [] }];
    });
  }

  // 对手：布布种子，只要「撞击」
  // 注意：数据包里 1 号布布种子没有技能记录，所以这里直接用固定脚本（普通系物理，威力 35）
  function bubuSkills(pet) {
    return [{
      id: -1, name: '撞击', power: 35, max_pp: 35, accuracy: 95, crit_rate: 6.25,
      priority: 0, must_hit: false, category: { id: 1 },
      type: (pet && pet.type) || { id: 1 }, info: '', effects: []
    }];
  }

  /** 读取输入框（输入不存在时返回默认值） */
  function val(sel, dft) {
    var el = $(sel);
    if (!el) return dft;
    var v = el.value;
    if (v == null || v === '') return dft;
    return v;
  }
  function numVal(sel, dft) {
    var n = parseInt(val(sel, ''), 10);
    return isNaN(n) ? dft : n;
  }
  /** 对手精灵：编号或名称，空则默认 1 号布布种子 */
  function resolveFoePet() {
    var raw = String(val('#stFoePet', '')).trim();
    if (!raw) return C.byId[1] || null;
    if (/^\d+$/.test(raw)) return C.byId[parseInt(raw, 10)] || null;
    var list = Object.keys(C.byId).map(function (k) { return C.byId[k]; });
    var hit = list.filter(function (p) { return p && p.name === raw; })[0];
    if (!hit) hit = list.filter(function (p) { return p && p.name && p.name.indexOf(raw) >= 0; })[0];
    return hit || null;
  }
  function standbySkill(pet) {
    return {
      id: -3, name: '待机', power: 0, max_pp: 99, accuracy: 100, crit_rate: 0,
      priority: 0, must_hit: true, category: { id: 4 },
      type: (pet && pet.type) || { id: 1 }, info: '', effects: []
    };
  }
  /** 技能：编号或名称（名称只能搜本地已缓存的技能） */
  function resolveSkill(raw) {
    raw = String(raw || '').trim();
    if (!raw) return Promise.resolve(null);
    if (/^\d+$/.test(raw)) return getSkill(parseInt(raw, 10));
    var cached = Db.getAll('skills') || [];
    var hit = cached.filter(function (s) { return s && s.name === raw; })[0];
    if (!hit) hit = cached.filter(function (s) { return s && s.name && s.name.indexOf(raw) >= 0; })[0];
    return Promise.resolve(hit || null);
  }
  function buildFoeSkills(pet) {
    var mode = val('#stFoeSkillMode', 'pound');
    if (mode === 'none') return Promise.resolve([standbySkill(pet)]);
    if (mode === 'pick') {
      return resolveSkill(val('#stFoeSkill', '')).then(function (sk) {
        return sk ? [sk] : null;
      });
    }
    return Promise.resolve(bubuSkills(pet));
  }

  function makeEntry(pet, skills, opts) {
    opts = opts || {};
    var marks = opts.noMarks ? [] : (C.marks[pet.id] || []).map(function (id) { return C.souls[id]; })
      .filter(function (m) { return m && !(B.soulmarkDisabled && B.soulmarkDisabled(pet.id, m.id)); });
    var passives = [];
    marks.forEach(function (m) { passives = passives.concat(B.parseSoulmark(m.desc || '')); });
    return {
      pet: pet,
      combo: C.combos[pet.type ? pet.type.id : 0] || null,
      skills: skills,
      soulmarks: marks,
      passives: passives,
      iv: 31, ev: {}, level: 100, nature: null, bonus: null, bonusPct: null,
      resist: { fixed: 0, percent: 0, crit: 0, status: 0 },
      mintmarks: [null, null, null],
      suitId: null
    };
  }

  // ---------- 背包出战格 ----------
  function teamPets() {
    var App = window.SeerApp;
    if (!App || !App.state) return [];
    var st = App.state;
    return (st.team || []).slice(0, 6).map(function (id) { return id != null ? st.petById[id] : null; }).filter(Boolean);
  }

  function updateTeamList() {
    var box = $('#stTeamList');
    if (!box) return;
    var pets = teamPets();
    if (!pets.length) {
      box.innerHTML = '<b>出战格是空的。</b>请先到「精灵背包」把要测试的精灵放进出战格（前 6 格）。';
      return;
    }
    box.innerHTML = '<b>出战格（' + pets.length + ' 只）：</b>' + pets.map(function (p, i) {
      return '<span style="margin-right:10px">' + (i + 1) + '. ' + p.name + '（' + p.id + '）</span>';
    }).join('');
  }

  // ---------- 开局 ----------
  function startTest() {
    if (!loadBase()) { msg('本地库为空，请先到「数据仓库」同步数据'); return; }
    var pets = teamPets();
    if (!pets.length) { msg('「精灵背包」出战格是空的，请先放精灵再测试'); updateTeamList(); return; }
    var foePet = resolveFoePet();
    if (!foePet) { msg('对手精灵找不到：' + val('#stFoePet', '') + '（请输入编号，或已同步的名称）'); return; }
    var foeHp = Math.max(1, numVal('#stFoeHp', BUBU_HP));
    var foeHpPct = Math.min(100, Math.max(1, numVal('#stFoeHpPct', 100)));
    var foeNoMarks = !($('#stFoeSoul') && $('#stFoeSoul').checked);
    msg('正在准备技能…');

    Promise.all(pets.map(pickMySkills)).then(function (lists) {
      return buildFoeSkills(foePet).then(function (foeSkills) {
        if (!foeSkills) {
          msg('指定的对手技能没有找到（名称搜索只能命中本地已缓存的技能，建议填技能编号）');
          return;
        }
        var meTeam = pets.map(function (p, i) { return makeEntry(p, lists[i]); });
        var foeTeam = [];
        for (var i = 0; i < 6; i++) foeTeam.push(makeEntry(foePet, foeSkills, { noMarks: foeNoMarks }));

        var stTypes = B.buildChart(C.types);
        var stTypeByName = {};
        (C.types || []).forEach(function (t) { stTypeByName[t.name] = t.id; });
        S.b = new B.Battle({
          chart: stTypes,
          typeByName: stTypeByName,
          comboOf: function (cid) { return C.combos[cid] || null; },
          difficulty: 'easy',
          level: 100,
          meTeam: meTeam,
          foeTeam: foeTeam
        });
        // 木桩血量：默认 10000，避免被一击秒杀（效果还挂在它身上就换人了）
        S.b.foe.team.forEach(function (c) {
          c.stats.hp = foeHp;
          c.maxHp = foeHp;
          c.hp = Math.max(1, Math.round(foeHp * foeHpPct / 100));
        });
        $('#stSetup').classList.add('hidden');
        $('#stView').classList.remove('hidden');
        $('#stMark').innerHTML = soulsHtml(pets);
        var missing = 0;
        lists.forEach(function (l) { if (l.length === 1 && l[0].id === -2) missing++; });
        msg(missing ? '有 ' + missing + ' 只精灵的技能没缓存也抓不到，已用占位技能；请联网后到「数据仓库」同步。' : '');
        render();
      });
    }).catch(function (e) {
      console.error(e);
      msg('准备失败：' + (e && e.message));
    });
  }

  function soulsHtml(pets) {
    return pets.map(function (pet) {
      var ids = C.marks[pet.id] || [];
      return ids.map(function (id) {
        var m = C.souls[id];
        if (!m) return '';
        return '<div class="muted small"><b>' + pet.name + ' · 魂印 ' + m.id + '</b>：' + (m.desc || '') + '</div>';
      }).join('');
    }).join('');
  }

  // ---------- 渲染 ----------
  function stageText(stages) {
    var names = { atk: '攻', def: '防', spAtk: '特攻', spDef: '特防', spd: '速', acc: '命', eva: '闪' };
    var out = [];
    Object.keys(names).forEach(function (k) {
      var v = stages[k] || 0;
      if (v) out.push(names[k] + (v > 0 ? '+' : '') + v);
    });
    return out.length ? out.join(' ') : '无';
  }

  function cardHtml(title, vm, live) {
    var pct = Math.max(0, Math.min(100, Math.round(vm.hp / (vm.maxHp || 1) * 100)));
    var bits = [];
    if (live) {
      if (live.teHeal && live.teHeal.turns > 0) {
        bits.push('回合类效果：每回合回 ' + Math.round(live.teHeal.pct * 100) + '%（剩 ' + live.teHeal.turns + ' 回合）');
      }
      if (live.shield > 0) bits.push('护盾 ' + live.shield);
      if (live.ward > 0) bits.push('护罩 ' + live.ward);
    }
    if (live && live.skills && live.skills.length) {
      bits.push('PP：' + live.skills.map(function (sl) {
        return sl.skill.name + ' ' + sl.pp + '/' + sl.maxPp;
      }).join('、'));
    }
    var eff = (vm.effects || []).map(function (e) { return e.text; });
    return '<div class="card" style="flex:1;min-width:240px">' +
      '<b>' + title + ' · ' + vm.name + '</b>' +
      '<div class="progress" style="margin:8px 0"><i style="width:' + pct + '%"></i></div>' +
      '<div class="muted">体力 ' + vm.hp + ' / ' + vm.maxHp + '</div>' +
      '<div class="muted">能力等级：' + stageText(vm.stages) + '</div>' +
      (bits.length ? '<div class="muted small">' + bits.join(' · ') + '</div>' : '') +
      (vm.status ? '<div class="muted small">异常：' + vm.status.name + (vm.status.turns < 900 ? '(' + vm.status.turns + ')' : '') + '</div>' : '') +
      (eff.length ? '<div class="muted small">效果：' + eff.join('、') + '</div>' : '') +
      '</div>';
  }

  /** 场下体力编辑：帝君之罚、1306 这类效果需要能改场下血量 */
  function benchEditorHtml(sideKey, sideObj, label) {
    var rows = (sideObj.team || []).map(function (c, i) {
      if (i === sideObj.active || !c) return '';
      return '<label class="muted small" style="margin-right:14px">' + (i + 1) + '. ' + c.name +
        ' <input class="input" type="number" style="width:92px" data-bench="' + sideKey + ':' + i +
        '" value="' + c.hp + '" min="0" max="' + c.maxHp + '" /></label>';
    }).filter(Boolean);
    if (!rows.length) return '<div class="muted small">' + label + '；没有场下精灵</div>';
    return '<div class="muted small">' + label + '（可直接改数值，0 = 阵亡）</div>' +
      '<div class="row" style="flex-wrap:wrap">' + rows.join('') + '</div>';
  }

  function render() {
    var b = S.b;
    if (!b) return;
    var snap = b.snapshot();
    var meSide = snap.me, foeSide = snap.foe;
    var meVM = meSide.team[meSide.active];
    var foeVM = foeSide.team[foeSide.active];
    var meLive = b.activeOf('me'), foeLive = b.activeOf('foe');

    $('#stCards').innerHTML = cardHtml('我方', meVM, meLive) + cardHtml('对手', foeVM, foeLive);

    // 技能按钮（每个技能右边一个「!」看详情）
    var bar = $('#stSkills');
    bar.innerHTML = '';
    var actor = b.activeOf('me');
    (meVM.skills || []).forEach(function (s, i) {
      var wrap = document.createElement('span');
      wrap.style.cssText = 'display:inline-flex;align-items:center;gap:4px;margin:0 6px 6px 0';

      var btn = document.createElement('button');
      btn.className = 'btn';
      btn.textContent = s.name + '  PP ' + s.pp + '/' + s.maxPp;
      btn.disabled = b.over || snap.needPlayerSwitch || s.pp <= 0;
      btn.addEventListener('click', function () { useSkill(i); });
      wrap.appendChild(btn);

      var info = document.createElement('button');
      info.className = 'btn';
      info.textContent = '!';
      info.title = '查看技能详情';
      info.style.padding = '0 7px';
      info.addEventListener('click', function () { showSkill(i); });
      wrap.appendChild(info);

      bar.appendChild(wrap);
    });
    if (actor) bar.dataset.side = actor.side;

    // 换人
    var sw = $('#stSwitch');
    if (snap.needPlayerSwitch && !b.over) {
      sw.classList.remove('hidden');
      var html = '<div class="muted">我方精灵倒下，选择下一只出战：</div><div class="row">';
      meSide.team.forEach(function (c) {
        if (!c.alive) return;
        html += '<button class="btn" data-st-switch="' + c.index + '">' +
          (c.index + 1) + '. ' + c.name + '（' + c.hp + '/' + c.maxHp + '）</button>';
      });
      html += '</div>';
      sw.innerHTML = html;
      sw.querySelectorAll('[data-st-switch]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          b.playerSwitch(Number(btn.dataset.stSwitch));
          render();
        });
      });
    } else {
      sw.classList.add('hidden');
      sw.innerHTML = '';
    }

    // 队伍列表
    var me = $('#stMeTeam'), fo = $('#stFoeTeam');
    if (me) {
      me.textContent = '我方队伍：' + meSide.team.map(function (c, i) {
        return (i + 1) + '.' + c.name + (c.alive ? '(' + c.hp + ')' : '(倒)');
      }).join('  ');
    }
    if (fo) {
      fo.textContent = '对手队伍：' + foeSide.team.map(function (c, i) {
        return (i + 1) + '.' + (c.alive ? c.hp : '倒');
      }).join('  ');
    }
    var bb = $('#stBenchBox');
    if (bb) {
      bb.innerHTML = benchEditorHtml('me', meSide, '我方场下') + benchEditorHtml('foe', foeSide, '对手场下');
    }

    // 日志
    var logBox = $('#stLog');
    logBox.textContent = b.log.slice(-80).join('\n');
    logBox.scrollTop = logBox.scrollHeight;

    if (b.over) msg(b.winner === 'me' ? '对战结束：你赢了。点「重新开始」或「退出测试」。' : '对战结束：你输了。点「重新开始」或「退出测试」。');
  }

  function useSkill(index) {
    var b = S.b;
    if (!b || b.over || b.needPlayerSwitch) return;
    b.step({ type: 'skill', index: index });
    render();
  }

  function showSkill(index) {
    var b = S.b;
    if (!b) return;
    var c = b.activeOf('me');
    if (!c) return;
    var slot = c.skills[index];
    if (!slot) return;
    var App = window.SeerApp;
    if (App && App.showSkill) App.showSkill(slot.skill);
  }

  // ---------- 手动操作 ----------
  function forceKill(side) {
    var b = S.b;
    if (!b || b.over) return;
    b.testForceFaint(side);
    render();
  }

  function addRoundHeal(side) {
    var b = S.b;
    if (!b || b.over) return;
    b.testRoundHeal(side, ROUND_HEAL_TURNS, 1 / 3);
    render();
  }

  function clearRound(side) {
    var b = S.b;
    if (!b || b.over) return;
    b.testClearRound(side);
    render();
  }

  function shiftStats(side, delta) {
    var b = S.b;
    if (!b || b.over) return;
    var c = b.activeOf(side);
    if (!c) return;
    // 「N 回合内无法使自身能力出现提升状态」：手动按钮也要遵守
    if (delta > 0 && c.noStatUp > 0) {
      b.push(b.tag(side) + c.pet.name + ' 处于「无法提升能力」状态（剩 ' + c.noStatUp + ' 回合），能力没有变化。');
      render();
      return;
    }
    b.testShiftStats(side, delta);
    render();
  }

  // ---------- 前置状态（方案 A 第 2 块） ----------
  function currentStatusId() {
    var sel = $('#stStatusSel');
    return sel && sel.value ? sel.value : 'paralyze';
  }
  function setStatus(side, on) {
    var b = S.b;
    if (!b || b.over) return;
    var c = b.activeOf(side);
    if (!c) return;
    if (on) b.applyStatus(c, currentStatusId(), 3, side === 'me' ? '我方' : '对手');
    else if (c.status) { c.status = null; b.push(b.tag(side) + c.pet.name + ' 的异常被清除了。'); }
    render();
  }
  function addShield(side, kind) {
    var b = S.b;
    if (!b || b.over) return;
    var c = b.activeOf(side);
    if (!c) return;
    var v = Math.max(1, numVal('#stShieldVal', 500));
    if (kind === 'ward') { c.ward = (c.ward || 0) + v; b.push(b.tag(side) + c.pet.name + ' 获得 ' + v + ' 点护罩。'); }
    else { c.shield = (c.shield || 0) + v; b.push(b.tag(side) + c.pet.name + ' 获得 ' + v + ' 点护盾。'); }
    render();
  }
  function setHpPct(side) {
    var b = S.b;
    if (!b || b.over) return;
    var c = b.activeOf(side);
    if (!c) return;
    var pct = Math.min(100, Math.max(1, numVal('#stHpPct', 50)));
    c.hp = Math.max(1, Math.round(c.maxHp * pct / 100));
    b.push(b.tag(side) + c.pet.name + ' 体力设为 ' + c.hp + ' / ' + c.maxHp + '。');
    render();
  }
  function zeroPp(side) {
    var b = S.b;
    if (!b || b.over) return;
    var c = b.activeOf(side);
    if (!c) return;
    c.skills.forEach(function (sl) { sl.pp = 0; });
    b.push(b.tag(side) + c.pet.name + ' 的所有技能 PP 归零。');
    render();
  }
  function markLastSkill(kind) {
    var b = S.b;
    if (!b || b.over) return;
    var c = b.activeOf('foe');
    if (!c) return;
    c.lastSkillCategory = kind === 'attr' ? 4 : 1;
    c.lastSkillName = kind === 'attr' ? '（测试标记：属性技）' : '（测试标记：攻击技）';
    b.push('（测试）已标记对手本回合使用' + (kind === 'attr' ? '属性技' : '攻击技') + '。');
    render();
  }
  function applyBenchHp(el) {
    var b = S.b;
    if (!b || !el) return;
    var parts = String(el.dataset.bench || '').split(':');
    var list = parts[0] === 'me' ? b.me.team : b.foe.team;
    var c = list[parseInt(parts[1], 10)];
    if (!c) return;
    var v = parseInt(el.value, 10);
    if (isNaN(v)) return;
    c.hp = Math.min(c.maxHp, Math.max(0, v));
    b.push(b.tag(parts[0]) + c.pet.name + ' 场下体力设为 ' + c.hp + ' / ' + c.maxHp + '。');
    render();
  }

  function resetTest() {
    S.b = null;
    $('#stView').classList.add('hidden');
    $('#stSetup').classList.remove('hidden');
    $('#stLog').textContent = '';
    msg('');
    updateTeamList();
  }

  // ---------- 事件绑定 ----------
  function bind() {
    var start = $('#stStart');
    if (!start) return;
    start.addEventListener('click', startTest);

    var refresh = $('#stRefresh');
    if (refresh) refresh.addEventListener('click', updateTeamList);

    ['#stExit', '#stExit2'].forEach(function (sel) {
      var btn = $(sel);
      if (btn) btn.addEventListener('click', resetTest);
    });

    $('#stReset').addEventListener('click', function () {
      resetTest();
      startTest();
    });

    var box = $('#stControls');
    box.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-st]');
      if (!btn) return;
      switch (btn.dataset.st) {
        case 'killMe': forceKill('me'); break;
        case 'killFoe': forceKill('foe'); break;
        case 'teMe': addRoundHeal('me'); break;
        case 'teFoe': addRoundHeal('foe'); break;
        case 'clearMe': clearRound('me'); break;
        case 'clearFoe': clearRound('foe'); break;
        case 'upMe': shiftStats('me', 1); break;
        case 'upFoe': shiftStats('foe', 1); break;
        case 'downMe': shiftStats('me', -1); break;
        case 'downFoe': shiftStats('foe', -1); break;
        case 'statusMe': setStatus('me', true); break;
        case 'statusFoe': setStatus('foe', true); break;
        case 'clearStatusMe': setStatus('me', false); break;
        case 'clearStatusFoe': setStatus('foe', false); break;
        case 'shieldMe': addShield('me', 'shield'); break;
        case 'shieldFoe': addShield('foe', 'shield'); break;
        case 'wardMe': addShield('me', 'ward'); break;
        case 'wardFoe': addShield('foe', 'ward'); break;
        case 'hpMe': setHpPct('me'); break;
        case 'hpFoe': setHpPct('foe'); break;
        case 'ppZeroMe': zeroPp('me'); break;
        case 'ppZeroFoe': zeroPp('foe'); break;
        case 'lastAttrFoe': markLastSkill('attr'); break;
        case 'lastAtkFoe': markLastSkill('atk'); break;
        default: break;
      }
    });

    // 异常下拉：直接用引擎的状态表
    var statusSel = $('#stStatusSel');
    if (statusSel && statusSel.options && !statusSel.options.length && B.STATUS_DEF) {
      Object.keys(B.STATUS_DEF).forEach(function (id) {
        var opt = document.createElement('option');
        opt.value = id;
        opt.textContent = (B.STATUS_DEF[id] && B.STATUS_DEF[id].name) || id;
        statusSel.appendChild(opt);
      });
      statusSel.value = 'paralyze';
    }

    // 场下体力编辑
    var benchBox = $('#stBenchBox');
    if (benchBox) {
      benchBox.addEventListener('change', function (e) {
        var el = e.target.closest('[data-bench]');
        if (el) applyBenchHp(el);
      });
    }

    // 切到本页时刷新队伍列表
    var tabs = $('#tabs');
    if (tabs) {
      tabs.addEventListener('click', function (e) {
        var tab = e.target.closest('.tab');
        if (tab && tab.dataset.tab === 'skilltest') updateTeamList();
      });
    }

    updateTeamList();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  window.SeerSkillTest = {
    start: startTest,
    battle: function () { return S.b; },
    benchHtml: function (sideKey) {
      var b = S.b;
      if (!b) return '';
      var snap = b.snapshot();
      return benchEditorHtml(sideKey, sideKey === 'me' ? snap.me : snap.foe, sideKey === 'me' ? '我方场下' : '对手场下');
    }
  };
})();
