import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AudioItem } from '../types';
import { supportsFileSystemAccess, useDirectoryScan } from './useDirectoryScan';
import { AudioPlayer } from './AudioPlayer';
import { transferKept } from './fsActions';

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? '—' : String(n));

export function CurationPage() {
  const { root, items, scanning, error, pick, setItems } = useDirectoryScan();
  const [selected, setSelected] = useState(0);
  const [autoPlay, setAutoPlay] = useState(true);
  const [filter, setFilter] = useState('');
  const [mode, setMode] = useState<'copy' | 'move'>('copy');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) =>
        it.relPath.toLowerCase().includes(q) ||
        (it.meta?.text ?? '').toLowerCase().includes(q),
    );
  }, [items, filter]);

  const clampSel = useCallback(
    (i: number) => Math.max(0, Math.min(i, filtered.length - 1)),
    [filtered.length],
  );

  const current: AudioItem | null = filtered[selected] ?? null;
  const keptCount = items.filter((it) => it.status === 'keep').length;

  const setStatus = useCallback(
    (item: AudioItem | null, status: AudioItem['status']) => {
      if (!item) return;
      setItems((arr) => arr.map((it) => (it.id === item.id ? { ...it, status } : it)));
    },
    [setItems],
  );

  const goNext = useCallback(() => setSelected((s) => clampSel(s + 1)), [clampSel]);

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
          onChange={(e) => setFilter(e.target.value)}
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

      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>状態</th>
              <th>パス</th>
              <th>テキスト</th>
              <th>絵文字</th>
              <th>seed</th>
              <th>steps</th>
              <th>cfg-text</th>
              <th>dur</th>
              <th>ref</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((it, i) => (
              <tr
                key={it.id}
                className={`${i === selected ? 'sel' : ''} ${it.status}`}
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
                <td className="path">{it.relPath}</td>
                <td className="text">{it.meta?.text ?? '—'}</td>
                <td>{it.meta?.emoji ?? '—'}</td>
                <td>{fmt(it.meta?.seed)}</td>
                <td>{fmt(it.meta?.numSteps)}</td>
                <td>{fmt(it.meta?.cfgScaleText)}</td>
                <td>{fmt(it.meta?.durationScale)}</td>
                <td className="ref" title={it.meta?.refWav ?? ''}>
                  {it.meta?.refWav ? it.meta.refWav.split(/[/\\]/).pop() : it.meta?.refMode === 'no-ref' ? 'no-ref' : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {root && !scanning && filtered.length === 0 && (
          <p className="info">wav が見つかりませんでした。</p>
        )}
      </div>

      <p className="hint">
        ショートカット: Space=再生/停止 · ↑↓=移動 · K=キープ · X=リジェクト · Enter=次
      </p>
    </div>
  );
}
