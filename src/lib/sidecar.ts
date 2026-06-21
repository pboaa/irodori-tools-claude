import { SIDECAR_SCHEMA, type SidecarMeta } from '../types';

/**
 * Parse arbitrary JSON text into a SidecarMeta if it looks like one.
 * Returns null when the content is not a recognizable sidecar object.
 */
export function parseSidecar(text: string): SidecarMeta | null {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  // Accept anything with our schema tag, or anything with a "text" field as a
  // best-effort fallback for hand-written sidecars.
  if (o.schema !== SIDECAR_SCHEMA && typeof o.text !== 'string') return null;

  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const strOrNull = (v: unknown): string | null =>
    typeof v === 'string' ? v : null;

  return {
    schema: SIDECAR_SCHEMA,
    wav: str(o.wav),
    text: str(o.text),
    baseText: str(o.baseText ?? o.text),
    emoji: strOrNull(o.emoji),
    caption: strOrNull(o.caption),
    model: str(o.model),
    refMode: o.refMode === 'ref-wav' ? 'ref-wav' : 'no-ref',
    seed: num(o.seed),
    numSteps: num(o.numSteps),
    cfgScaleText: num(o.cfgScaleText),
    cfgScaleCaption: num(o.cfgScaleCaption),
    cfgScaleSpeaker: num(o.cfgScaleSpeaker),
    durationScale: num(o.durationScale),
    swayCoeff: num(o.swayCoeff),
    truncationFactor: num(o.truncationFactor),
    createdAt: str(o.createdAt),
    command: str(o.command),
  };
}

/** Strip a file extension, e.g. "001_12.wav" -> "001_12". */
export function stem(name: string): string {
  const i = name.lastIndexOf('.');
  return i <= 0 ? name : name.slice(0, i);
}
