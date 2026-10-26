# Aligner architecture

Aligner is a **web app each PM runs for themselves**: a fork of this repo, deployed on Railway, over the **product context** of their products: a few plain files in `product/` of each product's repository, which the PM edits in Aligner and the AI coding agent reads and updates itself. Aligner signs the PM in with GitHub through its own GitHub App, reads the product context from the branch they open, keeps their edits as a draft on its volume, and commits the draft to the branch when they say so. It tells them when a new version of Aligner is out, and updates itself in one click. It makes no model calls, and has no MCP server and no database.

## 1. Components

```
 PM, on any computer       their Aligner (Railway)                GitHub                       AI coding agent
 or phone                  ┌───────────────────────┐   as the PM ┌──────────────────────────┐   (Claude Code, …)
 ┌───────────────┐  https  │ UI (one HTML file)    │   (app's    │ product repo, a branch   │   pulls, reads product/,
 │ browser tab   │────────▶│ sign-in, setup        │   user      │  product/product.md      │◀──builds flows end to end,
 │ sealed cookie │◀────────│ RPC handlers          │   token)    │  product/personas.md     │   updates product/,
 └───────────────┘         │ branch store ─────────┼────────────▶│  product/flows/          │   commits with the code,
                           │   reads the branch,   │  git data   │  product/screens.md      │   pushes
                           │   commits the draft   │  API        │  product/screens/        │
                           │ core: format, merge   │◀────────────│  CLAUDE.md / AGENTS.md   │
                           │ volume: the drafts    │             │ Aligner's GitHub App     │
                           └───────────────────────┘             │ its fork of the original │
                                                                 └──────────────────────────┘
```

| Package | Responsibility |
|---|---|
| `packages/core` | `src/context/`: the format. A lossless segmenter and parser driven by tables (`spec.ts`), span-preserving edits (`Workspace`), ID allocation from the files, and the checks. No Node APIs, so the UI imports it too (`@aligner/core/context`). `src/session.ts`: `ProductSession` applies PM edits, stores screenshots and mockups, each edit one write to a `ProductStore` (`src/store.ts`) described for its commit. `src/merge.ts`: a draft moved onto newer commits, item by item. |
| `apps/web` | The server (`src/`), the single-file UI (`ui/`), the e2e tests and their stand-in for GitHub (`e2e/`), and the scripts: `dev`, `screenshots`, `validate`. |

