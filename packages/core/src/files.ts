// Loading and checking a product context from where its files live.
import { validate } from './context/checks.ts';
import { CONTEXT_DIR, FILE_PATHS, FLOW_DIR } from './context/spec.ts';
import type { Finding } from './context/types.ts';
import { Workspace } from './context/workspace.ts';
import { toText, type ProductStore } from './store.ts';

const FLOW_FILE = new RegExp(`^${FLOW_DIR}/[^/]+\\.md$`);

/** The text of every product context file, the fixed files first, then the flows by name. */
export async function readContextFiles(store: ProductStore): Promise<Record<string, string>> {
  const paths = [...Object.values(FILE_PATHS), ...(await store.list(FLOW_DIR)).filter((p) => FLOW_FILE.test(p)).sort()];
  const texts = await Promise.all(paths.map((p) => store.read(p)));
  const files: Record<string, string> = {};
  paths.forEach((p, i) => { if (texts[i]) files[p] = toText(texts[i]!); }); // an absent file has no items yet
  return files;
}

export async function loadWorkspace(store: ProductStore): Promise<Workspace> {
  return new Workspace(await readContextFiles(store));
}

/** The checks, plus E-PICTURE for screenshots and mockups whose file is missing. */
export async function validateFiles(store: ProductStore, ws: Workspace): Promise<Finding[]> {
  const findings = validate(ws);
  const present = new Set(await store.list(CONTEXT_DIR));
  for (const s of ws.model.screens) {
    for (const key of ['picture', 'mockup'] as const) {
      const rel = s[key];
      if (rel && !present.has(`${CONTEXT_DIR}/${rel}`)) {
        const at = ws.locate(s.id);
        findings.push({
          code: 'E-PICTURE', severity: 'error', message: `${s.id} ${key} ${CONTEXT_DIR}/${rel} is missing`, items: [s.id],
          ...(at ? { file: at.doc.path, line: at.doc.segs[at.node.seg]!.line } : {}),
        });
      }
    }
  }
  return findings;
}
