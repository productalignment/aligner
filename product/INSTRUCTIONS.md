# Product context: format and rules

The product context describes what the product is for and how it works, in a few plain markdown files in `product/`. The PM edits it in Aligner, which commits their edits to the branch they work on; the coding agent reads it before every change and updates it after. Aligner edits these files in place and keeps every byte it doesn't change, so follow the format exactly.

## Layers

```
Vision  →  Personas  →  Jobs to be done  →  Flows (steps, with screens and mockups)
```

Each layer anchors the next. Every flow names the jobs it serves; a flow that serves no job, or a job that no flow serves, is a gap to raise with the PM.

## Files

| File | Holds |
|---|---|
| `product/product.md` | `# Product`, then `## Vision`, `## Out of scope`, `## Constraints` |
| `product/personas.md` | `# Personas`, then one `## PE-nnn <name>` per persona, each with a `### Jobs` list |
| `product/flows/FL-nnn.md` | One flow per file, named after its ID |
| `product/screens.md` | `# Screens`, then one `## SC-nnn <name>` per screen |
| `product/screens/` | Screenshots (`SC-nnn.png`), mockups (`SC-nnn.mockup.png`) and the shapes they were drawn with (`SC-nnn.shapes.json`, written by Aligner) |
| `product/flows/FL-nnn.layout.json` | Where the PM placed the flow's steps on Aligner's canvas, written by Aligner. Don't edit it; a step it doesn't list is placed next to the step that leads to it |
| `product/flows/FL-nnn.lines.json` | How the PM drew the flow's connectors on Aligner's canvas (curved, elbowed or straight; where each end is glued on its step; where it was bent), written by Aligner. Don't edit it; a connector it doesn't list is drawn curved, between the facing sides of its steps |
| `product/screens.layout.json` | Where the PM placed the screens on Aligner's map of them, written by Aligner. Don't edit it; a screen it doesn't list is placed next to a screen that leads to it |
| `product/screens.lines.json` | How the PM drew the arrows on the map, as `FL-nnn.lines.json` does a flow's connectors, written by Aligner. Don't edit it; an arrow it doesn't list goes round the screens in between |

No frontmatter. Comments (`<!-- … -->`) and blank lines may go anywhere. Files use LF line endings and end with a newline.

### product/product.md
```md
<!-- Product context. Read product/INSTRUCTIONS.md before changing anything. -->

# Product

## Vision
- for: the target customer
- who: their need or opportunity
- the: product name
- is a: product category
- that: key benefit, reason to buy
- unlike: the current alternative
- our product: primary differentiator

## Out of scope
- OS-001: What the product will not do

## Constraints
- PC-001: A limit every change must respect
```
The vision fields are optional but come in this order.

### product/personas.md
```md
# Personas

## PE-001 Working parent
- who: Parent of a toddler; both parents work full time
- wants: Know their child is fine without calling the nursery
- pains: Updates arrive late and in pieces
- context: Checks the phone in short gaps between meetings

### Jobs
- JB-001: When I'm at work, I want a quick picture of my child's day, so I can stop worrying
  - name: Stop worrying at work
```
The four fields are optional, in this order, one line each. A job is one sentence: "When …, I want to …, so I can …". Its optional `name` line, indented under it, is the short name the PM calls the job by.

### product/flows/FL-nnn.md
```md
# FL-001 See today's summary
- jobs: JB-001

## Steps
- FS-001: [start-end] Open the app after work
  - screen: SC-001
  - target: 6, 22, 88, 12
- FS-002: [user-decision] Anything unusual today?
- FS-003: [user-action] Read the summary
  - screen: SC-001

## Connections
- FS-001 -> FS-002
- FS-002 -> FS-003: no
```
- `jobs`: the jobs the flow serves, separated by `, `.
- Step types: `start-end` (where the flow starts or ends), `user-action` and `user-decision`, and the system's: `system-action` (something the backend does) and `system-decision` (a choice the backend makes). A decision has two or more outgoing connections, each labelled with its answer (`- FS-002 -> FS-003: no`). Aligner draws system steps in violet.
- System steps are optional: add them only where the backend logic needs defining (a complex rule, an integration, an order of operations that matters), not for every save or request.
- A step's label may be empty (`- FS-007: [user-decision]`): a shape the PM placed and hasn't named yet. Ask the PM what it is before building it.
- `screen`: the screen the step happens on, if any.
- `target`: what the user taps or interacts with on that screen to do the step, as a box in percent of the screen's picture: `x, y, width, height` (`- target: 8, 64, 84, 9` is a box 8% from the left and 64% from the top, 84% wide and 9% tall). Aligner shows it as a blue box on the screen.
- Connections join steps of the same flow: `- FS-a -> FS-b`, with an optional `: label`.

