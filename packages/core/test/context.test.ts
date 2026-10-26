import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { fileURLToPath } from 'node:url';
import { STEP_TYPES, Workspace, formatTarget, linkId, parseTarget, renderRepo, runChecks, segment, type Model } from '../src/context/index.ts';
import { MemoryStore, readContextFiles, readFolder } from '../src/index.ts';

const TIDY = fileURLToPath(new URL('../../../examples/tidy', import.meta.url));
const tidyFiles = async () => readContextFiles(new MemoryStore(await readFolder(TIDY)));
const load = async () => new Workspace(await tidyFiles());

/** Lines present in `after` but not in `before`, and vice versa (multiset diff). */
function lineDiff(before: string, after: string) {
  const count = (t: string) => t.split('\n').reduce((m, l) => m.set(l, (m.get(l) ?? 0) + 1), new Map<string, number>());
  const a = count(before);
  const b = count(after);
  const added: string[] = [];
  const removed: string[] = [];
  for (const [l, n] of b) for (let i = 0; i < n - (a.get(l) ?? 0); i++) added.push(l);
  for (const [l, n] of a) for (let i = 0; i < n - (b.get(l) ?? 0); i++) removed.push(l);
  return { added, removed };
}

describe('the example product (examples/tidy)', () => {
  it('segments every file losslessly', async () => {
    for (const [path, text] of Object.entries(await tidyFiles())) {
      expect(segment(text).map((s) => s.raw).join(''), path).toBe(text);
    }
  });

  it('parses into the four layers, with no errors or warnings', async () => {
    const ws = await load();
    expect(ws.parseErrors).toEqual([]);
    expect(runChecks(ws.model)).toEqual([]);
    const m = ws.model;
    expect(m.vision.the).toBe('Tidy');
    expect(m.personas.map((p) => [p.name, p.jobs.map((j) => j.id)])).toEqual([['Busy flatmate', ['JB-001', 'JB-002']], ['Flat organiser', ['JB-003', 'JB-004']]]);
    expect(m.personas[0]!.pains).toBe('Forgets whose turn it is until someone complains');
    expect(m.personas[0]!.jobs[1]).toEqual({ id: 'JB-002', text: "When I'm away, I want to hand my turn to someone, so the flat still runs", name: 'Hand over my turn' });
    expect(m.flows.map((f) => [f.id, f.jobs])).toEqual([['FL-001', ['JB-001', 'JB-002']], ['FL-002', ['JB-003']], ['FL-003', ['JB-004']]]);
    expect(m.flows[0]!.connections).toContainEqual({ from: 'FS-006', to: 'FS-008', label: 'yes' });
    expect(m.screens[0]).toEqual({
      id: 'SC-001', name: 'This week', picture: 'screens/SC-001.svg',
      links: [{ box: '6.7, 22.2, 86.7, 10', to: 'SC-002' }, { box: '69.4, 91.4, 27.8, 7.3', to: 'SC-005' }],
    });
    expect(m.screens[1]!.links[1]).toEqual({ box: '6.7, 77.5, 86.7, 8.1', to: 'SC-001', label: 'swap agreed' });
  });

  it('renders the same text it parsed', async () => {
    const files = await tidyFiles();
    expect(renderRepo(new Workspace(files).model)).toEqual(files);
  });
});

