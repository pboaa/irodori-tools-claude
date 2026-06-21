import { useMemo, useState } from 'react';
import type { GenConfig, EmojiPlacement } from '../types';
import { defaultConfig, defaultParams } from '../lib/defaults';
import { buildPs1, buildBat, splitLines } from './scriptBuilder';
import { ParamRangeInput } from './ParamRangeInput';
import { EmojiPicker } from './EmojiPicker';

const FACTORY_PARAMS = defaultParams();
const COUNT_OPTIONS = Array.from({ length: 10 }, (_, i) => i + 1);

function download(filename: string, text: string) {
  // Windows PowerShell 5.1 reads BOM-less UTF-8 .ps1 as ANSI (corrupts 日本語/絵文字),
  // so prepend a UTF-8 BOM for .ps1. cmd.exe chokes on a BOM, so .bat gets none.
  const parts = filename.endsWith('.ps1') ? ['﻿', text] : [text];
  const blob = new Blob(parts, { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function GeneratorPage() {
  const [config, setConfig] = useState<GenConfig>(defaultConfig);
  const [tab, setTab] = useState<'ps1' | 'bat'>('ps1');
  const [copied, setCopied] = useState(false);
  const [showScript, setShowScript] = useState(false);

  const set = (patch: Partial<GenConfig>) => setConfig((c) => ({ ...c, ...patch }));

  const ps1 = useMemo(() => buildPs1(config), [config]);
  const bat = useMemo(() => buildBat(config), [config]);
  const script = tab === 'ps1' ? ps1 : bat;

  const textCount = splitLines(config.texts).length;
  const total = textCount * Math.max(1, Math.floor(config.count));

  const copy = async () => {
    await navigator.clipboard.writeText(script);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="page generator">
      <div className="settings-grid">
        <div className="settings-col">
          <section>
            <h3>実行設定</h3>
            <label className="field">
              実行プレフィックス
              <input value={config.runPrefix} onChange={(e) => set({ runPrefix: e.target.value })} />
            </label>
            <label className="field">
              チェックポイント種別
              <select
                value={config.checkpointKind}
                onChange={(e) => set({ checkpointKind: e.target.value as GenConfig['checkpointKind'] })}
              >
                <option value="hf">HuggingFace (--hf-checkpoint)</option>
                <option value="local">ローカル (--checkpoint)</option>
              </select>
            </label>
            <label className="field">
              チェックポイント
              <input value={config.checkpoint} onChange={(e) => set({ checkpoint: e.target.value })} />
            </label>
            <label className="field">
              出力フォルダ
              <input value={config.outputDir} onChange={(e) => set({ outputDir: e.target.value })} />
            </label>
          </section>

          <section>
            <h3>テキスト（1行 = 1テキスト）</h3>
            <textarea rows={4} value={config.texts} onChange={(e) => set({ texts: e.target.value })} />
            <label className="field">
              caption（VoiceDesign 用・任意）
              <input value={config.caption} onChange={(e) => set({ caption: e.target.value })} />
            </label>
            <div className="inline">
              <label className="field">
                リファレンス
                <select
                  value={config.refMode}
                  onChange={(e) => set({ refMode: e.target.value as GenConfig['refMode'] })}
                >
                  <option value="no-ref">--no-ref</option>
                  <option value="ref-wav">--ref-wav</option>
                </select>
              </label>
              {config.refMode === 'ref-wav' && (
                <label className="field grow">
                  ref wav パス
                  <input value={config.refWav} onChange={(e) => set({ refWav: e.target.value })} />
                </label>
              )}
            </div>
            <label className="field">
              テキストごとの生成回数 N
              <input
                type="number"
                min={1}
                value={config.count}
                onChange={(e) => set({ count: Number(e.target.value) })}
              />
            </label>
          </section>
        </div>

        <div className="settings-col">
          <section>
            <h3>絵文字（スタイル制御）</h3>
            <div className="inline">
              <label className="field">
                付与方法
                <select
                  value={config.emojiPlacement}
                  onChange={(e) => set({ emojiPlacement: e.target.value as EmojiPlacement })}
                >
                  <option value="random">ランダムにN個追加（優先）</option>
                  <option value="head">文頭</option>
                  <option value="tail">文末</option>
                  <option value="both">文頭＋文末</option>
                  <option value="off">付与しない</option>
                </select>
              </label>
              {config.emojiPlacement === 'random' && (
                <>
                  <label className="field">
                    個数
                    <select
                      value={config.emojiCountMode}
                      onChange={(e) => set({ emojiCountMode: e.target.value as 'fixed' | 'range' })}
                    >
                      <option value="fixed">固定</option>
                      <option value="range">範囲ランダム</option>
                    </select>
                  </label>
                  {config.emojiCountMode === 'fixed' ? (
                    <label className="field">
                      個数（1-10）
                      <select
                        value={config.emojiCount}
                        onChange={(e) => set({ emojiCount: Number(e.target.value) })}
                      >
                        {COUNT_OPTIONS.map((n) => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <label className="field">
                      範囲（1-10）
                      <span className="count-range">
                        <select
                          value={config.emojiCountMin}
                          onChange={(e) =>
                            set({ emojiCountMin: Math.min(Number(e.target.value), config.emojiCountMax) })
                          }
                        >
                          {COUNT_OPTIONS.map((n) => (
                            <option key={n} value={n}>{n}</option>
                          ))}
                        </select>
                        <span>〜</span>
                        <select
                          value={config.emojiCountMax}
                          onChange={(e) =>
                            set({ emojiCountMax: Math.max(Number(e.target.value), config.emojiCountMin) })
                          }
                        >
                          {COUNT_OPTIONS.map((n) => (
                            <option key={n} value={n}>{n}</option>
                          ))}
                        </select>
                      </span>
                    </label>
                  )}
                </>
              )}
            </div>
            <p className="param-hint">
              選択した絵文字から各生成でランダムに採用（効果はホバー表示）。
            </p>
            <EmojiPicker
              selected={config.selectedEmojis}
              onChange={(selectedEmojis) => set({ selectedEmojis })}
            />
          </section>
        </div>
      </div>

      <section className="params-section">
        <div className="section-head">
          <h3>ランダム化パラメータ（既定 / 固定 / 範囲）</h3>
          <button type="button" className="reset" onClick={() => set({ params: defaultParams() })}>
            ⟲ 全てリセット
          </button>
        </div>
        <div className="params-grid">
          {config.params.map((p, i) => (
            <ParamRangeInput
              key={p.flag}
              param={p}
              factory={FACTORY_PARAMS[i]}
              onChange={(next) => set({ params: config.params.map((q, j) => (i === j ? next : q)) })}
            />
          ))}
        </div>
      </section>

      <section className={`accordion ${showScript ? 'open' : ''}`}>
        <div className="accordion-head">
          <button className="accordion-toggle" onClick={() => setShowScript((v) => !v)}>
            <span className="chevron">{showScript ? '▾' : '▸'}</span>
            スクリプトプレビュー
          </button>
          <div className="tabs small">
            <button className={tab === 'ps1' ? 'active' : ''} onClick={() => setTab('ps1')}>.ps1</button>
            <button className={tab === 'bat' ? 'active' : ''} onClick={() => setTab('bat')}>.bat</button>
          </div>
          <span className="summary">合計 {total} 生成（{textCount} × {config.count}）</span>
          <span className="grow" />
          <button onClick={copy}>{copied ? 'コピー済' : 'コピー'}</button>
          <button
            className="primary"
            onClick={() => download(tab === 'ps1' ? 'generate_tts.ps1' : 'generate_tts.bat', script)}
          >
            ダウンロード
          </button>
        </div>
        {showScript && <pre className="code">{script}</pre>}
      </section>
    </div>
  );
}
