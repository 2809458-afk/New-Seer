/* 战斗场景渲染（DOM + CSS）—— 按原版赛尔号布局：
 *
 *   顶部：我方信息（名字/等级/属性/血条/能力等级） ｜ 中间：属性克制 + 回合 ｜ 敌方信息
 *   中部：双方立绘（我方在左且水平镜像，敌方在右）
 *   底部：技能卡片栏（由 app.js 渲染）
 *
 * 为什么不用 PixiJS：`file://` 下浏览器把本地图片判为跨域，WebGL 上传纹理直接 SecurityError。
 * 改为 DOM 承载立绘后，双击打开即可用，不需要本地服务器。
 */
(function (root) {
  'use strict';

  var STAGE_SHORT = { atk: '攻', def: '防', spAtk: '特攻', spDef: '特防', spd: '速', acc: '命', eva: '闪' };

  var stage = {
    mode: 'none',
    host: null,
    root: null,
    els: null,
    view: null,
    prev: null,
    speed: 1
  };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function artUrl(id) {
    var map = root.SEER_ART || {};
    var f = map[String(id)];
    return f ? ('assets/pets/' + f) : null;
  }

  function buildSide(cls) {
    var side = el('div', 'tb-side ' + cls);

    var row1 = el('div', 'tb-row');
    var badge = el('span', 'tb-badge');
    var name = el('span', 'tb-name');
    var lv = el('span', 'tb-lv');
    var soul = el('span', 'tb-soul', '魂印');
    soul.style.display = 'none';
    row1.appendChild(badge);
    row1.appendChild(name);
    row1.appendChild(lv);
    row1.appendChild(soul);
    side.appendChild(row1);

    var hp = el('div', 'tb-hp');
    var fill = el('i');
    hp.appendChild(fill);
    side.appendChild(hp);

    var row2 = el('div', 'tb-row2');
    var hpText = el('span', 'tb-hptext');
    var stages = el('span', 'tb-stages');
    row2.appendChild(hpText);
    row2.appendChild(stages);
    side.appendChild(row2);

    // 回合类效果 / 异常状态 / 魂印名（与能力变化分开）
    var effects = el('div', 'tb-effects');
    side.appendChild(effects);

    return { side: side, badge: badge, name: name, lv: lv, fill: fill, hpText: hpText, stages: stages, effects: effects, soul: soul };
  }

  function build(host) {
    var rootEl = el('div', 'scene');
    rootEl.style.setProperty('--spd', '1');

    rootEl.appendChild(el('div', 'scene-bg'));

    // ---- 顶部信息栏 ----
    var topbar = el('div', 'bt-top');
    var meInfo = buildSide('me');
    var foeInfo = buildSide('foe');

    var center = el('div', 'tb-center');
    var match = el('div', 'tb-match');
    var matchInfo = el('div', 'tb-matchinfo');
    var turn = el('div', 'tb-turn');
    var field = el('div', 'tb-field');
    center.appendChild(match);
    center.appendChild(matchInfo);
    center.appendChild(turn);
    center.appendChild(field);

    topbar.appendChild(meInfo.side);
    topbar.appendChild(center);
    topbar.appendChild(foeInfo.side);
    rootEl.appendChild(topbar);

    // ---- 立绘 ----
    function fighter(cls) {
      var wrap = el('div', 'fighter ' + cls);
      var sprite = el('div', 'f-sprite');
      var img = document.createElement('img');
      img.alt = '';
      var ph = el('div', 'f-ph');
      sprite.appendChild(img);
      sprite.appendChild(ph);
      wrap.appendChild(sprite);
      return { wrap: wrap, sprite: sprite, img: img, ph: ph, imgSrc: '' };
    }
    var me = fighter('side-me');
    var foe = fighter('side-foe');
    rootEl.appendChild(foe.wrap);
    rootEl.appendChild(me.wrap);

    var result = el('div', 'scene-result');
    rootEl.appendChild(result);

    host.appendChild(rootEl);
    stage.root = rootEl;
    stage.host = host;
    stage.els = {
      meInfo: meInfo, foeInfo: foeInfo, match: match, matchInfo: matchInfo,
      turn: turn, field: field, me: me, foe: foe, result: result
    };
    stage.mode = 'dom';
    // Phaser 游戏层：仅在 http(s) 且 ?stage=phaser 时叠加（file:// 见文件头注释）
    if (root.SeerPhaserStage && root.SeerPhaserStage.enabled()) root.SeerPhaserStage.mount(rootEl);
  }

  function popDamage(who, amount, strong) {
    var ui = stage.els && stage.els[who];
    if (!ui) return;
    var t = el('div', 'dmg' + (strong ? ' strong' : ''), String(amount));
    ui.sprite.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 950);
  }

  function shake(who) {
    var ui = stage.els && stage.els[who];
    if (!ui) return;
    ui.wrap.classList.remove('hit');
    void ui.wrap.offsetWidth;
    ui.wrap.classList.add('hit');
  }

  function setInfo(ui, data, side) {
    if (!ui || !data) return;
    ui.soul.style.display = (data.soulmarks && data.soulmarks.length) ? '' : 'none';
    ui.soul.onclick = function (e) {
      e.stopPropagation();
      if (root.SeerStage.onSoul) root.SeerStage.onSoul(side);
    };
    ui.badge.textContent = data.status ? data.status.name : (data.comboName || '');
    ui.badge.className = 'tb-badge' + (data.status ? ' st s-' + data.status.id : ' type');
    ui.badge.style.background = data.status ? '' : (data.color || '#8899bb');

    ui.name.textContent = data.name || '—';
    ui.lv.textContent = 'Lv.' + (data.level || 100);

    var pct = data.maxHp ? Math.max(0, Math.min(1, data.hp / data.maxHp)) : 0;
    ui.fill.style.width = (pct * 100) + '%';
    ui.fill.className = pct > 0.5 ? '' : (pct > 0.2 ? 'mid' : 'low');

    ui.hpText.textContent = (data.hp == null ? 0 : data.hp) + ' / ' + (data.maxHp || 0) +
      (data.shield ? ' · 盾' + data.shield : '');

    ui.stages.innerHTML = '';
    var st = data.stages;
    if (st) {
      Object.keys(STAGE_SHORT).forEach(function (k) {
        var v = st[k] || 0;
        if (!v) return;
        var chip = el('span', 'chip ' + (v > 0 ? 'up' : 'down'), STAGE_SHORT[k] + (v > 0 ? '+' : '') + v);
        ui.stages.appendChild(chip);
      });
    }

    ui.effects.innerHTML = '';
    (data.effects || []).forEach(function (fx) {
      var chip = el('span', 'fxchip ' + (fx.tone || ''), fx.text);
      if (fx.tip) {
        chip.title = fx.tip;
        chip.classList.add('has-tip');
        chip.onclick = function (e) {
          e.stopPropagation();
          if (root.SeerStage.onTip) root.SeerStage.onTip(fx.tip);
        };
      }
      ui.effects.appendChild(chip);
    });
    (data.soulNames || []).forEach(function (nm) {
      var chip = el('span', 'fxchip soul', nm);
      chip.title = '点击查看魂印详情';
      chip.onclick = function (e) {
        e.stopPropagation();
        if (root.SeerStage.onSoul) root.SeerStage.onSoul(side);
      };
      ui.effects.appendChild(chip);
    });
    ui.effects.style.display = ui.effects.childNodes.length ? '' : 'none';
  }

  function setSprite(who, data) {
    var ui = stage.els[who];
    if (!ui || !data) return;
    var url = data.id != null ? artUrl(data.id) : null;
    if (url) {
      if (ui.imgSrc !== url) { ui.img.src = url; ui.imgSrc = url; }
      ui.sprite.classList.add('has-art');
      ui.img.style.display = 'block';
      ui.ph.style.display = 'none';
    } else {
      ui.sprite.classList.remove('has-art');
      ui.img.style.display = 'none';
      ui.ph.style.display = 'grid';
      ui.ph.textContent = (data.name || '?').slice(0, 1);
      ui.ph.style.background = data.color || '#8899bb';
    }
  }

  function setCenter(view) {
    var els = stage.els;
    var me = view.me || {};
    var foe = view.foe || {};

    els.match.innerHTML = '';
    var a = el('span', 'mt-type', me.comboName || '?');
    a.style.background = me.color || '#8899bb';
    var arrow = el('span', 'mt-arrow', '≫ ≪');
    var b = el('span', 'mt-type', foe.comboName || '?');
    b.style.background = foe.color || '#8899bb';
    els.match.appendChild(a);
    els.match.appendChild(arrow);
    els.match.appendChild(b);

    // 双方克制关系：两个方向都常驻显示（不再只在技能卡上提示）
    els.matchInfo.innerHTML = '';
    var m = view.matchup;
    if (m) {
      els.matchInfo.appendChild(matchChip('我→敌', m.toFoe));
      els.matchInfo.appendChild(matchChip('敌→我', m.toMe));
    }

    els.turn.textContent = '第 ' + Math.max(1, view.turn || 1) + ' 回合';
    els.field.textContent = view.fieldName || '';
  }

  /** 一个方向的克制标记：>1 克制、=1 普通、<1 被克、=0 无效 */
  function matchChip(label, ratio) {
    var tone = 'even', text = '×1';
    if (ratio === 0) { tone = 'zero'; text = '无效'; }
    else if (ratio > 1) { tone = 'good'; text = '×' + ratio; }
    else if (ratio < 1) { tone = 'bad'; text = '×' + ratio; }
    var chip = el('span', 'mt-dir ' + tone, label + ' ' + text);
    chip.title = label + '：' + (ratio === 0 ? '属性无效' : (ratio > 1 ? '克制' : (ratio < 1 ? '被克制' : '普通')));
    return chip;
  }

  function critFlash(who) {
    var rootEl = stage.root;
    if (!rootEl) return;
    rootEl.classList.remove('crit-me', 'crit-foe');
    void rootEl.offsetWidth;
    rootEl.classList.add(who === 'me' ? 'crit-me' : 'crit-foe');
    var b = el('div', 'crit-banner', '会心一击！');
    rootEl.appendChild(b);
    setTimeout(function () {
      rootEl.classList.remove('crit-me', 'crit-foe');
      if (b.parentNode) b.parentNode.removeChild(b);
    }, 950);
  }

  function render(view) {
    stage.view = view;
    if (root.SeerPhaserStage && root.SeerPhaserStage.enabled()) root.SeerPhaserStage.render(view);
    if (stage.mode !== 'dom') return;
    var els = stage.els;

    setInfo(els.meInfo, view.me, 'me');
    setInfo(els.foeInfo, view.foe, 'foe');
    setSprite('me', view.me);
    setSprite('foe', view.foe);
    setCenter(view);

    if (view.crit && (stage.critTurn !== view.turn || stage.critSide !== view.crit)) {
      stage.critTurn = view.turn;
      stage.critSide = view.crit;
      critFlash(view.crit);
    } else if (!view.crit) {
      stage.critSide = null;
    }

    if (stage.prev) {
      ['me', 'foe'].forEach(function (who) {
        var now = view[who];
        var before = stage.prev[who];
        if (!now || !before) return;
        var dmg = (before.hp || 0) - (now.hp || 0);
        if (dmg > 0) {
          popDamage(who, dmg, dmg > (now.maxHp || 1) * 0.22);
          shake(who);
        }
      });
    }

    if (view.over) {
      els.result.textContent = view.resultText || '';
      els.result.className = 'scene-result show' + (view.resultWin ? ' win' : ' lose');
    } else {
      els.result.textContent = '';
      els.result.className = 'scene-result';
    }

    stage.prev = {
      me: { hp: view.me ? view.me.hp : 0, maxHp: view.me ? view.me.maxHp : 0 },
      foe: { hp: view.foe ? view.foe.hp : 0, maxHp: view.foe ? view.foe.maxHp : 0 }
    };
  }

  function mount(host) {
    if (!host) return false;
    if (stage.root) {
      if (stage.root.parentNode !== host) host.appendChild(stage.root);
      stage.host = host;
      return true;
    }
    build(host);
    return true;
  }

  function reset() {
    stage.prev = null;
    if (root.SeerPhaserStage) root.SeerPhaserStage.reset();
    if (!stage.els) return;
    stage.els.result.textContent = '';
    stage.els.result.className = 'scene-result';
    [stage.els.me, stage.els.foe].forEach(function (ui) {
      ui.wrap.classList.remove('hit');
      var olds = ui.sprite.querySelectorAll('.dmg');
      for (var i = 0; i < olds.length; i++) olds[i].parentNode.removeChild(olds[i]);
    });
  }

  function destroy() {
    if (root.SeerPhaserStage) root.SeerPhaserStage.destroy();
    if (stage.root && stage.root.parentNode) stage.root.parentNode.removeChild(stage.root);
    stage.root = null;
    stage.els = null;
    stage.mode = 'none';
    stage.prev = null;
  }

  function setSpeed(k) {
    stage.speed = (k === 0) ? 0 : Math.max(1, Number(k) || 1);
    if (stage.root) {
      stage.root.style.setProperty('--spd', stage.speed === 0 ? '0.04' : String(1 / stage.speed));
    }
  }

  function mode() {
    if (root.SeerPhaserStage && root.SeerPhaserStage.active()) return stage.mode + '+phaser';
    return stage.mode;
  }

  function debugPixels() {
    if (!stage.els) return { mode: stage.mode };
    var px = {
      mode: mode(),
      nodes: stage.root ? stage.root.querySelectorAll('*').length : 0,
      art: (stage.els.me.imgSrc ? 1 : 0) + (stage.els.foe.imgSrc ? 1 : 0)
    };
    if (root.SeerPhaserStage && root.SeerPhaserStage.active()) {
      var ph = root.SeerPhaserStage.debugPixels();
      px.phaser = ph;
      px.art = Math.max(px.art, ph.art);
    }
    return px;
  }

  root.SeerStage = {
    mount: mount,
    render: render,
    reset: reset,
    destroy: destroy,
    resize: function () { },
    mode: mode,
    setSpeed: setSpeed,
    debugPixels: debugPixels,
    artUrl: artUrl
  };
})(typeof self !== 'undefined' ? self : this);
