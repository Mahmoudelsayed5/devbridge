# DevBridge

A developer transformation layer: take an artifact you already have and produce
the one you need next.

Everything in this repository is deterministic and runs locally. Nothing is
uploaded and no input is stored.

```
Source → Parser → Shared IR → Generator → Target
```

Adding a target language is a generator task, not another end-to-end converter.

📄 **[Why DevBridge](docs/why-devbridge.md)** — what it solves, use cases, and
how to explain it to someone else.
🗺️ **[Roadmap and build history](docs/roadmap.md)** — what exists, the
decisions behind it, and what comes next.

## Two IRs, not one

There are two intermediate representations, and the split is deliberate.

| IR | Models | Fed by | Feeds |
| --- | --- | --- | --- |
| **type graph** (`TypeNode`) | the *shape* of a value: primitives, objects, arrays, unions | `json` | `typescript`, `java`, `go`, `python`, `csharp` |
| **relational** (`RelationalModel`) | tables, columns, keys and the relationships between them | `sql` | `mermaid`, `dbml` |

The blueprint asks for one shared representation "whenever practical", and
this is where that stops being practical: there is nowhere in `TypeNode` to
record that a column references another table's primary key, and an ERD is
mostly a drawing of exactly those references. A SQL schema forced into the
type graph would lose the information its targets exist to show.

Everything else *is* shared — naming, diagnostics, `CodeWriter`, the
registries and the CLI and web surfaces. Each parser and generator declares
an `irKind`, and the engine refuses to pair mismatched ones with a message
naming the targets that would work:

```
"mermaid" cannot read JSON: it renders database schemas, and JSON produces
data shapes. Available targets for json: typescript, java, go, python, csharp.
```

## Status

| Phase | Goal | Status |
| --- | --- | --- |
| 0 | Monorepo, core package, tests | done |
| 1 | JSON → TypeScript | done |
| 2 | JSON → Java | done |
| 3 | JSON → Go, Python, C# | done |
| 4 | Web MVP | done |
| 5 | SQL family (Mermaid ERD / DBML) | done |
| 6 | OpenAPI family | not started |
| 7 | Chrome and VS Code extensions | not started |

## Packages

| Package | Responsibility |
| --- | --- |
| `@devbridge/core` | Both IRs, `TransformationContext`, naming helpers, diagnostics, parser/generator contracts, registries |
| `@devbridge/json-transformer` | JSON → IR (shape inference, merging, contextual naming) |
| `@devbridge/typescript-transformer` | IR → TypeScript interfaces / type aliases |
| `@devbridge/java-transformer` | IR → Java classes or records |
| `@devbridge/go-transformer` | IR → Go structs with json tags |
| `@devbridge/python-transformer` | IR → Python dataclasses |
| `@devbridge/csharp-transformer` | IR → C# classes or records |
| `@devbridge/sql-transformer` | SQL → relational IR (tables, keys, foreign keys) |
| `@devbridge/mermaid-transformer` | Relational IR → Mermaid `erDiagram` |
| `@devbridge/dbml-transformer` | Relational IR → DBML |
| `@devbridge/engine` | Wires every parser and generator into one `transform()` call |
| `@devbridge/cli` | `devbridge transform`, `devbridge validate`, `devbridge formats` |
| `@devbridge/web` (`apps/web`) | The web MVP — paste, pick a target, copy or download |

## Web app

```bash
pnpm dev:web      # http://localhost:5173
pnpm build:web    # static bundle in apps/web/dist
```

