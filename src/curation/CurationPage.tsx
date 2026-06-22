import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AudioItem, Rating } from '../types';
import { supportsFileSystemAccess, useDirectoryScan } from './useDirectoryScan';
import { AudioPlayer } from './AudioPlayer';
import { transferRated, writeRating } from './fsActions';
import { AnalysisView } from './AnalysisView';

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? '—' : String(n));

/** Directory portion of a relative path ('(ルート)' for top-level files). */
const dirOf = (relPath: string) =>
  relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '(ルート)';

const ROW_H = 30; // px per row, must match .grid td height for virtualization
const OVERSCAN = 8;
const RATE_LABEL: Record<number, string> = { 1: '✕', 2: '△', 3: '◎' };
const RATE_NAME: Record<number, string> = { 1: '不可', 2: '普', 3: '良' };

/** Playback / evaluation preferences (persisted to localStorage). */
interface Prefs {
  autoAdvance: boolean;
  advanceDelay: number;
  randomMode: boolean;
  loopUntilRated: boolean;
  autoSkipQuiet: boolean;
  quietThresh: number;
  wheelRate: boolean;
  defaultOkOnPass: boolean;
  skipRated: boolean;
  mode: 'copy' | 'move';
  minRating: number;
}
const DEFAULT_PREFS: Prefs = {
  autoAdvance: true,
  advanceDelay: 10,
  randomMode: false,
  loopUntilRated: false,
  autoSkipQuiet: false,
  quietThresh: 0.02,
  wheelRate: true,
  defaultOkOnPass: true,
  skipRated: false,
  mode: 'copy',
  minRating: 3,
};
const PREFS_KEY = 'irodori-tts-curation-prefs-v1';
function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    /* ignore */
  }
  return DEFAULT_PREFS;
}

