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

export function CurationPage() {
  const { root, items, scanning, loadingMeta, error, pick, setItems } = useDirectoryScan();
  const [selected, setSelected] = useState(0);
  const [autoPlay, setAutoPlay] = useState(true);
  const [randomMode, setRandomMode] = useState(false);
  const [loopUntilRated, setLoopUntilRated] = useState(false);
  const [autoSkipQuiet, setAutoSkipQuiet] = useState(false);
  const [quietThresh, setQuietThresh] = useState(0.02);
  const [filter, setFilter] = useState('');
  const [mode, setMode] = useState<'copy' | 'move'>('copy');
  const [minRating, setMinRating] = useState(3);
  const [view, setView] = useState<'list' | 'analysis'>('list');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [folderSel, setFolderSel] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(600);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

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
  const transferCount = items.filter((it) => it.rating >= minRating && it.rating > 0).length;

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

  const goNext = useCallback(() => {
    setSelected((s) => {
      const n = filtered.length;
      if (n <= 1) return Math.min(s, Math.max(0, n - 1));
      if (randomMode) {
        const cur = Math.min(s, n - 1);
        let r = cur;
        while (r === cur) r = Math.floor(Math.random() * n);
        return r;
      }
      return Math.min(s + 1, n - 1);
    });
  }, [filtered.length, randomMode]);

  const pickFolder = (dir: string | null) => {
    setFolderSel(dir);
    setSelected(0);
  };

  const openFolder = async () => {
    setFolderSel(null);
    await pick();
    setSelected(0);
  };

  const handleEnded = useCallback(() => {
    if (autoPlay) goNext();
  }, [autoPlay, goNext]);

  // Skip clips quieter than the threshold (failed/silent generations).
  const handlePeak = useCallback(
    (peak: number) => {
      if (autoSkipQuiet && peak < quietThresh) goNext();
    },
    [autoSkipQuiet, quietThresh, goNext],
  );

  // Jump to an item by id (from the analysis view) and show it in the list.
  const playById = useCallback(
    (id: string) => {
      setView('list');
      setFilter('');
      setFolderSel(null);
      const idx = items.findIndex((it) => it.id === id);
      if (idx >= 0) setSelected(idx);
    },
    [items],
  );

  // Keyboard shortcuts (1/2/3 rate, 0 clears; rating never auto-advances).
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

  // MediaSession: background control via media keys (audio must be playing).
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
    set('nexttrack', () => setSelected((s) => clampSel(s + 1)));
    set('seekforward', () => setRating(current, 3)); // 良
    set('seekbackward', () => setRating(current, 1)); // 不可
    return () => {
      (['play', 'pause', 'previoustrack', 'nexttrack', 'seekforward', 'seekbackward'] as const).forEach(
        (a) => set(a, null),
      );
    };
  }, [current, clampSel, setRating]);

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
      const r = await transferRated(root, items, minRating, mode);
      setResult(
        `${mode === 'move' ? '移動' : 'コピー'} ${r.moved} 件完了` +
          (r.errors.length ? ` / エラー ${r.errors.length} 件` : ''),
      );
      if (mode === 'move' && r.moved > 0) {
        setItems((arr) => arr.filter((it) => !(it.rating >= minRating && it.rating > 0)));
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
        <label className="checkbox">
          <input type="checkbox" checked={autoPlay} onChange={(e) => setAutoPlay(e.target.checked)} />
          自動再生
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={randomMode} onChange={(e) => setRandomMode(e.target.checked)} />
          ランダム
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={loopUntilRated} onChange={(e) => setLoopUntilRated(e.target.checked)} />
          評価までループ
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={autoSkipQuiet} onChange={(e) => setAutoSkipQuiet(e.target.checked)} />
          無音スキップ
        </label>
        {autoSkipQuiet && (
          <input
            type="number"
            className="thresh"
            min={0}
            max={0.5}
            step={0.005}
            value={quietThresh}
            title="この振幅未満を無音として次へ"
            onChange={(e) => setQuietThresh(Number(e.target.value))}
          />
        )}
        <span className="grow" />
        <select value={minRating} onChange={(e) => setMinRating(Number(e.target.value))}>
          <option value={3}>良のみ</option>
          <option value={2}>普以上</option>
          <option value={1}>評価済すべて</option>
        </select>
        <select value={mode} onChange={(e) => setMode(e.target.value as 'copy' | 'move')}>
          <option value="copy">selected/ へコピー</option>
          <option value="move">selected/ へ移動</option>
        </select>
        <button disabled={!root || transferCount === 0 || busy} onClick={doTransfer}>
          {transferCount} 件を実行
        </button>
      </div>

      {error && <p className="warn">{error}</p>}
      {result && <p className="info">{result}</p>}
      {scanning && <p className="info">走査中…</p>}
      {root && !scanning && (
        <p className="info">
          {filtered.length} / {items.length} 件
          {loadingMeta > 0 && `（パラメータ読込中… 残り ${loadingMeta}）`}
        </p>
      )}

      <AudioPlayer
        item={current}
        autoPlay={autoPlay}
        loop={loopUntilRated && !!current && current.rating === 0}
        onEnded={handleEnded}
        onPeak={handlePeak}
        audioRef={audioRef}
      />

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
        ショートカット: Space=再生/停止 · ↑↓=移動 · 1=不可 / 2=普 / 3=良 · 0=クリア · Enter=次
        <br />
        バックグラウンド（メディアキー/イヤホン）: ⏯=再生停止 · ⏮⏭=前/次 · 早送り=良・巻戻し=不可
      </p>
    </div>
  );
}
