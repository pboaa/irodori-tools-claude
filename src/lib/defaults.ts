import type { EmojiEntry, GenConfig, ParamRange, SidecarMeta } from '../types';

/** Default randomizable parameters with Irodori-TTS infer.py defaults + help text. */
export function defaultParams(): ParamRange[] {
  return [
    // Random generation is the goal, so seed + the main CFG scales default to
    // "range" out of the box; the rest stay on infer.py defaults.
    // seed has a huge range, so it uses number inputs instead of a slider.
    { flag: 'seed', label: 'seed', type: 'int', kind: 'range', fixed: 0, min: 0, max: 2147483647, decimals: 0, slider: false, sliderMin: 0, sliderMax: 2147483647, step: 1, default: 0, desc: '乱数シード。固定すると同じ結果を再現、範囲にすると生成ごとに声色・抑揚がばらつく。厳選用途では範囲推奨。' },
    { flag: 'num-steps', label: 'num-steps', type: 'int', kind: 'range', fixed: 40, min: 30, max: 60, decimals: 0, slider: true, sliderMin: 1, sliderMax: 100, step: 1, default: 40, desc: '拡散ステップ数。多いほど高品質だが遅い。少なすぎると音が荒れる（既定40）。' },
    { flag: 'cfg-scale-text', label: 'cfg-scale-text', type: 'float', kind: 'range', fixed: 3.0, min: 3.0, max: 10.0, decimals: 2, slider: true, sliderMin: 0, sliderMax: 10, step: 0.1, default: 3.0, desc: 'テキストへの忠実度。高いほど発話内容に正確だが硬くなりがち、低いと自由・不安定（既定3.0）。' },
    { flag: 'cfg-scale-caption', label: 'cfg-scale-caption', type: 'float', kind: 'off', fixed: 3.0, min: 2.0, max: 4.0, decimals: 2, slider: true, sliderMin: 0, sliderMax: 10, step: 0.1, default: 3.0, desc: 'caption（話し方の指定）への忠実度。VoiceDesign で caption を使う時のみ有効（既定3.0）。' },
    { flag: 'cfg-scale-speaker', label: 'cfg-scale-speaker', type: 'float', kind: 'range', fixed: 5.0, min: 4.0, max: 10.0, decimals: 2, slider: true, sliderMin: 0, sliderMax: 10, step: 0.1, default: 5.0, desc: '参照話者への忠実度。高いほど声が似るが不自然になりやすい、低いと崩れる（既定5.0）。' },
    { flag: 'duration-scale', label: 'duration-scale', type: 'float', kind: 'range', fixed: 1.0, min: 0.9, max: 1.1, decimals: 2, slider: true, sliderMin: 0.5, sliderMax: 2.0, step: 0.05, default: 1.0, desc: '生成される音声長の倍率。>1 でゆっくり長く、<1 で速く短く（既定1.0）。' },
    { flag: 'sway-coeff', label: 'sway-coeff', type: 'float', kind: 'off', fixed: -1.0, min: -1.0, max: 1.0, decimals: 2, slider: true, sliderMin: -1.0, sliderMax: 1.0, step: 0.05, default: -1.0, desc: 'Sway サンプリング係数。サンプリング軌道の偏り。高速化や質感調整に使う上級設定（既定-1.0）。' },
    { flag: 'truncation-factor', label: 'truncation-factor', type: 'float', kind: 'off', fixed: 1.0, min: 0.7, max: 1.0, decimals: 2, slider: true, sliderMin: 0, sliderMax: 1.0, step: 0.05, default: 1.0, desc: 'ノイズの切り詰め。低いほど安定・無難だが単調、高い（1.0）ほど多様だが崩れやすい。' },
  ];
}

let entrySeq = 0;
/** Create an emoji entry with sensible defaults. */
export function makeEntry(token: string, partial: Partial<EmojiEntry> = {}): EmojiEntry {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `e${Date.now()}-${entrySeq++}`;
  return {
    id,
    token,
    mode: 'fixed',
    headMin: 0,
    headMax: 0,
    tailMin: 1,
    tailMax: 1,
    randMin: 0,
    randMax: 0,
    ...partial,
  };
}

/** Reset target for params: restore the factory defaults (including range modes). */
export function resetParams(): ParamRange[] {
  return defaultParams();
}

export function defaultConfig(): GenConfig {
  return {
    runPrefix: 'uv run --no-sync python infer.py',
    checkpointKind: 'hf',
    checkpoint: 'Aratako/Irodori-TTS-500M-v3',
    precision: 'bf16',
    texts: 'こんにちは、私はAIです。',
    caption: '',
    refMode: 'no-ref',
    refWav: '',
    emojiEntries: [
      // Symbols on by default: occasionally add one ♡ / ！ / ？ at the end.
      makeEntry('♡', { mode: 'range', tailMin: 0, tailMax: 1 }),
      makeEntry('！', { mode: 'range', tailMin: 0, tailMax: 1 }),
      makeEntry('？', { mode: 'range', tailMin: 0, tailMax: 1 }),
    ],
    emojiMaxHead: 5,
    emojiMaxTail: 8,
    emojiMaxRand: 3,
    count: 5,
    outputDir: 'outputs/run',
    params: defaultParams(),
  };
}

/** Map a param flag to its SidecarMeta camelCase field name. */
export const FLAG_TO_META: Record<string, keyof SidecarMeta> = {
  seed: 'seed',
  'num-steps': 'numSteps',
  'cfg-scale-text': 'cfgScaleText',
  'cfg-scale-caption': 'cfgScaleCaption',
  'cfg-scale-speaker': 'cfgScaleSpeaker',
  'duration-scale': 'durationScale',
  'sway-coeff': 'swayCoeff',
  'truncation-factor': 'truncationFactor',
};
