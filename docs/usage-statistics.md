# Usage statistics

Your Aligner tells its makers how much it's used, so we can see whether it helps PMs and what to make better. This page lists everything it sends, and how to turn it off.

## What your Aligner sends
Your Aligner's server, not your browser, sends a short message to `https://productalignment.org/api/usage` when you, or anyone signed in to it:
- opens Aligner (once a day);
- changes the product (the vision, personas or jobs), a flow, the screens or their map, or a mockup (once a day for each);
- starts a branch, commits their draft, or adds product context to a repository (each time);
- sees a push that changed the product context of the branch they have open: usually their coding agent's, having built what they asked for (each time).

Each message holds these four things, and nothing else:

| Field | Example | What it is |
|---|---|---|
| `aligner` | `3f9a0c1d2e4b5a67` | your Aligner |
| `pm` | `b81e4d2c0a9f3e15` | the person who did it |
| `version` | `1.1.0` | your Aligner's version |
| `event` | `commit` | what they did: `open`, `product`, `flows`, `screens`, `mockups`, `branch`, `commit`, `start` or `push` |

`aligner` and `pm` are hashes keyed with your GitHub app's secret, which only your Aligner has: nobody else can work them out, or trace them back to you or to your GitHub account. They let us count people and see whether they come back, without knowing who they are.

## What it never sends
Names, GitHub logins or email addresses; the names of repositories, branches or files; anything in your product context, your commit messages or your code; your IP address, or anything about your browser. productalignment.org keeps no IP addresses either.

## What we do with them
We count people per day, week and month; which parts of Aligner they use; how often they commit; and how many come back, week after week. Only we see the numbers, we don't sell or share them, and we delete them after 25 months. They are kept at Cloudflare, in the EU. [productalignment.org/privacy](https://productalignment.org/privacy) says the same, with what the website counts.

The code that sends them is [`apps/web/src/usage.ts`](../apps/web/src/usage.ts).

## Turning them off
In Railway, open your Aligner service's **Variables**, add `ALIGNER_USAGE_STATS` with the value `off`, and deploy. Your Aligner sends nothing from then on, and its account menu stops mentioning them.

To keep them yourself instead, set `ALIGNER_USAGE_STATS` to the address of a server of yours: it gets the messages above, as JSON in a `POST`.
