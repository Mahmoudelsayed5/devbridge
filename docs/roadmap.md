# Roadmap and build history

What exists, how it got here, the decisions that shaped it, and what comes
next.

Last updated after the Pages deployment landed (`25109ef`).

---

## Where the project stands

| | |
| --- | --- |
| Phases complete | 0–5 of 9 |
| Packages | 12 libraries + 1 web app |
| Source formats | 2 (JSON, SQL) |
| Target formats | 7 (TypeScript, Java, Go, Python, C#, Mermaid ERD, DBML) |
| Tests | 231, all passing |
| Source / test lines | ~6,300 / ~2,800 |
| CI | build + test on Ubuntu and Windows, plus generated-output compilation |

```
          ┌── TypeScript ─┐
JSON ──┐  ├── Java ───────┤
       ├──┼── Go ─────────┤ type-graph IR
       │  ├── Python ─────┤
       │  └── C# ─────────┘
       │
SQL ───┴──┬── Mermaid ERD ─┐ relational IR
          └── DBML ────────┘
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
| **ESLint config** | `lint` scripts were removed rather than left broken | small |
| **Duplicate JSON keys** | `{"a":1,"a":2}` silently keeps the last; detecting it needs a hand-written tokenizer | medium |
| **A licence** | The repository is public with no `LICENSE` file, which legally means all rights reserved — nobody may use it | small, needs a decision |

**Done since this list was written:**

- ~~Integer width~~ — `integer` and `long` are now distinct in the IR, decided
  once by `integerWidth`, mapping to `long` / `int64` per target. The parser
  also warns when a whole number has already lost precision in `JSON.parse`.
- ~~Deploy the web app~~ — live at
  <https://mahmoudelsayed5.github.io/devbridge/>, published from `main` by
  `.github/workflows/deploy-pages.yml`. The repository was made public so that
  Pages would work on the free plan.

### Phase 6 — OpenAPI family

OpenAPI → Postman collections and related artifacts.

**Open question to settle first:** does OpenAPI fit the existing type-graph IR,
or does it need a third (request/response/endpoint) model? An OpenAPI *schema*
object maps cleanly onto the type graph, but *paths, verbs, parameters and
responses* do not. Current expectation: a third IR, reusing the same pattern —
which phase 5 has now proven is cheap to add.

### Phase 7 — Integrations

VS Code extension and Chrome extension. The engine is already browser-safe and
surface-independent, so this is mostly packaging and UX. Likely order:

1. **VS Code** — highest value: transform the selection, or right-click a
   `.json`/`.sql` file. The engine is already a plain library.
2. **Chrome** — transform a JSON response straight from the network tab.

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
- **No deployment yet.**

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
