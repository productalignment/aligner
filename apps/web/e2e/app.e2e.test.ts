// Drives the real UI against the built server and a stand-in for GitHub, the way the PM works:
// signed in, a repository's branch; the product, personas and jobs; a flow
// for a job, sketched step by step; a screen with a mockup drawn on its screenshot. Edits are kept
// as the PM's draft until they commit it, and what the coding agent pushes shows up by itself.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Locator, Page } from 'playwright';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFolder } from '@aligner/core';
import { startAligner, type Harness } from './harness';

const TIDY = fileURLToPath(new URL('../../../examples/tidy', import.meta.url));
const REPO = 'pat/tidy';
let h: Harness;
let page: Page;
/** What the page's Content-Security-Policy refused, as the browser reported it. */
const refused: string[] = [];

/** A file as the PM sees it: their draft's, or the branch's. */
const read = async (rel: string, branch = 'main') => {
  const data = h.file(REPO, branch, rel);
  if (data === undefined) throw new Error(`${rel} is not on ${branch}`);
  return data.toString('utf8');
};
const has = (rel: string) => h.file(REPO, 'main', rel) !== undefined;
const waitFor = async (check: () => boolean | Promise<boolean>) => {
  for (let i = 0; i < 100; i++) { if (await check()) return; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('condition not met');
};
const fileHas = (rel: string, text: string | RegExp, branch = 'main') => waitFor(async () => {
  const t = await read(rel, branch).catch(() => '');
  return typeof text === 'string' ? t.includes(text) : text.test(t);
});

const centre = async (label: string) => {
  const b = (await page.locator(`[data-step="${label}"]`).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
/** Drags from one of a step's dots (shown on hover) to a point. */
const connect = async (from: string, to: { x: number; y: number }) => {
  const c = await centre(from);
  await page.mouse.move(c.x, c.y);
  const d = (await page.locator(`[data-step="${from}"] .react-flow__handle-bottom`).boundingBox())!;
  await page.mouse.move(d.x + d.width / 2, d.y + d.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
};
/** Picks a shape in the toolbar, clicks the canvas at (dx, dy) from its corner, and types the step. */
const place = async (type: string, dx: number, dy: number, label: string) => {
  await page.locator(`[data-step-type="${type}"]`).click();
  const pane = (await page.locator('.react-flow__pane').boundingBox())!;
  await page.mouse.click(pane.x + dx, pane.y + dy);
  await page.locator('.react-flow textarea').waitFor();
  await page.keyboard.type(label);
  await page.keyboard.press('Enter');
  await page.locator(`[data-step="${label}"]`).waitFor();
};

beforeAll(async () => {
  h = await startAligner({ repos: { [REPO]: await readFolder(TIDY), 'pat/fresh': { 'README.md': '# Fresh\n' } } });
  page = await h.open('/');
  page.on('console', (m) => { if (m.text().includes('Content Security Policy')) refused.push(m.text()); });
  page.setDefaultTimeout(8_000);
});

afterAll(async () => {
  await h?.close();
});

describe('getting to a product', () => {
  it('lists the repositories the PM gave Aligner, and opens one on its default branch', async () => {
    await page.locator('[data-repo]').first().waitFor();
    expect(await page.locator('[data-repo]').allTextContents()).toEqual(['pat/fresh', 'pat/tidy']);
    await page.locator(`[data-repo="${REPO}"]`).click();
    await page.locator('[data-vision]').waitFor();
    expect(new URL(page.url()).search).toBe('?repo=pat%2Ftidy&branch=main');
    expect(await page.locator('[data-branch-menu]').innerText()).toContain('main');
  });
});

describe('the Product page', () => {
  it('has three views, and shows names and pictures, never IDs', async () => {
    expect(await page.locator('[data-tab]').allTextContents()).toEqual(['Product', 'Flows', 'Screens']);
    const text = await page.locator('main').innerText();
    expect(text).toContain('Busy flatmate');
    expect(text).toContain('Do my share\nWhen a chore is due');
    expect(text).not.toMatch(/\b[A-Z]{2}-\d{3}\b/);
    for (const gone of ['History', 'Problems', 'Ask your agent', 'Value canvas']) expect(await page.getByText(gone, { exact: true }).count()).toBe(0);
  });

  it('edits the vision in place', async () => {
    await page.locator('[data-vision] [data-text]', { hasText: 'mobile chore planner' }).click();
    await page.locator('[data-vision] textarea').fill('shared chore planner');
    await page.locator('[data-vision] textarea').press('Enter');
    await fileHas('product/product.md', '- is a: shared chore planner\n');
  });

  it('folds the boundaries, and adds a constraint', async () => {
    expect(await page.getByText('Splitting bills or paying flatmates').count()).toBe(0);
    await page.locator('[data-boundaries]').click();
    await page.getByText('Splitting bills or paying flatmates').waitFor();
    await page.getByRole('button', { name: 'Add', exact: true }).nth(1).click();
    await page.getByPlaceholder('e.g. Works offline').fill('Works offline');
    await page.getByPlaceholder('e.g. Works offline').press('Enter');
    await fileHas('product/product.md', '- PC-002: Works offline\n');
  });

  it('adds a persona with what they want, and a job', async () => {
    await page.getByRole('button', { name: 'Persona', exact: true }).click();
    await page.getByPlaceholder('Who is it for? e.g. Working parent').fill('Landlord');
    await page.getByPlaceholder('Who is it for? e.g. Working parent').press('Enter');
    const persona = page.locator('[data-persona="Landlord"]');
    await persona.waitFor();
    await persona.getByText('What they want').click();
    await persona.locator('textarea').fill('A flat that stays in good shape');
    await persona.locator('textarea').press('Enter');
    await persona.getByRole('button', { name: 'Job', exact: true }).click();
    await persona.getByPlaceholder('a short name for the job').fill('Check on the flat');
    await persona.getByPlaceholder('a short name for the job').press('Enter');
    await persona.getByPlaceholder('the situation or trigger').fill('I visit');
    await persona.getByPlaceholder('the situation or trigger').press('Enter');
    await persona.getByPlaceholder('the motivation').fill('see the flat is looked after');
    await persona.getByPlaceholder('the motivation').press('Enter');
    await persona.getByPlaceholder('the expected outcome').fill('renew the lease');
    await persona.getByPlaceholder('the expected outcome').press('Enter');
    await fileHas('product/personas.md', /## PE-003 Landlord\n- wants: A flat that stays in good shape\n\n### Jobs\n- JB-005: When I visit, I want to see the flat is looked after, so I can renew the lease\n  - name: Check on the flat\n/);
  });
});

describe('a flow for a job', () => {
  it('starts from the job: "+ Flow" makes a flow that serves it, and opens it', async () => {
    const job = page.locator('[data-job^="When I visit"]');
    await job.locator('[data-add-flow]').click();
    await job.getByPlaceholder('Flow name…').fill('Visit the flat');
    await job.getByPlaceholder('Flow name…').press('Enter');
    await page.locator('[data-tab="flows"][aria-current="page"]').waitFor();
    await fileHas('product/flows/FL-004.md', '# FL-004 Visit the flat\n- jobs: JB-005\n');
  });

  it('is sketched shape by shape, and connected from a dot', async () => {
    await place('start-end', 200, 260, 'Open the visit report');
    await place('user-action', 520, 260, 'See the latest chores done');
    await connect('Open the visit report', await centre('See the latest chores done'));
    await fileHas('product/flows/FL-004.md', '- FS-017: [start-end] Open the visit report\n- FS-018: [user-action] See the latest chores done\n\n## Connections\n- FS-017 -> FS-018\n');
  });

  it('gives a step a new screen, named after it', async () => {
    await page.locator('[data-step="See the latest chores done"]').click();
    await page.locator('[data-step-panel]').waitFor();
    await page.locator('[data-step-screen]').selectOption({ label: '+ New screen' });
    await fileHas('product/screens.md', '## SC-006 See the latest chores done\n');
    await fileHas('product/flows/FL-004.md', '  - screen: SC-006\n');
  });
});

describe('a mockup over a screenshot', () => {
  type Saved = { frame: { kind: string; width: number; height: number }; shapes: Record<string, unknown>[] };
  const saved = async () => JSON.parse(await read('product/screens/SC-006.shapes.json')) as Saved;
  const savedHas = (check: (m: Saved) => boolean) => waitFor(async () => { try { return check(await saved()); } catch { return false; } });
  const frame = async () => (await page.locator('[data-frame]').boundingBox())!;
  const drag = async (a: { x: number; y: number }, b: { x: number; y: number }, shift = false) => {
    if (shift) await page.keyboard.down('Shift');
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await page.mouse.up();
    if (shift) await page.keyboard.up('Shift');
  };
  const middle = async (sel: string) => { const b = (await page.locator(sel).first().boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };

  it('adds the screenshot, then draws a rectangle and a text, saved as the mockup the agent reads', async () => {
    await page.locator('[data-open-screen]').click();
    await page.locator('[data-frame="phone"]').waitFor(); // no screenshot yet: a blank phone
    await page.locator('[data-screenshot-input]').setInputFiles(join(TIDY, 'product/screens/SC-003.svg'));
    await fileHas('product/screens.md', '- picture: screens/SC-006.svg\n');
    await page.locator('[data-frame="screenshot"]').waitFor();

    const f = await frame();
    await page.locator('[data-tool="rect"]').click();
    await drag({ x: f.x + f.width * 0.1, y: f.y + f.height * 0.2 }, { x: f.x + f.width * 0.8, y: f.y + f.height * 0.4 });
    await page.locator('[data-tool="text"]').click();
    await page.mouse.click(f.x + f.width * 0.2, f.y + f.height * 0.6);
    await page.keyboard.type('Show a photo of each room');
    await page.keyboard.press('Enter');

    await fileHas('product/screens.md', '- mockup: screens/SC-006.mockup.png\n');
    await savedHas((m) => m.shapes.length === 2);
    const m = await saved();
    expect(m.frame.kind).toBe('screenshot');
    expect(m.shapes.map((s) => s.kind)).toEqual(['rect', 'text']);
    expect(m.shapes[1]).toMatchObject({ text: 'Show a photo of each room' });
    expect(h.file(REPO, 'main', 'product/screens/SC-006.mockup.png')!.subarray(1, 4).toString()).toBe('PNG');
  });

  it("styles the selected shape from its menu: fill, border and the text's look", async () => {
    await page.mouse.click(...Object.values(await middle('[data-shape="rect"]')) as [number, number]);
    await page.locator('[data-paint="fill"]').click();
    await page.locator('[data-swatch="#2563eb"]').click();
    await page.locator('[data-slider="opacity"]').fill('40');
    await page.keyboard.press('Escape');
    await page.locator('[data-paint="stroke"]').click();
    await page.locator('[data-stroke-style="dashed"]').click();
    await page.locator('[data-slider="thickness"]').fill('4');
    await page.keyboard.press('Escape');
    await page.locator('[data-radius]').click();
    await page.locator('[data-slider="corners"]').fill('0');
    await page.keyboard.press('Escape');
    await savedHas((m) => (m.shapes[0] as { radius: number }).radius === 0);
    expect((await saved()).shapes[0]).toMatchObject({ fill: { color: '#2563eb', opacity: 0.4 }, stroke: { width: 4, style: 'dashed' }, radius: 0 });

    await page.mouse.click(...Object.values(await middle('[data-shape="text"]')) as [number, number]);
    await page.locator('[data-bold]').click();
    await page.locator('[data-size]').selectOption('24');
    await savedHas((m) => m.shapes[1]!.size === 24 && m.shapes[1]!.bold === true);
  });

  it('reshapes a shape by its handles, keeping its proportions with Shift', async () => {
    await page.mouse.click(...Object.values(await middle('[data-shape="rect"]')) as [number, number]);
    const before = (await saved()).shapes[0] as { w: number; h: number };
    const se = await middle('[data-handle="se"]');
    await drag(se, { x: se.x + 60, y: se.y + 5 }, true);
    await savedHas((m) => (m.shapes[0] as { w: number }).w > before.w);
    const after = (await saved()).shapes[0] as { w: number; h: number };
    expect(after.w / after.h).toBeCloseTo(before.w / before.h, 1);
  });

  it('places an icon found by its name, and a picture beside the screen', async () => {
    await page.locator('[data-tool="icon"]').click();
    await page.locator('[data-icon-search]').fill('calendar days');
    await page.locator('[data-icon="CalendarDays"]').click();
    const f = await frame();
    await page.mouse.click(f.x + f.width * 0.5, f.y + f.height * 0.8);
    await page.locator('[data-picture-input]').setInputFiles(join(TIDY, 'product/screens/SC-001.svg'));
    await savedHas((m) => m.shapes.length === 4);
    await drag(await middle('[data-shape="image"]'), { x: f.x + f.width * 1.5, y: f.y + f.height * 0.5 });
    await savedHas((m) => (m.shapes[3]!.x as number) > 390);
    expect((await saved()).shapes.slice(2).map((s) => [s.kind, s.name ?? ''])).toEqual([['icon', 'CalendarDays'], ['image', '']]);
    expect(String((await saved()).shapes[3]!.src)).toMatch(/^data:image\//);
  });

  it('pulls the frame longer for a screen that scrolls, and leaves what lies beside it out of the picture', async () => {
    const before = (await saved()).frame;
    const handle = await middle('[data-frame-handle]');
    await drag(handle, { x: handle.x, y: handle.y + 120 });
    await savedHas((m) => m.frame.height > before.height);
    const frame = (await saved()).frame;
    await waitFor(async () => {
      const png = h.file(REPO, 'main', 'product/screens/SC-006.mockup.png')!;
      return png.readUInt32BE(16) === frame.width * 2 && png.readUInt32BE(20) === frame.height * 2; // the picture beside it is not in it
    });
  });

  it('selects every shape an area touches, and brings them to the front from the right-click menu', async () => {
    const f = await frame();
    await page.keyboard.press('Escape');
    await drag({ x: f.x - 30, y: f.y + f.height * 0.15 }, { x: f.x + f.width * 0.3, y: f.y + f.height * 0.65 });
    const text = await middle('[data-shape="text"]');
    await page.mouse.click(text.x, text.y, { button: 'right' });
    await page.locator('[data-order="front"]').click();
    await savedHas((m) => m.shapes[0]!.kind === 'icon');
    expect((await saved()).shapes.map((s) => s.kind)).toEqual(['icon', 'image', 'rect', 'text']);
  });

  it('draws the mockup on a blank phone instead of the screenshot', async () => {
    await page.locator('[data-tool="frame"]').click();
    await page.locator('[data-frame-option="phone"]').click();
    await page.locator('[data-frame="phone"]').waitFor();
    await savedHas((m) => m.frame.kind === 'phone');
  });

  it('shows the screen on the map with its Mockup badge', async () => {
    await page.locator('[data-tab="screens"]').click();
    await page.locator('[data-map-screen="See the latest chores done"]', { hasText: 'Mockup' }).waitFor();
  });

  it('removes the mockup when every shape is cleared', async () => {
    await page.locator('[data-map-screen="See the latest chores done"]').dblclick();
    await page.locator('[data-shape]').first().waitFor();
    await page.getByTitle('Clear the mockup').click();
    await page.getByTitle('Clear the mockup').click();
    await waitFor(async () => !(await read('product/screens.md')).includes('mockup:'));
    expect(has('product/screens/SC-006.mockup.png')).toBe(false);
  });

  it('starts a new design on a blank laptop before anything is drawn, though the screen has a screenshot', async () => {
    await page.locator('[data-tab="screens"]').click();
    await page.locator('[data-map-screen="See the latest chores done"]').dblclick();
    await page.locator('[data-frame="screenshot"]').waitFor();
    await page.locator('[data-tool="frame"]').click();
    expect(await page.locator('[data-frame-option]').allTextContents()).toEqual(['Phone', 'Laptop', 'Screenshot']);
    await page.locator('[data-frame-option="laptop"]').click();
    await page.locator('[data-frame="laptop"]').waitFor();
    await page.waitForTimeout(300);
    expect(await page.locator('[data-frame]').getAttribute('data-frame')).toBe('laptop'); // it stays, with nothing drawn yet
    const f = await frame();
    for (const y of [0.1, 0.5]) {
      await page.locator('[data-tool="rect"]').click();
      await drag({ x: f.x + f.width * 0.1, y: f.y + f.height * y }, { x: f.x + f.width * 0.4, y: f.y + f.height * (y + 0.2) });
    }
    await savedHas((m) => m.frame.kind === 'laptop' && m.shapes.length === 2);
  });

  it('leaves a sticky note for the coding agent, typed in place', async () => {
    const f = await frame();
    await page.locator('[data-tool="note"]').click();
    await page.mouse.click(f.x + f.width * 0.75, f.y + f.height * 0.5);
    await page.keyboard.type('Keep this list short');
    await page.keyboard.press('Enter');
    await savedHas((m) => m.shapes.length === 3);
    expect((await saved()).shapes[2]).toMatchObject({ kind: 'text', note: true, text: 'Keep this list short' });
  });

  it('shows the screenshot as it is, whole and in the middle, with Original', async () => {
    await page.locator('[data-view-original="true"]').click();
    await page.locator('[data-frame="screenshot"]').waitFor();
    expect(await page.locator('[data-shape]').count()).toBe(0);
    const canvas = (await page.locator('[data-markup]').boundingBox())!;
    const shot = await frame();
    expect(Math.abs(shot.x + shot.width / 2 - (canvas.x + canvas.width / 2))).toBeLessThan(2);
    expect(shot.y > canvas.y && shot.y + shot.height < canvas.y + canvas.height).toBe(true);
    await page.locator('[data-view-original="false"]').click();
    await page.locator('[data-frame="laptop"]').waitFor();
  });

  it('selects every shape with Ctrl+A, not the page, and Delete removes them with the mockup', async () => {
    await page.keyboard.press('ControlOrMeta+a');
    expect(await page.evaluate(() => String(getSelection()))).toBe('');
    await page.keyboard.press('Delete');
    await waitFor(async () => !(await read('product/screens.md')).includes('mockup:'));
  });
});

describe('gaps show as layout', () => {
  it('puts a flow that serves no job in the grey tray, and a job with no flow keeps its "+ Flow"', async () => {
    await page.locator('[data-tab="flows"]').click();
    await page.getByRole('button', { name: 'Flow', exact: true }).click();
    await page.getByPlaceholder('Flow name…').fill('Loose ends');
    await page.getByPlaceholder('Flow name…').press('Enter');
    await fileHas('product/flows/FL-005.md', '# FL-005 Loose ends\n');
    await page.locator('[data-tab="product"]').click();
    await page.locator('[data-unlinked] [data-flow-card="Loose ends"]').waitFor();
  });

  it('links the flow to a job from its header, by the job\'s sentence', async () => {
    await page.locator('[data-unlinked] [data-flow-card="Loose ends"]').click();
    await page.locator('[data-link-jobs]').click();
    await page.locator('label', { hasText: 'When someone says they do more' }).click();
    await fileHas('product/flows/FL-005.md', '- jobs: JB-004\n');
    await page.keyboard.press('Escape');
    await page.locator('[data-tab="product"]').click();
    await page.locator('[data-job^="When someone says they do more"] [data-flow-card="Loose ends"]').waitFor();
    expect(await page.locator('[data-unlinked]').count()).toBe(0);
  });

  it('filters the flows by the job they serve', async () => {
    await page.locator('[data-tab="flows"]').click();
    const filter = page.locator('[data-job-filter]');
    await filter.selectOption({ label: 'Set up the rota' });
    await waitFor(async () => (await page.locator('[data-flow-link]').count()) === 1);
    await page.locator('[data-flow-link="Set up the flat"]').waitFor();
    await filter.selectOption({ label: 'All jobs' });
    await page.locator('[data-flow-link="Complete a chore"]').waitFor();
    await page.locator('[data-tab="product"]').click();
  });

  it('opens the job a flow serves from the flow\'s header, on the Product page; with several jobs, the PM picks one', async () => {
    await page.locator('[data-job^="When someone says they do more"] [data-flow-card="Loose ends"]').click();
    await page.locator('[data-flow-jobs]').click();
    await page.locator('[data-job^="When someone says they do more"][data-lit]').waitFor();
    await page.locator('[data-tab="flows"]').click();
    await page.locator('[data-flow-link="Complete a chore"]').click();
    await page.locator('[data-flow-jobs]').click();
    await page.locator('[data-open-job^="When I\'m away"]').click();
    await page.locator('[data-job^="When I\'m away"][data-lit]').waitFor();
  });
});

describe('the flow canvas', () => {
  const flow = () => read('product/flows/FL-002.md');
  /** A visible point on a connector's line (not under a step), to click it; the whole flow in view first, with no step's panel over it. */
  const onConnector = async (id: string) => {
    await page.keyboard.press('Escape');
    await page.locator('.react-flow__controls-fitview').click();
    await page.waitForTimeout(300);
    return connectorPoint(id);
  };
  const connectorPoint = (id: string) => page.locator(`.react-flow__edge[data-id="${id}"] path.react-flow__edge-path`).evaluate((p: SVGPathElement) => {
    const m = p.getScreenCTM()!;
    for (const f of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8]) {
      const q = p.getPointAtLength(p.getTotalLength() * f);
      const pt = { x: q.x * m.a + m.e, y: q.y * m.d + m.f };
      if (document.elementFromPoint(pt.x, pt.y)?.closest('.react-flow__edge') === p.closest('.react-flow__edge')) return pt;
    }
    throw new Error('the connector is hidden');
  });

  /** Where an element is, once it shows: a connector's handles come back as the canvas takes in a save. */
  const shown = async (sel: string) => {
    let b: Awaited<ReturnType<Locator['boundingBox']>> = null;
    await waitFor(async () => !!(b = await page.locator(sel).boundingBox()));
    return b!;
  };

  beforeAll(async () => {
    await page.locator('[data-tab="flows"]').click();
    await page.locator('[data-flow-link="Set up the flat"]').click();
    await page.locator('[data-step="Start the rota"]').waitFor();
  });

  it('moves a step, and keeps where it was put beside the flow', async () => {
    const c = await centre('Start the rota');
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x, c.y + 150, { steps: 8 });
    await page.mouse.up();
    await fileHas('product/flows/FL-002.layout.json', '"FS-012"');
    expect(await flow()).not.toMatch(/"x"/);
    await page.locator('[data-tidy-up]').waitFor();
  });

  it('draws a connector from a step to another, dropped anywhere on it', async () => {
    await connect('First launch', await centre('Start the rota'));
    await fileHas('product/flows/FL-002.md', '- FS-010 -> FS-012\n');
  });

  it('reshapes a connector, glues its end to a dot of another step, and bends it, as on Miro', async () => {
    const lines = 'product/flows/FL-002.lines.json';
    const p = await onConnector('FS-011>FS-012');
    await page.mouse.click(p.x, p.y);
    await page.locator('[data-line-shape="elbow"]').click();
    await fileHas(lines, '"shape": "elbow"');
    // Its end onto the top dot of another step: the connector now leads there, glued to that dot.
    const end = await shown('[data-line-end="to"]');
    const onto = await shown('[data-step="This week\'s list is shown"]');
    await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2);
    await page.mouse.down();
    await page.mouse.move(onto.x + onto.width / 2, onto.y + 2, { steps: 10 });
    await page.mouse.up();
    await fileHas('product/flows/FL-002.md', '- FS-011 -> FS-013\n');
    await fileHas(lines, /"FS-011>FS-013": \{\n\s+"shape": "elbow",\n\s+"to": \{\n\s+"x": 0.5,\n\s+"y": 0\n/);
    // Dragged by its middle, it bends.
    const q = await onConnector('FS-011>FS-013');
    await page.mouse.click(q.x, q.y);
    const mid = await shown('[data-line-bend]');
    await page.mouse.move(mid.x + mid.width / 2, mid.y + mid.height / 2);
    await page.mouse.down();
    await page.mouse.move(mid.x + 60, mid.y + 80, { steps: 6 });
    await page.mouse.up();
    await fileHas(lines, '"via"');
    await page.keyboard.press('Escape');
  });

  it('drops a connector on empty canvas for a new step there, ready to name', async () => {
    const c = await centre("This week's list is shown");
    await connect("This week's list is shown", { x: c.x, y: c.y + 220 });
    await page.locator('.react-flow textarea').waitFor();
    await page.keyboard.type('Invite a flatmate later');
    await page.keyboard.press('Enter');
    await fileHas('product/flows/FL-002.md', '[user-action] Invite a flatmate later\n');
    await fileHas('product/flows/FL-002.md', /- FS-013 -> FS-\d+\n/);
  });

  it('adds a step with a double-click on empty canvas, and renames a step with a double-click', async () => {
    const pane = (await page.locator('.react-flow__pane').boundingBox())!;
    await page.mouse.dblclick(pane.x + 140, pane.y + pane.height - 140);
    await page.locator('.react-flow textarea').waitFor();
    await page.keyboard.type('Read the house rules');
    await page.keyboard.press('Enter');
    await fileHas('product/flows/FL-002.md', '[user-action] Read the house rules\n');
    await page.locator('[data-step="Add flatmates and chores"]').dblclick();
    await page.locator('.react-flow textarea').fill('Add flatmates');
    await page.keyboard.press('Enter');
    await fileHas('product/flows/FL-002.md', '[user-action] Add flatmates\n');
  });

  it('labels a connector: double-click, type, click outside; left empty, nothing changes; then deletes it', async () => {
    const outside = async () => {
      const pane = (await page.locator('.react-flow__pane').boundingBox())!;
      await page.mouse.click(pane.x + pane.width / 2, pane.y + 20);
    };
    const p = await onConnector('FS-012>FS-013');
    await page.mouse.dblclick(p.x, p.y);
    await outside();
    await page.waitForTimeout(500);
    expect(await flow()).toContain('- FS-012 -> FS-013\n');
    const q = await onConnector('FS-012>FS-013');
    await page.mouse.dblclick(q.x, q.y);
    await page.keyboard.type('next week');
    await outside();
    await fileHas('product/flows/FL-002.md', '- FS-012 -> FS-013: next week\n');
    const r = await onConnector('FS-012>FS-013');
    await page.mouse.click(r.x, r.y);
    await page.keyboard.press('Delete');
    await waitFor(async () => !(await flow()).includes('FS-012 -> FS-013'));
  });

  it('selects a step and deletes it with its connectors', async () => {
    await page.locator('[data-step="Read the house rules"]').click();
    await page.keyboard.press('Backspace');
    await waitFor(async () => !(await flow()).includes('Read the house rules'));
  });

  it('places a shape picked in the toolbar where the canvas is clicked, ready to type in', async () => {
    await page.locator('[data-step-type="user-decision"]').click();
    expect(await page.locator('[data-step-type="user-decision"]').getAttribute('aria-pressed')).toBe('true');
    const pane = (await page.locator('.react-flow__pane').boundingBox())!;
    await page.mouse.click(pane.x + 220, pane.y + 140);
    await page.locator('.react-flow textarea').waitFor();
    await page.keyboard.type('Anyone moving out?');
    await page.keyboard.press('Enter');
    await fileHas('product/flows/FL-002.md', /- FS-\d+: \[user-decision\] Anyone moving out\?\n/);
    expect(await page.locator('[data-step-type="user-decision"]').getAttribute('aria-pressed')).toBe('false'); // the tool lets go after one shape
  });

  it('places a system action, for backend logic, apart from the user\'s steps', async () => {
    await place('system-action', 420, 140, 'Rotate the chores');
    await fileHas('product/flows/FL-002.md', /- FS-\d+: \[system-action\] Rotate the chores\n/);
  });

  it('left without text, the shape stays: empty and unconnected', async () => {
    await page.locator('[data-step-type="start-end"]').click();
    const pane = (await page.locator('.react-flow__pane').boundingBox())!;
    await page.mouse.click(pane.x + 220, pane.y + pane.height - 120);
    await page.locator('.react-flow textarea').waitFor();
    await page.mouse.click(pane.x + pane.width / 2, pane.y + 30); // click away without typing
    await fileHas('product/flows/FL-002.md', /- (FS-\d+): \[start-end\]\n/);
    const id = /- (FS-\d+): \[start-end\]\n/.exec(await flow())![1]!;
    expect(await flow()).not.toMatch(new RegExp(`${id} ->|-> ${id}`));
    expect((await read('product/flows/FL-002.layout.json')).includes(`"${id}"`)).toBe(true);
  });

  it('marks what the user taps on a step\'s screen with a blue box, shown on the canvas too, and clears it', async () => {
    await page.locator('[data-step="Start the rota"]').click();
    await page.locator('[data-tap-zone]').click();
    const pic = page.locator('[data-tap-zone-view] [data-target-picture]'); // the screen opens large to draw on
    await waitFor(async () => ((await pic.boundingBox())?.height ?? 0) > 100);
    const b = (await pic.boundingBox())!;
    await page.mouse.move(b.x + b.width * 0.1, b.y + b.height * 0.8);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.9, b.y + b.height * 0.9, { steps: 5 });
    await page.mouse.up();
    await page.locator('[data-tap-zone-view]').waitFor({ state: 'detached' });
    await fileHas('product/flows/FL-002.md', /- FS-012: \[user-action\] Start the rota\n  - screen: SC-004\n  - target: \d+(\.\d)?, \d+(\.\d)?, \d+(\.\d)?, \d+(\.\d)?\n/);
    await page.locator('[data-step="Start the rota"] [data-target]').waitFor();
    await page.locator('[data-step-panel] [data-target]').getByTitle('Clear').click();
    await waitFor(async () => !(await flow()).includes('target:'));
    await page.keyboard.press('Escape');
  });

  it('tidies up: back to the automatic layout', async () => {
    await page.locator('[data-tidy-up]').click();
    await waitFor(() => !has('product/flows/FL-002.layout.json'));
  });
});

describe('the Screens map', () => {
  const screens = () => read('product/screens.md');
  /** Where an element is, once it shows: an arrow's handles come back as the map takes in a save. */
  const box = async (sel: string) => {
    let b: Awaited<ReturnType<Locator['boundingBox']>> = null;
    await waitFor(async () => !!(b = await page.locator(sel).first().boundingBox()));
    return b!;
  };
  /** Drags a box on the screen opened large, from (x0, y0) to (x1, y1), in fractions of it. */
  const drawOnLarge = async (x0: number, y0: number, x1: number, y1: number) => {
    const pic = page.locator('[data-tap-zone-view] [data-target-picture]');
    await waitFor(async () => ((await pic.boundingBox())?.height ?? 0) > 100);
    const b = (await pic.boundingBox())!;
    await page.mouse.move(b.x + b.width * x0, b.y + b.height * y0);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * x1, b.y + b.height * y1, { steps: 5 });
    await page.mouse.up();
    await page.locator('[data-tap-zone-view]').waitFor({ state: 'detached' });
  };
  /** A visible point on an arrow's line, to click it. */
  const onArrow = (sel: string) => page.locator(`.react-flow__edge${sel} path.react-flow__edge-path`).evaluate((p: SVGPathElement) => {
    const m = p.getScreenCTM()!;
    for (const f of [0.5, 0.4, 0.6, 0.3, 0.7]) {
      const q = p.getPointAtLength(p.getTotalLength() * f);
      const pt = { x: q.x * m.a + m.e, y: q.y * m.d + m.f };
      if (document.elementFromPoint(pt.x, pt.y)?.closest('.react-flow__edge') === p.closest('.react-flow__edge')) return pt;
    }
    throw new Error('the arrow is hidden');
  });

  beforeAll(async () => {
    await page.locator('[data-tab="screens"]').click();
    await page.locator('[data-map-screen="This week"]').waitFor();
  });

  it('shows every screen with its click zones, and an arrow from each zone to the screen it opens, never IDs', async () => {
    expect(await page.locator('[data-map-screen]').count()).toBe(6);
    expect(await page.locator('[data-map-screen="This week"] [data-zone]').evaluateAll((zs) => zs.map((z) => z.getAttribute('data-zone')))).toEqual(['Chore', 'Scoreboard']);
    expect(await page.locator('.react-flow__edge').count()).toBe(7);
    expect(await page.locator('[data-arrow-label]').allTextContents()).toEqual(['swap agreed']);
    expect(await page.locator('main').innerText()).not.toMatch(/\b[A-Z]{2}-\d{3}\b/);
  });

  it('selects a screen, whose pencil opens its mockup', async () => {
    await page.locator('[data-map-screen="Chore"]').click();
    await page.locator('[data-open-mockup]').click();
    await page.locator('[data-frame]').waitFor();
    await page.locator('[data-tab="screens"]').click();
  });

  it('draws a click zone on a screen opened large, then links it to the screen it opens with a click', async () => {
    await page.locator('[data-map-tool="zone"]').click();
    await page.locator('[data-map-screen="Done"]').click();
    await page.locator('[data-tap-zone-view] [data-zone="This week"]').waitFor(); // the zones it has, and where each leads
    await drawOnLarge(0.1, 0.05, 0.6, 0.12);
    await page.locator('[data-map-hint]', { hasText: 'Click the screen it opens' }).waitFor();
    await page.locator('[data-map-screen="Set up flat"]').click();
    await fileHas('product/screens.md', /## SC-003 Done\n- picture: screens\/SC-003.svg\n\n### Links\n- 6.7, 78.1, 86.7, 8.1 -> SC-001\n- [\d.]+, [\d.]+, [\d.]+, [\d.]+ -> SC-004\n/);
    expect(has('product/screens.layout.json')).toBe(true); // the screens stay where they were
  });

  it("drops a new zone's arrow on an empty spot: a new screen there, opened by it, ready to name", async () => {
    await page.locator('[data-map-tool="zone"]').click();
    await page.locator('[data-map-screen="Scoreboard"]').click();
    await drawOnLarge(0.37, 0.91, 0.63, 0.98);
    const pane = await box('.react-flow__pane');
    await page.mouse.click(pane.x + 60, pane.y + pane.height - 60);
    await page.locator('[data-map-screen="New screen"] textarea').waitFor();
    await page.keyboard.type('Flat');
    await page.keyboard.press('Enter');
    await fileHas('product/screens.md', '## SC-007 Flat\n');
    await fileHas('product/screens.md', /## SC-005 Scoreboard\n- picture: screens\/SC-005.svg\n\n### Links\n- 2.8, 91.4, 27.8, 7.3 -> SC-001\n- [\d., ]+ -> SC-007\n/);
  });

  it('labels an arrow, moves its end onto another screen, and removes it', async () => {
    const arrow = '[data-id^="SC-003@"][data-id$=">SC-004"]';
    const p = await onArrow(arrow);
    await page.mouse.dblclick(p.x, p.y);
    await page.keyboard.type('the first time');
    await page.keyboard.press('Enter');
    await fileHas('product/screens.md', /-> SC-004: the first time\n/);
    await page.locator('[data-map-screen="Done"] [data-zone="Set up flat"]').click();
    const drag = async (from: { x: number; y: number; width: number; height: number }, to: { x: number; y: number }) => {
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 8 });
      await page.mouse.up();
    };
    const chore = await box('[data-map-screen="Chore"]');
    await drag(await box('[data-line-end="to"]'), { x: chore.x + chore.width / 2, y: chore.y + chore.height / 2 });
    await fileHas('product/screens.md', /-> SC-002: the first time\n/);
    // Shaped as a flow's connectors are: elbowed, its end glued to the left dot of the screen's picture, then bent.
    const lines = 'product/screens.lines.json';
    await page.locator('[data-map-screen="Done"] [data-zone="Chore"]').click();
    await page.locator('[data-line-shape="elbow"]').click();
    await fileHas(lines, '"shape": "elbow"');
    await page.locator('[data-map-screen="Done"] [data-zone="Chore"]').click();
    await drag(await box('[data-line-end="to"]'), { x: chore.x + 1, y: chore.y + (chore.height - 30) / 2 });
    await fileHas(lines, /"to": \{\n\s+"x": 0,\n\s+"y": 0.5\n/);
    const mid = await box('[data-line-bend]');
    await drag(mid, { x: mid.x + 40, y: mid.y + 60 });
    await fileHas(lines, '"via"');
    await page.locator('[data-map-screen="Done"] [data-zone="Chore"]').click();
    await page.keyboard.press('Delete');
    await waitFor(async () => !(await screens()).includes('the first time'));
    await waitFor(() => !has(lines)); // the arrow's line goes with it
  });

  it("lights up a flow's way through the screens, with a dashed arrow where no click zone leads yet, which becomes one", async () => {
    await page.locator('[data-map-screen="This week"] [data-zone="Chore"]').click();
    await page.keyboard.press('Delete');
    await waitFor(async () => !(await screens()).includes('6.7, 22.2, 86.7, 10 -> SC-002'));
    await page.locator('[data-flow-filter]').selectOption({ label: 'Complete a chore' });
    expect(await page.locator('[data-map-screen="This week"] [data-order]').innerText()).toBe('1');
    expect(await page.locator('[data-map-screen="Done"] [data-order]').innerText()).toBe('3');
    await page.locator('[data-gap]').click(); // "Tap a chore" goes from This week to Chore, but no click zone does
    await drawOnLarge(0.07, 0.22, 0.93, 0.32);
    await fileHas('product/screens.md', /## SC-001 This week\n- picture: screens\/SC-001.svg\n\n### Links\n- 69.4, 91.4, 27.8, 7.3 -> SC-005\n- [\d., ]+ -> SC-002\n/);
    await page.locator('[data-gap]').waitFor({ state: 'detached' });
    await page.locator('[data-flow-filter]').selectOption({ label: 'All flows' });
  });

  it('moves a screen, keeps where it was put, and tidies up', async () => {
    const layout = async () => JSON.parse(await read('product/screens.layout.json')) as Record<string, { x: number; y: number }>;
    const before = (await layout())['SC-005']!;
    const b = await box('[data-map-screen="Scoreboard"]');
    await page.mouse.move(b.x + b.width / 2, b.y + 30);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + 130, { steps: 8 });
    await page.mouse.up();
    await waitFor(async () => (await layout())['SC-005']!.y > before.y + 50);
    await page.locator('[data-tidy-up]').click();
    await waitFor(() => !has('product/screens.layout.json'));
  });

  it("picks a step's target from its screen's click zones", async () => {
    await page.locator('[data-tab="flows"]').click();
    await page.locator('[data-flow-link="Check fairness"]').click();
    await page.locator('[data-step="Open the scoreboard"]').click();
    await page.locator('[data-tap-zone]').click();
    const zone = await box('[data-tap-zone-view] [data-zone="Scoreboard"]');
    await page.mouse.click(zone.x + zone.width / 2, zone.y + zone.height / 2 + 4);
    await fileHas('product/flows/FL-003.md', '- FS-015: [user-action] Open the scoreboard\n  - screen: SC-001\n  - target: 69.4, 91.4, 27.8, 7.3\n');
    await page.keyboard.press('Escape');
  });
});

describe("the coding agent's pushes", () => {
  it('show up by themselves', async () => {
    await page.locator('[data-tab="product"]').click();
    h.github.push(REPO, 'main', { 'product/flows/FL-003.md': (await read('product/flows/FL-003.md')).replace('# FL-003 Check fairness', '# FL-003 See who did what') });
    await page.locator('[data-flow-card="See who did what"]').waitFor({ timeout: 10_000 });
  });

  it("a new screen the agent sketched opens as a picture to draw over, and the drawing keeps it", async () => {
    h.github.push(REPO, 'main', {
      'product/screens/SC-090.mockup.png': readFileSync(join(TIDY, '../../product/screens/SC-007.png')),
      'product/screens.md': `${(await read('product/screens.md')).trimEnd()}\n\n## SC-090 Snooze until\n- mockup: screens/SC-090.mockup.png\n`,
    });
    await page.locator('[data-tab="screens"]').click();
    await page.locator('[data-map-screen="Snooze until"]', { hasText: 'Mockup' }).dblclick({ timeout: 10_000 });
    await page.locator('[data-frame="laptop"]').waitFor(); // the sketch is landscape
    await page.locator('[data-shape]').first().waitFor();
    expect(has('product/screens/SC-090.shapes.json')).toBe(false); // nothing saved by opening it

    const f = (await page.locator('[data-frame]').boundingBox())!;
    await page.locator('[data-tool="rect"]').click();
    await page.mouse.move(f.x + f.width * 0.2, f.y + f.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(f.x + f.width * 0.5, f.y + f.height * 0.5, { steps: 6 });
    await page.mouse.up();
    await waitFor(() => has('product/screens/SC-090.shapes.json'));
    const saved = JSON.parse(await read('product/screens/SC-090.shapes.json')) as { shapes: { kind: string }[] };
    expect(saved.shapes.map((s) => s.kind)).toEqual(['image', 'rect']);
    expect(await read('product/screens.md')).toContain('- mockup: screens/SC-090.mockup.png\n');
  });

  it('a line the agent got wrong shows as one quiet notice', async () => {
    h.github.push(REPO, 'main', { 'product/screens.md': `${await read('product/screens.md')}- oops\n` });
    await page.locator('[data-file-problems]').waitFor({ timeout: 10_000 });
    expect(await page.locator('[data-file-problems]').innerText()).toContain('Ask your coding agent to fix it');
  });
});

describe('the draft', () => {
  it('keeps every edit in Aligner, and commits them to the branch as one commit, with the message the PM writes', async () => {
    await page.locator('[data-tab="product"]').click();
    const before = h.github.messages(REPO, 'main').length;
    expect(Number(await page.locator('[data-draft]').getAttribute('data-draft'))).toBeGreaterThan(10);
    expect(h.github.file(REPO, 'main', 'product/product.md')).toContain('- is a: mobile chore planner\n'); // still the branch's
    await page.locator('[data-draft]').click();
    await page.locator('[data-commit-message]').fill('Sketch the landlord\'s visit');
    await page.locator('[data-commit]').click();
    await page.locator('[data-draft="0"]').waitFor();
    expect(h.github.messages(REPO, 'main').length).toBe(before + 1);
    expect(h.github.messages(REPO, 'main')[0]).toMatch(/^Sketch the landlord's visit\n\nEdited in Aligner:\n- edit the vision\n/);
    expect(h.github.file(REPO, 'main', 'product/product.md')).toContain('- is a: shared chore planner\n');
  });

  it('lets go of the edits on request', async () => {
    await page.locator('[data-vision] [data-text]', { hasText: 'shared chore planner' }).click();
    await page.locator('[data-vision] textarea').fill('chore planner for nobody');
    await page.locator('[data-vision] textarea').press('Enter');
    await page.locator('[data-draft="1"]').click();
    await page.locator('[data-discard]').click();
    await page.locator('[data-discard-yes]').click();
    await page.locator('[data-draft="0"]').waitFor();
    await page.locator('[data-vision] [data-text]', { hasText: 'shared chore planner' }).waitFor();
  });

  it('switches to another branch, with a draft of its own', async () => {
    h.github.addBranch(REPO, 'option-b');
    await page.locator('[data-branch-menu]').click();
    await page.locator('[data-branch="option-b"]').click();
    await page.waitForURL(/branch=option-b/);
    await page.locator('[data-vision] [data-text]', { hasText: 'shared chore planner' }).click();
    await page.locator('[data-vision] textarea').fill('chore planner for option B');
    await page.locator('[data-vision] textarea').press('Enter');
    await fileHas('product/product.md', '- is a: chore planner for option B\n', 'option-b');
    expect(await read('product/product.md')).toContain('- is a: shared chore planner\n'); // main is as it was
  });

  it('starts a new branch from the one the PM is on, taking their uncommitted edits with them', async () => {
    await page.locator('[data-vision] [data-text]', { hasText: 'chore planner for option B' }).click();
    await page.locator('[data-vision] textarea').fill('chore planner, spec first');
    await page.locator('[data-vision] textarea').press('Enter');
    await page.locator('[data-draft="1"]').waitFor();
    await page.locator('[data-branch-menu]').click();
    await page.locator('[data-new-branch]').click();
    await page.locator('[data-new-branch-name]').fill('spec first');
    await page.locator('[data-create-branch]').click();
    await page.waitForURL(/branch=spec-first/);
    await page.locator('[data-draft="1"]').waitFor();
    await page.locator('[data-vision] [data-text]', { hasText: 'chore planner, spec first' }).waitFor();
    expect(h.github.file(REPO, 'spec-first', 'product/product.md')).toContain('- is a: shared chore planner\n'); // the draft isn't committed
    expect(await read('product/product.md', 'option-b')).toContain('- is a: shared chore planner\n'); // option-b keeps no draft
    await page.locator('[data-branch-menu]').click();
    await page.locator('[data-new-branch]').click();
    await page.locator('[data-new-branch-name]').fill('option-b');
    await page.locator('[data-create-branch]').click();
    await page.getByText('There is already a branch named "option-b".').waitFor();
    await page.keyboard.press('Escape');
  });

  it('reads well on a phone', async () => {
    const phone = await h.browser!.newPage({ viewport: { width: 390, height: 844 } });
    await phone.context().addCookies(await page.context().cookies());
    await phone.goto(`${h.url}/?repo=${REPO}&branch=main`);
    await phone.locator('[data-vision]').waitFor();
    expect(await phone.evaluate(() => document.scrollingElement!.scrollWidth)).toBeLessThanOrEqual(390);
    await phone.close();
  });
});

describe('starting a product', () => {
  it('adds the product context to a repository that has none, in one commit', async () => {
    await page.locator('[data-branch-menu]').click();
    await page.locator('[data-other-repos]').click();
    await page.locator('[data-repo="pat/fresh"]').click();
    await page.getByText('Start a product here?').waitFor();
    await page.getByRole('button', { name: 'Add product context' }).click();
    await page.locator('[data-vision]').waitFor();
    await waitFor(() => h.github.messages('pat/fresh', 'main')[0] === 'Add the product context');
    expect(h.github.file('pat/fresh', 'main', 'product/INSTRUCTIONS.md')).toBeDefined();
    expect(h.github.file('pat/fresh', 'main', 'CLAUDE.md')).toContain('<!-- product-context:begin');
  });
});

describe('signing out', () => {
  it('signs out, back to signing in with GitHub', async () => {
    await page.locator('[data-account]').click();
    expect(await page.locator('[data-usage-stats]').count()).toBe(0); // turned off
    await page.locator('[data-sign-out]').click();
    await page.locator('[data-sign-in]').waitFor();
    await page.locator('[data-sign-in]').click();
    await page.locator('[data-repo]').first().waitFor(); // GitHub would first ask the PM to authorize Aligner again; the stand-in doesn't
  });
});

describe("the page's Content-Security-Policy", () => {
  it('refused nothing the PM used, all along', () => {
    expect(refused).toEqual([]);
  });
});

describe('setting Aligner up', () => {
  it('creates its GitHub app, then gives the PM the variables to paste into Railway', async () => {
    const fresh = await startAligner({ setUp: false });
    try {
      const first = await fresh.open('/');
      await first.locator('[data-create-app]').click();
      await first.locator('[data-variables]').waitFor();
      const app = fresh.github.app!;
      expect((await first.locator('[data-variables]').innerText()).trim()).toBe(`GITHUB_APP_SLUG=${app.slug}\nGITHUB_CLIENT_ID=${app.clientId}\nGITHUB_CLIENT_SECRET=${app.clientSecret}`);
      expect(await first.locator('[data-usage-note]').innerText()).toContain('ALIGNER_USAGE_STATS=off');
    } finally {
      await fresh.close();
    }
  });
});

describe('usage statistics', () => {
  it('the account menu says when Aligner shares them, and links to what they hold', async () => {
    const u = await startAligner({ env: { ALIGNER_USAGE_STATS: 'http://127.0.0.1:9/api/usage' } }); // nobody listens there
    try {
      const first = await u.open('/');
      await first.locator('[data-account]').click();
      expect(await first.locator('[data-usage-stats] a').getAttribute('href')).toContain('docs/usage-statistics.md');
    } finally {
      await u.close();
    }
  });
});

describe('a new version of Aligner', () => {
  it('says what it brings, and updates Aligner in one click', async () => {
    const u = await startAligner({ env: { RAILWAY_GIT_REPO_OWNER: 'pat', RAILWAY_GIT_REPO_NAME: 'aligner', RAILWAY_GIT_BRANCH: 'main' } });
    try {
      u.github.addRepo('productalignment/aligner', { 'README.md': '# Aligner\n' }, { private: false });
      u.github.addFork('productalignment/aligner', 'pat/aligner');
      u.github.push('productalignment/aligner', 'main', { 'CHANGELOG.md': "# What's new in Aligner\n\n## 99.0.0\n- Comments on flows\n" });
      const first = await u.open('/');
      await first.locator('[data-update]').click();
      expect(await first.locator('[data-update-notes]').innerText()).toContain('Comments on flows');
      await first.locator('[data-update-now]').click();
      await first.locator('[data-updating]').waitFor();
      expect(u.github.head('pat/aligner', 'main')).toBe(u.github.head('productalignment/aligner', 'main'));
    } finally {
      await u.close();
    }
  });
});