Pick a source format (JSON or SQL), paste or open a file, pick one of the
targets that source can feed, adjust only the options that target actually
reads, and copy or download the result. The target buttons change with the
source, so a cross-family pairing is not offerable in the first place.
Targets that emit one file per type (Java, C#) show file tabs and a
"Download all" button that builds a `.zip` in the browser.

It is a static bundle with **no backend**: the engine runs in the page, so an
artifact is never uploaded, and nothing is written to `localStorage` — the
input is gone on refresh, which is what the blueprint asks for. That promise is
enforced by a test (`local-first.test.ts`) that fails if any shipped module
references `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon` or any web
storage API.

`apps/web/tsconfig.json` deliberately does not extend `tsconfig.base.json`: the
app needs `moduleResolution: "Bundler"`, JSX and DOM libs, where the libraries
are built as composite `NodeNext` projects. Vite aliases the workspace packages
to their TypeScript source, so `pnpm dev:web` needs no prior `tsc -b`.

## Getting started

Requires Node.js 24 LTS or newer. pnpm is not installed globally — corepack
resolves the version pinned in `packageManager`:

```bash
corepack enable pnpm
```

```bash
pnpm install
pnpm build
pnpm test
```

Verified on Node v24.21.0, pnpm 12.8.1, TypeScript 7.0.2, Vitest 5.0.2:
12 packages build clean, 215 tests pass.

### Verifying generated code actually compiles

The unit tests assert on generated text. This asserts the text is valid in the
target language, which is a stronger and different claim:

```bash
pnpm verify:generated
```

It generates `fixtures/kitchen-sink.json` into every target and runs that
language's real toolchain: `tsc --strict`, `javac -Xlint:all`, `go vet` plus a
`gofmt -l` canonical-formatting check, `py_compile` plus `typing.get_type_hints`
on every dataclass, and `dotnet build` with `TreatWarningsAsErrors`. A missing
toolchain is skipped; `pnpm verify:generated:strict` makes it a failure instead,
which is what CI uses.

The two relational targets have no compiler, so they are verified differently
and in the normal test run: the generated DBML is parsed by the official
`@dbml/core` parser, and the Mermaid output was checked against mermaid 11.15
in a browser. That check found two things worth recording — Mermaid rejects a
comma inside an attribute type (`decimal(10,2)`), but does accept a
comma-separated key marker list (`PK, FK`).

## CLI

```bash
node packages/cli/dist/bin.js transform payload.json --to java --package com.example --out ./generated
```

```bash
cat payload.json | node packages/cli/dist/bin.js transform - --from json --to typescript
```

```bash
node packages/cli/dist/bin.js transform schema.sql --to mermaid
```

```bash
node packages/cli/dist/bin.js validate payload.json
```

`devbridge formats` lists each source with the targets it can feed, since
only same-family pairs are valid.

## Library

```ts
import { transform } from "@devbridge/engine";

const result = transform({
  input: '{"user":{"id":1}}',
  source: "json",
  target: "typescript",
});

console.log(result.preview);
console.log(result.names); // ["Root", "User"] — table names for SQL
```

`result.ir` is discriminated by family, so a consumer can reach the model it
actually got:

```ts
if (result.ir.kind === "relational") {
  console.log(result.ir.model.tables.length);
}
```

Or drive a single stage directly:

```ts
import { parseJson } from "@devbridge/json-transformer";
import { generateJavaFiles } from "@devbridge/java-transformer";

const { root, context } = parseJson(source, { rootName: "Payload" });
const files = generateJavaFiles(root, context, { packageName: "com.example" });
```

## How JSON inference works

The parser runs in two passes, which is what makes merging and naming
dependable.

1. **Shape inference.** Every value becomes an unnamed `Shape`. Shapes merge:
   two array items merge into one item shape, a property missing from one
   sample is recorded as present in fewer samples than the total, `integer` and
   `number` widen to `number`, and an empty array collapses into whatever a
   later sample reveals. Merging is recursive, so nested objects inside array
   items widen instead of the first sample silently winning.
2. **Naming and IR construction.** Each object position gets the *shortest
   unique* type name. A bare property name wins when nothing else wants it;
   a conflict pulls in as many parent fragments as needed
   (`Address` → `CompanyAddress` / `CustomerAddress`). Two structurally
   identical objects in different places stay separate types, which is the
   contextual naming the blueprint asks for.

Resulting rules:

| JSON | IR | TypeScript |
| --- | --- | --- |
| `{"a":1}` | `integer` | `number` |
| `{"a":1.5}` | `number` | `number` |
| `[1, 1.5]` | `array<number>` | `number[]` |
| `[]` | `array<unknown>` | `unknown[]` |
| `[1,"a"]` | `array<union>` | `(number \| string)[]` |
| `[1,null]` | `array<union>` | `(number \| null)[]` |
| missing in one item | `optional` | `a?: T` |
| `null` in one item | `union` with `null` | `a: T \| null` |

A document whose root is an array is accepted: the root type then describes a
single element, and an informational diagnostic says so. A leading UTF-8 byte
order mark is stripped, since Windows editors write one and `JSON.parse`
rejects it.

## Target notes

- **TypeScript** — one file, `export interface` by default; `style: "type"` for
  aliases. Property names are quoted when they are not plain identifiers.
- **Java** — one file per class, getters and setters by default,
  `style: "record"` for records. Optional and nullable primitives are boxed.
  `jsonAnnotations: true` adds `@JsonProperty` only where a name changed.
- **Go** — one file, exported fields, aligned columns, `json:"..."` tags with
  `omitempty` on optional fields, pointers for optional and nullable values.
- **Python** — dataclasses with `from __future__ import annotations`. Optional
  fields default to `None` and are moved last, because Python forbids a field
  without a default after one that has a default. JSON keys are preserved by
  default so `Root(**payload)` works.
- **C#** — one file per type, `required` members (C# 11) for non-optional
  properties and nullable types otherwise, `[JsonPropertyName]` wherever the
  name was converted.
- **Mermaid** — one `erDiagram`. Cardinality is read off the schema rather
  than guessed: a nullable foreign key makes the parent side optional
  (`|o--o{`), and a child key that is itself unique makes the relationship
  one-to-one (`||--o|`). Attribute types are sanitised for Mermaid's grammar —
  spaces and commas become underscores, so `decimal(10,2)` is emitted as
  `decimal(10_2)` and `timestamp with time zone` as `timestamp_with_time_zone`.
  `simpleTypes: true` drops the arguments entirely.
- **DBML** — one document. Full SQL types are kept verbatim (only Mermaid
  needs sanitising). A single-column primary key is inline `[pk]`; composite
  keys and multi-column uniques go in an `indexes` block. Defaults are
  classified: a SQL string becomes a DBML string, a number stays bare, and
  anything else is an expression in backticks.

## SQL support

The parser is dialect-tolerant rather than dialect-correct — the goal is to
read a schema dump from MySQL, PostgreSQL, SQL Server or SQLite, not to
validate SQL. It reads `CREATE TABLE`, `ALTER TABLE ... ADD CONSTRAINT` and
`CREATE UNIQUE INDEX`; anything else is skipped.

Handled: quoted identifiers in all four styles (`"x"`, `` `x` ``, `[x]`),
schema qualification, multi-word types (`double precision`,
`character varying(40)`, `timestamp with time zone`), inline and table-level
constraints, composite primary keys, `SERIAL` and `GENERATED ... AS IDENTITY`,
`ON DELETE` / `ON UPDATE` actions, line and block comments, and defaults
captured verbatim from the source text. `ALTER TABLE` is applied after every
`CREATE TABLE`, so a constraint may appear before the table it references.

A foreign key pointing at a table that is not in the document is a warning,
not an error — the relationship is still drawn.

## Adding a target

1. Create `packages/<name>-transformer` exporting a `TargetGenerator`
   (`irKind: "type-graph"`) or a `RelationalGenerator`
   (`irKind: "relational"`).
2. Map the IR to the language, reusing `splitNullable` and the naming helpers
   for a type graph, or `relationshipsOf` and `isUniqueSet` for a relational
   model, plus `CodeWriter` for output in either case.
3. Register it in `packages/engine/src/index.ts`.
4. Add tests driven by `parseJson` or `parseSql`, so every generator is
   exercised against the same fixtures.
5. Add a descriptor to `apps/web/src/lib/options.ts`. A test fails if a
   registered target has none, so the web app cannot silently fall behind.

No parser changes are needed, and the web app picks the new target up from the
registry on its own.

## Scope

The blueprint (`DevBridge_Project_Blueprint.pdf`) is the scope anchor. Out of
scope for now: accounts and billing, a server backend for transformations that
can run locally, AI features before the deterministic path is proven, and
persistent storage of transformation inputs.
