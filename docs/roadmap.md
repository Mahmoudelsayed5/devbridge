# Roadmap and build history

What exists, how it got here, the decisions that shaped it, and what comes
next.

Last updated after phase 7 and the hardening pass that followed it.

---

## Where the project stands

| | |
| --- | --- |
| Phases complete | 0–7 of 9 (Chrome extension deliberately skipped) |
| Packages | 14 libraries + web app + VS Code extension |
| Source formats | 3 (JSON, SQL, OpenAPI) |
| Target formats | 8 (TypeScript, Java, Go, Python, C#, Mermaid ERD, DBML, Postman) |
| Tests | 310, all passing |
| Source / test lines | ~6,300 / ~2,800 |
| CI | lint, build + test on Ubuntu and Windows, plus generated-output compilation |

```
             ┌── TypeScript ─┐
JSON ─────┐  ├── Java ───────┤
          ├──┼── Go ─────────┤  type-graph IR
          │  ├── Python ─────┤
          │  └── C# ─────────┘
          │
SQL ──────┴──┬── Mermaid ERD ┐  relational IR
             └── DBML ───────┘

OpenAPI ─────── Postman ─────── api IR
```

---

## What was built, phase by phase

### Phase 0 — Foundation *(pre-existing)*
pnpm monorepo, TypeScript, the first core package.

### Phase 1 — JSON → TypeScript *(rebuilt)*

The phase was marked "nearly done" but could not build: every package extended
a `tsconfig.base.json` that **did not exist**. Working through the definition
of done surfaced bugs where the parser produced plausible output while
silently dropping data, so the parser was rebuilt rather than patched.

**Pre-existing bugs fixed:**

| Problem | Effect |
| --- | --- |
| `parseObject` returned the first type registered under a name | the second object's fields were discarded |
| contextual naming used only the immediate parent | two different shapes 3 levels deep collided; one was lost |
| nested objects in array items were not merged | `[{p:{city}}, {p:{city,zip}}]` lost `zip` |
| `integer` + `number` not widened | `number \| number` in TS, `Object` in Java |
| empty array not collapsed | `unknown[] \| string[]` |
| malformed TS output | leading space, 1-space indent, no `export` |
| Java import scan recursed into referenced classes | false-positive `java.util.List` imports |
| Java had no accessors | output was not usable |
| UTF-8 BOM rejected | BOM-prefixed JSON is normal on Windows |

**The rebuild — two passes:**

1. **`shape.ts`** infers an unnamed `Shape`, then merges recursively. Objects
   union their property sets with *presence counts*, so "missing from one
   sample" is a recorded fact rather than a guess. `integer` widens with
   `number`; empty arrays collapse into whatever a later sample reveals.
2. **`builder.ts`** assigns the **shortest unique** type name. A bare property
   name wins when nothing else wants it; a conflict pulls in as many parent
   fragments as needed (`Address` → `CompanyAddress` / `CustomerAddress`).

### Phase 2–3 — Java, Go, Python, C#

Four more generators over the same IR. The TypeScript generator was moved out
of `json-transformer` into its own package so that generators are
target-scoped and parsers source-scoped — otherwise "adding a target is a
generator task" was not structurally true.

Also added: `@devbridge/engine` (registries + `transform()`) and
`@devbridge/cli`.

### Phase 4 — Web MVP

A static React + Vite app. No backend; the engine runs in the page.

- Source panel with file open, sample loading, and live validation
- Target picker, with only the options each target actually reads
- File tabs and a **dependency-free ZIP writer** (~190 lines, STORE-only) so
  the file-per-type targets download as one archive
- `local-first.test.ts`, which fails the build if any shipped module
  references `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon` or web
  storage

### Phase 5 — SQL family

SQL → Mermaid ERD and DBML. The phase that tested the project's central
architectural bet.

- **`sql-transformer`** — a tokenizer and dialect-tolerant parser reading
  `CREATE TABLE`, `ALTER TABLE ... ADD CONSTRAINT` and `CREATE UNIQUE INDEX`
  from MySQL, PostgreSQL, SQL Server and SQLite dumps
- **`mermaid-transformer`** — `erDiagram` output with crow's-foot cardinality
- **`dbml-transformer`** — DBML with inline and composite keys, and refs

### Phase 6 — OpenAPI family

OpenAPI 3 → Postman collection, and the second confirmation that adding an IR
is cheap once the pattern exists.

- **`openapi-transformer`** — reads YAML or JSON, resolves local `$ref`s with
  cycle protection, merges path-level parameters into each operation, and
  **synthesises example payloads** from schemas so every generated request
  arrives prefilled rather than blank
- **`postman-transformer`** — Collection v2.1: folders by tag, a `{{baseUrl}}`
  variable, `:name` path parameters, optional query parameters included but
  disabled, and security schemes mapped onto collection-level auth

The question settled here was whether OpenAPI needed its own IR. Its
`components/schemas` would have fitted the type graph — but its `paths` are
the part a Postman collection is made of, and there is no slot in `TypeNode`
for a verb, a path parameter or a `404`. A third IR it was.

Cost of the third IR: the `ApiModel` file, the two packages, and four lines of
engine wiring. Nothing in the other six generators changed.

### Phase 7 — VS Code extension

The engine was already a plain, browser-safe library, so this was packaging
and UX rather than new capability.

- `src/core.ts` holds every decision — source inference, target filtering,
  result shaping — and imports nothing from `vscode`
- `src/extension.ts` is thin glue that does, and therefore holds nothing worth
  testing
- esbuild bundles the engine into one CommonJS file with `vscode` external, so
  the packaged extension has no runtime dependencies
- `pnpm package:vscode` produces an installable `devbridge.vsix` (56 KB), which
  CI uploads as an artifact on every run

**The testing approach is the part worth keeping.** An extension can only
really be exercised inside an editor, which CI cannot do cheaply — but most of
what goes wrong is cheaper than that. A second suite loads the real bundled
`.cjs` with a **stubbed `vscode` module** and asserts three things: that it
loads at all, that it exports `activate` and `deactivate`, and that it
registers *exactly* the commands the manifest declares. A manifest promising a
command the code never registers is the classic extension bug, and it is now
impossible to merge.

### After phase 7 — the hardening pass

With the feature work done, the question changed from "what else can it do" to
"what is wrong with it that nobody has looked for". Three things came out of
auditing it as a public repository rather than as a work in progress.

**Duplicate JSON keys were silent data loss.** `JSON.parse('{"a":1,"a":2}')`
returns `{a: 2}` and reports nothing, so a hand-edited config with a key
pasted twice would transform cleanly and quietly lose a field. Detecting it
means scanning the text yourself — by the time `JSON.parse` returns, the
evidence is gone. `duplicates.ts` walks the document with a frame stack, which
is what makes the distinctions that matter: a key is only a duplicate within
*its own* object, a brace inside a string is not structure, and `"a"` is
the same key as `"a"`. Reported as a warning, not an error: the document is
still valid JSON and still transforms.

**The repo had no linter, and could not have the obvious one.**
typescript-eslint does not support TypeScript 7 (their issue #10940), and the
whole repo targets the native port — so ESLint was blocked by a real
incompatibility rather than a preference. oxlint runs its rules without a
TypeScript integration, so it works today. Across ~9,000 lines it found 13
problems, nearly all cosmetic; the one worth the exercise was a local `text`
variable in the OpenAPI parser shadowing a module-level `text()` helper,
making the helper unreachable inside that function. Four rules are off on
purpose and the reasoning is recorded in `CONTRIBUTING.md`, because the config
is JSON and cannot hold a comment. The audit behind one of them is the useful
kind: `unicorn/no-array-sort` fires on all six `.sort()` calls, and each one
was checked individually — every one sorts a fresh array, so the rule is wrong
six times out of six here.

**`noUnusedLocals` found nothing**, which was the point. A clean result makes
it a ratchet rather than a cleanup.

---

## Decisions that shaped the design

### A shared IR, so adding a target is one piece

Parse into an intermediate representation, generate from it. **N + M** pieces
rather than **N × M**. The measured proof: adding the two SQL targets needed
no change to the JSON parser and no change to the five language generators.

### Two IRs, not one — the one place the bet bent

The type-graph IR models the *shape of a value*. A database schema models
tables and the relationships between them, and an ERD is mostly a drawing of
those relationships. There is nowhere in `TypeNode` to record "this column
references that table's primary key".

So `RelationalModel` lives alongside `TypeNode`. Everything else is still
shared — naming, diagnostics, `CodeWriter`, registries, CLI and web app. Each
parser and generator declares an `irKind`, and the engine refuses a mismatched
pair with a message naming the way out:

```
"java" cannot read SQL: it renders data shapes, and SQL produces database
schemas. Available targets for sql: mermaid, dbml.
```

The architecture survived a second source format. What it did not survive was
the assumption of a *single* representation — and that seems like the right
place for it to bend.

### Verify generated output with real tools, not assertions

Unit tests assert what the text *looks like*. A separate check asserts the text
is **valid in the target language** — `tsc --strict`, `javac -Xlint:all`,
`go vet` + `gofmt -l`, `py_compile` + `get_type_hints`, `dotnet build` with
`TreatWarningsAsErrors`, `@dbml/core` for DBML, and a browser render for
Mermaid.

This is the decision that paid for itself most often. Three bugs found this way
that every unit test had passed:

1. **Mermaid rejects a comma inside an attribute type** — `decimal(10,2)`
   broke the diagram. The same probe also disproved a *second* assumption: the
   `PK, FK` marker list I had avoided as risky is in fact accepted.
2. **DBML's unnamed `Ref` requires a colon** — `Ref: a.b > c.d`, not
   `Ref a.b > c.d`.
3. **A UTF-8 BOM** made valid JSON unparseable — found because PowerShell
   wrote a test fixture with one.

### Make the privacy claim testable

The web app says "nothing is uploaded or stored" on screen. A claim like that
rots silently, so a test enforces it across the app *and* all seven library
packages.

### Failure is data, not an exception

The web UI re-runs on every keystroke, so a half-typed document is the normal
case. `runTransform` never throws, and a test asserts an invalid artifact
*always* yields at least one diagnostic — you cannot land in a blank error
state.

---

## What's next

### Immediate — small, unblocked

| Item | Why | Size |
| --- | --- | --- |
| **OpenAPI → language models** | The `components/schemas` half of an OpenAPI document fits the type graph, so the same file could also feed the five language generators. Needs a parser that can offer two IRs. | medium |
| **Publish the extension** | The `.vsix` builds in CI but has never been pushed to the Marketplace, which needs a publisher account | small |

**Done since this list was written:**

- ~~Duplicate JSON keys~~ — `packages/json-transformer/src/duplicates.ts`
  now reports them as warnings (`json/duplicate-key`), through both
  `parseJson` and `validateJson`. `JSON.parse` keeps the last value and says
  nothing, so this was real silent data loss. It needed the hand-written
  scanner the list predicted: a brace inside a string, an escaped quote in a
  key, and `"a"` versus `"a"` all have to be handled, and all three are
  tested.
- ~~A linter~~ — oxlint, not ESLint. **The reason is worth recording:**
  typescript-eslint does not support TypeScript 7 (their issue #10940), and
  this repo targets the native port, so the obvious choice was unavailable
  rather than merely unattractive. oxlint needs no TypeScript integration to
  run its rules. It found 13 problems in ~9,000 lines; the one that mattered
  was a local `text` variable shadowing a module-level `text()` helper in the
  OpenAPI parser, which made the helper unreachable inside that function.
  `pnpm lint` runs as its own CI job.
- ~~Compiler-level dead-code detection~~ — `noUnusedLocals` and
  `noUnusedParameters` across all three tsconfigs. Found nothing, which is
  the useful outcome: it now cannot accumulate.
- ~~Repository hygiene~~ — `CONTRIBUTING.md`, `SECURITY.md`, `.editorconfig`
  and a grouped Dependabot config.
- ~~Integer width~~ — `integer` and `long` are now distinct in the IR, decided
  once by `integerWidth`, mapping to `long` / `int64` per target. The parser
  also warns when a whole number has already lost precision in `JSON.parse`.
- ~~Deploy the web app~~ — live at
  <https://mahmoudelsayed5.github.io/devbridge/>, published from `main` by
  `.github/workflows/deploy-pages.yml`. The repository was made public so that
  Pages would work on the free plan.
- ~~A licence~~ — MIT.
- ~~Phase 6~~ — see above.

### Phase 7 — Integrations *(VS Code done; Chrome deliberately not)*

The VS Code extension is built and packages to an installable `devbridge.vsix`
that CI uploads on every run. See the README for what it does.

**Chrome extension: recommended against, for now.** The blueprint lists it,
but the case has weakened since it was written:

- The obvious version — paste JSON in a browser, get types — is **what the
  live web app already does**, and the web app needs no install and no store
  review.
- The version that would actually add something — reading a response straight
  out of the DevTools network panel — is a `chrome.devtools.network` panel
  under Manifest V3. That is real, fiddly work against an API that has
  already churned once, for a workflow most developers do a few times a month.
- Anyone else installing it needs a Chrome Web Store listing: a developer
  account, a review cycle, and a privacy declaration for an extension whose
  entire pitch is that it touches no data.

Worth revisiting if someone actually asks for it. Until then it is cost
without evidence, which is the thing the blueprint's scope rules exist to
prevent.

**A better next integration**, if one is wanted: a JetBrains plugin, which
reaches the IntelliJ/WebStorm/DataGrip audience the SQL family is aimed at and
has no equivalent already shipping.

### Phase 8–9 — Later

Productization (accounts, team features, API plans) and AI assistance
(repair, explanation, difficult transformations). Both explicitly deferred
until the deterministic engine has proven demand — monetization should follow
evidence of usage rather than drive architecture.

### Further sources worth considering

| Source | Targets | Note |
| --- | --- | --- |
| GraphQL SDL | language models | fits the type-graph IR directly |
| Protobuf / Avro | language models | fits the type-graph IR directly |
| SQL | Django / SQLAlchemy / JPA models | would need relational → type-graph bridging |
| Figma | React components | listed in the blueprint; much larger and less certain |

---

## Known gaps

Stated plainly, so nobody is surprised:

- **Inference is sample-based.** Fields absent from every sample cannot appear
  in the output.
- **The SQL parser skips what it doesn't recognise.** Views, triggers,
  stored procedures and partitioning clauses are ignored, not reported.
- **Mermaid output is lossy by one character**: `decimal(10,2)` is emitted as
  `decimal(10_2)` because Mermaid's grammar rejects the comma. DBML keeps the
  type verbatim.
- **No syntax highlighting** in the web editor — a plain `<textarea>`, which
  keeps the bundle dependency-free. CodeMirror is the obvious upgrade if it
  starts to bite.
- **The VS Code extension is not published.** It builds, packages and
  installs from the `.vsix`, but reaching users through the Marketplace needs
  a publisher account that does not exist yet.
- **OpenAPI only produces Postman.** The `components/schemas` half of a
  document is a type graph and could feed the language generators; no parser
  currently offers two IRs from one source.

---

## Working agreements that have held up

Carried from the project blueprint, and worth keeping:

1. **Correctness over quantity.** A small number of excellent transformations.
2. **IR-first.** New targets reuse a shared representation whenever practical —
   and when it stops being practical, say so explicitly rather than forcing it.
3. **Every important bug becomes a test.** Every fix listed above has one.
4. **Local-first.** Deterministic transformations never require uploading.
5. **Explicit AI.** Anything AI-powered stays clearly separated from the
   deterministic conversion path.
6. **Scope discipline.** A feature must strengthen either the transformation
   engine or the developer workflow around it.
