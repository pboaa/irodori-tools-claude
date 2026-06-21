import { useState } from 'react';
import { EMOJIS } from '../lib/emojis';
import { makeEntry } from '../lib/defaults';
import type { EmojiEntry } from '../types';

interface Props {
  entries: EmojiEntry[];
  onChange: (next: EmojiEntry[]) => void;
}

const LABEL_OF = new Map(EMOJIS.map((e) => [e.emoji, e.label]));
const COUNT_OPTS = Array.from({ length: 11 }, (_, i) => i); // 0..10
const SYMBOLS = ['♡', '！', '？', '〜', '♪', '…', '、', '。'];

/** One numeric count cell (single value in fixed mode, min-max in range mode). */
function CountCell({
  entry,
  which,
  label,
  onPatch,
}: {
  entry: EmojiEntry;
  which: 'head' | 'tail' | 'rand';
  label: string;
  onPatch: (patch: Partial<EmojiEntry>) => void;
}) {
  const minKey = `${which}Min` as const;
  const maxKey = `${which}Max` as const;
  return (
    <div className="count-cell">
      <span className="count-label">{label}</span>
      {entry.mode === 'fixed' ? (
        <select
          value={entry[minKey]}
          aria-label={`${entry.token} ${label}`}
          onChange={(e) => onPatch({ [minKey]: Number(e.target.value), [maxKey]: Number(e.target.value) })}
        >
          {COUNT_OPTS.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      ) : (
        <span className="count-range">
          <select
            value={entry[minKey]}
            aria-label={`${entry.token} ${label} min`}
            onChange={(e) => onPatch({ [minKey]: Number(e.target.value) })}
          >
            {COUNT_OPTS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <span>〜</span>
          <select
            value={entry[maxKey]}
            aria-label={`${entry.token} ${label} max`}
            onChange={(e) => onPatch({ [maxKey]: Number(e.target.value) })}
          >
            {COUNT_OPTS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </span>
      )}
    </div>
  );
}

/** Editor for per-token emoji/symbol injection rules. */
export function EmojiPicker({ entries, onChange }: Props) {
  const [custom, setCustom] = useState('');

  const add = (token: string) => {
    if (!token) return;
    onChange([...entries, makeEntry(token)]);
  };
  const patch = (id: string, p: Partial<EmojiEntry>) =>
    onChange(entries.map((e) => (e.id === id ? { ...e, ...p } : e)));
  const remove = (id: string) => onChange(entries.filter((e) => e.id !== id));

  return (
    <div className="emoji-editor">
      <div className="entry-list">
        {entries.length === 0 && (
          <div className="emoji-empty">未設定（下のリストや入力欄から追加）</div>
        )}
        {entries.map((e) => (
          <div className="entry" key={e.id}>
            <div className="entry-token" title={LABEL_OF.get(e.token) ?? 'カスタム'}>
              <span className="emoji-char">{e.token}</span>
              <span className="entry-eff">{LABEL_OF.get(e.token) ?? 'カスタム'}</span>
            </div>
            <select
              className="entry-mode"
              value={e.mode}
              onChange={(ev) => patch(e.id, { mode: ev.target.value as EmojiEntry['mode'] })}
            >
              <option value="fixed">固定</option>
              <option value="range">範囲</option>
            </select>
            <CountCell entry={e} which="head" label="文頭" onPatch={(p) => patch(e.id, p)} />
            <CountCell entry={e} which="tail" label="文末" onPatch={(p) => patch(e.id, p)} />
            <CountCell entry={e} which="rand" label="ﾗﾝﾀﾞﾑ位置" onPatch={(p) => patch(e.id, p)} />
            <button className="entry-del" title="削除" onClick={() => remove(e.id)}>
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="symbol-row">
        {SYMBOLS.map((sym) => (
          <button type="button" key={sym} className="symbol-btn" onClick={() => add(sym)}>
            {sym}
          </button>
        ))}
      </div>

      <div className="custom-add">
        <input
          placeholder="任意の記号・文字（♡ ! ? など）"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              add(custom.trim());
              setCustom('');
            }
          }}
        />
        <button
          onClick={() => {
            add(custom.trim());
            setCustom('');
          }}
        >
          追加
        </button>
      </div>

      <p className="param-hint">下の絵文字をクリックで追加（同じ絵文字も複数追加可）。</p>
      <div className="emoji-grid">
        {EMOJIS.map(({ emoji, label }) => (
          <button
            type="button"
            key={emoji}
            className="emoji-cell"
            title={label}
            onClick={() => add(emoji)}
          >
            <span className="emoji-char">{emoji}</span>
            <span className="emoji-label">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
