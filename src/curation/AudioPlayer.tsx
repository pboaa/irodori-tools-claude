import { useEffect, useState, type RefObject } from 'react';
import type { AudioItem } from '../types';

interface Props {
  item: AudioItem | null;
  autoPlay: boolean;
  onEnded: () => void;
  audioRef: RefObject<HTMLAudioElement | null>;
}

/** Audio bar that loads the current item's wav via a Blob URL. */
export function AudioPlayer({ item, autoPlay, onEnded, audioRef }: Props) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    (async () => {
      if (!item) {
        if (!cancelled) setUrl(null);
        return;
      }
      try {
        const file = await item.wavHandle.getFile();
        if (cancelled) return;
        const u = URL.createObjectURL(file);
        revoked = u;
        setUrl(u);
      } catch {
        if (!cancelled) setUrl(null);
      }
    })();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [item]);

  useEffect(() => {
    if (url && autoPlay && audioRef.current) {
      audioRef.current.play().catch(() => {});
    }
  }, [url, autoPlay, audioRef]);

  return (
    <div className="player">
      <div className="player-name">{item ? item.relPath : '—'}</div>
      <audio ref={audioRef} src={url ?? undefined} controls onEnded={onEnded} />
    </div>
  );
}
