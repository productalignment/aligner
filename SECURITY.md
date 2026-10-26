# Security

## Reporting a vulnerability

Please report security issues privately, not in a public issue:

- through GitHub's [private vulnerability reporting](https://github.com/productalignment/aligner/security/advisories/new) for this repository, or
- by email to hello@productalignment.org.

Say what you found, how to reproduce it, and which version of Aligner it affects (shown in your Aligner, and in `apps/web/package.json`). We'll acknowledge your report, keep you posted while we fix it, and credit you in the advisory if you'd like.

## How Aligner holds your keys

There is no shared Aligner service. Each Aligner is a copy that a PM runs for themselves, with its own GitHub App, created from a manifest on its first start: the app's keys live only in that PM's Railway variables, and the app may read and change only the repositories the PM picks for it. Aligner has no database: the session is a sealed cookie, and its volume holds only the drafts not yet committed.

So a vulnerability in Aligner is fixed by a new version, which every Aligner offers to install with **Update now**. If you think your own app's keys have leaked, regenerate them in the app's settings on GitHub and give Railway the new ones.

## Supported versions

Only the latest version gets security fixes.
