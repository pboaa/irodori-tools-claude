import type { AudioItem } from '../types';
import { stem } from '../lib/sidecar';

async function writeFile(
  dir: FileSystemDirectoryHandle,
  name: string,
  data: ArrayBuffer | string,
): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(data);
  await writable.close();
}

/** Find a non-colliding name in `dir` by appending _1, _2, ... before ext. */
async function uniqueName(dir: FileSystemDirectoryHandle, name: string): Promise<string> {
  const dot = name.lastIndexOf('.');
  const base = dot <= 0 ? name : name.slice(0, dot);
  const ext = dot <= 0 ? '' : name.slice(dot);
  let candidate = name;
  let n = 0;
  // Loop until getFileHandle without create throws NotFound.
  for (;;) {
    try {
      await dir.getFileHandle(candidate);
      n += 1;
      candidate = `${base}_${n}${ext}`;
    } catch {
      return candidate;
    }
  }
}

export interface TransferResult {
  moved: number;
  errors: string[];
}

/**
 * Persist a rating into the item's sidecar JSON (read → patch → write back).
 * No-op when the wav has no sidecar (rating then lives in memory only).
 */
export async function writeRating(item: AudioItem, rating: number): Promise<void> {
  if (!item.jsonHandle) return;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(await (await item.jsonHandle.getFile()).text());
  } catch {
    obj = {};
  }
  obj.rating = rating;
  await writeFile(item.dirHandle, item.jsonHandle.name, JSON.stringify(obj, null, 2));
}

/**
 * Copy or move items whose rating meets `minRating` into a `selected/`
 * subfolder of root. The matching sidecar .json is transferred alongside.
 */
export async function transferRated(
  root: FileSystemDirectoryHandle,
  items: AudioItem[],
  minRating: number,
  mode: 'copy' | 'move',
): Promise<TransferResult> {
  const kept = items.filter((it) => it.rating >= minRating && it.rating > 0);
  const selected = await root.getDirectoryHandle('selected', { create: true });
  const errors: string[] = [];
  let moved = 0;

  for (const it of kept) {
    try {
      const wavName = await uniqueName(selected, it.name);
      const wavBuf = await (await it.wavHandle.getFile()).arrayBuffer();
      await writeFile(selected, wavName, wavBuf);

      if (it.jsonHandle) {
        const jsonName = `${stem(wavName)}.json`;
        const jsonText = await (await it.jsonHandle.getFile()).text();
        await writeFile(selected, jsonName, jsonText);
      }

      if (mode === 'move') {
        await it.dirHandle.removeEntry(it.name);
        if (it.jsonHandle) {
          await it.dirHandle.removeEntry(it.jsonHandle.name);
        }
      }
      moved += 1;
    } catch (e) {
      errors.push(`${it.relPath}: ${String(e)}`);
    }
  }

  return { moved, errors };
}
