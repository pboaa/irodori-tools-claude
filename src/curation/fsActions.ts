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
 * Copy or move all kept items into a `selected/` subfolder of root.
 * The matching sidecar .json is transferred alongside each wav.
 */
export async function transferKept(
  root: FileSystemDirectoryHandle,
  items: AudioItem[],
  mode: 'copy' | 'move',
): Promise<TransferResult> {
  const kept = items.filter((it) => it.status === 'keep');
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
