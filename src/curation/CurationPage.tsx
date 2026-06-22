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
const delayLabel = (s: number) => (s >= 60 && s % 60 === 0 ? `${s / 60}分` : `${s}秒`);
const LOOP_CONFIRM_MS = 1500; // loop mode: settle window after a rating before advancing

/** How playback advances to the next clip. */
type AdvanceMode = 'manual' | 'auto' | 'loop';

/** Playback / evaluation preferences (persisted to localStorage). */
interface Prefs {
  /** manual=自分で送る / auto=間隔で自動送り / loop=評価するまでループ(評価で即次). */
  advanceMode: AdvanceMode;
  advanceDelay: number; // auto: interval seconds
  defaultOkOnPass: boolean; // auto: untouched → 普
  ratingAdvances: boolean; // auto: rating advances immediately (false = 評価しても待機)
  randomMode: boolean;
  autoSkipQuiet: boolean;
  quietThresh: number;
  wheelRate: boolean;
  /** Which ratings are shown/cycled through (0=未,1=不可,2=普,3=良). [] = all. */
  ratingFilter: number[];
  mode: 'copy' | 'move';
  minRating: number;
}
const DEFAULT_PREFS: Prefs = {
  advanceMode: 'auto',
  advanceDelay: 10,
  defaultOkOnPass: true,
  ratingAdvances: false, // 既定: 評価しても待機（即送りしない）
  randomMode: false,
  autoSkipQuiet: false,
  quietThresh: 0.02,
  wheelRate: true,
  ratingFilter: [], // empty = show all; press chips to show only those
  mode: 'copy',
  minRating: 3,
};
const PREFS_KEY = 'irodori-tts-curation-prefs-v1';
function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<Prefs> & { autoAdvance?: boolean; loopUntilRated?: boolean };
      // Migrate old autoAdvance/loopUntilRated → advanceMode.
      if (s.advanceMode === undefined) {
        s.advanceMode = s.loopUntilRated ? 'loop' : s.autoAdvance === false ? 'manual' : 'auto';
      }
      return { ...DEFAULT_PREFS, ...s };
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_PREFS;
}

