import { beforeEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { MemoryStore, ProductSession, readFolder, type Markup } from '../src/index.ts';

const TIDY = fileURLToPath(new URL('../../../examples/tidy', import.meta.url));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const REF = { repo: 'flatmates/tidy', branch: 'main' };
let store: MemoryStore;
let s: ProductSession;
const read = (path: string) => store.text(path);
const has = (path: string) => store.files.has(path);

beforeEach(async () => {
  store = new MemoryStore(await readFolder(TIDY));
  s = new ProductSession(store, REF);
});

describe('ProductSession', () => {
  it('reads a snapshot of the branch, named after the product', async () => {
    const snap = await s.snapshot();
    expect(snap).toMatchObject({ repo: 'flatmates/tidy', branch: 'main', hasContext: true, name: 'Tidy', findings: [] });
  });

  it('writes each edit as one change, described for its commit', async () => {
    const { id } = await s.edit({ op: 'add', type: 'job', parent: 'PE-001', fields: { text: 'When I cook, I want the kitchen clean' } });
    expect(id).toBe('JB-005');
    await s.edit({ op: 'modify', id: 'VI-THE', fields: { text: 'Tidy Flat' } });
    expect(read('product/personas.md')).toContain('- JB-005: When I cook, I want the kitchen clean\n');
    expect(read('product/product.md')).toContain('- the: Tidy Flat\n');
    expect(store.notes).toEqual(['add JB-005 to PE-001', 'edit the vision']);
  });

  it('adds a flow linked to a job', async () => {
    const flow = await s.edit({ op: 'add', type: 'flow', fields: { name: 'Swap a turn', jobs: ['JB-002'] } });
    expect(flow.snapshot.model.flows.find((f) => f.id === flow.id)!.jobs).toEqual(['JB-002']);
  });

  it('adds a screen on a step', async () => {
    const { id, snapshot } = await s.edit({ op: 'add', type: 'screen', on: 'FS-009', fields: { name: 'Still yours' } });
    expect(snapshot.model.flows[0]!.steps.find((x) => x.id === 'FS-009')!.screen).toBe(id);
  });

  it('stores a screenshot, then a mockup with its shapes, and removes the mockup when the shapes are gone', async () => {
    await s.setPicture('SC-001', 'shot.png', PNG);
    expect(has('product/screens/SC-001.png')).toBe(true);
    expect(has('product/screens/SC-001.svg')).toBe(false);
    const markup: Markup = {
      frame: { kind: 'screenshot', width: 390, height: 844 },
      shapes: [{ kind: 'rect', x: 0, y: 0, w: 1, h: 1, fill: { color: '#ffffff', opacity: 1 }, stroke: { color: '#171717', opacity: 1, width: 2, style: 'solid' }, radius: 8 }],
    };
    const res = await s.saveMockup('SC-001', markup, PNG);
    expect(res.snapshot.model.screens[0]).toMatchObject({ id: 'SC-001', name: 'This week', picture: 'screens/SC-001.png', mockup: 'screens/SC-001.mockup.png' });
    expect(await s.markup('SC-001')).toEqual(markup);
    expect(await s.picture('screens/SC-001.mockup.png')).toMatch(/^data:image\/png;base64,/);
    await s.saveMockup('SC-001', { ...markup, shapes: [] }, new Uint8Array());
    expect((await s.snapshot()).model.screens[0]!.mockup).toBeUndefined();
    expect(has('product/screens/SC-001.mockup.png')).toBe(false);
    expect(await s.markup('SC-001')).toBeNull();
    expect(store.notes).toEqual(['screenshot of SC-001', 'mockup of SC-001', 'clear the mockup of SC-001']);
  });

  it('removing a screen removes its files, unlinks its steps and removes the links to it, in one change', async () => {
    await s.edit({ op: 'remove', id: 'SC-005' });
    expect(has('product/screens/SC-005.svg')).toBe(false);
    expect((await s.snapshot()).model.flows.find((f) => f.id === 'FL-003')!.steps.at(-1)!.screen).toBeUndefined();
    expect((await s.snapshot()).model.screens[0]!.links.map((l) => l.to)).toEqual(['SC-002']);
    expect(store.notes).toEqual(['remove SC-005']);
  });

  it('keeps where the PM put the steps of a flow, beside the flow, and goes back to the automatic layout on request', async () => {
    expect((await s.snapshot()).layouts).toEqual({});
    const snap = await s.saveLayout('FL-002', { 'FS-010': { x: 10.4, y: 20.6 }, 'FS-011': { x: 300, y: 20 } });
    expect(snap.layouts['FL-002']).toEqual({ 'FS-010': { x: 10, y: 21 }, 'FS-011': { x: 300, y: 20 } });
    expect(read('product/flows/FL-002.md')).not.toContain('300'); // the flow itself stays free of coordinates
    expect((await s.snapshot()).findings).toEqual([]);
    expect((await s.saveLayout('FL-002', null)).layouts).toEqual({});
    await expect(s.saveLayout('FL-404', {})).rejects.toThrow(/not a flow/);
  });

  it('adds a step where it was dropped, connected from the step its connector was drawn from, never in between', async () => {
    const { id, snapshot } = await s.edit({ op: 'add', type: 'step', parent: 'FL-002', link: 'FS-011', at: { x: 500, y: 200 }, layout: { 'FS-010': { x: 0, y: 0 } }, fields: { step_type: 'user-action', label: 'New step' } });
    const flow = snapshot.model.flows.find((f) => f.id === 'FL-002')!;
    expect(flow.connections.map((c) => `${c.from}>${c.to}`)).toEqual(['FS-010>FS-011', 'FS-011>FS-012', 'FS-012>FS-013', `FS-011>${id}`]);
    expect(snapshot.layouts['FL-002']).toEqual({ 'FS-010': { x: 0, y: 0 }, [id]: { x: 500, y: 200 } });
    expect(store.notes).toEqual([`add ${id} to FL-002`]);
  });

  it('keeps how the PM drew the connectors of a flow, and moves a connector onto another step, keeping its shape and other end', async () => {
    const snap = await s.saveLines('FL-002', {
      'FS-010>FS-011': { shape: 'elbow', from: { x: 1, y: 0.33333 }, via: { x: 120.4, y: 40 } },
      'FS-011>FS-012': {},
      'FS-404>FS-010': { shape: 'straight' },
    });
    expect(snap.lines['FL-002']).toEqual({ 'FS-010>FS-011': { shape: 'elbow', from: { x: 1, y: 0.333 }, via: { x: 120, y: 40 } } });
    const { id, snapshot } = await s.edit({ op: 'modify', id: 'FS-010>FS-011', fields: { to: 'FS-013' } });
    expect(id).toBe('FS-010>FS-013');
    expect(snapshot.model.flows.find((f) => f.id === 'FL-002')!.connections.map((c) => `${c.from}>${c.to}`)).toEqual(['FS-010>FS-013', 'FS-011>FS-012', 'FS-012>FS-013']);
    expect(snapshot.lines['FL-002']).toEqual({ 'FS-010>FS-013': { shape: 'elbow', from: { x: 1, y: 0.333 } } });
    await expect(s.edit({ op: 'modify', id, fields: { from: 'FS-013' } })).rejects.toThrow(/two steps/);
    await expect(s.edit({ op: 'modify', id, fields: { from: 'FS-012' } })).rejects.toThrow(/connected already/);
    await expect(s.edit({ op: 'modify', id, fields: { from: 'FS-001' } })).rejects.toThrow(/steps of FL-002/);
    await s.saveLines('FL-002', { [id]: { shape: 'straight', via: { x: 5, y: 5 } } });
    expect((await s.saveLayout('FL-002', null)).lines['FL-002']).toEqual({ [id]: { shape: 'straight' } }); // tidied up, unbent
    await s.edit({ op: 'remove', id: 'FS-010' });
    expect(has('product/flows/FL-002.lines.json')).toBe(false);
    expect(store.notes).toEqual(['draw the connectors of FL-002', 'edit FS-010 -> FS-011', 'draw the connectors of FL-002', 'tidy up FL-002', 'remove FS-010']);
  });

  it('keeps how the PM drew the arrows on the map, and moves an arrow onto another screen, keeping its shape', async () => {
    const arrow = 'SC-003@6.7, 78.1, 86.7, 8.1>SC-001';
    expect((await s.saveLines('screens', { [arrow]: { shape: 'elbow', to: { x: 0, y: 0.5 }, via: { x: 1, y: 2 } } })).lines.screens).toEqual({ [arrow]: { shape: 'elbow', to: { x: 0, y: 0.5 }, via: { x: 1, y: 2 } } });
    expect(has('product/screens.lines.json')).toBe(true);
    const { id, snapshot } = await s.edit({ op: 'modify', id: arrow, fields: { to: 'SC-004' } });
    expect(snapshot.lines.screens).toEqual({ [id]: { shape: 'elbow' } });
    await s.edit({ op: 'remove', id: 'SC-004' });
    expect(has('product/screens.lines.json')).toBe(false);
    expect(store.notes).toEqual(['draw the arrows on the map', 'edit the click zone on SC-003 to SC-001', 'remove SC-004']);
  });

  it('keeps where the PM put the screens on the map, beside the flows\' layouts, and goes back to the automatic layout on request', async () => {
    const snap = await s.saveLayout('screens', { 'SC-004': { x: 0, y: 0 }, 'SC-001': { x: 310.4, y: 0 } });
    expect(snap.layouts).toEqual({ screens: { 'SC-004': { x: 0, y: 0 }, 'SC-001': { x: 310, y: 0 } } });
    expect(has('product/screens.layout.json')).toBe(true);
    expect((await s.saveLayout('screens', null)).layouts).toEqual({});
    expect(store.notes).toEqual(['move the screens on the map', 'tidy up the map']);
  });

  it('links a click zone to a screen, changes where it leads and when, and removes it, each one change', async () => {
    const { id } = await s.edit({ op: 'add', type: 'link', parent: 'SC-003', fields: { box: '6.7, 60.04, 86.7, 8', to: 'SC-005' } });
    expect(id).toBe('SC-003@6.7, 60, 86.7, 8>SC-005');
    expect(read('product/screens.md')).toContain('### Links\n- 6.7, 78.1, 86.7, 8.1 -> SC-001\n- 6.7, 60, 86.7, 8 -> SC-005\n');
    await s.edit({ op: 'modify', id, fields: { to: 'SC-004', label: 'first time' } });
    const moved = 'SC-003@6.7, 60, 86.7, 8>SC-004';
    expect((await s.snapshot()).model.screens[2]!.links).toEqual([{ box: '6.7, 78.1, 86.7, 8.1', to: 'SC-001' }, { box: '6.7, 60, 86.7, 8', to: 'SC-004', label: 'first time' }]);
    await expect(s.edit({ op: 'add', type: 'link', parent: 'SC-003', fields: { box: '6.7, 60, 86.7, 8', to: 'SC-004' } })).rejects.toThrow(/already opens that screen/);
    await expect(s.edit({ op: 'add', type: 'link', parent: 'SC-003', fields: { box: 'the button', to: 'SC-004' } })).rejects.toThrow(/x, y, width, height/);
    await expect(s.edit({ op: 'add', type: 'link', parent: 'SC-003', fields: { box: '1, 1, 5, 5', to: 'FS-001' } })).rejects.toThrow(/FS-001 is not a screen/);
    await expect(s.edit({ op: 'add', type: 'link', parent: 'FS-001', fields: { box: '1, 1, 5, 5', to: 'SC-001' } })).rejects.toThrow(/FS-001 is not a screen/);
    await s.edit({ op: 'remove', id: moved });
    expect((await s.snapshot()).model.screens[2]!.links).toEqual([{ box: '6.7, 78.1, 86.7, 8.1', to: 'SC-001' }]);
    expect(store.notes).toEqual(['link SC-003 to SC-005', 'edit the click zone on SC-003 to SC-005', 'remove the click zone on SC-003 to SC-004']);
  });

  it('adds a new screen at the end of a click zone\'s arrow, where it was dropped on the map, in one change', async () => {
    const { id, snapshot } = await s.edit({
      op: 'add', type: 'screen', fields: { name: 'Flat' }, zone: { screen: 'SC-001', box: '36.1, 91.4, 27.8, 7.3' },
      at: { x: 900, y: 420 }, layout: { 'SC-001': { x: 310, y: 0 } },
    });
    expect(id).toBe('SC-006');
    expect(snapshot.model.screens.find((x) => x.id === 'SC-001')!.links.at(-1)).toEqual({ box: '36.1, 91.4, 27.8, 7.3', to: 'SC-006' });
    expect(snapshot.layouts.screens).toEqual({ 'SC-001': { x: 310, y: 0 }, 'SC-006': { x: 900, y: 420 } });
    expect(store.notes).toEqual(['add SC-006, opened from SC-001']);
  });

  it('keeps the screens where they are on the map when a link is drawn', async () => {
    const { snapshot } = await s.edit({ op: 'add', type: 'link', parent: 'SC-003', fields: { box: '6.7, 60, 86.7, 8', to: 'SC-004' }, layout: { 'SC-003': { x: 900, y: 0 }, 'SC-004': { x: 0, y: 0 } } });
    expect(snapshot.layouts.screens).toEqual({ 'SC-003': { x: 900, y: 0 }, 'SC-004': { x: 0, y: 0 } });
  });

  it('removing a flow removes its layout', async () => {
    await s.saveLayout('FL-003', { 'FS-014': { x: 0, y: 0 } });
    await s.edit({ op: 'remove', id: 'FL-003' });
    expect(has('product/flows/FL-003.layout.json')).toBe(false);
  });

  it('refuses pictures outside product/', async () => {
    await expect(s.picture('../package.json')).rejects.toThrow(/must live in product/);
  });

  it('reports a missing screenshot file', async () => {
    store.files.delete('product/screens/SC-003.svg');
    expect((await s.snapshot()).findings.map((f) => f.code)).toEqual(['E-PICTURE']);
  });

  it('changes its version when a file changes', async () => {
    const before = await s.version();
    await store.write(new Map([['product/flows/FL-003.md', read('product/flows/FL-003.md')!.replace('Check fairness', 'See who did what')]]), 'the agent');
    expect(await s.version()).not.toBe(before);
  });

  it('starts a product on an empty branch, with the agent files, never overwriting, in one change', async () => {
    const empty = new MemoryStore({ 'CLAUDE.md': '# My rules\n' });
    const blocks = { 'CLAUDE.md': '<!-- begin -->\nblock\n', 'AGENTS.md': '<!-- begin -->\nblock\n' };
    const fresh = new ProductSession(empty, REF);
    const written = await fresh.init({ 'product/INSTRUCTIONS.md': 'rules\n' }, { blocks, marker: '<!-- begin' });
    expect(written.sort()).toEqual(['AGENTS.md', 'CLAUDE.md', 'product/INSTRUCTIONS.md', 'product/personas.md', 'product/product.md', 'product/screens.md']);
    expect(empty.text('CLAUDE.md')).toBe('# My rules\n\n<!-- begin -->\nblock\n');
    expect(empty.notes).toEqual(['add the product context']);
    expect(await fresh.init({}, { blocks, marker: '<!-- begin' })).toEqual([]);
    expect(await fresh.snapshot()).toMatchObject({ hasContext: true, name: 'tidy', findings: [] });
  });
});
