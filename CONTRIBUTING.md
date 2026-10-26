# Contributing to Aligner

Issues and pull requests are welcome. By taking part, you agree to follow our [code of conduct](CODE_OF_CONDUCT.md). To report a security issue, see [`SECURITY.md`](SECURITY.md) instead of opening an issue.

## Before you start

- [`CLAUDE.md`](CLAUDE.md) describes the code, how it's organised, and the rules it follows; your coding agent reads it too.
- [`docs/architecture.md`](docs/architecture.md) explains how Aligner is built.
- Aligner describes itself in its own product context, in `product/`; [`product/INSTRUCTIONS.md`](product/INSTRUCTIONS.md) is the format. A change to the product updates it in the same commit.

## Working on it

```sh
npm install
npm run dev                                # run Aligner on the example product, against a stand-in for GitHub
npm run validate -- examples/tidy          # check a product context in a folder
```

## Checks to run before pushing

From the repository root:

```sh
npm test                                   # all packages (builds the app first)
npm run typecheck
npm run validate -- .                      # Aligner's own product context
npm run validate -- examples/tidy          # the example product
npm run e2e                                # after UI changes: the UI in Chromium against the built server and a stand-in for GitHub
```

CI runs the same checks on every push and pull request.

## Licence

By contributing, you agree that your code is licensed under the [MIT License](LICENSE) and your documentation under [CC BY 4.0](LICENSE-docs), as described in the README.
