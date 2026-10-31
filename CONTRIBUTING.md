# Contributing to DevBridge

Thanks for looking. This file covers how to get the repo running, the two
conventions that are easy to break by accident, and what a reviewable change
looks like.

The architecture is documented in [README.md](README.md) and the history of
how it got here is in [docs/roadmap.md](docs/roadmap.md). Read the README's
"Why N+M, not N×M" and "The three IRs" sections before adding a parser or a
generator — those two ideas are what the package layout is for, and a change
that ignores them will look fine in isolation and be wrong in review.

## Setup

You need Node 24 or newer. pnpm comes from corepack, pinned by the
`packageManager` field, so do not install it separately:

```bash
corepack enable pnpm
```

```bash
pnpm install
pnpm build
pnpm test
```

If you plan to touch a generator, you also want the target languages installed
— Java 21, Go 1.24, Python 3.13, .NET 8 — so `pnpm verify:generated` can run
locally instead of only in CI. Without them it skips, which is quiet but not
the same as passing.

## The scripts

| Command | What it does |
| --- | --- |
| `pnpm build` | `tsc -b` across the workspace |
| `pnpm test` | the full Vitest run |
| `pnpm test:watch` | the same, watching |
| `pnpm lint` | oxlint over every package and app |
| `pnpm lint:fix` | the autofixable subset |
| `pnpm verify:generated` | generate into every target and run that language's real compiler |
| `pnpm verify:generated:strict` | the same, but a missing toolchain fails instead of skipping |
| `pnpm build:web` / `pnpm dev:web` | the static web app |
| `pnpm build:vscode` / `pnpm package:vscode` | the extension bundle and its `.vsix` |

Before opening a pull request, run `pnpm lint`, `pnpm build`, `pnpm test`, and
— if you changed a generator — `pnpm verify:generated`. CI runs all of them on
both Ubuntu and Windows, plus the strict verification job.

## Two conventions worth stating

**Generated output is verified against real toolchains, not just asserted on.**
A unit test proving a generator emits a particular string proves only that the
string has not changed. `pnpm verify:generated` proves the string is valid
Java, Go, Python, C#, or TypeScript. If you add a target language, add it to
`scripts/verify-generated.mjs` too; a generator with no compiler behind it is
the one place this project will accumulate silent breakage.

It runs two fixtures through every target, and the second one is there for a
reason: `fixtures/kitchen-sink.openapi.yaml` contains a reference cycle, which
no JSON sample can express, and that case was emitting uncompilable Go until
a real `go vet` was pointed at it. If you touch a type-graph generator, run
both.

**Nothing shipped may touch the network or spawn a process.** This is a
promise the README and [SECURITY.md](SECURITY.md) both make to users pasting
production schemas into the tool, and it is enforced by `local-first.test.ts`
rather than by review. If you need `node:fs` or `node:child_process`, it
belongs in the CLI's own entry point or in a script under `scripts/`, not in a
transformer package.

## Linting

oxlint, not ESLint. That is not a preference: typescript-eslint does not
support TypeScript 7 (typescript-eslint#10940), and the repo targets the
native TypeScript port. When that lands, revisiting this is worthwhile.

Four rules are deliberately off in [`.oxlintrc.json`](.oxlintrc.json), and the
config is JSON so the reasoning has to live here:

- **`no-await-in-loop`** — every instance is a deliberately sequential loop:
  creating a directory before writing into it, opening editors one at a time.
  `Promise.all` would be wrong, not faster.
- **`unicorn/no-array-sort`** — all six `.sort()` call sites operate on a fresh
  array (`[...x]` or the result of `.map()`), so there is nothing shared to
  mutate. Each one was checked individually.
- **`unicorn/no-null`** and **`unicorn/no-array-reduce`** — stylistic, and the
  codebase is consistent without them. `null` in particular is meaningful here:
  it is a JSON value.
- **`unicorn/consistent-function-scoping`** in tests — a helper scoped to the
  test that uses it reads better than one hoisted away from it.

If you want to disable a rule for a line, say why in a comment above the
disable. The one inline disable in the repo (`react/no-array-index-key` in
`DiagnosticsList.tsx`) is written that way.

## Adding a parser or a target

The README has step-by-step lists for both — see "Adding a target" and the
section on the three IRs. The short version: a generator declares an `irKind`,
the engine refuses to pair families that do not match, and a new target needs a
descriptor in `apps/web/src/lib/options.ts` or a test will fail on purpose.

A parser whose source describes genuinely two kinds of thing can declare
`alsoProduces: "type-graph"` with a `parseTypeGraph` method, and the engine
picks the reading from the chosen target. OpenAPI is the only source that
does this, and the bar for a second one is high: it should be true of the
*format*, not a convenience. Note that such a parser's `validate` runs before
any target is chosen, so it must only reject what every reading would.

## Pull requests

- One concern per pull request. A refactor and a behaviour change in the same
  diff are hard to review and harder to revert.
- Explain *why* in the description. The *what* is in the diff.
- Tests for new behaviour, in the package that owns it. Parser changes should
  be driven through `parseJson` or `parseSql` so every generator sees the same
  fixtures.
- Comments should explain reasoning that is not obvious from the code — a
  constraint, a rejected alternative, a format quirk. The existing comments
  about Mermaid's `decimal(10,2)` and DBML's unnamed `Ref` are the model;
  neither fact is discoverable from the code alone.
- Keep the diff in the style of the file around it.

## Reporting bugs

For a transformation bug, the input is the bug report. Include the schema or
JSON you fed in, the target you asked for, what came out, and what you
expected. For anything security-relevant, read
[SECURITY.md](SECURITY.md) first — report it privately rather than in an issue.

## Scope

The blueprint (`DevBridge_Project_Blueprint.pdf`) is the scope anchor.
Deliberately out of scope for now: accounts and billing, a server backend for
transformations that can run locally, AI features before the deterministic path
is proven, and persistent storage of transformation inputs. A pull request
adding one of those will be declined on scope rather than on quality, so please
open an issue first.
