<!-- Product context. Read product/INSTRUCTIONS.md before changing anything. -->

# Product

## Vision
- for: product managers who build products with AI coding agents
- who: want a connected picture of the product, from the vision down to the smallest detail, that they can refine in a structured way to make sure the right thing gets built
- the: Aligner
- is a: simple, visual editor of the product context
- that: keeps the vision, the personas and the jobs they hire the product for, and the user flows with screenshots and mockups as plain files in the repo, which the PM edits as UI and the coding agent reads before every change and updates after it
- unlike: loose prompts, specs and backlogs that drift away from what was built
- our product: treats product specifications as code: connected, validated and versioned with the product, so they stay true to the product as built

## Out of scope
- OS-001: Multi-user collaboration inside Aligner, collaboration is organized via repo in github
- OS-002: Cloud sync
- OS-003: Integrations with Jira, Linear and other trackers
- OS-004: Item types beyond the vision, personas, jobs to be done, user flows and screens
- OS-005: A standalone desktop app
- OS-006: Reviewing or approving the agent's changes before they land
- OS-007: A backlog, user stories or build tracking

## Constraints
- PC-001: No hidden database for product state; the repo files are the source of truth
- PC-002: A product context must keep working with any AI coding agent, without Aligner
