# DevBridge

**▶ Try it: https://mahmoudelsayed5.github.io/devbridge/**

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

## Three IRs, not one

There are three intermediate representations, and each split is deliberate.

| IR | Models | Fed by | Feeds |
| --- | --- | --- | --- |
| **type graph** (`TypeNode`) | the *shape* of a value: primitives, objects, arrays, unions, enums, maps, literals | `json`, `openapi` | `typescript`, `java`, `go`, `python`, `csharp` |
| **relational** (`RelationalModel`) | tables, columns, keys and the relationships between them | `sql` | `mermaid`, `dbml` |
| **api** (`ApiModel`) | endpoints: verbs, paths, parameters, bodies and responses | `openapi` | `postman` |

The blueprint asks for one shared representation "whenever practical", and
each of these is a place where that stops being practical. There is nowhere
in `TypeNode` to record that a column references another table's primary key,
and an ERD is mostly a drawing of exactly those references. There is likewise
no slot for `GET`, a path parameter or a `404`, and a Postman collection is a
list of requests.

### One document, two readings

OpenAPI appears twice in that table, and it is the only source that does.
Its `paths` are HTTP endpoints and its `components/schemas` are data shapes;
both readings are legitimate, and which one you want depends on what you
asked for. So the parser declares that it *also* produces the type graph, and
the engine picks the reading from the chosen target — `--to postman` reads the
paths, `--to java` reads the schemas.

That is deliberately a small addition rather than a general "list of IRs" on
every parser: only one secondary IR has proved worth having, and it is always
the type graph, because that is where the generators are.

Reading schemas rather than samples is also better information in three
places, and the language models come out stronger for it:

| | from JSON samples | from OpenAPI schemas |
| --- | --- | --- |
| **Shared types** | two identical shapes must be guessed as one type or two | a `$ref` says they are the same type |
| **Optional fields** | inferred from "absent in at least one sample" | the `required` list states it |
| **Integer width** | inferred from magnitude, so `42` looks like an `int` | `format: int64` states it |

Recursion comes free for the same reason: a `$ref` is a link by name, so a
category whose children are categories is an ordinary cycle in the graph,
where no finite set of JSON samples could describe one.

### Enums

`enum` is the fourth thing a schema states and a sample cannot. Seeing
`"available"` in a payload tells you the field is a string; `enum: [available,
pending, sold]` tells you the set is *closed*, which is a different and much
stronger claim. Inferring one from samples would be a guess about values that
have not occurred yet, so the JSON parser deliberately does not, and
`EnumNode` is reached from OpenAPI alone.

Each target renders it the way that language actually spells the idea:

| Target | Rendering |
| --- | --- |
| TypeScript | `type Status = "available" \| "sold";` — the members *are* the wire values, so nothing maps in either direction. `enumStyle: "enum"` gives the nominal form instead. |
| Java | `enum Status` where each constant carries its value, plus `getValue()` and `fromValue()` — Java constants are `SHOUTY_CASE` and the wire value usually is not, so the mapping has to live somewhere |
| Go | `type Status string` with typed constants, which is what the standard library does (`time.Monday`). Constants are prefixed because Go constants are package scoped |
| Python | `class Status(str, Enum)` — subclassing `str` matters: a plain `Enum` member is not equal to its value and `json.dumps` refuses it |
| C# | `enum Status` with `[JsonConverter(typeof(JsonStringEnumConverter))]` |

The member name and the wire value are stored separately in the IR, because
they are rarely the same: `"n/a"`, `"2xx"` and `""` are not identifiers in any
of these languages. The IR holds a neutral name that each generator re-cases,
alongside the value, which is preserved exactly.

One honest limit, reported rather than hidden: **C# cannot express a value
that is not a case-variant of its member name**. `System.Text.Json` matches
member *names*, and the attribute that would fix it
(`JsonStringEnumMemberName`) is .NET 9. The C# generator emits a warning
naming the specific values that will not round-trip.

### Maps

`{"en": "Hello", "fr": "Bonjour"}` has exactly the same JSON shape as an
object type. The difference — a *field* named `en`, versus an arbitrary key
that happens to be `en` — is not visible in the value at all, so again only a
declaration can settle it: OpenAPI's `additionalProperties`.