### product/screens.md
```md
# Screens

## SC-001 Today
- picture: screens/SC-001.png
- mockup: screens/SC-001.mockup.png

### Links
- 6, 22, 88, 12 -> SC-002
- 70, 90, 30, 10 -> SC-003: once the week is planned
```
`picture` is the screenshot of the screen as built. `mockup`, when present, is how the PM wants the screen to look: the screenshot with changes drawn on it, a new screen drawn on a blank phone or laptop frame, or a sketch the agent made, which the PM draws over in Aligner. Build what it shows; its yellow sticky notes are the PM's notes to you. Paths are relative to `product/`.

`### Links` says where the screen's buttons, links and tabs lead, one click zone per line: the zone as a box in percent of the screen's picture (`x, y, width, height`, as a step's `target`), `->`, the screen it opens, and an optional `: label` for when or how it leads there (a condition, a gesture). A zone that leads to different screens has a line for each, labelled. Aligner draws each one as an arrow on its map of the screens. A screen with no links has no `### Links`.

## IDs
Every item has an ID: a two-letter prefix and three or more digits (`OS`, `PC`, `PE`, `JB`, `FL`, `FS` for steps, `SC`). A new item takes the next number after the highest one of its kind in the files. Never reuse or renumber IDs: links depend on them. Connections and a screen's links have no ID of their own.

## Rules for coding agents
1. **Before a change**, pull the branch, for the PM's latest edits; then read `product/product.md`, `product/personas.md`, and the flows and screens it touches, including their mockups. Respect the out-of-scope list and the constraints; if the request conflicts with them, ask the PM before building.
2. **Sketch** a screen when the PM asks how it could look: render it in the product's look (its colours, fonts and icons), capture it, and save the capture as the screen's mockup (`screens/SC-nnn.mockup.png` and its `mockup` line), adding the screen if it's new. The PM draws over it in Aligner. A sketch is never a screenshot: `picture` stays the screen as built.
3. **Build** flows end to end: the steps and decisions give the logic, the mockups the look, each step's `target` the element the user interacts with, and each screen's links where its buttons, links and tabs lead.
4. **After the change**, update the product context in the same commit as the code, so it describes the product as built:
   - behaviour changed: update the flow's steps and connections, and the screens; mark each user step's `target`, and each screen's links, on its new screenshot;
   - a screen looks different: replace its screenshot, captured from the running product; once it shows what its mockup asked for, remove the mockup (its `mockup` line and both mockup files);
   - if you can't capture screenshots, keep the old ones and say which screens need new ones. Never draw or fake one.
5. Check the product context against the format above and the checks below, and fix every error. Aligner shows the PM the errors it finds on the branch.
6. The vision, the out-of-scope list, the constraints, the personas and their jobs belong to the PM: change them only when asked. You may add flows and screens with their links, and link flows to existing jobs. Mapping a product, map where each screen's buttons, links and tabs lead too.

## Checks
Validation reports:
- **errors**: lines that don't match this format, duplicate IDs, links to missing items or to the wrong kind (`jobs` must name jobs, `screen` and a screen's links a screen), connections outside their flow, targets and click zones that aren't a box inside the picture, targets on a step with no screen, click zones on a screen with neither screenshot nor mockup, the same click zone and screen twice, and screenshot or mockup files that are missing;
- **warnings**: jobs that no flow serves, flows that serve no job, and decisions with fewer than two outcomes.