export function CurationPage() {
  const { root, items, scanning, loadingMeta, error, pick, setItems } = useDirectoryScan();
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const p = (patch: Partial<Prefs>) => setPrefs((s) => ({ ...s, ...patch }));
  const toggleRatingFilter = (v: number) =>
    setPrefs((s) => ({
      ...s,
      ratingFilter: s.ratingFilter.includes(v)
        ? s.ratingFilter.filter((x) => x !== v)
        : [...s.ratingFilter, v].sort(),
    }));

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [view, setView] = useState<'list' | 'analysis'>('list');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [folderSel, setFolderSel] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(600);
  const [waitRemaining, setWaitRemaining] = useState<number | null>(null);
  const [waitingIdSt, setWaitingIdSt] = useState<string | null>(null); // mirror of waitingId for render
  const [windowActive, setWindowActive] = useState(typeof document !== 'undefined' ? document.hasFocus() : true);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const playerWrapRef = useRef<HTMLDivElement | null>(null);
  const advanceTimer = useRef<number | null>(null);
  const waitingId = useRef<string | null>(null);
  const waitUntil = useRef(0);
  const waitStart = useRef(0);
  const currentRef = useRef<AudioItem | null>(null);
  const itemsRef = useRef<AudioItem[]>(items);
  const filteredRef = useRef<AudioItem[]>([]);
  const lastWheel = useRef<{ id: string | null; r: Rating }>({ id: null, r: 0 });
  const wheelCooldown = useRef(0);

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
    const rf = prefs.ratingFilter; // empty = all ratings
    return items.filter((it) => {
      if (effFolder && dirOf(it.relPath) !== effFolder) return false;
      if (rf.length > 0 && !rf.includes(it.rating)) return false;
      if (!q) return true;
      return it.relPath.toLowerCase().includes(q) || (it.meta?.text ?? '').toLowerCase().includes(q);
    });
  }, [items, filter, effFolder, prefs.ratingFilter]);

  // Selection is by item id, so changing folder/rating/text filters keeps the
  // current clip if it's still visible, and never carries a stale index.
  const foundIndex = filtered.findIndex((it) => it.id === selectedId);
  let selIndex = foundIndex >= 0 ? foundIndex : 0;
  let current: AudioItem | null = filtered[selIndex] ?? null;
  // If a rating just removed the current clip from the filter while it's still
  // in its 評価待ち/確定 window, keep it pinned so the wait isn't bypassed.
  if (foundIndex < 0 && selectedId && waitingIdSt === selectedId) {
    const pinned = items.find((it) => it.id === selectedId);
    if (pinned) {
      current = pinned;
      selIndex = -1; // not in the visible list
    }
  }
  const transferCount = items.filter((it) => it.rating >= prefs.minRating && it.rating > 0).length;

  useEffect(() => {
    currentRef.current = current;
  }, [current]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(() => {
    filteredRef.current = filtered;
  }, [filtered]);

  // Cancel a pending 評価待ち when the clip actually changes (not on a rating
  // update, which keeps the same id).
  useEffect(() => {
    if (advanceTimer.current) {
      clearTimeout(advanceTimer.current);
      advanceTimer.current = null;
    }
    waitingId.current = null;
    waitUntil.current = 0; // the countdown interval clears the badge within a tick
  }, [current?.id]);

  // Track window focus (for the "ながら評価" overlay shown while inactive).
  useEffect(() => {
    const on = () => setWindowActive(true);
    const off = () => setWindowActive(false);
    window.addEventListener('focus', on);
    window.addEventListener('blur', off);
    return () => {
      window.removeEventListener('focus', on);
      window.removeEventListener('blur', off);
    };
  }, []);

  // Tick the 評価待ち countdown.
  useEffect(() => {
    const t = window.setInterval(() => {
      setWaitRemaining(waitUntil.current > 0 ? Math.max(0, Math.ceil((waitUntil.current - Date.now()) / 1000)) : null);
    }, 250);
    return () => clearInterval(t);
  }, []);

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
    if (!el || selIndex < 0) return; // pinned item isn't in the list
    const top = selIndex * ROW_H;
    const bottom = top + ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
  }, [selIndex]);

  // Index of the current item within the latest filtered set (via refs).
  const curIndex = () => {
    const arr = filteredRef.current;
    const i = arr.findIndex((it) => it.id === currentRef.current?.id);
    return i >= 0 ? i : 0;
  };

  // Move the selection by a delta (keyboard ↑↓ / media prev).
  const moveBy = useCallback((delta: number) => {
    const arr = filteredRef.current;
    if (arr.length === 0) return;
    const i = Math.max(0, Math.min(curIndex() + delta, arr.length - 1));
    setSelectedId(arr[i].id);
  }, []);

  // Advance within the filtered set (sequential, or random without repeats).
  // If the current clip isn't in the filtered set (pinned/just-rated), start
  // from the first item rather than skipping it.
  const goNext = useCallback(() => {
    const arr = filteredRef.current;
    const n = arr.length;
    if (n === 0) return;
    const i = arr.findIndex((it) => it.id === currentRef.current?.id);
    if (prefs.randomMode) {
      if (n === 1) {
        setSelectedId(arr[0].id);
        return;
      }
      let r = i;
      while (r === i) r = Math.floor(Math.random() * n);
      setSelectedId(arr[r].id);
    } else {
      setSelectedId(arr[i < 0 ? 0 : Math.min(i + 1, n - 1)].id);
    }
  }, [prefs.randomMode]);

  // Stop the 評価待ち window and move on.
  const doAdvance = useCallback(() => {
    if (advanceTimer.current) {
      clearTimeout(advanceTimer.current);
      advanceTimer.current = null;
    }
    waitingId.current = null;
    waitUntil.current = 0;
    setWaitRemaining(null);
    setWaitingIdSt(null);
    goNext();
  }, [goNext]);

  // (Re)arm the auto-mode 評価待ち timer from waitStart with the CURRENT interval,
  // so changing the interval mid-wait updates the remaining time.
  const armWaitTimer = useCallback(
    (id: string) => {
      waitUntil.current = waitStart.current + Math.max(0, prefs.advanceDelay) * 1000;
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
      advanceTimer.current = window.setTimeout(
        () => {
          if (currentRef.current?.id !== id) return;
          const l = itemsRef.current.find((it) => it.id === id);
          if (prefs.defaultOkOnPass && l && l.rating === 0) {
            setItems((arr) => arr.map((it) => (it.id === id ? { ...it, rating: 2 } : it)));
            void writeRating(l, 2);
          }
          doAdvance();
        },
        Math.max(0, waitUntil.current - Date.now()),
      );
    },
    [prefs.advanceDelay, prefs.defaultOkOnPass, doAdvance, setItems],
  );

  // Reschedule a running auto-wait when the interval changes.
  useEffect(() => {
    if (prefs.advanceMode === 'auto' && waitingId.current) armWaitTimer(waitingId.current);
  }, [prefs.advanceMode, armWaitTimer]);

  // Set a rating, persist it, and advance depending on the mode:
  //  - loop: any rating stops playback and goes straight to the next clip.
  //  - auto: a rating during 評価待ち advances (unless 評価しても待機).
  const setRating = useCallback(
    (item: AudioItem | null, r: Rating) => {
      if (!item) return;
      setItems((arr) => arr.map((it) => (it.id === item.id ? { ...it, rating: r } : it)));
      void writeRating(item, r);
      if (prefs.advanceMode === 'loop') {
        // Start (or reset) a short 確定待ち so wheel steps can be adjusted before
        // advancing. Each change resets it; clearing (0) cancels.
        if (advanceTimer.current) {
          clearTimeout(advanceTimer.current);
          advanceTimer.current = null;
        }
        if (r > 0) {
          waitingId.current = item.id;
          waitUntil.current = Date.now() + LOOP_CONFIRM_MS;
          setWaitingIdSt(item.id);
          advanceTimer.current = window.setTimeout(() => {
            audioRef.current?.pause();
            doAdvance();
          }, LOOP_CONFIRM_MS);
        } else {
          waitingId.current = null;
          waitUntil.current = 0;
          setWaitRemaining(null);
          setWaitingIdSt(null);
        }
        return;
      }
      if (r > 0 && prefs.advanceMode === 'auto' && prefs.ratingAdvances && waitingId.current === item.id) {
        doAdvance();
      }
    },
    [setItems, prefs.advanceMode, prefs.ratingAdvances, doAdvance],
  );

  const pickFolder = (dir: string | null) => {
    setFolderSel(dir);
    setSelectedId(null); // start from the first of the chosen folder
  };

  const openFolder = async () => {
    setFolderSel(null);
    setSelectedId(null);
    await pick();
  };

  // On clip end:
  //  - manual: do nothing. loop: <audio loop> handles repeating (this won't fire).
  //  - auto: if already rated → next; else 評価待ち for the interval, then 普(任意)+次.
  const handleEnded = useCallback(() => {
    if (prefs.advanceMode !== 'auto') return;
    const id = currentRef.current?.id ?? null;
    if (!id) return;
    const live = itemsRef.current.find((it) => it.id === id);
    if (live && live.rating > 0 && prefs.ratingAdvances) {
      doAdvance(); // already rated → straight to next
      return;
    }
    if (waitingId.current !== id) {
      waitingId.current = id;
      waitStart.current = Date.now();
      setWaitingIdSt(id);
      armWaitTimer(id);
    }
  }, [prefs.advanceMode, prefs.ratingAdvances, doAdvance, armWaitTimer]);

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

  // Wheel-to-rate: up = 良(3), down = 不可(1).
  // - Window is ACTIVE: only the player area rates (so list/page scroll normally).
  // - Window is INACTIVE (working in another app but hovering the browser): the
  //   WHOLE viewport rates — "ながら評価". `document.hasFocus()` tells them apart.
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!prefs.wheelRate) return;
      const el = playerWrapRef.current;
      const overPlayer = !!el && e.target instanceof Node && el.contains(e.target);
      const wholeScreen = !document.hasFocus();
      if (!wholeScreen && !overPlayer) return; // active + outside player → normal scroll
      e.preventDefault();
      const cur = currentRef.current;
      if (!cur) return;
      // Level-based step: unrated counts as 普(2). up=+1, down=-1, clamped to 1..3.
      // → from 未: up=良 / down=不可; from 良: down=普; from 不可: up=普.
      const level = cur.rating || 2;
      const r = (e.deltaY < 0 ? Math.min(3, level + 1) : Math.max(1, level - 1)) as Rating;
      if (r === cur.rating) return; // no change (already at the end)
      const now = Date.now();
      if (now < wheelCooldown.current) return; // throttle trackpad bursts
      if (lastWheel.current.id === cur.id && lastWheel.current.r === r) return; // dedupe
      wheelCooldown.current = now + 120;
      lastWheel.current = { id: cur.id, r };
      setRating(cur, r);
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, [prefs.wheelRate, setRating]);

  const playById = useCallback((id: string) => {
    setView('list');
    setFilter('');
    setFolderSel(null);
    setSelectedId(id);
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
          moveBy(1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          moveBy(-1);
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
  }, [current, moveBy, setRating, goNext]);

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
    set('previoustrack', () => moveBy(-1));
    set('nexttrack', () => goNext());
    set('seekforward', () => setRating(currentRef.current, 3));
    set('seekbackward', () => setRating(currentRef.current, 1));
    return () => {
      (['play', 'pause', 'previoustrack', 'nexttrack', 'seekforward', 'seekbackward'] as const).forEach(
        (a) => set(a, null),
      );
    };
  }, [moveBy, setRating, goNext]);

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
        // Drop moved items; selection realigns by id (falls to first if removed).
        setItems((arr) => arr.filter((it) => !(it.rating >= prefs.minRating && it.rating > 0)));
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
      {!windowActive && prefs.wheelRate && current && (
        <div className="nagara-overlay">
          <div className="nagara-card">
            <div className="nagara-title">作業中モード</div>
            <div className="nagara-sub">
              ブラウザが非アクティブ（別アプリ作業中）です。この間も<b>ホイールで評価</b>できます。
            </div>
            <div className="nagara-now">
              <span className={`nagara-rate r${current.rating}`}>
                {current.rating === 0 ? '未評価' : RATE_NAME[current.rating]}
              </span>
              <span className="nagara-text">{current.meta?.text ?? current.name}</span>
            </div>
            <div className="nagara-help">
              ホイール: <b>上 = 良</b> / <b>下 = 不可</b>（良→下で普 / 不可→上で普）。何もしなければ <b>普</b> で次へ。
            </div>
            <div className="nagara-modes">
              {prefs.advanceMode === 'auto' && (
                <>
                  自動送り <b>{delayLabel(prefs.advanceDelay)}</b>ごとに次へ
                  {!prefs.ratingAdvances && <> ／ 評価しても<b>待機</b>（テンポ一定）</>}
                </>
              )}
              {prefs.advanceMode === 'loop' && <>評価するまで<b>ループ</b>（評価→約1.5秒で次・その間に修正可）</>}
              {prefs.advanceMode === 'manual' && <>手動送り（自分で次へ）</>}
            </div>
            <div className="nagara-count">
              {prefs.advanceMode === 'loop'
                ? waitRemaining !== null
                  ? `✓ 確定まで ${waitRemaining}s（スクロールで修正可）`
                  : '🔁 評価するまでループ中'
                : waitRemaining !== null
                  ? `⏳ 評価待ち 残り ${waitRemaining}s`
                  : '▶ 再生中…'}
            </div>
          </div>
        </div>
      )}
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
          onChange={(e) => setFilter(e.target.value)}
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
          <div className="opt-group-label">共通（手動操作でも有効）</div>

          <div className="opt opt-wide" title="一覧と送り対象に含める評価を選びます。">
            <div className="opt-head">
              <span className="opt-label">表示する評価</span>
              <span className="rate-filter">
                {([[0, '未'], [1, '不可'], [2, '普'], [3, '良']] as const).map(([v, l]) => (
                  <button
                    key={v}
                    className={`chip-toggle rf${v} ${prefs.ratingFilter.includes(v) ? 'on' : 'off'}`}
                    onClick={() => toggleRatingFilter(v)}
                  >
                    {l}
                  </button>
                ))}
              </span>
            </div>
            <p className="opt-desc">
              押した評価<b>だけ</b>を一覧・再生対象に（何も押さなければ全部）。「良」＝聴き返し、「良＋不可」＝二重チェック、「未」＝未評価のみ。0件なら再生しません。
            </p>
          </div>

          <div className="opt" title="プレイヤー上（非アクティブ時は画面全体）でホイール評価。">
            <label className="checkbox">
              <input type="checkbox" checked={prefs.wheelRate} onChange={(e) => p({ wheelRate: e.target.checked })} />
              スクロールで評価
            </label>
            <p className="opt-desc">
              ホイール 上=良 / 下=不可（良→下で普、不可→上で普）。いつでも有効で、ブラウザが<b>非アクティブになると「作業中モード」</b>になり<b>画面全体</b>で評価できます（別アプリ作業中でもOK・最小化時は不可）。
            </p>
          </div>

          <div className="opt-group-label">
            進み方（流し聞きのテンポ。手動の送り Enter / ↑↓ / クリック には影響しません）
          </div>

          <div className="opt opt-wide" title="次のクリップへ進む方式。">
            <div className="opt-head">
              <span className="opt-label">進み方</span>
              <select
                value={prefs.advanceMode}
                onChange={(e) => p({ advanceMode: e.target.value as AdvanceMode })}
              >
                <option value="manual">手動</option>
                <option value="auto">自動送り（間隔）</option>
                <option value="loop">評価するまでループ</option>
              </select>
              {prefs.advanceMode === 'auto' && (
                <label className="opt-inline">
                  間隔
                  <select value={prefs.advanceDelay} onChange={(e) => p({ advanceDelay: Number(e.target.value) })}>
                    <option value={5}>5秒</option>
                    <option value={10}>10秒</option>
                    <option value={30}>30秒</option>
                    <option value={60}>1分</option>
                    <option value={120}>2分</option>
                    <option value={300}>5分</option>
                  </select>
                </label>
              )}
            </div>
            <p className="opt-desc">
              <b>手動</b>: 自分で送る（再生は1回）。<b>自動送り</b>: 再生終了→間隔をおいて次へ（無評価は普）。
              <b>評価するまでループ</b>: 評価するまで繰り返し再生。<b>評価したら約1.5秒後に次へ</b>（その間にスクロールで修正可）。間隔・自動の普付与なし。
            </p>
          </div>

          <div className={`opt ${prefs.advanceMode === 'auto' ? '' : 'opt-disabled'}`} title="自動送りで評価しても即送りせず間隔まで待つ。">
            <label className="checkbox">
              <input
                type="checkbox"
                disabled={prefs.advanceMode !== 'auto'}
                checked={!prefs.ratingAdvances}
                onChange={(e) => p({ ratingAdvances: !e.target.checked })}
              />
              評価しても待機（自動送り）
            </label>
            <p className="opt-desc">
              自動送りのとき、評価しても即送りせず間隔が来るまで留まります（テンポ一定・進みすぎ防止）。OFFなら評価した瞬間に次へ。
            </p>
          </div>
        </div>

        <details className="cura-advanced">
          <summary>詳細設定（あまり使わない）</summary>
          <div className="cura-settings-body">
            <div className="opt-group-label">自動送りの挙動（進み方＝自動送りのときだけ働きます）</div>

            <div className={`opt ${prefs.advanceMode === 'auto' ? '' : 'opt-disabled'}`} title="間隔が過ぎても未評価なら普(2)を付けて次へ。">
              <label className="checkbox">
                <input
                  type="checkbox"
                  disabled={prefs.advanceMode !== 'auto'}
                  checked={prefs.defaultOkOnPass}
                  onChange={(e) => p({ defaultOkOnPass: e.target.checked })}
                />
                無操作は自動で普
              </label>
              <p className="opt-desc">自動送りの間隔が過ぎても未評価だった音声に、自動で「普(2)」を付けて次へ。良し悪しだけ手で付ければOKに。</p>
            </div>

            <div className="opt-group-label">送り順・その他</div>

            <div className="opt" title="次へ進むとき順番ではなくランダムに選ぶ（手動の次送りにも適用）。">
              <label className="checkbox">
                <input type="checkbox" checked={prefs.randomMode} onChange={(e) => p({ randomMode: e.target.checked })} />
                ランダム順
              </label>
              <p className="opt-desc">「次へ」がランダムな音声になります（同じものは連続しない）。手動の Enter / メディアキー送りにも適用。</p>
            </div>

            <div className="opt" title="音量が小さい（無音/失敗）音声を自動でスキップ。">
              <div className="opt-head">
                <label className="checkbox">
                  <input type="checkbox" checked={prefs.autoSkipQuiet} onChange={(e) => p({ autoSkipQuiet: e.target.checked })} />
                  無音スキップ
                </label>
                {prefs.autoSkipQuiet && (
                  <label className="opt-inline">
                    閾値
                    <input
                      type="number"
                      className="thresh"
                      min={0}
                      max={0.5}
                      step={0.005}
                      value={prefs.quietThresh}
                      onChange={(e) => p({ quietThresh: Number(e.target.value) })}
                    />
                  </label>
                )}
              </div>
              <p className="opt-desc">波形のピークが閾値未満（ほぼ無音＝生成失敗など）の音声を自動でスキップ。閾値が小さいほど厳しめ（既定 0.02）。</p>
            </div>
          </div>
        </details>
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
        {prefs.advanceMode === 'loop' && current ? (
          <div className="wait-badge">
            {waitRemaining !== null ? `✓ 確定まで ${waitRemaining}s（スクロールで修正可）` : '🔁 評価するまでループ'}
          </div>
        ) : (
          waitRemaining !== null && <div className="wait-badge">⏳ 評価待ち 残り {waitRemaining}s</div>
        )}
        <AudioPlayer
          item={current}
          autoPlay={prefs.advanceMode !== 'manual'}
          loop={prefs.advanceMode === 'loop'}
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
                      onClick={() => setSelectedId(it.id)}
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
        ホイール評価: 未→上=良/下=不可、良→下=普、不可→上=普（緑赤から黄に戻せる）。
        <b>非アクティブ時は「作業中モード」になり画面全体</b>で評価可、アクティブ時はプレイヤー上のみ。
        進み方: <b>手動</b>／<b>自動送り</b>（終了→間隔で次・無評価は普）／<b>評価するまでループ</b>（評価で止めて即次へ）。
      </p>
    </div>
  );
}
