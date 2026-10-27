/* Phaser 游戏层（战斗舞台的精灵与伤害数字）
 *
 * 与旧 Web 的关系：DOM/CSS 的界面（信息栏、技能栏、日志）完全不改；
 * 这里只把「中间的两个立绘 + 伤害数字 + 受击抖动」搬到 Phaser 画布上，叠在原来的战斗场景里。
 *
 * 默认不启用：file:// 下浏览器把本地图片判成跨域，WebGL 上传纹理会 SecurityError（见 render.js 顶部注释）。
 * 启用：经 http:// 打开并带 ?stage=phaser（或 #...&stage=phaser）。
 */
(function (root) {
  'use strict';

  var S = {
    game: null,
    scene: null,
    host: null,
    wrap: null,
    mode: 'none',
    booting: null,
    artBySide: { me: '', foe: '' },
    pending: null,
    animIndex: null,
    animBySide: { me: null, foe: null },
    plays: { attack: 0, hited: 0 }
  };

  function search() {
    var l = root.location;
    return l ? String(l.search || '') + String(l.hash || '') : '';
  }
  function wanted() { return /[?&#]stage=phaser/.test(search()); }
  function fileProtocol() { return !!(root.location && root.location.protocol === 'file:'); }
  function enabled() { return wanted() && !fileProtocol(); }
  function active() { return S.mode === 'phaser' && !!S.game; }

  function loadLib() {
    if (root.Phaser) return Promise.resolve(true);
    if (S.booting) return S.booting;
    S.booting = new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = 'lib/phaser.min.js';
      s.onload = function () { resolve(!!root.Phaser); };
      s.onerror = function () { resolve(false); };
      document.head.appendChild(s);
    });
    return S.booting;
  }

  function artUrl(id) {
    var map = root.SEER_ART || {};
    var f = map[String(id)];
    return f ? ('assets/pets/' + f) : null;
  }

  function makeScene() {
    return new root.Phaser.Scene({ key: 'battle' });
  }

  function initGame(Phaser) {
    var scene = makeScene();
    scene.preload = function () {
      // 烘焙动画清单：存在则对应精灵自动改用帧动画，缺失时静默回退静态立绘
      this.load.json('anim-index', 'assets/pet-anim/index.json');
    };
    scene.create = function () {
      var w = this.scale.width;
      var h = this.scale.height;
      this.meSprite = this.add.sprite(w * 0.28, h * 0.58, '__WHITE').setOrigin(0.5).setVisible(false);
      this.foeSprite = this.add.sprite(w * 0.72, h * 0.58, '__WHITE').setOrigin(0.5).setVisible(false);
      this.meSprite.setFlipX(true);
      this.loaded = {};
      S.scene = this;
      S.errors = [];
      this.load.on('loaderror', function (file) {
        S.errors.push(String(file && (file.src || file.key)));
        console.warn('[phaser] 贴图加载失败 ' + (file && (file.src || file.key)));
      });
      S.animIndex = this.cache.json.get('anim-index') || { pets: {} };
      var self = this;
      this.time.delayedCall(0, function () {
        if (S.pending) { var v = S.pending; S.pending = null; render(v); }
      });
    };
    scene.update = function () { /* 目前只有静态帧 + 补间，无需逐帧逻辑 */ };
    var game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: S.wrap,
      transparent: true,
      banner: false,
      audio: { noAudio: true },
      scale: { mode: Phaser.Scale.RESIZE, width: S.wrap.clientWidth || 800, height: S.wrap.clientHeight || 320 },
      scene: scene
    });
    S.game = game;
    S.mode = 'phaser';
    // 场景首帧可能晚于本帧的视图推送：补几次渲染，确保贴图真的载入
    [0, 200, 600, 1200].forEach(function (d) {
      root.setTimeout(function () { if (S.last) render(S.last); }, d);
    });
  }

  function bakedFor(id) {
    var pets = (S.animIndex && S.animIndex.pets) || {};
    return pets[String(id)] || null;
  }

  /** 该侧精灵如果有烘焙动画，就把贴图与动画挂上去（返回 true） */
  function ensureSideAnim(side, id) {
    var scene = S.scene;
    if (!scene || !id) return false;
    var info = bakedFor(id);
    if (!info) return false;
    var key = 'anim-' + id;
    if (scene.anims.exists(key + '-standby')) { attachSideAnim(side, id); return true; }
    if (queued['anim:' + id]) return false;
    queued['anim:' + id] = true;
    var metaKey = key + '-meta';
    if (!scene.cache.json.exists(metaKey)) scene.load.json(metaKey, 'assets/pet-anim/' + id + '.json');
    if (!scene.textures.exists(key)) scene.load.image(key, info.image);
    scene.load.once('complete', function () {
      queued['anim:' + id] = false;
      setupAnim(id, key, scene.cache.json.get(metaKey));
      if (S.last) render(S.last);
    });
    scene.load.start();
    return false;
  }

  /** 把烘焙的帧序列注册成 Phaser 动画 */
  function setupAnim(id, key, meta) {
    var scene = S.scene;
    if (!id || !meta || !scene || !scene.textures.exists(key)) { S.errors.push('anim-missing:' + id); return; }
    var meta = scene.cache.json.get(key + '-meta');
    if (!meta || !scene.textures.exists(key)) {
      S.errors.push('anim-missing:' + id);
      return;
    }
    var tex = scene.textures.get(key);
    meta.frames.forEach(function (fr) {
      if (!tex.has(fr.name)) tex.add(fr.name, 0, fr.x, fr.y, fr.w, fr.h);
    });
    Object.keys(meta.anims).forEach(function (name) {
      var animKey = key + '-' + name;
      if (scene.anims.exists(animKey)) return;
      var list = meta.anims[name];
      // 出招：只取 action_hit 前 18 帧到命中后 2 帧，命中前后动作与伤害数字能对上
      var hit = (meta.labels && meta.labels[name] && meta.labels[name].action_hit) || list.length;
      var start = name === 'attack' ? Math.max(0, hit - 18) : 0;
      var end = name === 'attack' ? Math.min(list.length, hit + 2) : list.length;
      var frames = list.slice(start, end);
      scene.anims.create({
        key: animKey,
        frames: frames.map(function (i) { return { key: key, frame: meta.frames[i].name }; }),
        // 出招片段按 36 fps 播，约 0.55 秒；其余按素材帧率
        frameRate: name === 'attack' ? 36 : (meta.fps || 24),
        repeat: name === 'standby' ? -1 : 0
      });
    });
  }

  /** 把某只精灵切到帧动画；同一 id 可能同时出现在两侧 */
  function attachSideAnim(side, id) {
    var scene = S.scene;
    var key = 'anim-' + id;
    var meta = scene && scene.cache.json.get(key + '-meta');
    if (!meta || !meta.anims.standby || !scene.textures.exists(key)) return false;
    var sp = side === 'me' ? scene.meSprite : scene.foeSprite;
    if (!sp || sp.getData('anim') === id) return true;
    sp.setData('anim', id);
    sp.setTexture(key, meta.frames[meta.anims.standby[0]].name);
    sp.baseScale = Math.min(1, (scene.scale.height * 0.78) / (meta.frameSize || 512));
    sp.setScale(sp.baseScale);
    sp.setVisible(true);
    sp.play(key + '-standby');
    var atk = scene.anims.get(key + '-attack');
    S.animBySide[side] = {
      key: key, id: id, frames: meta.frames.length, anims: Object.keys(meta.anims),
      playing: key + '-standby',
      attackFrames: atk ? atk.getTotalFrames() : 0,
      attackMs: atk ? Math.round((atk.getTotalFrames() / 36) * 1000) : 0
    };
    sp.on('animationcomplete', function (anim) {
      if (anim && anim.key !== key + '-standby') sp.play(key + '-standby');
      if (S.animBySide[side]) S.animBySide[side].playing = key + '-standby';
    });
    return true;
  }

  function playOnce(side, name) {
    var info = S.animBySide[side];
    if (!info || !S.scene || !S.scene.anims.exists(info.key + '-' + name)) return false;
    if (S.plays[name] != null) S.plays[name]++;
    var sp = side === 'me' ? S.scene.meSprite : S.scene.foeSprite;
    sp.play(info.key + '-' + name);
    info.playing = info.key + '-' + name;
    return true;
  }

  function mount(hostEl) {
    if (!enabled()) return false;
    if (S.wrap && S.wrap.parentNode) return true;
    S.host = hostEl;
    var wrap = document.createElement('div');
    wrap.className = 'phaser-wrap';
    hostEl.appendChild(wrap);
    hostEl.classList.add('phaser-on'); // 见 style.css：隐藏 DOM 立绘，避免两层重复
    S.wrap = wrap;
    loadLib().then(function (ok) {
      if (!ok) { S.mode = 'none'; return; }
      initGame(root.Phaser);
      if (S.pending) { render(S.pending); S.pending = null; }
    });
    return true;
  }

  var queued = {};

  /** 贴图键直接用 URL，存在即复用 */
  function applyArt() {
    var scene = S.scene;
    if (!scene || !scene.textures) return;
    if (S.artBySide.me && scene.textures.exists(S.artBySide.me)) {
      scene.meSprite.setTexture(S.artBySide.me).setVisible(true);
      scene.loaded[S.artBySide.me] = true;
      idleLoop('me');
    }
    if (S.artBySide.foe && scene.textures.exists(S.artBySide.foe)) {
      scene.foeSprite.setTexture(S.artBySide.foe).setVisible(true);
      scene.loaded[S.artBySide.foe] = true;
      idleLoop('foe');
    }
  }

  function setTexture(side, url) {
    var scene = S.scene;
    if (!scene || !url || !scene.textures) return;
    S.artBySide[side] = url;
    if (scene.textures.exists(url)) { applyArt(); return; }
    if (queued[url]) return;
    queued[url] = true;
    scene.load.image(url, url);
    scene.load.once('complete', function () { queued[url] = false; applyArt(); });
    scene.load.start();
  }

  function popDamage(side, amount, strong) {
    var scene = S.scene;
    if (!scene) return;
    var base = side === 'me' ? scene.meSprite : scene.foeSprite;
    if (!base || !base.visible) return;
    var t = scene.add.text(base.x, base.y - 60, String(amount), {
      fontFamily: 'sans-serif', fontSize: strong ? '40px' : '28px', fontStyle: 'bold',
      color: strong ? '#ff5a68' : '#ffd166', stroke: '#10141f', strokeThickness: 5
    }).setOrigin(0.5);
    scene.tweens.add({ targets: t, y: t.y - 46, alpha: 0, duration: 900, onComplete: function () { t.destroy(); } });
  }

  /** 待机呼吸：轻微缩放浮动，避免画面完全静止 */
  function idleLoop(side) {
    var scene = S.scene;
    if (!scene) return;
    var sp = side === 'me' ? scene.meSprite : scene.foeSprite;
    if (!sp || sp.getData && sp.getData('idle')) return;
    if (sp.setData) sp.setData('idle', true);
    var base = sp.baseScale || 1;
    sp.setScale(base);
    scene.tweens.add({
      targets: sp, scaleX: base * 0.985, scaleY: base * 1.015, duration: 1100 + (side === 'me' ? 0 : 140),
      yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
    });
  }

  /** 出招：向对手方向冲刺一下再回来（网格动作未接入前的动作反馈） */
  function lunge(side) {
    var scene = S.scene;
    if (!scene) return;
    var sp = side === 'me' ? scene.meSprite : scene.foeSprite;
    if (!sp || !sp.visible) return;
    var x0 = sp.x;
    var dir = side === 'me' ? 1 : -1;
    scene.tweens.add({
      targets: sp, x: x0 + dir * 46, duration: 110, yoyo: true, hold: 60, ease: 'Quad.easeOut',
      onComplete: function () { sp.x = x0; }
    });
  }

  function shake(side) {
    var scene = S.scene;
    if (!scene) return;
    var sp = side === 'me' ? scene.meSprite : scene.foeSprite;
    if (!sp || !sp.visible) return;
    var x0 = sp.x;
    scene.tweens.add({ targets: sp, x: x0 + 8, duration: 60, yoyo: true, repeat: 3, onComplete: function () { sp.x = x0; } });
  }

  var prev = null;

  function render(view) {
    S.last = view;
    if (!active()) { S.pending = view; return; }
    var scene = S.scene;
    if (!scene) { S.pending = view; return; }
    var v = view || {};
    if (v.me && v.me.id != null) {
      if (bakedFor(v.me.id)) ensureSideAnim('me', v.me.id); else setTexture('me', artUrl(v.me.id));
    }
    if (v.foe && v.foe.id != null) {
      if (bakedFor(v.foe.id)) ensureSideAnim('foe', v.foe.id); else setTexture('foe', artUrl(v.foe.id));
    }
    if (prev) {
      ['me', 'foe'].forEach(function (who) {
        var now = v[who] || {};
        var was = prev[who] || {};
        var dmg = (was.hp || 0) - (now.hp || 0);
        if (dmg > 0) {
          var strong = dmg > (now.maxHp || 1) * 0.22;
          if (who === 'foe') {
            // 对手掉血 = 我方出招：先播动作，伤害数字/抖动延到命中时刻
            if (playOnce('me', 'attack')) {
              var ms = (S.animBySide.me && S.animBySide.me.attackMs) || 0;
              if (ms > 0) scene.time.delayedCall(ms * 0.85, function () { popDamage('foe', dmg, strong); shake('foe'); });
              else { popDamage('foe', dmg, strong); shake('foe'); }
            } else {
              popDamage('foe', dmg, strong); shake('foe'); lunge('me');
            }
          } else {
            popDamage(who, dmg, strong);
            shake(who);
            if (!playOnce(who, 'hited')) lunge('foe');
          }
        }
      });
    }
    prev = {
      me: { hp: v.me ? v.me.hp : 0, maxHp: v.me ? v.me.maxHp : 0 },
      foe: { hp: v.foe ? v.foe.hp : 0, maxHp: v.foe ? v.foe.maxHp : 0 }
    };
  }

  function reset() {
    prev = null;
    var scene = S.scene;
    if (!scene) return;
    queued = {};
    [scene.meSprite, scene.foeSprite].forEach(function (sp) {
      if (!sp) return;
      sp.setPosition(sp.x, sp.y);
      sp.setVisible(false);
    });
    S.artBySide = { me: '', foe: '' };
    S.animBySide = { me: null, foe: null };
    [scene.meSprite, scene.foeSprite].forEach(function (sp) { if (sp && sp.setData) sp.setData('anim', null); });
    S.plays = { attack: 0, hited: 0 };
  }

  function destroy() {
    if (S.game && S.game.destroy) { try { S.game.destroy(true); } catch (e) { /* ignore */ } }
    S.game = null; S.scene = null; prev = null; S.artBySide = { me: '', foe: '' };
    S.animBySide = { me: null, foe: null }; S.animIndex = null; S.mode = 'none';
    if (S.wrap && S.wrap.parentNode) S.wrap.parentNode.removeChild(S.wrap);
    S.wrap = null;
  }

  function debugPixels() {
    var scene = S.scene;
    var cv = S.wrap ? S.wrap.querySelector('canvas') : null;
    return {
      mode: S.mode,
      scene: !!S.scene,
      pending: !!S.pending,
      phaserGlobal: !!root.Phaser,
      canvas: S.wrap ? S.wrap.querySelectorAll('canvas').length : 0,
      w: cv ? cv.width : 0,
      h: cv ? cv.height : 0,
      loaded: scene ? Object.keys(scene.loaded || {}).length : 0,
      animIndex: S.animIndex ? Object.keys(S.animIndex.pets || {}).length : 0,
      hash: String(root.location && root.location.hash),
      errors: (S.errors || []).slice(0, 3),
      art: S.artBySide,
      tweens: scene && scene.tweens ? scene.tweens.getTweens().length : 0,
      anim: { me: S.animBySide.me, foe: S.animBySide.foe },
      plays: S.plays,
      me: !!(scene && scene.meSprite && scene.meSprite.visible && scene.meSprite.texture && scene.meSprite.texture.key !== '__WHITE'),
      foe: !!(scene && scene.foeSprite && scene.foeSprite.visible && scene.foeSprite.texture && scene.foeSprite.texture.key !== '__WHITE'),
      art: (scene && scene.meSprite && scene.meSprite.visible ? 1 : 0) + (scene && scene.foeSprite && scene.foeSprite.visible ? 1 : 0)
    };
  }

  root.SeerPhaserStage = {
    enabled: enabled,
    active: active,
    mount: mount,
    render: render,
    reset: reset,
    destroy: destroy,
    debugPixels: debugPixels,
    artUrl: artUrl
  };
})(typeof self !== 'undefined' ? self : this);
