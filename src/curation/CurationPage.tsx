import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AudioItem } from '../types';
import { supportsFileSystemAccess, useDirectoryScan } from './useDirectoryScan';
import { AudioPlayer } from './AudioPlayer';
import { transferKept } from './fsActions';

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? '—' : String(n));

/** Directory portion of a relative path ('(ルート)' for top-level files). */
const dirOf = (relPath: string) =>
  relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '(ルート)';

export function CurationPage() {
  const { root, items, scanning, error, pick, setItems } = useDirectoryScan();
  const [selected, setSelected] = useState(0);
  const [autoPlay, setAutoPlay] = useState(true);
  const [filter, setFilter] = useState('');
  const [mode, setMode] = useState<'copy' | 'move'>('copy');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [folderSel, setFolderSel] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Distinct folders (with counts) discovered under the opened root.
  const folders = useMemo(() => {
    const map = new Map<string, number>();
    for (const it of items) {
      const d = dirOf(it.relPath);
      map.set(d, (map.get(d) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [items]);

  // A stale folder selection (e.g. after opening a new root) falls back to all.
  const effFolder = folderSel && folders.some(([d]) => d === folderSel) ? folderSel : null;

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return items.filter((it) => {
      if (effFolder && dirOf(it.relPath) !== effFolder) return false;
      if (!q) return true;
      return (
        it.relPath.toLowerCase().includes(q) ||
        (it.meta?.text ?? '').toLowerCase().includes(q)
      );
    });
  }, [items, filter, effFolder]);

  const clampSel = useCallback(
    (i: number) => Math.max(0, Math.min(i, filtered.length - 1)),
    [filtered.length],
  );

  // Keep the highlighted row in range as the visible set changes.
  const selIndex = Math.min(selected, Math.max(0, filtered.length - 1));
  const current: AudioItem | null = filtered[selIndex] ?? null;
  const keptCount = items.filter((it) => it.status === 'keep').length;

  const setStatus = useCallback(
    (item: AudioItem | null, status: AudioItem['status']) => {
      if (!item) return;
      setItems((arr) => arr.map((it) => (it.id === item.id ? { ...it, status } : it)));
    },
    [setItems],
  );

  const goNext = useCallback(() => setSelected((s) => clampSel(s + 1)), [clampSel]);

  const pickFolder = (dir: string | null) => {
    setFolderSel(dir);
    setSelected(0);
  };

  // Keyboard shortcuts.
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
        case 'k':
        case 'K':
          setStatus(current, 'keep');
          goNext();
          break;
        case 'x':
        case 'X':
          setStatus(current, 'reject');
          goNext();
          break;
        case 'Enter':
          goNext();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, clampSel, setStatus, goNext]);

  const doTransfer = async () => {
    if (!root) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await transferKept(root, items, mode);
      setResult(
        `${mode === 'move' ? '移動' : 'コピー'} ${r.moved} 件完了` +
          (r.errors.length ? ` / エラー ${r.errors.length} 件` : ''),
      );
      if (mode === 'move' && r.moved > 0) {
        // Drop moved items from the list.
        setItems((arr) => arr.filter((it) => it.status !== 'keep'));
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
        <button className="primary" onClick={pick}>
          フォルダを開く
        </button>
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
        <span className="grow" />
        <select value={mode} onChange={(e) => setMode(e.target.value as 'copy' | 'move')}>
          <option value="copy">selected/ へコピー</option>
          <option value="move">selected/ へ移動</option>
        </select>
        <button disabled={!root || keptCount === 0 || busy} onClick={doTransfer}>
          キープ {keptCount} 件を実行
        </button>
      </div>

      {error && <p className="warn">{error}</p>}
      {result && <p className="info">{result}</p>}
      {scanning && <p className="info">走査中…</p>}

      <AudioPlayer item={current} autoPlay={autoPlay} onEnded={goNext} audioRef={audioRef} />

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

        <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>状態</th>
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
            {filtered.map((it, i) => {
              const dir = it.relPath.includes('/')
                ? it.relPath.slice(0, it.relPath.lastIndexOf('/'))
                : '(ルート)';
              const prevDir =
                i > 0 && filtered[i - 1].relPath.includes('/')
                  ? filtered[i - 1].relPath.slice(0, filtered[i - 1].relPath.lastIndexOf('/'))
                  : i > 0
                    ? '(ルート)'
                    : null;
              const showGroup = dir !== prevDir;
              return [
                showGroup && (
                  <tr key={`g-${it.id}`} className="group">
                    <td colSpan={13}>📁 {dir}</td>
                  </tr>
                ),
                (<tr
                key={it.id}
                className={`${i === selIndex ? 'sel' : ''} ${it.status}`}
                onClick={() => setSelected(i)}
              >
                <td>
                  <button
                    className="mini keep"
                    onClick={(e) => {
                      e.stopPropagation();
                      setStatus(it, it.status === 'keep' ? 'none' : 'keep');
                    }}
                  >
                    {it.status === 'keep' ? '★' : '☆'}
                  </button>
                  <button
                    className="mini reject"
                    onClick={(e) => {
                      e.stopPropagation();
                      setStatus(it, it.status === 'reject' ? 'none' : 'reject');
                    }}
                  >
                    ✕
                  </button>
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
              </tr>),
              ];
            })}
          </tbody>
        </table>
        {root && !scanning && filtered.length === 0 && (
          <p className="info">wav が見つかりませんでした。</p>
        )}
        </div>
      </div>

      <p className="hint">
        ショートカット: Space=再生/停止 · ↑↓=移動 · K=キープ · X=リジェクト · Enter=次
      </p>
    </div>
  );
}