### 1.1 Deployment
- The **`Dockerfile`** builds the UI and bundles the server into `dist/server.js`, one file with no dependencies, beside `dist/ui.html` and the files Aligner adds to new products (`dist/assets`: `INSTRUCTIONS.md`, and `CLAUDE.md` for the instruction block; and the home-screen icon). Railway builds it from the PM's fork, runs `node server.js` (as root: Railway mounts volumes as root), sets `PORT`, gives it a domain, and mounts the volume that keeps the drafts. A push to the fork (**Update now**, or GitHub's **Sync fork**) deploys the new version. The server bundle carries its version, from `apps/web/package.json`. CI builds the image and checks that it answers.
- **Settings are environment variables:** `GITHUB_APP_SLUG`, `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` (Aligner's GitHub App); `RAILWAY_VOLUME_MOUNT_PATH`, or `ALIGNER_DATA`, for the drafts (without either they last until a restart); `RAILWAY_GIT_REPO_OWNER`, `RAILWAY_GIT_REPO_NAME` and `RAILWAY_GIT_BRANCH`, which Railway sets, for the fork **Update now** updates; `GITHUB_URL` and `GITHUB_API_URL` for another GitHub than github.com.

### 1.2 Setting up and signing in
- **First start**, without the app's variables: the page asks the PM to create Aligner's GitHub App. It posts a manifest to GitHub (`/settings/apps/new`, or the organization's) built from the address the browser used: permissions `contents: write` and `metadata: read`, private to its owner, a callback at `/auth/callback`, a setup URL at `/`, no webhook. GitHub sends the PM back to `/setup/github` with a code, which the server converts into the app's slug, client ID and secret, and shows them as three lines for Railway's raw variable editor (carried in a cookie meanwhile). The page waits until Railway has restarted Aligner with them.
- **Signing in** is GitHub's web application flow with PKCE: `/auth/login` → GitHub → `/auth/callback`, then back to the page the PM was going to, a page of this Aligner only. The session is a cookie sealed with AES-GCM under a key derived from the app's secret, holding the PM's login and their user token, which expires every 8 hours and is renewed with its refresh token (requests that come together share one renewal). It lasts 30 days from the last renewal, so a month unused signs the PM out. **Signing out** deletes the app's grant for the PM on GitHub (`DELETE /applications/{client_id}/grant`, with the app's keys), so every token it gave them stops working, on every device.
- What a PM can open is what GitHub lets their user token reach: the repositories they installed the app on and can push to. **Choose repositories** is the app's installation page on GitHub, which sends the PM back to Aligner.

### 1.3 Server and UI
- `GET /` serves the UI, with its tab icon inside, under a Content-Security-Policy: only its own inlined script runs (by its hash), styles and fonts come from itself and Google Fonts, pictures from itself, data URLs and https, and no other site can frame it. `GET /apple-touch-icon.png` is the icon an iPhone puts on its home screen; `GET /health` answers Railway. `POST /rpc` runs one of the `Products` methods for the signed-in PM: `repos`, `branches`, `snapshot`, `initProduct`, `edit`, `setPicture`, `picture`, `markup`, `saveLayout`, `saveLines`, `saveMockup`, `theme`, `status`, `commit`, `discard`; and `account`, `update` and `signOut`. Only Aligner's own page can call it: it must carry an `x-aligner` header, which a page elsewhere can't send without a CORS preflight the server never allows.
- The UI is one self-contained HTML file (React, Tailwind, React Flow and ELK). Pictures come through `picture` as data URLs. The address holds the product: `/?repo=owner/name&branch=…`, so a link opens it on another device.
- **Getting to a product:** setup, sign-in, the list of repositories (the latest pushed first), and the start page for a branch with no product context. The top bar holds the product's name, the three views, the draft (**N changes · Commit**, opening the message, **Commit** and **Discard**; **Committed** when there is none), the branch menu (another branch, or another repository), **Update** when a newer Aligner is out, and the account menu (choosing repositories, signing out). It fits a phone.
- **The flow canvas** works like a whiteboard; positions go to `flows/FL-nnn.layout.json` through `saveLayout`; a flow without one is laid out by ELK. Its connectors are shaped, bent and reconnected as on Miro (`ui/src/components/connector.tsx`), drawn as `flows/FL-nnn.lines.json` says (`saveLines`). A step's `target` is drawn on its screen's picture. **The map of the screens** (`ui/src/views/ScreenMap.tsx`) works the same way, its positions in `screens.layout.json` (`saveLayout` with `screens`) and its arrows' shapes in `screens.lines.json` (`saveLines` with `screens`). **Three views**: Product, Flows, Screens. **No IDs in the UI**: items show by name, shape, colour and picture; an ID appears only in a hover title.

### 1.4 The branch store and the draft (`apps/web/src/branch.ts`, `drafts.ts`)
- The files Aligner works with are the branch's: those at the root of the repository (for `CLAUDE.md` and `AGENTS.md`) and those in `product/`, read through the git data API (the branch, its root tree, the `product/` tree, then blobs as they are needed). Trees and blobs are kept by SHA, within bounds, across branches and PMs.
- **The draft:** each PM's edits of a branch, read back before the branch's files. Every edit is saved at once in Aligner's data folder (`drafts/<login>/<owner>/<repo>/<branch>/`: the changed files under their git SHA, and `draft.json` with the commit they are on and what changed, written in one go), so the draft is there on any device and after a restart. An edit that brings a file back to the branch's takes it out of the draft.
- **Commit** makes the draft one commit on the branch's latest commit: blobs for pictures, the text inline, one tree, one commit as the PM, and the branch moved forward only. The message is the PM's (or "Update the product context"), then the list of what changed: `Edited in Aligner: - edit FL-003 - add FS-104 to FL-003`. **Discard** empties the draft. Starting a product is committed at once.
- **The coding agent's instructions come up to date with a commit** (`apps/web/src/extras.ts`): where the branch's `product/INSTRUCTIONS.md`, or the instruction block in its `CLAUDE.md` or `AGENTS.md`, is an older version Aligner shipped (known by its git blob SHA), the current one goes into the draft just before it is committed. One changed by hand, or newer, stays as it is.
- **Live refresh:** the UI polls `status` every two seconds. The store asks GitHub for the branch at most that often, with its ETag, so an unchanged branch costs nothing, and takes in a commit someone else pushed. Its `version` is a digest of the `product/` files as the PM sees them, the same before and after their draft is committed, so the page reloads only for someone else's changes. New commits are taken in between edits, never during one.
- **Someone pushed under the draft:** the draft is moved onto their commit (`packages/core/src/merge.ts`). What it added, changed and removed since the commit it was on is done again on theirs, field by field: both sides' changes stay; where both changed the same field, the draft's value stays; an item they removed stays removed; items both added under one ID are renumbered in the draft, with the files named after them. The draft's pictures, mockups and layouts keep the draft's version. `status` tells the PM which items were in both.
- A repository with no commits yet starts from nothing: its first file goes in through the contents API, which makes the branch.

### 1.5 Updates (`apps/web/src/updates.ts`)
- Every few hours, as the signed-in PM, Aligner reads `CHANGELOG.md` of the original repository (`productalignment/aligner`): a `## x.y.z` heading per version, with what it brings below it. A version newer than its own shows as **Update**, with what each newer version brings.
- **Update now** asks GitHub to sync the fork Railway deploys Aligner from (`POST /repos/{fork}/merge-upstream`); Railway sees the push and deploys it, and the page reloads once the new version answers. When GitHub can't (the fork has changes of its own, Aligner can't reach it, or the new version changes a GitHub workflow, which the app has no `workflows` permission for), or Aligner doesn't know its fork, the PM is pointed to **Sync fork** on GitHub.

## 2. Data flow

### A PM edit
The UI calls `edit`. `ProductSession` loads the files from the store (the branch with the PM's draft), rewrites only the changed spans, writes the changed files as one change into the draft, and returns a fresh snapshot with the checks. The PM commits the draft when it is ready. A new item takes the next number after the highest of its kind in the files. Removing an item unlinks it everywhere (a job from flows, a screen from steps and from the links to it, a step's connections); removing a screen removes its pictures, in the same change.

### A mockup
The editor (`ui/src/views/Mockup.tsx`) draws a frame and the shapes as SVG on a canvas that pans and zooms. A moment after each change it paints the frame and the shapes inside it onto a canvas (`ui/src/components/markup.ts`) and calls `saveMockup`, which writes `screens/SC-nnn.mockup.png` and `screens/SC-nnn.shapes.json` and sets the screen's `mockup` field. Clearing every shape removes the mockup.

The `theme` call (`src/theme.ts`) reads the product's look from its code, from the branch's archive on GitHub, streamed and read once per commit: colour and font tokens from CSS and Tailwind configs, Google Fonts links, and the lucide icons it imports.

### The map of the screens
A screen's links are listed in `screens.md` under `### Links`, one per click zone: `- x, y, width, height -> SC-nnn: label`, the zone in percent of the screen's picture. Links have no IDs; the format, the edits and the merge know one by its screen, its zone and the screen it opens (`linkId`). The map draws each screen as its picture, its zones as blue boxes, and an arrow from each zone to the screen it opens: out of the zone's side facing that screen, into its facing side, level with the zone where it can; an arrow that would cross another screen goes round it instead, along a free row between the screens in between, or below or above them. Until the PM moves a screen, ELK lays the map out along the arrows, the screens nothing leads to first; a new screen, or a new link, keeps everything where it was. A click zone is drawn on the screen opened large (the tap-zone view, `components/Target.tsx`), then linked by clicking the screen it opens, or an empty spot, which adds a screen there with its link in one edit (`zone` and `at` on the `add`). Picking a flow walks its steps from its start: the screens it goes through are numbered, the links it uses (the one under a step's target where there is one) light up, and a move between two screens no link covers is a dashed arrow, which adds the link from the step's target, or from a box drawn on the screen opened large.

### Starting a product
`initProduct` writes the empty `product/` files and `product/INSTRUCTIONS.md`, never overwriting a file, and the instruction block into `CLAUDE.md` and `AGENTS.md` (a new file, or appended to one without the block), and commits them at once, so the coding agent has its instructions.

### A change by the coding agent
```
PM commits their draft, asks the agent ─▶ agent pulls the branch, reads product.md, personas.md, the flow and its screens (with mockups)
                  ─▶ conflicts with out of scope / constraints? ─ yes ─▶ asks the PM
                  ─▶ builds the flow end to end
                  ─▶ updates the flow, screens (with their links) and screenshots; removes the mockups it built
                  ─▶ checks the product context against product/INSTRUCTIONS.md
                  ─▶ one commit: code + product context ─▶ pushed
                  ─▶ the open Aligner page refreshes
```

## 3. Design choices

| Area | Choice | Why |
|---|---|---|
| Scope | **One PM and their coding agent** | Aligner serves the person who decides what gets built and the agent that builds it; collaboration happens in the repository on GitHub. |
| Layers | **Vision → personas → jobs → flows** | Each anchors the next; every flow names the jobs it serves. |
| Running Aligner | **Each PM's own, on Railway, from their fork** | No terminal, Node.js or coding agent needed to use it, and it opens on any computer or phone. No shared service holds everyone's tokens. |
| Connecting to GitHub | **A GitHub App each Aligner creates from its manifest** | The PM chooses repositories as they do for Railway; the app may touch file contents only. An OAuth app would reach every repository the PM has. |
| Keeping state | **The repo, a sealed cookie, and the drafts on a volume** | No database to set up or back up. The app's keys are Railway variables; a draft is only the changed files, gone once committed. |
| Saving | **A draft, committed when the PM says so** | One commit per piece of work with the PM's message, no half-finished specs for the agent, no deploy of the product for every edit. Kept on the server, the draft follows the PM to any device, and sets off no CI or preview deploys until it is committed. |
| Merging a draft | **Item by item, field by field** | The files are lists of items with IDs, so the agent's and the PM's changes to different items, or different fields of one, never clash; git's line merge would clash on neighbouring lines. |
| Updating | **The original's changelog, and GitHub's fork sync** | Nothing to run but the PM's own Aligner; Railway deploys what the fork gets. |
| Mockups | **Shapes on a frame (the screenshot, or a blank phone or laptop), flattened to PNG** | The agent reads images natively; the shapes JSON keeps them editable. |
| Navigation | **Click zones on each screen, with arrows to the screens they open, on a map** | As a wireflow: every button's way shows, flows or not, and the agent builds it from the zone. |
| The agent's instructions | **Brought up to date with the PM's commits** | Products keep up with the format. Only a version Aligner shipped is replaced, so nothing changed by hand, or newer, is lost. |
| Format | **Strict, ID-based markdown with a lossless parser** | The UI edits in place; agents need a closed set of items; diffs stay readable. IDs stay in the files, out of the UI. |
| Checking | **The agent checks against `INSTRUCTIONS.md`; Aligner shows the errors** | The format and its checks are written down in every product, so the product context stays valid with any agent, without Aligner; `npm run validate` checks a folder from this repo. |
| UI bundle | **Single inlined HTML** | One file to serve, with the server bundled beside it. |

## 4. Verification

| What | How |
|---|---|
| Format | `packages/core/test/context.test.ts`: the example product, the checks (click zones too), span-preserving edits (a screen's links, and the heading its last one takes with it), and a fast-check round-trip property. |
| Session | `packages/core/test/session.test.ts`: edits, links, screenshots, mockups, removals, layouts (the map's too), a screen added at the end of a click zone's arrow, and starting a product, each edit one described write, on an in-memory store. |
| Merging | `packages/core/test/merge.test.ts`: both sides' changes to different items and fields, the same field, items removed by either side, items both added under one ID (a step, a flow file), click zones on both sides or to a screen removed, the vision, additions in place. |
| Instructions | `apps/web/test/extras.test.ts`: the shipped versions include the current ones; an older one is brought up to date, one changed by hand is not. |
| Server | `apps/web/test/server.test.ts`: runs the built server against the stand-in for GitHub (`apps/web/e2e/github.ts`: OAuth with PKCE and expiring tokens, cancelling a sign-in, the manifest, installations, the git data API with git's object IDs, archives): setting up, the page's Content-Security-Policy, signing in (back to its own pages only) and out everywhere, renewing tokens, refusing what it didn't start, repositories and branches, the draft on another device and after a restart, committed as one commit or discarded, pictures, the agent's pushes picked up for free and merged into the draft, a clash told, the theme, starting a product (also in an empty repository), a newer version and updating the fork. |
| UI | `apps/web/e2e/app.e2e.test.ts`: Playwright drives the UI against the built server and the stand-in, the way the PM works: a repository, the vision, a persona and job, a flow from a job, steps and a screen, a mockup drawn and cleared, the gaps, the map of the screens (click zones drawn and linked, a new screen from an arrow, labels, an arrow moved and removed, a flow followed and its dashed arrow made a click zone, screens moved and tidied up, a step's target picked from the click zones), the agent's pushes showing up, committing and discarding the draft, another branch, a phone, starting a product, signing out, setting Aligner up, and updating it; and that the page's Content-Security-Policy refused nothing all along. |
| Deployment | CI builds the `Dockerfile` and checks the container answers `/health`. |

## 5. Risks

| Risk | Mitigation |
|---|---|
| The agent forgets to pull, or to update the product context | The instruction block in `CLAUDE.md`/`AGENTS.md` and `product/INSTRUCTIONS.md` say to pull first and update after; the Product page shows gaps as layout, and the file problems the agent should fix. |
| The PM forgets to commit before asking the agent to build | The top bar counts the draft's changes until they are committed; the commit popover says the agent sees them only then. |
| The agent's push and the PM's draft change the same field of an item | The draft's value stays, and Aligner tells the PM which items. |
| Aligner has no volume | Drafts last until it restarts; the commit popover and the update notice say so, and to commit first. |
| A protected branch refuses commits | Aligner says why it couldn't commit, and the draft stays; the PM can open another branch. |
| An update that can't fast-forward (the PM changed their fork) | Aligner points to Sync fork on GitHub, where they choose. |
| GitHub's limits | User tokens get 5,000 requests an hour; an unchanged branch costs nothing to ask about, and trees and blobs are read once. |
