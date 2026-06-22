import { useEffect, useMemo, useRef, useState } from 'react';
import type { GenConfig } from '../types';
import { defaultConfig, defaultParams, resetParams } from '../lib/defaults';
import { buildPs1, buildBat, buildPy, splitLines } from './scriptBuilder';
import { ParamRangeInput } from './ParamRangeInput';
import { EmojiPicker } from './EmojiPicker';
import { TokenPalette } from './TokenPalette';

const FACTORY_PARAMS = defaultParams();
const STORAGE_KEY = 'irodori-tts-gen-config-v1';

/** Load persisted config, merged over defaults to tolerate schema additions. */
function loadConfig(): GenConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const stored = JSON.parse(raw) as Partial<GenConfig>;
      const merged: GenConfig = { ...defaultConfig(), ...stored };
      if (!Array.isArray(merged.params) || merged.params.length !== FACTORY_PARAMS.length) {
        merged.params = defaultParams();
      }
      if (!Array.isArray(merged.emojiEntries)) merged.emojiEntries = defaultConfig().emojiEntries;
      return merged;
    }
  } catch {
    /* ignore malformed storage */
  }
  return defaultConfig();
}
const N_OPTIONS = [1, 2, 3, 4, 5, 8, 10, 15, 20, 30, 50, 100];

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
  const [config, setConfig] = useState<GenConfig>(loadConfig);
  const [tab, setTab] = useState<'py' | 'ps1' | 'bat'>('py');
  const [copied, setCopied] = useState(false);
  const [showScript, setShowScript] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const set = (patch: Partial<GenConfig>) => setConfig((c) => ({ ...c, ...patch }));

  // Persist config across reloads.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch {
      /* storage may be unavailable */
    }
  }, [config]);

  // Per-section reset helpers (use a fresh default each time).
  const resetRun = () => {
    const d = defaultConfig();
    set({
      runPrefix: d.runPrefix,
      checkpointKind: d.checkpointKind,
      checkpoint: d.checkpoint,
      precision: d.precision,
      outputDir: d.outputDir,
    });
  };
  const resetText = () => {
    const d = defaultConfig();
    set({ texts: d.texts, caption: d.caption, refMode: d.refMode, refWav: d.refWav, count: d.count });
  };
  // Browsers can't expose a file's absolute path, so this fills the file NAME;
  // edit/prefix the field if the wav lives in a subfolder of the repo.
  const pickRefWav = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/wav,.wav';
    input.onchange = () => {
      const f = input.files?.[0];
      if (f) set({ refWav: f.name });
    };
    input.click();
  };

  const resetEmoji = () => {
    const d = defaultConfig();
    set({
      emojiEntries: d.emojiEntries,
      emojiMaxHead: d.emojiMaxHead,
      emojiMaxTail: d.emojiMaxTail,
      emojiMaxRand: d.emojiMaxRand,
    });
  };

  const ps1 = useMemo(() => buildPs1(config), [config]);
  const bat = useMemo(() => buildBat(config), [config]);
  const py = useMemo(() => buildPy(config), [config]);
  const script = tab === 'py' ? py : tab === 'ps1' ? ps1 : bat;
  const filename = tab === 'py' ? 'generate_tts.py' : tab === 'ps1' ? 'generate_tts.ps1' : 'generate_tts.bat';

  const textCount = splitLines(config.texts).length;
  const total = textCount * Math.max(1, Math.floor(config.count));

  /** Insert a token into the text at the current cursor / selection. */
  const insertAtCursor = (token: string) => {
    const ta = textareaRef.current;
    const text = config.texts;
    const start = ta?.selectionStart ?? text.length;
    const end = ta?.selectionEnd ?? start;
    const next = text.slice(0, start) + token + text.slice(end);
    set({ texts: next });
    requestAnimationFrame(() => {
      if (!ta) return;
      ta.focus();
      const pos = start + token.length;
      ta.setSelectionRange(pos, pos);
    });
  };

  const copy = async () => {
    await navigator.clipboard.writeText(script);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="page generator gen-grid">
      {/* left column */}
      <div className="area-config">
        <section>
          <div className="section-head">
            <h3>実行設定</h3>
            <button className="reset" title="この設定をリセット" onClick={resetRun}>⟲</button>
          </div>
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
          <div className="inline">
            <label className="field grow">
              出力フォルダ
              <input value={config.outputDir} onChange={(e) => set({ outputDir: e.target.value })} />
            </label>
            <label className="field">
              精度
              <select
                value={config.precision}
                onChange={(e) => set({ precision: e.target.value as GenConfig['precision'] })}
              >
                <option value="bf16">bf16（速い/GPU）</option>
                <option value="fp32">fp32（安全/CPU）</option>
              </select>
            </label>
          </div>
        </section>

        <section>
          <div className="section-head">
            <h3>テキスト（1行 = 1テキスト）</h3>
            <button className="reset" title="この設定をリセット" onClick={resetText}>⟲</button>
          </div>
          <textarea
            ref={textareaRef}
            rows={4}
            value={config.texts}
            onChange={(e) => set({ texts: e.target.value })}
          />
          <p className="param-hint">下のパレットをクリックでカーソル位置に挿入。</p>
          <TokenPalette onPick={insertAtCursor} compact />

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
                <span className="path-pick">
                  <input value={config.refWav} onChange={(e) => set({ refWav: e.target.value })} />
                  <button type="button" onClick={pickRefWav}>参照…</button>
                </span>
              </label>
            )}
            <label className="field">
              生成回数 N
              <select value={config.count} onChange={(e) => set({ count: Number(e.target.value) })}>
                {N_OPTIONS.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
          </div>
          {config.refMode === 'ref-wav' && (
            <p className="param-hint">
              ※ ブラウザはフルパスを取れないためファイル名のみ入ります。サブフォルダにある場合は
              <code>refs/voice.wav</code> のように手で調整してください。
            </p>
          )}
          <div className="output-count">
            出力ファイル数: <b>{total}</b>（{textCount} テキスト × {config.count} 回）
          </div>
        </section>

        <section>
          <div className="section-head">
            <h3>絵文字・記号（ランダム付与）</h3>
            <button className="reset" title="この設定をリセット" onClick={resetEmoji}>⟲</button>
          </div>
          <p className="param-hint">
            トークンごとに「文頭・文末・ランダム位置」に入れる個数を設定。固定 or
            範囲（生成ごとに変動）を選べ、同じトークンも複数追加できます。例: 👂 を文頭3・文末3で囁き声に。
          </p>
          <div className="inline maxrow">
            <span className="maxrow-label">最大数:</span>
            <label className="field">
              文頭
              <input
                type="number"
                min={0}
                max={20}
                value={config.emojiMaxHead}
                onChange={(e) => set({ emojiMaxHead: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              文末
              <input
                type="number"
                min={0}
                max={20}
                value={config.emojiMaxTail}
                onChange={(e) => set({ emojiMaxTail: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              ランダム位置
              <input
                type="number"
                min={0}
                max={20}
                value={config.emojiMaxRand}
                onChange={(e) => set({ emojiMaxRand: Number(e.target.value) })}
              />
            </label>
          </div>
          <p className="param-hint">
            各スロットはこの最大数まで。<b>固定を優先配置</b>し、余りがあれば<b>範囲</b>がランダムで埋めます。
          </p>
          <EmojiPicker
            entries={config.emojiEntries}
            onChange={(emojiEntries) => set({ emojiEntries })}
          />
        </section>
      </div>

      {/* right column: parameters */}
      <section className="area-params">
        <div className="section-head">
          <h3>ランダム化パラメータ</h3>
          <button type="button" className="reset" title="全パラメータをリセット" onClick={() => set({ params: resetParams() })}>
            ⟲ 全て
          </button>
        </div>
        <p className="param-hint">
          各パラメータは「既定（infer.py 任せ）/ 固定 / 範囲（生成ごとにランダム）」を選べます。
        </p>
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

      {/* full-width bottom: output / script preview */}
      <section className={`area-output accordion ${showScript ? 'open' : ''}`}>
        <div className="output-summary">
          このスクリプトは <b>{total}</b> ファイルを生成します
        </div>
        <p className="param-hint">
          🚀 <b>.py</b> はモデルを1回だけ読み込んでループ（精度 {config.precision}）。1音声ごとに起動する
          .ps1/.bat より大幅に高速です。実行: <code>uv run --no-sync python generate_tts.py</code>
        </p>
        <div className="accordion-head">
          <button className="accordion-toggle" onClick={() => setShowScript((v) => !v)}>
            <span className="chevron">{showScript ? '▾' : '▸'}</span>
            スクリプトプレビュー
          </button>
          <div className="tabs small">
            <button className={tab === 'py' ? 'active' : ''} onClick={() => setTab('py')}>.py 🚀</button>
            <button className={tab === 'ps1' ? 'active' : ''} onClick={() => setTab('ps1')}>.ps1</button>
            <button className={tab === 'bat' ? 'active' : ''} onClick={() => setTab('bat')}>.bat</button>
          </div>
          <span className="grow" />
          <button onClick={copy}>{copied ? 'コピー済' : 'コピー'}</button>
          <button className="primary" onClick={() => download(filename, script)}>
            ダウンロード
          </button>
        </div>
        {showScript && <pre className="code">{script}</pre>}
      </section>
    </div>
  );
}