| Target | Rendering |
| --- | --- |
| TypeScript | `Record<string, T>` |
| Java | `Map<String, T>`, value boxed because generics cannot hold primitives |
| Go | `map[string]T` |
| Python | `dict[str, T]` |
| C# | `Dictionary<string, T>` |

`MapNode` is structural rather than named, like `ArrayNode` — every target
spells it inline, so there is nothing to declare and nothing to register. The
key is always a string, because a JSON object key always is.

`additionalProperties` carries three meanings in one slot, and they are not
interchangeable: `false` *forbids* extra keys (a closed object, the opposite
claim), `true` or `{}` permits any, and a schema constrains their values.
Only the last two are maps.

A schema with **both** `properties` and `additionalProperties` says "these
fields, plus any others", which no target type can hold — a class with named
fields has nowhere to put the rest. The named fields win, and the dropped
overflow is reported.

### Discriminated unions

`Cat | Dog` is awkward in every language: given one, there is no way to tell
which you have without inspecting fields. OpenAPI's `discriminator` says that
one property carries the answer, and the parser resolves its two spellings —
an explicit `mapping`, or the implicit rule where the tag is each branch's
*schema name* — into one list of value-to-type pairs.

The payoff is a **literal** tag on each branch:

```ts
export interface Cat { petType: "cat"; meowVolume: number; }
export interface Dog { petType: "dog"; breed: string; }
export interface Shelter { resident: Cat | Dog; }
```

which is what makes `switch (resident.petType)` narrow. Python gets the same
through `Literal["cat"]`. Narrowing the branch is sound beyond the union
itself — the discriminator asserts a Cat's tag is *always* `"cat"` — so it
holds wherever `Cat` appears.

**Java, C# and Go cannot express this**, and say so rather than pretending.
All three would need the branches to share a declared base type — a sealed
interface, or a class carrying `[JsonPolymorphic]` — and the type graph has
no notion of one object type extending another. They emit the union untyped,
as before, with a warning naming the discriminator that was lost.

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
| 6 | OpenAPI family (Postman) | done |
| 7 | VS Code extension | done |
| 7b | Chrome extension | see docs/roadmap.md — recommended against for now |
| 8 | OpenAPI → language models (second IR from one source) | done |
| 9 | Enums in the IR | done |
| 10 | Maps in the IR | done |
| 11 | Discriminated unions | done |

## Packages

| Package | Responsibility |
| --- | --- |
| `@devbridge/core` | All three IRs, `TransformationContext`, naming helpers, diagnostics, parser/generator contracts, registries |
| `@devbridge/json-transformer` | JSON → IR (shape inference, merging, contextual naming) |
| `@devbridge/typescript-transformer` | IR → TypeScript interfaces / type aliases |
| `@devbridge/java-transformer` | IR → Java classes or records |
| `@devbridge/go-transformer` | IR → Go structs with json tags |
| `@devbridge/python-transformer` | IR → Python dataclasses |
| `@devbridge/csharp-transformer` | IR → C# classes or records |
| `@devbridge/sql-transformer` | SQL → relational IR (tables, keys, foreign keys) |
| `@devbridge/mermaid-transformer` | Relational IR → Mermaid `erDiagram` |
| `@devbridge/dbml-transformer` | Relational IR → DBML |
| `@devbridge/openapi-transformer` | OpenAPI 3 (YAML or JSON) → API IR, and `components/schemas` → type graph |
| `@devbridge/postman-transformer` | API IR → Postman collection v2.1 |
| `@devbridge/engine` | Wires every parser and generator into one `transform()` call |
| `@devbridge/cli` | `devbridge transform`, `devbridge validate`, `devbridge formats` |
| `@devbridge/web` (`apps/web`) | The web MVP — paste, pick a target, copy or download |
| `devbridge-vscode` (`apps/vscode`) | VS Code extension: transform the selection without leaving the editor |

## Web app

Live at **https://mahmoudelsayed5.github.io/devbridge/**, published from `main`
by `.github/workflows/deploy-pages.yml`.

```bash
pnpm dev:web      # http://localhost:5173
pnpm build:web    # static bundle in apps/web/dist
```

Pick a source format (JSON, SQL or OpenAPI), paste or open a file, pick one
of the targets that source can feed, adjust only the options that target
actually reads, and copy or download the result. The target buttons change with the
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

## VS Code extension

```bash
pnpm package:vscode     # apps/vscode/devbridge.vsix
code --install-extension apps/vscode/devbridge.vsix
```

