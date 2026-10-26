# AGENTS.md

Instructions for AI coding agents. Working on Aligner's own code: see the "Working on Aligner's code" section of `CLAUDE.md`.

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
