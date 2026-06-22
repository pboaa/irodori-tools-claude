import { useMemo } from 'react';
import type { AudioItem } from '../types';
import { analyze } from './analysis';

const RATE_LABEL: Record<number, string> = { 0: '—', 1: '不可', 2: '普', 3: '良' };

interface Props {
  items: AudioItem[];
  onPlay: (id: string) => void;
}

export function AnalysisView({ items, onPlay }: Props) {
  const groups = useMemo(() => analyze(items), [items]);
  const totalRated = items.filter((it) => it.rating > 0).length;

  if (totalRated === 0) {
    return (
      <p className="info">
        まだ評価がありません。リストで 1=不可 / 2=普 / 3=良 を付けると、ここに ref 別の高評価トップ・
        効く設定・同一シード比較が出ます。
      </p>
    );
  }

  return (
    <div className="analysis">
      {groups.map((g) => (
        <section className="analysis-ref" key={g.ref}>
          <h3>
            ref: {g.ref} <span className="muted">{g.ratedCount}/{g.count} 評価済</span>
          </h3>

          <div className="analysis-cols">
            <div className="analysis-col">
              <h4>高評価トップ</h4>
              {g.top.length === 0 && <p className="info">評価済なし</p>}
              {g.top.map((it) => (
                <button className="an-item" key={it.id} onClick={() => onPlay(it.id)} title={it.relPath}>
                  <span className={`an-rate r${it.rating}`}>{RATE_LABEL[it.rating]}</span>
                  <span className="an-text">{it.meta?.text ?? it.name}</span>
                  <span className="an-meta">
                    seed {it.meta?.seed ?? '—'} · cfgT {it.meta?.cfgScaleText ?? '—'} · cfgS{' '}
                    {it.meta?.cfgScaleSpeaker ?? '—'}
                  </span>
                </button>
              ))}
            </div>

            <div className="analysis-col">
              <h4>効く設定（平均評価）</h4>
              {g.buckets.length === 0 && <p className="info">データ不足（同設定の評価が2件以上必要）</p>}
              {g.buckets.map((b) => (
                <div className="an-bucket" key={b.label}>
                  <span className="an-bar" style={{ width: `${(b.avg / 3) * 100}%` }} />
                  <span className="an-bucket-label">{b.label}</span>
                  <span className="an-bucket-val">
                    {b.avg.toFixed(2)} <span className="muted">(n={b.n})</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          {g.seedGroups.length > 0 && (
            <div className="analysis-seed">
              <h4>同一シード比較</h4>
              {g.seedGroups.slice(0, 12).map((sg) => (
                <div className="an-seed" key={sg.seed}>
                  <div className="an-seed-head">seed {sg.seed}</div>
                  {sg.items.map((it) => (
                    <button className="an-item" key={it.id} onClick={() => onPlay(it.id)} title={it.relPath}>
                      <span className={`an-rate r${it.rating}`}>{RATE_LABEL[it.rating]}</span>
                      <span className="an-meta">
                        cfgT {it.meta?.cfgScaleText ?? '—'} · cfgS {it.meta?.cfgScaleSpeaker ?? '—'} · steps{' '}
                        {it.meta?.numSteps ?? '—'} · dur {it.meta?.durationScale ?? '—'} ·{' '}
                        {it.meta?.emoji ?? '—'}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
