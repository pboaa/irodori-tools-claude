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
}

export type RefMode = 'no-ref' | 'ref-wav';

/** Full generator configuration that drives script building. */
export interface GenConfig {
  /** e.g. "uv run --no-sync python infer.py" */
  runPrefix: string;
  /** "hf" => --hf-checkpoint, "local" => --checkpoint */
  checkpointKind: 'hf' | 'local';
  checkpoint: string;
  /** One text per non-empty line. */
  texts: string;
  caption: string;
  refMode: RefMode;
  refWav: string;
  /** Emoji pool (comma/newline separated). */
  emojiPool: string;
  appendEmoji: boolean;
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
  refMode: RefMode;
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
