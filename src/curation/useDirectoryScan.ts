import { useCallback, useRef, useState } from 'react';
import type { AudioItem } from '../types';
import { parseSidecar, stem } from '../lib/sidecar';

export function supportsFileSystemAccess(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

interface ScanState {
  root: FileSystemDirectoryHandle | null;
  items: AudioItem[];
  scanning: boolean;
  /** Number of sidecars still being parsed in the background (0 = done). */
  loadingMeta: number;
  error: string | null;
}

/**
 * Recursively walk a directory handle, collecting every .wav and pairing it
 * with a same-stem .json sidecar handle. Sidecar CONTENTS are NOT read here —
 * that happens lazily in the background so huge folders enumerate instantly.
 */
async function walk(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  out: AudioItem[],
): Promise<void> {
  const files = new Map<string, FileSystemFileHandle>();
  const dirs: FileSystemDirectoryHandle[] = [];
  for await (const entry of dir.values()) {
    if (entry.kind === 'file') files.set(entry.name, entry as FileSystemFileHandle);
    else dirs.push(entry as FileSystemDirectoryHandle);
  }

  for (const [name, handle] of files) {
    if (!name.toLowerCase().endsWith('.wav')) continue;
    const jsonHandle = files.get(`${stem(name)}.json`) ?? null;
    out.push({
      id: prefix + name,
      relPath: prefix + name,
      name,
      wavHandle: handle,
      dirHandle: dir,
      jsonHandle,
      meta: null,
      rating: 0,
    });
  }

  for (const sub of dirs) {
    if (sub.name === 'selected') continue; // skip our own output folder
    await walk(sub, `${prefix}${sub.name}/`, out);
  }
}

export function useDirectoryScan() {
  const [state, setState] = useState<ScanState>({
    root: null,
    items: [],
    scanning: false,
    loadingMeta: 0,
    error: null,
  });
  // Generation token so a background loader from a previous pick stops early.
  const genRef = useRef(0);

  const setItems = useCallback(
    (updater: (items: AudioItem[]) => AudioItem[]) =>
      setState((s) => ({ ...s, items: updater(s.items) })),
    [],
  );

  /** Parse sidecars in parallel batches, patching items as they resolve. */
  const loadMeta = useCallback(async (items: AudioItem[], gen: number) => {
    const CONC = 24;
    const todo = items.filter((it) => it.jsonHandle);
    let done = 0;
    for (let i = 0; i < todo.length; i += CONC) {
      if (genRef.current !== gen) return; // a newer pick superseded us
      const chunk = todo.slice(i, i + CONC);
      const results = await Promise.all(
        chunk.map(async (it): Promise<[string, AudioItem['meta']]> => {
          try {
            return [it.id, parseSidecar(await (await it.jsonHandle!.getFile()).text())];
          } catch {
            return [it.id, null];
          }
        }),
      );
      if (genRef.current !== gen) return;
      const map = new Map(results);
      done += chunk.length;
      const remaining = todo.length - done;
      setState((s) => ({
        ...s,
        loadingMeta: remaining,
        items: s.items.map((it) => {
          if (!map.has(it.id)) return it;
          const meta = map.get(it.id)!;
          // Keep an already-set (user) rating; otherwise hydrate from the JSON.
          const rating = (it.rating || (meta?.rating ?? 0)) as AudioItem['rating'];
          return { ...it, meta, rating };
        }),
      }));
    }
  }, []);

  const pick = useCallback(async () => {
    if (!supportsFileSystemAccess()) {
      setState((s) => ({ ...s, error: 'このブラウザは File System Access API に未対応です（Chrome / Edge を使用してください）。' }));
      return;
    }
    const gen = ++genRef.current;
    try {
      // @ts-expect-error - showDirectoryPicker is not in default TS lib.
      const root: FileSystemDirectoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      setState({ root, items: [], scanning: true, loadingMeta: 0, error: null });
      const out: AudioItem[] = [];
      await walk(root, '', out);
      out.sort((a, b) => a.relPath.localeCompare(b.relPath));
      const pending = out.filter((it) => it.jsonHandle).length;
      setState({ root, items: out, scanning: false, loadingMeta: pending, error: null });
      void loadMeta(out, gen); // fill params in the background
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') {
        setState((s) => ({ ...s, scanning: false }));
        return;
      }
      setState((s) => ({ ...s, scanning: false, error: String(e) }));
    }
  }, [loadMeta]);

  return { ...state, pick, setItems };
}