describe('the checks', () => {
  it('finds broken links, jobs with no flow, flows serving no job, and one-way decisions', async () => {
    const ws = await load();
    ws.modify('FL-003', { jobs: ['JB-009'] });
    ws.modify('FS-001', { screen: 'SC-404' });
    ws.add('flow', 'FL-004', { name: 'Loose' });
    ws.add('step', 'FS-018', { step_type: 'user-decision', label: 'Which?' }, { parent: 'FL-004' });
    expect(runChecks(ws.model).map((f) => `${f.code} ${f.items[0]}`).sort()).toEqual([
      'E-LINK FL-003', 'E-LINK FS-001', 'W-DECISION-BRANCH FS-018', 'W-FLOW-NO-JOB FL-004', 'W-JOB-NO-FLOW JB-004',
    ]);
  });

  it('reads a step\'s target, and finds one that is malformed, outside the picture, or on a step with no screen', async () => {
    const ws = await load();
    ws.modify('FS-002', { target: '8, 64, 84, 9' });
    expect(ws.docs.get('product/flows/FL-001.md')!.text).toContain('- FS-002: [user-action] Tap a chore\n  - screen: SC-001\n  - target: 8, 64, 84, 9\n');
    expect(parseTarget(ws.model.flows[0]!.steps[1]!.target)).toEqual({ x: 8, y: 64, w: 84, h: 9 });
    expect(runChecks(ws.model)).toEqual([]);
    ws.modify('FS-004', { target: '50, 50, 60, 10' });
    ws.modify('FS-006', { target: '1, 2, 3, 4' });
    ws.modify('FS-007', { target: 'the button' });
    expect(runChecks(ws.model).map((f) => `${f.code} ${f.items[0]}`)).toEqual(['E-TARGET FS-004', 'E-TARGET FS-006', 'E-TARGET FS-007']);
    expect(formatTarget({ x: 8.04, y: 64.26, w: 84, h: 9 })).toBe('8, 64.3, 84, 9');
  });

  it('finds a click zone that is malformed or outside the picture, one to a missing screen or to something else, and one on a screen with no picture', async () => {
    const ws = await load();
    const add = (screen: string, box: string, to: string) => ws.add('link', linkId(screen, box, to), { box, to }, { parent: screen });
    add('SC-003', '1, 2, 3', 'SC-002');
    add('SC-003', '50, 50, 60, 10', 'SC-004');
    add('SC-004', '1, 1, 5, 5', 'SC-404');
    add('SC-004', '1, 10, 5, 5', 'FL-001');
    ws.add('screen', 'SC-006', { name: 'Invite' });
    add('SC-006', '10, 10, 20, 5', 'SC-001');
    expect(ws.parseErrors).toEqual([]);
    expect(runChecks(ws.model).map((f) => `${f.code} ${f.message}`)).toEqual([
      'E-ZONE SC-003 click zone 1, 2, 3 must be "x, y, width, height" in percent of the picture',
      'E-ZONE SC-003 click zone 50, 50, 60, 10 must be "x, y, width, height" in percent of the picture',
      'E-LINK SC-004 links to missing SC-404',
      'E-LINK SC-004 links to flow FL-001, which is not a screen',
      'E-ZONE SC-006 has click zones but no screenshot or mockup',
    ]);
  });

  it('reports the same click zone and screen listed twice, and a link outside a screen\'s links', () => {
    const ws = new Workspace({
      'product/product.md': '# Product\n',
      'product/screens.md': '# Screens\n- 1, 1, 5, 5 -> SC-001\n\n## SC-001 Home\n- picture: screens/SC-001.png\n\n### Links\n- 1, 1, 5, 5 -> SC-001\n- 1,1,5,5 -> SC-001\n',
    });
    expect(ws.parseErrors.map((f) => f.message)).toEqual(['Link is not allowed here', 'SC-001 lists the click zone 1,1,5,5 -> SC-001 twice']);
  });

  it('reports frontmatter, unknown fields and misplaced items as parse errors', () => {
    const ws = new Workspace({
      'product/product.md': '---\nartifact: product\n---\n# Product\n',
      'product/personas.md': '# Personas\n\n## PE-001 Ann\n- mood: tired\n\n### Jobs\n- FS-001: nope\n',
    });
    expect(ws.parseErrors.map((f) => f.message)).toEqual([
      'Remove the frontmatter: product context files have none',
      'Unknown field "mood" on PE-001',
      'FS-001 is not allowed here',
    ]);
  });
});