export function CurationPage() {
  const { root, items, scanning, loadingMeta, error, pick, setItems } = useDirectoryScan();
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const p = (patch: Partial<Prefs>) => setPrefs((s) => ({ ...s, ...patch }));

  const [selected, setSelected] = useState(0);
  const [filter, setFilter] = useState('');
  const [view, setView] = useState<'list' | 'analysis'>('list');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [folderSel, setFolderSel] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(600);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const playerWrapRef = useRef<HTMLDivElement | null>(null);
  const advanceTimer = useRef<number | null>(null);
  const currentRef = useRef<AudioItem | null>(null);
  const itemsRef = useRef<AudioItem[]>(items);
  const lastWheel = useRef<{ id: string | null; r: Rating }>({ id: null, r: 0 });

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* ignore */
    }
  }, [prefs]);

  const folders = useMemo(() => {
    const map = new Map<string, number>();
    for (const it of items) {
      const d = dirOf(it.relPath);
      map.set(d, (map.get(d) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [items]);

  const effFolder = folderSel && folders.some(([d]) => d === folderSel) ? folderSel : null;

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return items.filter((it) => {
      if (effFolder && dirOf(it.relPath) !== effFolder) return false;
      if (!q) return true;
      return it.relPath.toLowerCase().includes(q) || (it.meta?.text ?? '').toLowerCase().includes(q);
    });
  }, [items, filter, effFolder]);

  const clampSel = useCallback(
    (i: number) => Math.max(0, Math.min(i, filtered.length - 1)),
    [filtered.length],
  );

  const selIndex = Math.min(selected, Math.max(0, filtered.length - 1));
  const current: AudioItem | null = filtered[selIndex] ?? null;
  const transferCount = items.filter((it) => it.rating >= prefs.minRating && it.rating > 0).length;

  useEffect(() => {
    currentRef.current = current;
  }, [current]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // ---- Virtualized window. ----
  const maxScroll = Math.max(0, filtered.length * ROW_H - viewH);
  const stp = Math.min(scrollTop, maxScroll);
  const vStart = Math.max(0, Math.floor(stp / ROW_H) - OVERSCAN);
  const vEnd = Math.min(filtered.length, Math.ceil((stp + viewH) / ROW_H) + OVERSCAN);
  const visible = filtered.slice(vStart, vEnd);
  const topPad = vStart * ROW_H;
  const bottomPad = Math.max(0, (filtered.length - vEnd) * ROW_H);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [view]);

  useEffect(() => {
    if (wrapRef.current) wrapRef.current.scrollTop = 0;
  }, [filter, effFolder]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const top = selIndex * ROW_H;
    const bottom = top + ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
  }, [selIndex]);

  // Set a rating (no auto-advance) and persist it to the sidecar JSON.
  const setRating = useCallback(
    (item: AudioItem | null, r: Rating) => {
      if (!item) return;
      setItems((arr) => arr.map((it) => (it.id === item.id ? { ...it, rating: r } : it)));
      void writeRating(item, r);
    },
    [setItems],
  );

  // Advance, optionally skipping already-rated items.
  const goNext = useCallback(() => {
    setSelected((s) => {
      const arr = filtered;
      const n = arr.length;
      if (n === 0) return 0;
      const cur = Math.min(s, n - 1);
      if (prefs.skipRated) {
        const unrated = arr.map((it, i) => (it.rating === 0 && i !== cur ? i : -1)).filter((i) => i >= 0);
        if (unrated.length === 0) return cur;
        if (prefs.randomMode) return unrated[Math.floor(Math.random() * unrated.length)];
        const fwd = unrated.find((i) => i > cur);
        return fwd !== undefined ? fwd : cur;
      }
      if (n <= 1) return cur;
      if (prefs.randomMode) {
        let r = cur;
        while (r === cur) r = Math.floor(Math.random() * n);
        return r;
      }
      return Math.min(cur + 1, n - 1);
    });
  }, [filtered, prefs.skipRated, prefs.randomMode]);

  const pickFolder = (dir: string | null) => {
    setFolderSel(dir);
    setSelected(0);
  };

  const openFolder = async () => {
    setFolderSel(null);
    await pick();
    setSelected(0);
  };

  // Auto-advance after a grace delay; an untouched clip auto-gets 普(2).
  const handleEnded = useCallback(() => {
    if (!prefs.autoAdvance) return;
    const id = currentRef.current?.id ?? null;
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    advanceTimer.current = window.setTimeout(
      () => {
        if (currentRef.current?.id !== id) return; // user navigated away
        const live = itemsRef.current.find((it) => it.id === id);
        if (prefs.defaultOkOnPass && live && live.rating === 0) setRating(live, 2);
        goNext();
      },
      Math.max(0, prefs.advanceDelay) * 1000,
    );
  }, [prefs.autoAdvance, prefs.advanceDelay, prefs.defaultOkOnPass, goNext, setRating]);

  useEffect(
    () => () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    },
    [],
  );

  // Skip clips quieter than the threshold (failed/silent generations).
  const handlePeak = useCallback(
    (peak: number) => {
      if (prefs.autoSkipQuiet && peak < prefs.quietThresh) goNext();
    },
    [prefs.autoSkipQuiet, prefs.quietThresh, goNext],
  );

  // Wheel-to-rate over the player: up = 良(3), down = 不可(1). Works even when
  // another app is focused, as long as the browser window is hovered.
  useEffect(() => {
    const el = playerWrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!prefs.wheelRate) return;
      e.preventDefault();
      const cur = currentRef.current;
      if (!cur) return;
      const r: Rating = e.deltaY < 0 ? 3 : 1;
      if (lastWheel.current.id === cur.id && lastWheel.current.r === r) return; // dedupe burst
      lastWheel.current = { id: cur.id, r };
      setRating(cur, r);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [prefs.wheelRate, setRating]);

  const playById = useCallback((id: string) => {
    setView('list');
    setFilter('');
    setFolderSel(null);
    const idx = itemsRef.current.findIndex((it) => it.id === id);
    if (idx >= 0) setSelected(idx);
  }, []);

  // Keyboard: 1/2/3 rate, 0 clears (rating never auto-advances).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          if (audioRef.current) {
            if (audioRef.current.paused) audioRef.current.play().catch(() => {});
            else audioRef.current.pause();
          }
          break;
        case 'ArrowDown':
          e.preventDefault();
          setSelected((s) => clampSel(s + 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelected((s) => clampSel(s - 1));
          break;
        case '1':
          setRating(current, 1);
          break;
        case '2':
          setRating(current, 2);
          break;
        case '3':
          setRating(current, 3);
          break;
        case '0':
        case 'Backspace':
          setRating(current, 0);
          break;
        case 'Enter':
          goNext();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, clampSel, setRating, goNext]);

  // MediaSession: background control via media keys.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (action: MediaSessionAction, fn: (() => void) | null) => {
      try {
        ms.setActionHandler(action, fn);
      } catch {
        /* unsupported */
      }
    };
    set('play', () => audioRef.current?.play().catch(() => {}));
    set('pause', () => audioRef.current?.pause());
    set('previoustrack', () => setSelected((s) => clampSel(s - 1)));
    set('nexttrack', () => goNext());
    set('seekforward', () => setRating(currentRef.current, 3));
    set('seekbackward', () => setRating(currentRef.current, 1));
    return () => {
      (['play', 'pause', 'previoustrack', 'nexttrack', 'seekforward', 'seekbackward'] as const).forEach(
        (a) => set(a, null),
      );
    };
  }, [clampSel, setRating, goNext]);

  useEffect(() => {
    if (!('mediaSession' in navigator) || !current) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: current.meta?.text || current.name,
        artist: dirOf(current.relPath),
        album: 'Irodori-TTS 厳選',
      });
    } catch {
      /* unsupported */
    }
  }, [current]);

  const doTransfer = async () => {
    if (!root) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await transferRated(root, items, prefs.minRating, prefs.mode);
      setResult(
        `${prefs.mode === 'move' ? '移動' : 'コピー'} ${r.moved} 件完了` +
          (r.errors.length ? ` / エラー ${r.errors.length} 件` : ''),
      );
      if (prefs.mode === 'move' && r.moved > 0) {
        setItems((arr) => arr.filter((it) => !(it.rating >= prefs.minRating && it.rating > 0)));
        setSelected((s) => clampSel(s));
      }
    } catch (e) {
      setResult(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!supportsFileSystemAccess()) {
    return (
      <div className="page curation">
        <p className="warn">
          このブラウザは File System Access API に未対応です。Chrome または Edge で開いてください。
        </p>
      </div>
    );
  }

  return (
    <div className="page curation">
      <div className="toolbar">
        <button className="primary" onClick={openFolder}>
          フォルダを開く
        </button>
        <div className="tabs small">
          <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>
            リスト
          </button>
          <button className={view === 'analysis' ? 'active' : ''} onClick={() => setView('analysis')}>
            分析
          </button>
        </div>
        <input
          className="filter"
          placeholder="テキスト/パスで絞り込み"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setSelected(0);
          }}
        />
        <span className="grow" />
        <select value={prefs.minRating} onChange={(e) => p({ minRating: Number(e.target.value) })}>
          <option value={3}>良のみ</option>
          <option value={2}>普以上</option>
          <option value={1}>評価済すべて</option>
        </select>
        <select value={prefs.mode} onChange={(e) => p({ mode: e.target.value as 'copy' | 'move' })}>
          <option value="copy">selected/ へコピー</option>
          <option value="move">selected/ へ移動</option>
        </select>
        <button disabled={!root || transferCount === 0 || busy} onClick={doTransfer}>
          {transferCount} 件を実行
        </button>
      </div>

      <details className="cura-settings" open>
        <summary>再生・評価 設定</summary>
        <div className="cura-settings-body">
          <label className="checkbox">
            <input type="checkbox" checked={prefs.autoAdvance} onChange={(e) => p({ autoAdvance: e.target.checked })} />
            自動送り
          </label>
          {prefs.autoAdvance && (
            <label className="checkbox" title="再生終了から次へ進むまでの猶予">
              猶予
              <input
                type="number"
                className="thresh"
                min={0}
                max={60}
                step={1}
                value={prefs.advanceDelay}
                onChange={(e) => p({ advanceDelay: Math.max(0, Number(e.target.value)) })}
              />
              秒
            </label>
          )}
          <label className="checkbox">
            <input type="checkbox" checked={prefs.randomMode} onChange={(e) => p({ randomMode: e.target.checked })} />
            ランダム
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={prefs.skipRated} onChange={(e) => p({ skipRated: e.target.checked })} />
            評価済みをスキップ
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={prefs.loopUntilRated} onChange={(e) => p({ loopUntilRated: e.target.checked })} />
            評価までループ
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={prefs.wheelRate} onChange={(e) => p({ wheelRate: e.target.checked })} />
            スクロールで評価
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={prefs.defaultOkOnPass} onChange={(e) => p({ defaultOkOnPass: e.target.checked })} />
            無操作は自動で普
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={prefs.autoSkipQuiet} onChange={(e) => p({ autoSkipQuiet: e.target.checked })} />
            無音スキップ
          </label>
          {prefs.autoSkipQuiet && (
            <input
              type="number"
              className="thresh"
              min={0}
              max={0.5}
              step={0.005}
              value={prefs.quietThresh}
              title="この振幅未満を無音として次へ"
              onChange={(e) => p({ quietThresh: Number(e.target.value) })}
            />
          )}
        </div>
      </details>

      {error && <p className="warn">{error}</p>}
      {result && <p className="info">{result}</p>}
      {scanning && <p className="info">走査中…</p>}
      {root && !scanning && (
        <p className="info">
          {filtered.length} / {items.length} 件
          {loadingMeta > 0 && `（パラメータ読込中… 残り ${loadingMeta}）`}
        </p>
      )}

      <div className="player-wrap" ref={playerWrapRef}>
        <AudioPlayer
          item={current}
          autoPlay={prefs.autoAdvance}
          loop={prefs.loopUntilRated && !!current && current.rating === 0}
          onEnded={handleEnded}
          onPeak={handlePeak}
          audioRef={audioRef}
        />
      </div>

      {view === 'analysis' ? (
        <AnalysisView items={items} onPlay={playById} />
      ) : (
        <div className="curation-body">
          {folders.length > 0 && (
            <aside className="folder-panel">
              <button
                className={`folder-item ${effFolder === null ? 'on' : ''}`}
                onClick={() => pickFolder(null)}
              >
                <span className="folder-name">すべて</span>
                <span className="folder-count">{items.length}</span>
              </button>
              {folders.map(([dir, count]) => (
                <button
                  key={dir}
                  className={`folder-item ${effFolder === dir ? 'on' : ''}`}
                  title={dir}
                  onClick={() => pickFolder(dir)}
                >
                  <span className="folder-name">📁 {dir.split('/').pop()}</span>
                  <span className="folder-count">{count}</span>
                </button>
              ))}
            </aside>
          )}

          <div className="table-wrap" ref={wrapRef} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
            <table className="grid">
              <thead>
                <tr>
                  <th>評価</th>
                  <th>#</th>
                  <th>テキスト</th>
                  <th>絵文字</th>
                  <th>seed</th>
                  <th>steps</th>
                  <th>cfg-T</th>
                  <th>cfg-C</th>
                  <th>cfg-S</th>
                  <th>dur</th>
                  <th>sway</th>
                  <th>trunc</th>
                  <th>ref</th>
                </tr>
              </thead>
              <tbody>
                {topPad > 0 && <tr style={{ height: topPad }} aria-hidden />}
                {visible.map((it, vi) => {
                  const i = vStart + vi;
                  return (
                    <tr
                      key={it.id}
                      className={`${i === selIndex ? 'sel' : ''} r${it.rating}`}
                      onClick={() => setSelected(i)}
                    >
                      <td className="rate">
                        {[1, 2, 3].map((v) => (
                          <button
                            key={v}
                            className={`mini rate${v} ${it.rating === v ? 'on' : ''}`}
                            title={RATE_NAME[v]}
                            onClick={(e) => {
                              e.stopPropagation();
                              setRating(it, (it.rating === v ? 0 : v) as Rating);
                            }}
                          >
                            {RATE_LABEL[v]}
                          </button>
                        ))}
                      </td>
                      <td className="num">{fmt(it.meta?.index)}</td>
                      <td className="text" title={it.meta?.text ?? ''}>{it.meta?.text ?? '—'}</td>
                      <td>{it.meta?.emoji ?? '—'}</td>
                      <td className="num">{fmt(it.meta?.seed)}</td>
                      <td className="num">{fmt(it.meta?.numSteps)}</td>
                      <td className="num">{fmt(it.meta?.cfgScaleText)}</td>
                      <td className="num">{fmt(it.meta?.cfgScaleCaption)}</td>
                      <td className="num">{fmt(it.meta?.cfgScaleSpeaker)}</td>
                      <td className="num">{fmt(it.meta?.durationScale)}</td>
                      <td className="num">{fmt(it.meta?.swayCoeff)}</td>
                      <td className="num">{fmt(it.meta?.truncationFactor)}</td>
                      <td className="ref" title={it.meta?.refWav ?? ''}>
                        {it.meta?.refWav ? it.meta.refWav.split(/[/\\]/).pop() : it.meta?.refMode === 'no-ref' ? 'no-ref' : '—'}
                      </td>
                    </tr>
                  );
                })}
                {bottomPad > 0 && <tr style={{ height: bottomPad }} aria-hidden />}
              </tbody>
            </table>
            {root && !scanning && filtered.length === 0 && (
              <p className="info">wav が見つかりませんでした。</p>
            )}
          </div>
        </div>
      )}

      <p className="hint">
        ショートカット: Space=再生/停止 · ↑↓=移動 · 1=不可 / 2=普 / 3=良 · 0=クリア · Enter=次 ·
        プレイヤー上でホイール上=良 / 下=不可
        <br />
        バックグラウンド（メディアキー/イヤホン）: ⏯=再生停止 · ⏮⏭=前/次 · 早送り=良・巻戻し=不可
      </p>
    </div>
  );
}
