// A folder's files, read into memory: for checking a product context on disk, and for tests.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Every file under `dir` by its path relative to it, skipping `.git` and `node_modules`. */
export async function readFolder(dir: string): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = {};
  const walk = async (rel: string) => {
    for (const e of await readdir(join(dir, rel), { withFileTypes: true })) {
      const path = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (e.name !== '.git' && e.name !== 'node_modules') await walk(path); }
      else if (e.isFile()) files[path] = await readFile(join(dir, path));
    }
  };
  await walk('');
  return files;
}
