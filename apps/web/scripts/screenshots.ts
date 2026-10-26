// Captures Aligner as the PM sees it, signed in to a stand-in for GitHub whose repositories are
// copies of the products, so nothing changes in the repo but the pictures.
// Run: npm run screenshots -w aligner → docs/screenshots/{setup,tidy,aligner}/*.png, and Aligner's
// own screen pictures in product/screens/ (its product context shows Aligner as it is today).
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from 'playwright';
import { readFolder } from '@aligner/core';
import { startAligner } from '../e2e/harness';

const repo = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const VIEWPORT = { width: 1440, height: 900 };

type Nav = Record<string, unknown>;
const SHOTS: { name: string; nav: Nav }[] = [
  { name: '1-product', nav: { view: 'product' } },
  { name: '2-flow', nav: { view: 'flows' } },
  { name: '3-flow-step', nav: { view: 'flows', flow: 'FL-001', selected: 'FS-003' } },
  { name: '4-screens', nav: { view: 'screens' } },
  { name: '5-mockup-editor', nav: { view: 'screens', screen: 'SC-002' } },
];

/** Aligner's own screens (product/screens.md), and the capture that shows each. */
const OWN_SCREENS: Record<string, string> = {
  'SC-002': 'tidy/1-product', 'SC-007': 'tidy/0-start-a-product', 'SC-009': 'tidy/3-flow-step', 'SC-018': 'tidy/4-screens', 'SC-019': 'tidy/5-mockup-editor',
  'SC-020': 'setup/1-connect-to-github', 'SC-021': 'setup/2-give-the-app-to-railway', 'SC-022': 'setup/3-sign-in', 'SC-023': 'setup/4-repositories',
  'SC-024': 'tidy/6-commit', 'SC-025': 'setup/5-update', 'SC-026': 'tidy/7-click-zone',
};

const shot = (page: Page, name: string) => page.screenshot({ path: join(repo, 'docs/screenshots', `${name}.png`) });

async function ready(page: Page) {
  await page.waitForFunction(() => document.body.dataset.ready === '1', undefined, { timeout: 15_000 }).catch(() => undefined);
  await new Promise((r) => setTimeout(r, 500));
}

async function go(page: Page, nav: Nav) {
  await page.evaluate((n) => window.__alignerNavigate!(n), nav);
  await ready(page);
}

/** Opens a product, in screenshot mode. */
async function open(page: Page, url: string) {
  await page.goto(url);
  await page.evaluate(() => { document.body.dataset.screenshot = '1'; });
  await page.locator('[data-vision]').waitFor();
}

/** The PM's mockup on Tidy's Chore screen: a new button drawn on its screenshot, and a sticky note for the agent. */
async function drawMockup(page: Page) {
  await go(page, { view: 'screens', screen: 'SC-002' });
  const b = (await page.locator('[data-frame]').boundingBox())!;
  const at = (x: number, y: number) => ({ x: b.x + b.width * x, y: b.y + b.height * y });
  const drag = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();
  };
  const text = async (where: { x: number; y: number }, words: string) => {
    await page.locator('[data-tool="text"]').click();
    await page.mouse.click(where.x, where.y);
    await page.keyboard.type(words);
    await page.keyboard.press('Enter');
  };
  await page.locator('[data-tool="rect"]').click();
  await drag(at(0.06, 0.78), at(0.94, 0.85));
  await page.locator('[data-paint="fill"]').click();
  await page.locator('[data-swatch="#e5e5e5"], [data-swatch="#d4d4d4"]').first().click();
  await page.keyboard.press('Escape');
  await text(at(0.4, 0.815), 'Snooze');
  await page.locator('[data-tool="note"]').click();
  const note = at(0.78, 0.14);
  await page.mouse.click(note.x, note.y);
  await page.keyboard.type('Snooze moves the chore to tomorrow');
  await page.keyboard.press('Enter');
  await page.mouse.click(b.x - 80, b.y + 20);
  await page.waitForFunction(() => document.querySelector('[data-save-status]')?.getAttribute('data-save-status') === 'saved', undefined, { timeout: 10_000 });
}

/** On the map, the click-zone tool opens This week large, and a box is being dragged round its Flat tab. */
async function drawClickZone(page: Page) {
  await go(page, { view: 'screens' });
  await page.locator('[data-map-tool="zone"]').click();
  await page.locator('[data-map-screen="This week"]').click();
  const b = (await page.locator('[data-tap-zone-view] [data-target-picture]').boundingBox())!;
  await ready(page);
  await page.mouse.move(b.x + b.width * 0.37, b.y + b.height * 0.915);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.63, b.y + b.height * 0.985, { steps: 6 });
  await shot(page, 'tidy/7-click-zone');
  await page.keyboard.press('Escape');
  await page.mouse.up();
}

