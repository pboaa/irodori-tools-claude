import { EMOJIS } from '../lib/emojis';

interface Props {
  selected: string[];
  onChange: (next: string[]) => void;
}

/** Clickable grid of all supported emojis with their effect labels. */
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
      <div className="emoji-actions">
        <button type="button" onClick={() => onChange(EMOJIS.map((e) => e.emoji))}>
          全選択
        </button>
        <button type="button" onClick={() => onChange([])}>
          全解除
        </button>
        <span className="emoji-count">{selected.length} 個選択中</span>
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
