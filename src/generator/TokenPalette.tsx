import { ALL_TOKENS } from '../lib/emojis';

interface Props {
  /** Called with the chosen token (emoji or symbol). */
  onPick: (token: string) => void;
  /** Compact mode hides labels (used for in-text insertion). */
  compact?: boolean;
}

/**
 * Shared, unified palette of emojis + symbols. Reused for both inserting into
 * the text at the cursor and for adding randomization entries.
 */
export function TokenPalette({ onPick, compact }: Props) {
  return (
    <div className={`emoji-grid ${compact ? 'compact' : ''}`}>
      {ALL_TOKENS.map(({ emoji, label }) => (
        <button
          type="button"
          key={emoji}
          className="emoji-cell"
          title={label}
          onClick={() => onPick(emoji)}
        >
          <span className="emoji-char">{emoji}</span>
          {!compact && <span className="emoji-label">{label}</span>}
        </button>
      ))}
    </div>
  );
}