/** The vision's product category, changed in place. */
async function editVision(page: Page, from: string, to: string) {
  await page.locator('[data-vision] [data-text]', { hasText: from }).click();
  await page.locator('[data-vision] textarea').fill(to);
  await page.locator('[data-vision] textarea').press('Enter');
}

for (const dir of ['setup', 'tidy', 'aligner']) {
  rmSync(join(repo, 'docs/screenshots', dir), { recursive: true, force: true });
  mkdirSync(join(repo, 'docs/screenshots', dir), { recursive: true });
}

// Aligner's first start, before it has its GitHub app.
const fresh = await startAligner({ setUp: false });
try {
  const page = await fresh.open('/', VIEWPORT);
  await page.locator('[data-create-app]').waitFor();
  await shot(page, 'setup/1-connect-to-github');
  await page.locator('[data-create-app]').click();
  await page.locator('[data-variables]').waitFor();
  await shot(page, 'setup/2-give-the-app-to-railway');
} finally {
  await fresh.close();
}

// A newer version of Aligner is out, for the copy it runs from.
const updating = await startAligner({
  repos: { 'pat/tidy': await readFolder(join(repo, 'examples/tidy')) },
  env: { RAILWAY_GIT_REPO_OWNER: 'pat', RAILWAY_GIT_REPO_NAME: 'aligner', RAILWAY_GIT_BRANCH: 'main' },
});
try {
  updating.github.addRepo('productalignment/aligner', { 'CHANGELOG.md': "# What's new in Aligner\n\n## 99.0.0\n- Comments on flows, for you and your coding agent\n- A darker theme, for the evening\n" }, { private: false });
  updating.github.addFork('productalignment/aligner', 'pat/aligner');
  const page = await updating.open('/?repo=pat/tidy&branch=main', VIEWPORT);
  await page.evaluate(() => { document.body.dataset.screenshot = '1'; });
  await page.locator('[data-update]').click();
  await page.locator('[data-update-notes]').waitFor();
  await shot(page, 'setup/5-update');
} finally {
  await updating.close();
}

const productOnly = (files: Record<string, Uint8Array>) => Object.fromEntries(Object.entries(files).filter(([p]) => p.startsWith('product/')));
const h = await startAligner({
  repos: {
    'pat/tidy': await readFolder(join(repo, 'examples/tidy')),
    'pat/aligner': productOnly(await readFolder(repo)),
    'pat/new-product': { 'README.md': '# New product\n' },
  },
});
try {
  const signedOut = await h.browser!.newPage({ viewport: VIEWPORT });
  await signedOut.goto(h.url);
  await signedOut.locator('[data-sign-in]').waitFor();
  await shot(signedOut, 'setup/3-sign-in');

  const page = await h.open('/', VIEWPORT);
  await page.locator('[data-repo]').first().waitFor();
  await shot(page, 'setup/4-repositories');

  await open(page, `${h.url}/?repo=pat/tidy&branch=main`);
  await drawMockup(page);
  for (const s of SHOTS) {
    await go(page, s.nav);
    await shot(page, `tidy/${s.name}`);
  }
  await drawClickZone(page);

  // The draft: everything so far committed, then one change, ready to commit with a message.
  await go(page, { view: 'product' });
  await page.locator('[data-draft]').click();
  await page.locator('[data-commit]').click();
  await page.locator('[data-draft="0"]').waitFor();
  await editVision(page, 'mobile chore planner', 'shared chore planner');
  await page.locator('[data-draft="1"]').click();
  await page.locator('[data-commit-message]').fill('Say who shares the planner');
  await shot(page, 'tidy/6-commit');
  await page.keyboard.press('Escape');

  // A repository with no product context yet: the start page.
  await page.goto(`${h.url}/?repo=pat/new-product&branch=main`);
  await page.getByText('Start a product here?').waitFor();
  await shot(page, 'tidy/0-start-a-product');

  // Aligner's own product context, with the pictures just taken.
  const pictures: Record<string, Uint8Array> = {};
  for (const [id, from] of Object.entries(OWN_SCREENS)) pictures[`product/screens/${id}.png`] = readFileSync(join(repo, 'docs/screenshots', `${from}.png`));
  h.github.push('pat/aligner', 'main', pictures, 'Screenshots');
  await open(page, `${h.url}/?repo=pat/aligner&branch=main`);
  for (const s of [SHOTS[0]!, SHOTS[1]!, { name: '3-flow-step', nav: { view: 'flows', flow: 'FL-007', selected: 'FS-065' } }]) {
    await go(page, s.nav);
    await shot(page, `aligner/${s.name}`);
  }
} finally {
  await h.close();
}

for (const [id, from] of Object.entries(OWN_SCREENS)) copyFileSync(join(repo, 'docs/screenshots', `${from}.png`), join(repo, 'product/screens', `${id}.png`));
console.log('Screenshots in docs/screenshots/ and product/screens/');
