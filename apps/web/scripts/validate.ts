// Checks the product context in a folder, as Aligner does: `npm run validate -- <folder>`. CI runs
// it on this repo's own product context and on the example.
import { join, resolve } from 'node:path';
import { CONTEXT_DIR, MemoryStore, loadWorkspace, readFolder, report, validateFiles } from '@aligner/core';

const dir = resolve(process.env.INIT_CWD ?? process.cwd(), process.argv[2] ?? '.');
const files = Object.entries(await readFolder(join(dir, CONTEXT_DIR))).map(([path, data]) => [`${CONTEXT_DIR}/${path}`, data] as const);
const store = new MemoryStore(Object.fromEntries(files));
const ws = await loadWorkspace(store);
const { text, errors } = report(dir, ws.model, await validateFiles(store, ws));
console.log(text);
process.exitCode = errors ? 1 : 0;
