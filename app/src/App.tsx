import { useEffect, useMemo, useRef, useState } from 'react';
import { GameStore, emptyTeam, ACTIVE_SIZE, TEAM_SIZE, type GameState } from './core/store';
import { BattleSession, type BattleAction, type BattleView } from './core/session';
import { createGame } from './game/ArenaScene';
import { loadPack, statsOf, comboNameOf, type Pack, type PackPet } from './data/pack';
import { PetArtCache, type AssetManifest } from './data/assets';

function PetArt({ id, cache }: { id: number; cache: PetArtCache }) {
  const [failed, setFailed] = useState(false);
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let active = true;
    setFailed(false); setUrl(undefined);
    cache.load(id).then((url) => { if (active) setUrl(url); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [id, cache]);
  return failed ? <span className="pet-art missing">暂无立绘</span> :
    url ? <img className="pet-art" src={url} alt="" onError={() => setFailed(true)} /> : <span className="pet-art missing">加载中…</span>;
}

export default function App() {
  const [resources, setResources] = useState<{ pack: Pack; manifest: AssetManifest }>();
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    Promise.all([loadPack(), fetch('/assets-manifest.json', { cache: 'no-cache' }).then((r) => {
      if (!r.ok) throw new Error('立绘清单加载失败');
      return r.json() as Promise<AssetManifest>;
    })]).then(([pack, manifest]) => { if (active) setResources({ pack, manifest }); })
      .catch((e) => { if (active) setError(String(e.message)); });
    return () => { active = false; };
  }, []);
  if (error) return <main className="loading" role="alert">{error}<button onClick={() => location.reload()}>重试</button></main>;
  if (!resources) return <main className="loading">正在加载精灵数据…</main>;
  return <GameApp {...resources} />;
}

