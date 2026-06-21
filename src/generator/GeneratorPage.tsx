import { useMemo, useState } from 'react';
import type { GenConfig } from '../types';
import { defaultConfig } from '../lib/defaults';
import { buildPs1, buildBat, splitLines } from './scriptBuilder';
import { ParamRangeInput } from './ParamRangeInput';

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
      <div className="config-col">
        <section>
          <h3>実行設定</h3>
          <label className="field">
            実行プレフィックス
            <input
              value={config.runPrefix}
              onChange={(e) => set({ runPrefix: e.target.value })}
            />
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
            <input
              value={config.checkpoint}
              onChange={(e) => set({ checkpoint: e.target.value })}
            />
          </label>
          <label className="field">
            出力フォルダ
            <input value={config.outputDir} onChange={(e) => set({ outputDir: e.target.value })} />
          </label>
        </section>

        <section>
          <h3>テキスト（1行 = 1テキスト）</h3>
          <textarea
            rows={4}
            value={config.texts}
            onChange={(e) => set({ texts: e.target.value })}
          />
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

        <section>
          <h3>絵文字</h3>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={config.appendEmoji}
              onChange={(e) => set({ appendEmoji: e.target.checked })}
            />
            各生成でプールから1つランダムに末尾付与
          </label>
          <textarea
            rows={2}
            placeholder="🤭, 😊, 😢 （カンマ/改行区切り）"
            value={config.emojiPool}
            disabled={!config.appendEmoji}
            onChange={(e) => set({ emojiPool: e.target.value })}
          />
        </section>

        <section>
          <h3>ランダム化パラメータ</h3>
          {config.params.map((p, i) => (
            <ParamRangeInput
              key={p.flag}
              param={p}
              onChange={(next) =>
                set({ params: config.params.map((q, j) => (i === j ? next : q)) })
              }
            />
          ))}
        </section>
      </div>

      <div className="preview-col">
        <div className="preview-head">
          <div className="tabs small">
            <button className={tab === 'ps1' ? 'active' : ''} onClick={() => setTab('ps1')}>
              .ps1
            </button>
            <button className={tab === 'bat' ? 'active' : ''} onClick={() => setTab('bat')}>
              .bat
            </button>
          </div>
          <div className="summary">合計 {total} 生成（{textCount} テキスト × {config.count}）</div>
          <div className="actions">
            <button onClick={copy}>{copied ? 'コピー済' : 'コピー'}</button>
            <button
              className="primary"
              onClick={() =>
                download(tab === 'ps1' ? 'generate_tts.ps1' : 'generate_tts.bat', script)
              }
            >
              ダウンロード
            </button>
          </div>
        </div>
        <pre className="code">{script}</pre>
      </div>
    </div>
  );
}
