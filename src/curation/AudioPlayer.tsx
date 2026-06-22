import { useEffect, useRef, useState, type RefObject } from 'react';
import type { AudioItem } from '../types';

interface Props {
  item: AudioItem | null;
  autoPlay: boolean;
  /** Loop the clip (used for "loop until rated"). */
  loop: boolean;
  onEnded: () => void;
  /** Reports the decoded clip's peak amplitude (0..1) for quiet-skip. */
  onPeak: (peak: number) => void;
  audioRef: RefObject<HTMLAudioElement | null>;
}

let sharedCtx: AudioContext | null = null;
function getCtx(): AudioContext {
  if (!sharedCtx) sharedCtx = new AudioContext();
  return sharedCtx;
}

/** Draw a min/max waveform and return the peak amplitude (0..1). */
function drawWaveform(canvas: HTMLCanvasElement | null, buf: AudioBuffer): number {
  const data = buf.getChannelData(0);
  const W = canvas?.width ?? 600;
  const H = canvas?.height ?? 48;
  const ctx = canvas?.getContext('2d') ?? null;
  if (ctx) {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#5c7cfa';
  }
  const per = Math.max(1, Math.floor(data.length / W));
  const mid = H / 2;
  let peak = 0;
  for (let x = 0; x < W; x++) {
    let min = 1;
    let max = -1;
    const start = x * per;
    const end = Math.min(data.length, start + per);
    for (let i = start; i < end; i++) {
      const v = data[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (-min > peak) peak = -min;
    if (max > peak) peak = max;
    if (ctx) {
      const y1 = mid - max * mid;
      const y2 = mid - min * mid;
      ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
    }
  }
  return peak;
}

/** Audio bar: loads the current wav, draws its waveform, plays it. */
export function AudioPlayer({ item, autoPlay, loop, onEnded, onPeak, audioRef }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);
  const readyRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onPeakRef = useRef(onPeak);
  useEffect(() => {
    onPeakRef.current = onPeak;
  });

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
        // Decode for waveform + peak (independent of playback).
        const audioBuf = await getCtx().decodeAudioData(await file.arrayBuffer());
        if (cancelled) return;
        onPeakRef.current(drawWaveform(canvasRef.current, audioBuf));
      } catch {
        if (!cancelled) setUrl(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Reload only when the underlying file changes — not when its rating does
    // (rating updates create a new item object but keep the same id).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  useEffect(() => {
    if (url && autoPlay && audioRef.current) audioRef.current.play().catch(() => {});
  }, [url, autoPlay, audioRef]);

  return (
    <div className="player">
      <canvas className="waveform" width={600} height={48} ref={canvasRef} />
      <div className="player-side">
        <div className="player-name">{item ? item.relPath : '—'}</div>
        <audio
          ref={audioRef}
          src={url ?? undefined}
          controls
          loop={loop}
          onPlaying={() => {
            readyRef.current = true;
          }}
          onEnded={() => {
            if (readyRef.current && audioRef.current?.ended) onEnded();
          }}
        />
      </div>
    </div>
  );
}
