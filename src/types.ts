// Shared types for the Irodori-TTS tools app.

/** Sidecar metadata schema version written next to each generated wav. */
export const SIDECAR_SCHEMA = 'irodori-tts-sidecar/v1' as const;

/** How a randomizable inference parameter is supplied. */
export type ParamKind = 'off' | 'fixed' | 'range';

/** A single randomizable parameter (e.g. cfg-scale-text, num-steps). */
export interface ParamRange {
  /** CLI flag without leading dashes, e.g. "cfg-scale-text". */
  flag: string;
  /** Human label shown in the UI. */
  label: string;
  /** integer => no decimals; float => rounded to `decimals`. */
  type: 'int' | 'float';
  kind: ParamKind;
  /** Used when kind === 'fixed'. */
  fixed: number;
  /** Used when kind === 'range'. */
  min: number;
  max: number;
  /** Decimal places for float rounding. */
  decimals: number;
  /** Short explanation shown in the UI. */
  desc: string;
  /** Whether to render slider controls (false => number inputs, e.g. seed). */
  slider: boolean;
  /** Absolute slider track bounds. */
  sliderMin: number;
  sliderMax: number;
  /** Slider step ("刻み"). */
  step: number;
  /** Factory default value (reset target). */
  default: number;
}

export type RefMode = 'no-ref' | 'ref-wav';

/** Whether an emoji entry's per-slot counts are fixed or randomized. */
export type CountMode = 'fixed' | 'range';

/**
 * One emoji/symbol injection rule. The same token may appear in multiple
 * entries with different settings (e.g. 👂 fixed 2/2 plus 👂 random 0-2/0-2).
 * Tokens are arbitrary text, so ♡ ! ? etc. are also supported.
 */
export interface EmojiEntry {
  id: string;
  token: string;
  mode: CountMode;
  /** Count placed at the start of the text (min===max in fixed mode). */
  headMin: number;
  headMax: number;
  /** Count placed at the end of the text. */
  tailMin: number;
  tailMax: number;
  /** Count inserted at random positions inside the text. */
  randMin: number;
  randMax: number;
}

/** Full generator configuration that drives script building. */
export interface GenConfig {
  /** e.g. "uv run --no-sync python infer.py" */
  runPrefix: string;
  /** "hf" => --hf-checkpoint, "local" => --checkpoint */
  checkpointKind: 'hf' | 'local';
  checkpoint: string;
  /** Inference precision: bf16 (fast, GPU) or fp32 (safe, CPU/old GPU). */
  precision: 'bf16' | 'fp32';
  /** One text per non-empty line. */
  texts: string;
  caption: string;
  refMode: RefMode;
  refWav: string;
  /** Per-token emoji/symbol injection rules. */
  emojiEntries: EmojiEntry[];
  /** Generations per text line. */
  count: number;
  /** Output directory the scripts create and write into. */
  outputDir: string;
  params: ParamRange[];
}

/** Sidecar JSON written next to each wav and consumed by the curation tool. */
export interface SidecarMeta {
  schema: typeof SIDECAR_SCHEMA;
  wav: string;
  text: string;
  baseText: string;
  emoji: string | null;
  caption: string | null;
  model: string;
  checkpointKind: 'hf' | 'local';
  refMode: RefMode;
  /** Reference wav path when refMode === 'ref-wav', else null. */
  refWav: string | null;
  /** Running sequence number within the batch (1-based). */
  index: number | null;
  /** Batch run id (timestamp) shared by all files from one script run. */
  runId: string;
  seed: number | null;
  numSteps: number | null;
  cfgScaleText: number | null;
  cfgScaleCaption: number | null;
  cfgScaleSpeaker: number | null;
  durationScale: number | null;
  swayCoeff: number | null;
  truncationFactor: number | null;
  createdAt: string;
  command: string;
}

/** A wav discovered during curation, with optional parsed sidecar metadata. */
export interface AudioItem {
  id: string;
  /** Path relative to the picked root, for display. */
  relPath: string;
  name: string;
  wavHandle: FileSystemFileHandle;
  /** Directory containing the wav (for move/delete). */
  dirHandle: FileSystemDirectoryHandle;
  /** Sidecar file handle if a matching .json was found. */
  jsonHandle: FileSystemFileHandle | null;
  meta: SidecarMeta | null;
  status: 'none' | 'keep' | 'reject';
}