describe('span-preserving edits', () => {
  it('modify rewrites only that item', async () => {
    const ws = await load();
    const before = ws.docs.get('product/personas.md')!.text;
    ws.modify('JB-002', { text: 'When I travel, I want to swap my turn, so the flat still runs' });
    ws.modify('PE-001', { context: 'Mostly on the phone' });
    expect(lineDiff(before, ws.docs.get('product/personas.md')!.text)).toEqual({
      added: ['- context: Mostly on the phone', '- JB-002: When I travel, I want to swap my turn, so the flat still runs'],
      removed: ['- context: Checks the phone between shifts, mostly when a reminder arrives', "- JB-002: When I'm away, I want to hand my turn to someone, so the flat still runs"],
    });
    expect([...ws.changedFiles().keys()]).toEqual(['product/personas.md']);
  });

  it('keeps untouched bytes even when they are not canonical', async () => {
    const files = await tidyFiles();
    files['product/personas.md'] = files['product/personas.md']!.replace('- JB-001: When', '- JB-001:  When');
    const ws = new Workspace(files);
    ws.modify('JB-003', { text: 'Set up the rota' });
    expect(ws.docs.get('product/personas.md')!.text).toContain('- JB-001:  When');
  });

  it('keeps a step with no label yet: a shape placed on the canvas and not named', async () => {
    const ws = await load();
    ws.add('step', 'FS-017', { step_type: 'user-decision', label: '' }, { parent: 'FL-003' });
    expect(ws.docs.get('product/flows/FL-003.md')!.text).toContain('- FS-016: [start-end] See who did what this month\n  - screen: SC-005\n- FS-017: [user-decision]\n');
    expect(ws.parseErrors).toEqual([]);
    expect(ws.model.flows[2]!.steps.at(-1)).toEqual({ id: 'FS-017', step_type: 'user-decision', label: '' });
    ws.modify('FS-017', { label: 'Anyone home?' });
    expect(ws.model.flows[2]!.steps.at(-1)!.label).toBe('Anyone home?');
    ws.modify('FS-017', { label: '' });
    expect(ws.docs.get('product/flows/FL-003.md')!.text).toContain('- FS-017: [user-decision]\n');
  });

  it('allocates the next ID from the files, with no counters', async () => {
    const ws = await load();
    expect(ws.allocate('JB')).toBe('JB-005');
    expect(ws.allocate('FS')).toBe('FS-017');
    expect(ws.allocate('PE')).toBe('PE-003');
    expect(new Workspace({}).allocate('SC')).toBe('SC-001');
  });

  it('adds personas, jobs, screens and flows in their files', async () => {
    const ws = await load();
    ws.add('persona', 'PE-003', { name: 'Landlord', who: 'Owns the flat' });
    ws.add('job', 'JB-005', { text: 'When I visit, I want the flat clean' }, { parent: 'PE-003' });
    ws.add('screen', 'SC-006', { name: 'Invite' }, { after: 'SC-001' });
    ws.add('flow', 'FL-004', { name: 'Invite a flatmate', jobs: ['JB-003'] });
    expect(ws.docs.get('product/personas.md')!.text).toMatch(/## PE-003 Landlord\n- who: Owns the flat\n\n### Jobs\n- JB-005: When I visit, I want the flat clean\n$/);
    expect(ws.model.screens.map((s) => s.id)).toEqual(['SC-001', 'SC-006', 'SC-002', 'SC-003', 'SC-004', 'SC-005']);
    expect(ws.docs.get('product/flows/FL-004.md')!.text).toBe('# FL-004 Invite a flatmate\n- jobs: JB-003\n\n## Steps\n\n## Connections\n');
    expect(ws.parseErrors).toEqual([]);
  });

  it('adds a screen\'s first link under a new "### Links", edits it in place, and the last one takes the heading with it', async () => {
    const ws = await load();
    ws.add('screen', 'SC-006', { name: 'Invite', picture: 'screens/SC-006.png' }, { after: 'SC-001' });
    const plain = ws.docs.get('product/screens.md')!.text;
    const id = linkId('SC-006', '10, 20, 30, 5', 'SC-001');
    ws.add('link', id, { box: '10, 20, 30, 5', to: 'SC-001' }, { parent: 'SC-006' });
    expect(ws.docs.get('product/screens.md')!.text).toContain('## SC-006 Invite\n- picture: screens/SC-006.png\n\n### Links\n- 10, 20, 30, 5 -> SC-001\n\n## SC-002 Chore\n');
    ws.modify(id, { label: 'once invited' });
    expect(lineDiff(plain, ws.docs.get('product/screens.md')!.text)).toEqual({ added: ['', '### Links', '- 10, 20, 30, 5 -> SC-001: once invited'], removed: [] });
    ws.modify(id, { to: 'SC-002', label: null });
    expect(ws.model.screens[1]!.links).toEqual([{ box: '10, 20, 30, 5', to: 'SC-002' }]);
    expect(ws.locate(id)).toBeUndefined();
    ws.remove(linkId('SC-006', '10, 20, 30, 5', 'SC-002'));
    expect(ws.docs.get('product/screens.md')!.text).toBe(plain);
    expect(ws.parseErrors).toEqual([]);
  });

  it('removing a screen removes the links to it, and the headings left with none', async () => {
    const ws = await load();
    ws.removeCascade('SC-001');
    expect(ws.model.screens.map((s) => [s.id, s.links.map((l) => l.to)])).toEqual([['SC-002', ['SC-003']], ['SC-003', []], ['SC-004', []], ['SC-005', []]]);
    expect(ws.docs.get('product/screens.md')!.text).toBe('# Screens\n\n## SC-002 Chore\n- picture: screens/SC-002.svg\n\n### Links\n- 6.7, 67.2, 86.7, 8.1 -> SC-003\n\n## SC-003 Done\n- picture: screens/SC-003.svg\n\n## SC-004 Set up flat\n- picture: screens/SC-004.svg\n\n## SC-005 Scoreboard\n- picture: screens/SC-005.svg\n');
    expect(ws.parseErrors).toEqual([]);
  });

  it('removing a job unlinks it from flows; removing a step drops its connections; removing a screen unlinks its steps', async () => {
    const ws = await load();
    ws.removeCascade('JB-002');
    expect(ws.model.flows[0]!.jobs).toEqual(['JB-001']);
    ws.removeCascade('FS-006');
    expect(ws.model.flows[0]!.connections.some((c) => c.from === 'FS-006' || c.to === 'FS-006')).toBe(false);
    ws.modify('FS-004', { target: '6, 42, 88, 8' });
    ws.removeCascade('SC-002');
    expect(ws.model.flows[0]!.steps.find((s) => s.id === 'FS-003')!.screen).toBeUndefined();
    expect(ws.model.flows[0]!.steps.find((s) => s.id === 'FS-004')!.target).toBeUndefined();
    ws.removeCascade('PE-002');
    expect(ws.model.flows.find((f) => f.id === 'FL-002')!.jobs).toEqual([]);
    expect(ws.parseErrors).toEqual([]);
  });
});

// ---- Round trip --------------------------------------------------------------

const CHARS = 'abcdefghij XYZ-:,.[]#*`<>/()"\'é→'.split('');
const text = fc
  .string({ unit: fc.constantFrom(...CHARS), minLength: 1, maxLength: 24 })
  .map((s) => s.trim().replace(/\s+/g, ' '))
  .filter((s) => s.length > 0 && !s.startsWith('#'));

const modelArb: fc.Arbitrary<Model> = fc
  .record({
    vision: fc.record({ for: text, who: text, the: text, is_a: text, that: text, unlike: text, our_product: text }, { requiredKeys: [] }),
    os: fc.array(text, { maxLength: 3 }),
    constraints: fc.array(text, { maxLength: 2 }),
    personas: fc.array(fc.record({ name: text, who: fc.option(text, { nil: undefined }), pains: fc.option(text, { nil: undefined }), jobs: fc.array(fc.record({ text, name: fc.option(text, { nil: undefined }) }), { maxLength: 3 }) }), { maxLength: 3 }),
    flows: fc.array(fc.record({
      name: text,
      steps: fc.array(fc.record({ type: fc.constantFrom(...STEP_TYPES), label: text, screen: fc.boolean() }), { maxLength: 5 }),
      edgeLabels: fc.array(fc.option(text, { nil: undefined }), { maxLength: 4 }),
    }), { maxLength: 3 }),
    screens: fc.array(fc.record({ name: text, picture: fc.boolean(), links: fc.array(fc.option(text, { nil: undefined }), { maxLength: 2 }) }), { maxLength: 3 }),
  })
  .map((g) => {
    const counters: Record<string, number> = {};
    const next = (p: string) => `${p}-${String((counters[p] = (counters[p] ?? 0) + 1)).padStart(3, '0')}`;
    const m: Model = {
      vision: g.vision,
      out_of_scope: g.os.map((t) => ({ id: next('OS'), text: t })),
      constraints: g.constraints.map((t) => ({ id: next('PC'), text: t })),
      personas: g.personas.map((p) => ({
        id: next('PE'), name: p.name, ...(p.who ? { who: p.who } : {}), ...(p.pains ? { pains: p.pains } : {}),
        jobs: p.jobs.map((j) => ({ id: next('JB'), text: j.text, ...(j.name ? { name: j.name } : {}) })),
      })),
      flows: [],
      screens: g.screens.map((s) => {
        const id = next('SC');
        return { id, name: s.name, ...(s.picture ? { picture: `screens/${id}.png` } : {}), links: [] };
      }),
    };
    // Each screen's click zones open the screens after it, round the list.
    g.screens.forEach((s, i) => {
      m.screens[i]!.links = s.links.map((label, j) => ({
        box: `${j * 10}, ${i * 10 + 0.5}, 5, 5`, to: m.screens[(i + j + 1) % m.screens.length]!.id, ...(label ? { label } : {}),
      }));
    });
    const jobIds = m.personas.flatMap((p) => p.jobs.map((j) => j.id));
    for (const f of g.flows) {
      const steps = f.steps.map((s, i) => ({
        id: next('FS'), step_type: s.type, label: s.label,
        ...(s.screen && m.screens[i % Math.max(1, m.screens.length)] ? { screen: m.screens[i % m.screens.length]!.id } : {}),
      }));
      const connections = steps.slice(1).map((s, i) => ({ from: steps[i]!.id, to: s.id, ...(f.edgeLabels[i] ? { label: f.edgeLabels[i] } : {}) }));
      m.flows.push({ id: next('FL'), name: f.name, jobs: jobIds.slice(0, 1), steps, connections });
    }
    return m;
  });

describe('round trip', () => {
  it('parses what it renders, losslessly', () => {
    fc.assert(fc.property(modelArb, (m) => {
      const files = renderRepo(m);
      const ws = new Workspace(files);
      expect(ws.parseErrors).toEqual([]);
      expect(ws.model).toEqual(m);
      for (const t of Object.values(files)) expect(segment(t).map((s) => s.raw).join('')).toBe(t);
    }), { numRuns: 150 });
  });
});
