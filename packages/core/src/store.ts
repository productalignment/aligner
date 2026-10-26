// Where a product's files live: a branch of its GitHub repository on the server, or
// memory in tests. Paths are relative to the repository root, with `/`.

export type FileChanges = Map<string, string | Uint8Array | null>;

export interface ProductStore {
  /** The file's content, or null when there is none. */
  read(path: string): Promise<Uint8Array | null>;
  /** The files under `dir`, at any depth. */
  list(dir: string): Promise<string[]>;
  /** Writes files (null removes one), as one change described by `note` (e.g. "edit FL-003"). */
  write(changes: FileChanges, note: string): Promise<void>;
  /** Changes whenever a file in product/ changes. */
  version(): Promise<string>;
  /** Runs `fn` alone: no other change, and no new commit taken in, while it reads and writes. */
  exclusive<T>(fn: () => Promise<T>): Promise<T>;
}

/** Runs functions one after another. */
export function serializer() {
  let queue: Promise<unknown> = Promise.resolve();
  return <T,>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn);
    queue = run.catch(() => undefined);
    return run;
  };
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const toBytes = (data: string | Uint8Array) => (typeof data === 'string' ? encoder.encode(data) : data);
export const toText = (data: Uint8Array) => decoder.decode(data);

/** Files kept in memory: for tests, and for checking a product folder read from disk. */
export class MemoryStore implements ProductStore {
  readonly files = new Map<string, Uint8Array>();
  readonly notes: string[] = [];
  private revision = 0;
  readonly exclusive = serializer();

  constructor(files: Record<string, string | Uint8Array> = {}) {
    for (const [path, data] of Object.entries(files)) this.files.set(path, toBytes(data));
  }

  async read(path: string) {
    return this.files.get(path) ?? null;
  }

  async list(dir: string) {
    return [...this.files.keys()].filter((p) => p.startsWith(`${dir}/`)).sort();
  }

  async write(changes: FileChanges, note: string) {
    for (const [path, data] of changes) {
      if (data === null) this.files.delete(path);
      else this.files.set(path, toBytes(data));
    }
    this.notes.push(note);
    this.revision++;
  }

  async version() {
    return String(this.revision);
  }

  text(path: string) {
    const data = this.files.get(path);
    return data && toText(data);
  }
}
