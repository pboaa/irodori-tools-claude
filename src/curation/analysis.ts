import type { AudioItem, SidecarMeta } from '../types';

export interface Bucket {
  label: string;
  avg: number;
  n: number;
}
export interface SeedGroup {
  seed: number;
  items: AudioItem[];
}
export interface RefGroup {
  ref: string;
  count: number;
  ratedCount: number;
  top: AudioItem[];
  buckets: Bucket[];
  seedGroups: SeedGroup[];
}

/** Key used to bucket items by reference voice. */
export function refKey(m: SidecarMeta): string {
  if (m.refMode === 'ref-wav') return m.refWav || '(ref)';
  return 'no-ref';
}

const round = (v: number, step: number) => Math.round(v / step) * step;
const numLabel = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2));

interface Dim {
  label: string;
  get: (m: SidecarMeta) => string | null;
}

const DIMS: Dim[] = [
  { label: '絵文字', get: (m) => (m.emoji && m.emoji !== '' ? m.emoji : '(なし)') },
  { label: 'cfg-T', get: (m) => (m.cfgScaleText == null ? null : '≈' + numLabel(round(m.cfgScaleText, 0.5))) },
  { label: 'cfg-S', get: (m) => (m.cfgScaleSpeaker == null ? null : '≈' + numLabel(round(m.cfgScaleSpeaker, 0.5))) },
  { label: 'cfg-C', get: (m) => (m.cfgScaleCaption == null ? null : '≈' + numLabel(round(m.cfgScaleCaption, 0.5))) },
  { label: 'steps', get: (m) => (m.numSteps == null ? null : numLabel(m.numSteps)) },
  { label: 'dur', get: (m) => (m.durationScale == null ? null : '≈' + numLabel(round(m.durationScale, 0.05))) },
  { label: 'sway', get: (m) => (m.swayCoeff == null ? null : '≈' + numLabel(round(m.swayCoeff, 0.1))) },
  { label: 'trunc', get: (m) => (m.truncationFactor == null ? null : '≈' + numLabel(round(m.truncationFactor, 0.1))) },
];

/**
 * Group rated items by reference voice and, within each, surface the highest
 * rated items, the best-scoring parameter/emoji buckets, and same-seed groups.
 */
export function analyze(items: AudioItem[], topN = 10, maxBuckets = 15): RefGroup[] {
  const withMeta = items.filter((it): it is AudioItem & { meta: SidecarMeta } => it.meta != null);
  const byRef = new Map<string, (AudioItem & { meta: SidecarMeta })[]>();
  for (const it of withMeta) {
    const k = refKey(it.meta);
    (byRef.get(k) ?? byRef.set(k, []).get(k)!).push(it);
  }

  const groups: RefGroup[] = [];
  for (const [ref, all] of byRef) {
    const rated = all.filter((it) => it.rating > 0);

    const top = [...rated]
      .sort((a, b) => b.rating - a.rating || (a.meta.index ?? 0) - (b.meta.index ?? 0))
      .slice(0, topN);

    // Average rating per parameter/emoji bucket.
    const acc = new Map<string, { sum: number; n: number }>();
    for (const it of rated) {
      for (const dim of DIMS) {
        const v = dim.get(it.meta);
        if (v == null) continue;
        const key = `${dim.label} ${v}`;
        const a = acc.get(key) ?? { sum: 0, n: 0 };
        a.sum += it.rating;
        a.n += 1;
        acc.set(key, a);
      }
    }
    const buckets: Bucket[] = [...acc.entries()]
      .map(([label, a]) => ({ label, avg: a.sum / a.n, n: a.n }))
      .filter((b) => b.n >= 2)
      .sort((a, b) => b.avg - a.avg || b.n - a.n)
      .slice(0, maxBuckets);

    // Same-seed comparison groups (size >= 2).
    const bySeed = new Map<number, (AudioItem & { meta: SidecarMeta })[]>();
    for (const it of all) {
      if (it.meta.seed == null) continue;
      (bySeed.get(it.meta.seed) ?? bySeed.set(it.meta.seed, []).get(it.meta.seed)!).push(it);
    }
    const seedGroups: SeedGroup[] = [...bySeed.entries()]
      .filter(([, g]) => g.length >= 2)
      .map(([seed, g]) => ({
        seed,
        items: [...g].sort((a, b) => b.rating - a.rating || (a.meta.index ?? 0) - (b.meta.index ?? 0)),
      }))
      .sort((a, b) => (b.items[0]?.rating ?? 0) - (a.items[0]?.rating ?? 0))
      .slice(0, 30);

    groups.push({ ref, count: all.length, ratedCount: rated.length, top, buckets, seedGroups });
  }

  return groups.sort((a, b) => b.ratedCount - a.ratedCount || a.ref.localeCompare(b.ref));
}