function GameApp({ pack, manifest }: { pack: Pack; manifest: AssetManifest }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [store] = useState(() => new GameStore({ turn: 0,
    me: { name: '请选择出战精灵', hp: 0, maxHp: 1 },
    foe: { name: '等待对战', hp: 0, maxHp: 1 }, team: emptyTeam() }));
  const [state, setState] = useState<GameState>(store.get() as GameState);
  const [page, setPage] = useState<'battle' | 'bag'>('bag');
  const [view, setView] = useState<BattleView>();
  const [logs, setLogs] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [session] = useState(() => new BattleSession(pack, store));
  const cache = useMemo(() => new PetArtCache(undefined, manifest), [manifest]);
  useEffect(() => () => cache.reset(), [cache]);

  useEffect(() => {
    if (!hostRef.current) return;
    // StrictMode 会立即重放 effect；下一帧再创建，避免销毁尚未 boot 的 Phaser。
    let game: ReturnType<typeof createGame> | undefined;
    const frame = requestAnimationFrame(() => {
      if (hostRef.current) game = createGame(hostRef.current, store);
    });
    const unsub = store.subscribe((s) => setState({ ...s, me: { ...s.me }, foe: { ...s.foe }, team: [...s.team] }));
    return () => { cancelAnimationFrame(frame); unsub(); game?.destroy(true); };
  }, [store]);

  const filtered = useMemo(() => pack.pets.filter((p) => p.name.includes(query) || String(p.id).includes(query)), [pack, query]);
  const pets = filtered.slice(pageIndex * 60, (pageIndex + 1) * 60);
  const picked = state.team.filter(Boolean).length;
  const locked = !!view && !view.over;
  const active = view?.me.team[view.me.active];
  const pct = (hp: number, max: number) => Math.round((hp / max) * 100);
  function toggle(pet: PackPet) {
    if (locked) return;
    const st = statsOf(pet);
    const ok = store.selectPet({ id: pet.id, name: pet.name, comboName: comboNameOf(pack, pet.type),
      hp: st.hp, maxHp: st.hp, atk: st.atk, spd: st.spd });
    setNotice(ok ? '' : '队伍已满，请先移除一只精灵');
  }
  function start() {
    try { setView(session.start()); setLogs(session.logs()); setPage('battle'); setNotice(''); }
    catch (e) { setNotice((e as Error).message); }
  }
  function act(action: BattleAction) {
    session.settle(action);
    setView(session.snapshot());
    setLogs(session.logs());
  }

  return <div className="app">
    <div className="game-host" ref={hostRef} />
    <div className="overlay">
      <header className="hud">
        <div className="side me"><span className="name">{state.me.name}</span>
          <span className="hp">{state.me.hp}/{state.me.maxHp} {pct(state.me.hp, state.me.maxHp)}%</span></div>
        <div className="turn">第 {state.turn} 回合</div>
        <div className="side foe"><span className="name">{state.foe.name}</span>
          <span className="hp">{state.foe.hp}/{state.foe.maxHp} {pct(state.foe.hp, state.foe.maxHp)}%</span></div>
      </header>

      {page === 'bag' ? <section className="bag" data-testid="bag">
        <div className="bag-head"><b>精灵背包</b><span className="muted">已选 {picked} / {TEAM_SIZE} · 前 {ACTIVE_SIZE} 只出战 · 本地库共 {pack.pets.length} 只</span></div>
        <div className="team-slots">{state.team.map((slot, i) => <button key={i} disabled={locked || !slot}
          onClick={() => slot && store.selectPet(slot)} className={i < ACTIVE_SIZE ? 'active-slot' : ''}>
          {i + 1}. {slot?.name || '空位'}</button>)}</div>
        <div className="bag-search"><input aria-label="搜索精灵" placeholder="名称或编号" value={query}
          onChange={(e) => { setQuery(e.target.value); setPageIndex(0); }} />
          <button disabled={pageIndex === 0} onClick={() => setPageIndex(pageIndex - 1)}>上一页</button>
          <span>{pageIndex + 1} / {Math.max(1, Math.ceil(filtered.length / 60))}</span>
          <button disabled={(pageIndex + 1) * 60 >= filtered.length} onClick={() => setPageIndex(pageIndex + 1)}>下一页</button></div>
        <div className="bag-grid">{pets.map((p) => {
          const st = statsOf(p);
          const isPicked = state.team.some((t) => t?.id === p.id);
          return <button key={p.id} disabled={locked} className={'pet-card' + (isPicked ? ' picked' : '')} onClick={() => toggle(p)}>
            <PetArt id={p.id} cache={cache} /><span className="pet-no">#{p.id}</span>
            <span className="pet-name">{p.name}</span><span className="pet-meta">{comboNameOf(pack, p.type)}</span>
            <span className="pet-stats">HP {st.hp} · 攻 {st.atk} · 速 {st.spd}</span></button>;
        })}</div>
      </section> : <section className="battle-panel">
        {view && <>
          <p role="status">{view.over ? (view.winner === 'me' ? '战斗结束：我方获胜' : view.winner === 'foe' ? '战斗结束：对手获胜' : '战斗结束：平局') : view.needPlayerSwitch ? '请选择下一只出战精灵' : '请选择技能'}</p>
          <div className="skills">{active?.skills.map((skill, i) => <button key={skill.id}
            disabled={view.over || view.needPlayerSwitch || skill.pp <= 0} onClick={() => act({ type: 'skill', index: i })}>
            {skill.name} · PP {skill.pp}/{skill.maxPp}</button>)}
            <button disabled={view.over || view.needPlayerSwitch} onClick={() => act({ type: 'pass' })}>待机</button></div>
          <div className="bench">{view.me.team.map((p, i) => <button key={p.id}
            disabled={view.over || !p.alive || p.exiled || i === view.me.active} onClick={() => act({ type: 'switch', index: i })}>
            {p.name} {p.hp}/{p.maxHp}{p.status ? ' · ' + p.status.name : ''}</button>)}</div>
          <ol className="battle-log" aria-label="战斗记录">{logs.slice(-16).map((text, i) => <li key={i}>{text}</li>)}</ol>
        </>}
      </section>}

      <footer className="actions">
        <button onClick={() => setPage(page === 'bag' ? 'battle' : 'bag')}>{page === 'bag' ? '返回战斗' : '打开背包'}</button>
        <button disabled={locked} onClick={start}>{view?.over ? '再来一局' : '开始对战'}</button>
        <span role="status">{notice || (locked && page === 'bag' ? '对战中无法调整队伍' : '')}</span>
      </footer>
    </div>
  </div>;
}
