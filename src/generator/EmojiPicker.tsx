import { EMOJIS } from '../lib/emojis';

interface Props {
  selected: string[];
  onChange: (next: string[]) => void;
}

const LABEL_OF = new Map(EMOJIS.map((e) => [e.emoji, e.label]));

/** Selected-emoji chip list + clickable grid of all supported emojis. */
export function EmojiPicker({ selected, onChange }: Props) {
  const toggle = (emoji: string) => {
    onChange(
      selected.includes(emoji)
        ? selected.filter((e) => e !== emoji)
        : [...selected, emoji],
    );
  };

  return (
    <div className="emoji-picker">
      <div className="emoji-selected">
        {selected.length === 0 ? (
          <span className="emoji-empty">未選択（下のリストから追加）</span>
        ) : (
          selected.map((emoji) => (
            <button
              type="button"
              key={emoji}
              className="chip"
              title={`${LABEL_OF.get(emoji) ?? ''} — クリックで削除`}
              onClick={() => toggle(emoji)}
            >
              <span className="emoji-char">{emoji}</span>
              <span className="chip-x">×</span>
            </button>
          ))
        )}
      </div>

      <div className="emoji-actions">
        <button type="button" onClick={() => onChange(EMOJIS.map((e) => e.emoji))}>
          全選択
        </button>
        <button type="button" onClick={() => onChange([])}>
          全解除
        </button>
        <span className="emoji-count">{selected.length} / {EMOJIS.length}</span>
      </div>

      <div className="emoji-grid">
        {EMOJIS.map(({ emoji, label }) => (
          <button
            type="button"
            key={emoji}
            className={`emoji-cell ${selected.includes(emoji) ? 'on' : ''}`}
            title={label}
            onClick={() => toggle(emoji)}
          >
            <span className="emoji-char">{emoji}</span>
            <span className="emoji-label">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
