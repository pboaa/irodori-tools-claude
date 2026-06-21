import { useCallback, useState } from 'react';
import type { AudioItem } from '../types';
import { parseSidecar, stem } from '../lib/sidecar';

export function supportsFileSystemAccess(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

interface ScanState {
  root: FileSystemDirectoryHandle | null;
  items: AudioItem[];
  scanning: boolean;
  error: string | null;
}

/**
 * Recursively walk a directory handle, collecting every .wav and pairing it
 * with a same-stem .json sidecar when present.
 */
async function walk(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  out: AudioItem[],
): Promise<void> {
  // Collect this directory's entries first so we can pair wav <-> json.
  const files = new Map<string, FileSystemFileHandle>();
  const dirs: FileSystemDirectoryHandle[] = [];
  for await (const entry of dir.values()) {
    if (entry.kind === 'file') files.set(entry.name, entry as FileSystemFileHandle);
    else dirs.push(entry as FileSystemDirectoryHandle);
  }

  for (const [name, handle] of files) {
    if (!name.toLowerCase().endsWith('.wav')) continue;
    const jsonName = `${stem(name)}.json`;
    const jsonHandle = files.get(jsonName) ?? null;
    let meta = null;
    if (jsonHandle) {
      try {
        meta = parseSidecar(await (await jsonHandle.getFile()).text());
      } catch {
        meta = null;
      }
    }
    out.push({
      id: prefix + name,
      relPath: prefix + name,
      name,
      wavHandle: handle,
      dirHandle: dir,
      jsonHandle,
      meta,
      status: 'none',
    });
  }

  for (const sub of dirs) {
    // Skip the output folder we create so re-scans stay clean.
    if (sub.name === 'selected') continue;
    await walk(sub, `${prefix}${sub.name}/`, out);
  }
}

export function useDirectoryScan() {
  const [state, setState] = useState<ScanState>({
    root: null,
    items: [],
    scanning: false,
    error: null,
  });

  const pick = useCallback(async () => {
    if (!supportsFileSystemAccess()) {
      setState((s) => ({ ...s, error: 'このブラウザは File System Access API に未対応です（Chrome / Edge を使用してください）。' }));
      return;
    }
    try {
      // @ts-expect-error - showDirectoryPicker is not in default TS lib.
      const root: FileSystemDirectoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      setState({ root, items: [], scanning: true, error: null });
      const out: AudioItem[] = [];
      await walk(root, '', out);
      out.sort((a, b) => a.relPath.localeCompare(b.relPath));
      setState({ root, items: out, scanning: false, error: null });
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') {
        setState((s) => ({ ...s, scanning: false }));
        return;
      }
      setState((s) => ({ ...s, scanning: false, error: String(e) }));
    }
  }, []);

  const setItems = useCallback(
    (updater: (items: AudioItem[]) => AudioItem[]) =>
      setState((s) => ({ ...s, items: updater(s.items) })),
    [],
  );

  return { ...state, pick, setItems };
}
