import type { GenConfig, ParamRange } from '../types';

/** Default randomizable parameters with Irodori-TTS infer.py defaults. */
export function defaultParams(): ParamRange[] {
  return [
    { flag: 'seed', label: 'seed', type: 'int', kind: 'off', fixed: 0, min: 0, max: 2147483647, decimals: 0 },
    { flag: 'num-steps', label: 'num-steps', type: 'int', kind: 'off', fixed: 40, min: 20, max: 60, decimals: 0 },
    { flag: 'cfg-scale-text', label: 'cfg-scale-text', type: 'float', kind: 'off', fixed: 3.0, min: 2.0, max: 4.0, decimals: 2 },
    { flag: 'cfg-scale-caption', label: 'cfg-scale-caption', type: 'float', kind: 'off', fixed: 3.0, min: 2.0, max: 4.0, decimals: 2 },
    { flag: 'cfg-scale-speaker', label: 'cfg-scale-speaker', type: 'float', kind: 'off', fixed: 5.0, min: 4.0, max: 6.0, decimals: 2 },
    { flag: 'duration-scale', label: 'duration-scale', type: 'float', kind: 'off', fixed: 1.0, min: 0.9, max: 1.1, decimals: 2 },
    { flag: 'sway-coeff', label: 'sway-coeff', type: 'float', kind: 'off', fixed: -1.0, min: -1.0, max: 1.0, decimals: 2 },
    { flag: 'truncation-factor', label: 'truncation-factor', type: 'float', kind: 'off', fixed: 1.0, min: 0.7, max: 1.0, decimals: 2 },
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
    emojiPool: '🤭, 😮‍💨, 😊, 😢, 😡',
    appendEmoji: false,
    count: 5,
    outputDir: 'outputs/run',
    params: defaultParams(),
  };
}

/** Map a param flag to its SidecarMeta camelCase field name. */
export const FLAG_TO_META: Record<string, keyof import('../types').SidecarMeta> = {
  seed: 'seed',
  'num-steps': 'numSteps',
  'cfg-scale-text': 'cfgScaleText',
  'cfg-scale-caption': 'cfgScaleCaption',
  'cfg-scale-speaker': 'cfgScaleSpeaker',
  'duration-scale': 'durationScale',
  'sway-coeff': 'swayCoeff',
  'truncation-factor': 'truncationFactor',
};
