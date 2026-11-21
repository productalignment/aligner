# CLAUDE.md

This repo is **Aligner**, a simple, visual editor for a product's **product context**, and it keeps its own product context in `product/`. Aligner installs the block between the `product-context:begin` / `product-context:end` markers into the `CLAUDE.md` and `AGENTS.md` of every product it sets up, and brings it up to date there, so that block must stay product-agnostic.

<!-- product-context:begin (installed by Aligner; keep this block product-agnostic) -->
## Product context

This repo describes its product in `product/`: `product.md` (vision, out of scope, constraints), `personas.md` (who the product is for, and the jobs they hire it for), `flows/` (user flows, each serving one or more jobs) and `screens.md` (screens, with screenshots and mockups in `screens/`). The format is in `product/INSTRUCTIONS.md`. The PM edits it in Aligner, which commits their edits to the branch they work on.

For every change to the product:
1. **Before:** pull the branch, for the PM's latest edits; then read `product/product.md`, `product/personas.md`, and the flows and screens the change touches. A screen's mockup (`screens/SC-nnn.mockup.png`) is how the PM wants it to look, drawn on its screenshot, on a blank phone or laptop frame, or over your sketch: build what it shows. When asked to sketch a screen, save the capture as its mockup, never as its screenshot. Respect the out-of-scope list and the constraints; if the request conflicts with them, ask before building.
2. **Build** the flow end to end: its steps and decisions for the logic, its mockups for the look, each step's `target` (a blue box on its screen) for what the user taps, and each screen's links for where its buttons, links and tabs lead.
3. **After:** update the product context to describe the product as built, in the same commit as the code:
   - behaviour changed: update the flow's steps and connections, and the screens, with each user step's `target` and each screen's links on its screen;
   - a screen looks different: replace its screenshot (`screens/SC-nnn.png`), captured from the running product; once it shows what its mockup asked for, remove the mockup (its `mockup` line, `SC-nnn.mockup.png` and `SC-nnn.shapes.json`);
   - if you can't capture screenshots, keep the old ones and say which screens need new ones.

   Then check the product context against the format and the checks in `product/INSTRUCTIONS.md`, and fix any errors.

The vision, the out-of-scope list, the constraints, the personas and their jobs belong to the PM: change them only when asked. Aligner shows the PM the branch as it is on GitHub: your changes show there once they are pushed.
<!-- product-context:end -->

## Working on Aligner's code

- **We add only the necessary parts, and we remove everything that becomes unnecessary.** With every change, take out what it makes redundant (controls, hints, code paths, tests, docs), rather than keeping both the old way and the new.
- Aligner is a **web app each PM runs for themselves**: a fork of this repo, deployed on Railway from its `Dockerfile` and opened from any computer or phone. On its first start it has the PM create its GitHub App from a manifest, whose keys the PM gives Railway as variables; then the PM signs in with GitHub and opens a repository's branch. Aligner reads `product/` from the branch, keeps the PM's edits as a draft on its volume until they commit it to the branch (`apps/web/src/branch.ts`, `drafts.ts`), and merges what the coding agent pushes meanwhile into the draft, item by item. There is no database: the session is a sealed cookie, the product context lives in the repo, and the volume holds only the drafts not yet committed. There is no MCP server; agents read and update the product context files directly.
- Monorepo, npm workspaces:
  - `packages/core`: the format (`src/context/`: lossless parser and serializer, span-preserving edits, checks), `ProductSession` (edits, screenshots, mockups) over a `ProductStore` (`src/store.ts`), and the merge of a draft onto newer commits (`src/merge.ts`).
  - `apps/web`: the server (`src/`: setting up and signing in with GitHub, the branch store and the drafts, the RPC handlers, the product's look, updates), the UI (`ui/`), the e2e tests with their stand-in for GitHub (`e2e/github.ts`), and the scripts (`dev`, `screenshots`, `validate`).
- **A release** raises `version` in `apps/web/package.json` and adds its entry at the top of `CHANGELOG.md`, in plain words for PMs: what the version brings them (a test keeps the two in step). Once it is on `main`, every PM's Aligner shows it and offers **Update now**. Keep `main` releasable: their forks take it as it is.
- The format is described in `product/INSTRUCTIONS.md`, which Aligner copies into every product; keep it in step with `packages/core/src/context/spec.ts`. Aligner brings an older `INSTRUCTIONS.md` or instruction block it shipped up to date with the PM's next commit: when you change either, add its new git blob SHA to `SHIPPED` in `apps/web/src/extras.ts` (a test checks). `examples/tidy/` is the example product the tests use.
- Docs: `docs/architecture.md` (how Aligner works; keep it in step with the code) and `docs/install.md` (deploying Aligner on Railway).
- Before pushing, run from the repo root:
  - `npm test` (the `aligner` app tests build it first),
  - `npm run typecheck`,
  - `npm run validate -- .` (this repo's own product context) and `npm run validate -- examples/tidy`,
  - after UI changes, `npm run e2e`, which drives the UI in Chromium against the built server and the stand-in for GitHub (`ALIGNER_E2E_CHANNEL=chrome` uses the installed Google Chrome when Playwright's browser isn't installed).
- `npm run screenshots` captures the views into `docs/screenshots/` and this repo's own screens into `product/screens/`. `npm run dev -- [folder…]` builds and runs Aligner with those folders (by default the example and this repo) as repositories on the stand-in for GitHub, and prints the link that signs you in.
- The UI must stay one self-contained HTML file. Screen pictures travel as data URLs through the `picture` RPC.
- No IDs in the UI: show names, shapes, colours and pictures; an item's ID may appear only in a hover title.
- The parser must stay lossless. Any change to `packages/core/src/context` keeps the round-trip property test passing.