Two commands: **DevBridge: Transform…** works on the selection, or the whole
file when nothing is selected, and opens the result in a new editor under the
right language; **DevBridge: Validate this document** reports the first
problem with its line and column.

The source format comes from the editor's language mode, falling back to the
file extension — which matters for a `.ddl` file VS Code calls plain text — and
you are asked only when neither is conclusive.

`src/extension.ts` is deliberately thin glue over `src/core.ts`, because
anything importing `vscode` cannot be unit tested: the decisions live in
`core.ts`, which is covered. A second suite loads the real bundled `.cjs` with
a **stubbed `vscode` module** and asserts it loads, exports `activate` /
`deactivate`, and registers exactly the commands the manifest declares — the
three things that most often break, caught without launching an editor.

esbuild bundles the engine in and leaves `vscode` external, so the packaged
extension has no runtime dependencies.

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
14 packages build clean, 442 tests pass.

Linting is oxlint rather than ESLint, because typescript-eslint does not
support TypeScript 7 and this repo targets the native port:

```bash
pnpm lint
```

[CONTRIBUTING.md](CONTRIBUTING.md) records why each disabled rule is disabled.

### Verifying generated code actually compiles

The unit tests assert on generated text. This asserts the text is valid in the
target language, which is a stronger and different claim:

```bash
pnpm verify:generated
```

It generates **two** fixtures — `fixtures/kitchen-sink.json` and
`fixtures/kitchen-sink.openapi.yaml` — into every target and runs that
language's real toolchain: `tsc --strict`, `javac -Xlint:all`, `go vet` plus a
`gofmt -l` canonical-formatting check, `py_compile` plus `typing.get_type_hints`
on every dataclass, and `dotnet build` with `TreatWarningsAsErrors`. A missing
toolchain is skipped; `pnpm verify:generated:strict` makes it a failure instead,
which is what CI uses.

Both fixtures, because the two readings reach the generators with different
material. The OpenAPI one earned its place immediately: it contains a pair of
mutually referencing schemas, and **a struct containing itself by value is not
a legal Go type**, so the Go generator was emitting code that `go vet` rejects
outright. No set of JSON samples can describe a cycle, so nothing before this
had ever put that case in front of a compiler. The generator now breaks a
cycle with a pointer on exactly the edge that closes it, which is what a Go
author would write by hand; the other four languages were unaffected, their
fields being references already.

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
node packages/cli/dist/bin.js transform openapi.yaml --to postman --out ./collections
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
- **Postman** — one Collection v2.1 file. Requests are grouped into folders by
  tag and written against a `{{baseUrl}}` variable taken from the first
  declared server, so retargeting an environment is one edit. Path parameters
  become Postman's `:name` form with their description and an example value;
  optional query parameters are included but **disabled**, so a request sends
  only what it must. Request bodies and saved response examples are
  synthesised from the schema — `$ref`s resolved, the first `enum` member
  preferred over a bare placeholder. A security scheme becomes collection-level
  auth with `{{bearerToken}}`-style variables rather than blanks.

## OpenAPI support

Reads OpenAPI **3.x** in YAML or JSON (JSON is tried first, since its errors
are better; YAML is a superset so one parser covers both). Swagger 2.0 is
detected and named specifically rather than rejected vaguely.

Handled: local `$ref` resolution with cycle protection, path-level parameters
merged into each operation (with operation-level overrides winning, as the
specification requires), `allOf`/`oneOf`/`anyOf` approximated by their first
branch, security schemes, tags, and `deprecated`. Example synthesis prefers
what the document states — `example`, then `default`, then the first `enum`
member — and falls back to a placeholder typical of the declared type and
format, so `format: uuid` yields a UUID rather than `"string"`.

An OpenAPI document saved as `.json` resolves to the JSON parser by extension;
pass `--from openapi` to override.

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

A type-graph target gets two fixtures' worth of exercise for free, so add the
language to `scripts/verify-generated.mjs` as well: the OpenAPI fixture
carries shared references, declared integer widths and a reference cycle,
none of which the JSON fixture can express.

## Scope

The blueprint (`DevBridge_Project_Blueprint.pdf`) is the scope anchor. Out of
scope for now: accounts and billing, a server backend for transformations that
can run locally, AI features before the deterministic path is proven, and
persistent storage of transformation inputs.
