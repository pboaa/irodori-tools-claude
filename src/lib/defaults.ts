import type { GenConfig, ParamRange, SidecarMeta } from '../types';

/** Default randomizable parameters with Irodori-TTS infer.py defaults. */
export function defaultParams(): ParamRange[] {
  return [
    // Random generation is the goal, so seed + the main CFG scales default to
    // "range" out of the box; the rest stay on infer.py defaults.
    // seed has a huge range, so it uses number inputs instead of a slider.
    { flag: 'seed', label: 'seed', type: 'int', kind: 'range', fixed: 0, min: 0, max: 2147483647, decimals: 0, slider: false, sliderMin: 0, sliderMax: 2147483647, step: 1, default: 0 },
    { flag: 'num-steps', label: 'num-steps', type: 'int', kind: 'off', fixed: 40, min: 20, max: 60, decimals: 0, slider: true, sliderMin: 1, sliderMax: 100, step: 1, default: 40 },
    { flag: 'cfg-scale-text', label: 'cfg-scale-text', type: 'float', kind: 'range', fixed: 3.0, min: 2.0, max: 4.0, decimals: 2, slider: true, sliderMin: 0, sliderMax: 10, step: 0.1, default: 3.0 },
    { flag: 'cfg-scale-caption', label: 'cfg-scale-caption', type: 'float', kind: 'off', fixed: 3.0, min: 2.0, max: 4.0, decimals: 2, slider: true, sliderMin: 0, sliderMax: 10, step: 0.1, default: 3.0 },
    { flag: 'cfg-scale-speaker', label: 'cfg-scale-speaker', type: 'float', kind: 'range', fixed: 5.0, min: 4.0, max: 6.0, decimals: 2, slider: true, sliderMin: 0, sliderMax: 10, step: 0.1, default: 5.0 },
    { flag: 'duration-scale', label: 'duration-scale', type: 'float', kind: 'off', fixed: 1.0, min: 0.9, max: 1.1, decimals: 2, slider: true, sliderMin: 0.5, sliderMax: 2.0, step: 0.05, default: 1.0 },
    { flag: 'sway-coeff', label: 'sway-coeff', type: 'float', kind: 'off', fixed: -1.0, min: -1.0, max: 1.0, decimals: 2, slider: true, sliderMin: -1.0, sliderMax: 1.0, step: 0.05, default: -1.0 },
    { flag: 'truncation-factor', label: 'truncation-factor', type: 'float', kind: 'off', fixed: 1.0, min: 0.7, max: 1.0, decimals: 2, slider: true, sliderMin: 0, sliderMax: 1.0, step: 0.05, default: 1.0 },
  ];
}

export function defaultConfig(): GenConfig {
  return {
    runPrefix: 'uv run --no-sync python infer.py',
    checkpointKind: 'hf',
    checkpoint: 'Aratako/Irodori-TTS-500M-v3',
    texts: 'こんにちは、私はAIです。',
    caption: '',
    refMode: 'no-ref',
    refWav: '',
    selectedEmojis: ['🤭', '😊', '😏', '😆', '🥺'],
    emojiPlacement: 'random',
    emojiCountMode: 'fixed',
    emojiCount: 1,
    emojiCountMin: 1,
    emojiCountMax: 3,
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
