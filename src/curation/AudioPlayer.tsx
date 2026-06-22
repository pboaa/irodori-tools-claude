import { useEffect, useRef, useState, type RefObject } from 'react';
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
  // Current object URL, revoked only when replaced or on unmount (never while
  // it is still the <audio> src — that previously caused stray events).
  const urlRef = useRef<string | null>(null);
  // True only once the *current* clip has actually started playing, so a stray
  // `ended` fired while swapping src (navigating) can't trigger auto-advance.
  const readyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    readyRef.current = false;
    (async () => {
      if (!item) {
        if (!cancelled) setUrl(null);
        return;
      }
      try {
        const file = await item.wavHandle.getFile();
        if (cancelled) return;
        const u = URL.createObjectURL(file);
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = u;
        setUrl(u);
      } catch {
        if (!cancelled) setUrl(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [item]);

  // Revoke the last URL when the component unmounts.
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  useEffect(() => {
    if (url && autoPlay && audioRef.current) {
      audioRef.current.play().catch(() => {});
    }
  }, [url, autoPlay, audioRef]);

  return (
    <div className="player">
      <div className="player-name">{item ? item.relPath : '—'}</div>
      <audio
        ref={audioRef}
        src={url ?? undefined}
        controls
        onPlaying={() => {
          readyRef.current = true;
        }}
        onEnded={() => {
          // Only advance on a genuine end of the clip that was actually playing.
          if (readyRef.current && audioRef.current?.ended) onEnded();
        }}
      />
    </div>
  );
}
