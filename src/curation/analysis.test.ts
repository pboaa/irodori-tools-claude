import { describe, it, expect } from 'vitest';
import { analyze, refKey } from './analysis';
import { SIDECAR_SCHEMA, type AudioItem, type Rating, type SidecarMeta } from '../types';

function meta(p: Partial<SidecarMeta>): SidecarMeta {
  return {
    schema: SIDECAR_SCHEMA,
    wav: 'x.wav',
    text: 't',
    baseText: 't',
    emoji: null,
    caption: null,
    model: 'm',
    checkpointKind: 'hf',
    refMode: 'no-ref',
    refWav: null,
    index: 0,
    runId: 'r',
    seed: null,
    numSteps: null,
    cfgScaleText: null,
    cfgScaleCaption: null,
    cfgScaleSpeaker: null,
    durationScale: null,
    swayCoeff: null,
    truncationFactor: null,
    createdAt: '',
    command: '',
    rating: 0,
    ...p,
  };
}

let idc = 0;
function item(rating: Rating, m: Partial<SidecarMeta>): AudioItem {
  const id = `i${idc++}`;
  return {
    id,
    relPath: id + '.wav',
    name: id + '.wav',
    wavHandle: {} as FileSystemFileHandle,
    dirHandle: {} as FileSystemDirectoryHandle,
    jsonHandle: null,
    meta: meta(m),
    rating,
  };
}

describe('refKey', () => {
  it('uses refWav for ref-wav, else no-ref', () => {
    expect(refKey(meta({ refMode: 'ref-wav', refWav: 'a/b.wav' }))).toBe('a/b.wav');
    expect(refKey(meta({ refMode: 'no-ref' }))).toBe('no-ref');
  });
});

describe('analyze', () => {
  it('groups by ref and ranks tops by rating', () => {
    const items = [
      item(3, { refMode: 'ref-wav', refWav: 'A.wav', seed: 1 }),
      item(1, { refMode: 'ref-wav', refWav: 'A.wav', seed: 2 }),
      item(2, { refMode: 'no-ref', seed: 3 }),
      item(0, { refMode: 'no-ref', seed: 4 }), // unrated: excluded from tops
    ];
    const g = analyze(items);
    const a = g.find((x) => x.ref === 'A.wav')!;
    expect(a.count).toBe(2);
    expect(a.ratedCount).toBe(2);
    expect(a.top[0].rating).toBe(3); // best first
    const nr = g.find((x) => x.ref === 'no-ref')!;
    expect(nr.ratedCount).toBe(1);
  });

  it('computes parameter buckets (n>=2) averaged by rating', () => {
    const items = [
      item(3, { cfgScaleText: 3.0 }),
      item(3, { cfgScaleText: 3.1 }), // rounds to 3.0 bucket
      item(1, { cfgScaleText: 5.0 }),
      item(1, { cfgScaleText: 5.0 }),
    ];
    const g = analyze(items)[0];
    const labels = g.buckets.map((b) => b.label);
    expect(labels.some((l) => l.includes('cfg-T ≈3'))).toBe(true);
    // the 3.0 bucket should rank above the 5.0 bucket (higher avg)
    const top = g.buckets[0];
    expect(top.avg).toBeGreaterThan(2);
  });

  it('builds same-seed groups (size>=2)', () => {
    const items = [
      item(3, { seed: 42, cfgScaleText: 3 }),
      item(1, { seed: 42, cfgScaleText: 5 }),
      item(2, { seed: 99 }), // singleton -> not a group
    ];
    const g = analyze(items)[0];
    expect(g.seedGroups).toHaveLength(1);
    expect(g.seedGroups[0].seed).toBe(42);
    expect(g.seedGroups[0].items[0].rating).toBe(3);
  });
});
