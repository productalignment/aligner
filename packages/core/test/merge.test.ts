// The PM's draft moved onto what the coding agent pushed meanwhile: both sides' changes
// stay, item by item and field by field.
import { beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { MemoryStore, Workspace, itemName, mergeDraft, readContextFiles, readFolder, validate } from '../src/index.ts';

const TIDY = fileURLToPath(new URL('../../../examples/tidy', import.meta.url));
let base: Record<string, string>;

/** The product context after some edits, as files. */
const edited = (fn: (ws: Workspace) => void) => {
  const ws = new Workspace(base);
  fn(ws);
  return Object.fromEntries([...ws.files()].filter((e): e is [string, string] => e[1] !== null));
};

/** Merges, and reads the result: theirs with the merged files. */
function merge(ours: (ws: Workspace) => void, theirs: (ws: Workspace) => void) {
  const t = edited(theirs);
  const result = mergeDraft(base, edited(ours), t);
  const files = { ...t };
  for (const [path, text] of result.files) if (text === null) delete files[path]; else files[path] = text;
  const ws = new Workspace(files);
  return { ...result, ws, m: ws.model, step: (id: string) => ws.model.flows.flatMap((f) => f.steps).find((s) => s.id === id) };
}

beforeAll(async () => {
  base = await readContextFiles(new MemoryStore(await readFolder(TIDY)));
});

describe('merging the draft with what was pushed meanwhile', () => {
  it('keeps both sides\' changes to different items of the same file', () => {
    const r = merge(
      (ws) => ws.modify('PE-001', { who: 'Works nights' }),
      (ws) => ws.modify('PE-002', { who: 'Lives alone' }),
    );
    expect(r.m.personas.map((p) => p.who)).toEqual(['Works nights', 'Lives alone']);
    expect(r.kept).toEqual([]);
    expect(validate(r.ws).filter((f) => f.severity === 'error')).toEqual([]);
  });

  it('keeps both sides\' changes to different fields of the same item', () => {
    const r = merge(
      (ws) => ws.modify('FS-015', { label: 'Open the scores' }),
      (ws) => ws.modify('FS-015', { target: '10, 80, 80, 8' }),
    );
    expect(r.step('FS-015')).toMatchObject({ label: 'Open the scores', target: '10, 80, 80, 8', screen: 'SC-001' });
    expect(r.kept).toEqual([]);
  });

  it("keeps the draft's value of a field both changed, and says so", () => {
    const r = merge(
      (ws) => ws.modify('FS-015', { label: 'Open the scores' }),
      (ws) => ws.modify('FS-015', { label: 'Tap Scores' }),
    );
    expect(r.step('FS-015')!.label).toBe('Open the scores');
    expect(r.kept).toEqual(['FS-015']);
    expect(itemName(r.m, 'FS-015')).toBe('“Open the scores”');
  });

  it('drops a change to an item they removed, and says so', () => {
    const r = merge(
      (ws) => ws.modify('FS-016', { label: 'See the scores' }),
      (ws) => ws.removeCascade('FS-016'),
    );
    expect(r.step('FS-016')).toBeUndefined();
    expect(r.dropped).toEqual(['FS-016']);
  });

  it('removes what the draft removed, even if they changed it', () => {
    const r = merge(
      (ws) => ws.removeCascade('SC-005'),
      (ws) => ws.modify('SC-005', { name: 'Scores' }),
    );
    expect(r.m.screens.map((s) => s.id)).not.toContain('SC-005');
    expect(r.step('FS-016')!.screen).toBeUndefined();
    expect(r.kept).toEqual(['SC-005']);
  });

  it("renumbers what both added under the same ID, with what refers to it", () => {
    const r = merge(
      (ws) => { ws.add('step', 'FS-017', { step_type: 'user-action', label: 'Share the scores' }, { parent: 'FL-003' }); ws.add('connection', 'FS-016>FS-017', { from: 'FS-016', to: 'FS-017' }, { parent: 'FL-003' }); },
      (ws) => { ws.add('step', 'FS-017', { step_type: 'system-action', label: 'Send a weekly summary' }, { parent: 'FL-003' }); ws.add('connection', 'FS-015>FS-017', { from: 'FS-015', to: 'FS-017' }, { parent: 'FL-003' }); },
    );
    expect([...r.renames]).toEqual([['FS-017', 'FS-018']]);
    expect(r.step('FS-017')!.label).toBe('Send a weekly summary');
    expect(r.step('FS-018')!.label).toBe('Share the scores');
    expect(r.m.flows.find((f) => f.id === 'FL-003')!.connections.map((c) => `${c.from}>${c.to}`)).toEqual(['FS-014>FS-015', 'FS-015>FS-016', 'FS-016>FS-018', 'FS-015>FS-017']);
    expect(validate(r.ws).filter((f) => f.severity === 'error')).toEqual([]);
  });

  it('renumbers a flow both added, file and all', () => {
    const r = merge(
      (ws) => ws.add('flow', 'FL-004', { name: 'Swap a turn', jobs: ['JB-002'] }),
      (ws) => ws.add('flow', 'FL-004', { name: 'Leave the flat', jobs: [] }),
    );
    expect(r.m.flows.map((f) => `${f.id} ${f.name}`)).toEqual(['FL-001 Complete a chore', 'FL-002 Set up the flat', 'FL-003 Check fairness', 'FL-004 Leave the flat', 'FL-005 Swap a turn']);
    expect([...r.files.keys()]).toEqual(['product/flows/FL-005.md']);
  });

  it("keeps both sides' changes to the vision, part by part", () => {
    const r = merge(
      (ws) => ws.modify('VI-THE', { text: 'Tidy Flat' }),
      (ws) => ws.modify('VI-FOR', { text: 'students who share a flat' }),
    );
    expect(r.m.vision).toMatchObject({ the: 'Tidy Flat', for: 'students who share a flat' });
  });

  it("keeps both sides' click zones, and the agent's label on one the draft left alone", () => {
    const r = merge(
      (ws) => ws.add('link', 'SC-003@6.7, 60, 86.7, 8>SC-005', { box: '6.7, 60, 86.7, 8', to: 'SC-005' }, { parent: 'SC-003' }),
      (ws) => { ws.add('link', 'SC-004@6.7, 50, 86.7, 8>SC-002', { box: '6.7, 50, 86.7, 8', to: 'SC-002' }, { parent: 'SC-004' }); ws.modify('SC-001@6.7, 22.2, 86.7, 10>SC-002', { label: 'your chore' }); },
    );
    expect(r.m.screens.map((x) => x.links.map((l) => `${l.to}${l.label ? ` (${l.label})` : ''}`))).toEqual([
      ['SC-002 (your chore)', 'SC-005'], ['SC-003', 'SC-001 (swap agreed)'], ['SC-001', 'SC-005'], ['SC-001', 'SC-002'], ['SC-001'],
    ]);
    expect(validate(r.ws).filter((f) => f.severity === 'error')).toEqual([]);
  });

  it('drops a click zone to a screen they removed, and says so', () => {
    const r = merge(
      (ws) => ws.add('link', 'SC-003@6.7, 60, 86.7, 8>SC-005', { box: '6.7, 60, 86.7, 8', to: 'SC-005' }, { parent: 'SC-003' }),
      (ws) => ws.removeCascade('SC-005'),
    );
    expect(r.m.screens.find((x) => x.id === 'SC-003')!.links.map((l) => l.to)).toEqual(['SC-001']);
    expect(r.dropped).toEqual(['SC-003@6.7, 60, 86.7, 8>SC-005']);
    expect(itemName(r.m, r.dropped[0]!)).toBe('a click zone');
  });

  it('adds what the draft added where it put it, in files theirs left alone', () => {
    const r = merge(
      (ws) => { ws.add('job', 'JB-005', { text: 'When I cook, I want the kitchen clean' }, { parent: 'PE-001' }); ws.add('constraint', 'PC-002', { text: 'Works offline' }); },
      (ws) => ws.modify('FS-014', { label: 'On the list' }),
    );
    expect(r.m.personas[0]!.jobs.map((j) => j.id)).toEqual(['JB-001', 'JB-002', 'JB-005']);
    expect(r.m.constraints.map((c) => c.text)).toEqual(['No paid third-party services in the MVP', 'Works offline']);
    expect(r.step('FS-014')!.label).toBe('On the list');
  });
});
