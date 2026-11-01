# Why DevBridge

A guide to explaining what this is, what it solves, and why it deserves a
place in someone's toolbox.

---

**Try it: https://mahmoudelsayed5.github.io/devbridge/** — it runs entirely in
your browser, so you can hand someone that link and they can test it with
their own data without installing anything or uploading it anywhere.

## The one-sentence version

> **DevBridge turns a developer artifact you already have into the one you
> need next — on your own machine, without uploading anything.**

Paste a JSON response, get typed models in TypeScript, Java, Go, Python or C#.
Paste a SQL schema, get an entity-relationship diagram or a DBML document.
Paste an OpenAPI spec, get a ready-to-import Postman collection — or models in
any of five languages, from the same file.

---

## The problem, stated honestly

Every developer does this translation by hand, constantly:

- An API returns JSON. You need a typed model for it in your language.
- You're writing a design doc. You need a diagram of the database you already
  have.
- A new service needs the same payload contract as three existing ones, in
  three different languages.

None of this is hard. All of it is tedious, and it goes wrong in small,
expensive ways. Three failure modes in particular:

**1. Hand translation is quietly incorrect.**
Given a 40-field payload, people get the *optional* vs *nullable* distinction
wrong. These are different facts:

| What you saw in the samples | What it means | TypeScript |
| --- | --- | --- |
| the key is missing from some records | optional | `note?: string` |
| the key is present but `null` | nullable | `note: string \| null` |
| both | optional **and** nullable | `note?: string \| null` |

Get it wrong and you either write defensive checks you don't need, or skip the
one you do.

**2. Single-purpose converters are fragmented.**
One site does JSON→TypeScript. Another does SQL→diagram. A third does
JSON→Java. You copy-paste between them, each with a different idea of naming,
and nothing is reproducible tomorrow.

**3. The convenient tools are web services.**
This is the one worth dwelling on. Pasting a production API response into a
stranger's website is a data egress event. The payload may contain customer
names, internal field names, or the shape of an unreleased feature. Plenty of
organisations forbid it outright; plenty more would if anyone noticed.

> **Analogy.** Using a public online converter for a production schema is like
> photocopying a contract at the print shop on the corner. It is fast, it
> works, and the document left your hands. The problem isn't that the shop is
> malicious — it's that you no longer get to make that claim.

---

## The core idea: one hub, not many cables

The architectural decision behind DevBridge is worth explaining because it's
the reason it can keep growing.

A naive converter is built per *pair*: JSON→TypeScript is one program,
JSON→Java is another. With **N** sources and **M** targets you need **N × M**
converters, and every new target means writing it N times.

DevBridge parses a source into a shared **intermediate representation**, then
generates from that. You need **N + M** pieces, and a new target is **one**
new piece.

```
JSON ─────┐                 ┌── TypeScript, Java, Go, Python, C#
          │                 │
SQL ──────┼──►  [  IR  ] ───┼── Mermaid ERD, DBML
          │                 │
OpenAPI ──┘                 └── Postman
```

| | pair-by-pair | shared IR |
| --- | --- | --- |
| today (3 sources, 8 targets) | 24 converters | 11 pieces |
| add 1 target | +2 | **+1** |
| 5 sources × 12 targets | 60 | **17** |

> **Analogy — the travel adapter.** You could carry a separate cable for every
> country-pair you travel between. Or you carry one universal adapter: every
> plug goes in one side, every socket comes out the other. Adding a country
> means one new head, not one per country you already own.

> **Analogy — the translator.** A phrasebook handles one language pair. A
> translator who understands the *meaning* can go from any language to any
> other, because they translate through the idea, not through the words.
> Professional translation systems call this a *pivot language*. The IR is
> DevBridge's pivot.

This is not just theory — it's the measured result. Adding the two SQL targets
required **no changes to the JSON parser and no changes to the five language
generators**.

The sharper demonstration came later. Teaching OpenAPI to produce typed models
in all five languages required **no new generator at all** — the schemas are
data shapes, the type-graph IR already describes data shapes, and the existing
generators consumed them unchanged. Five new source-to-target pairs for one
new parser reading. A pair-by-pair tool would have had five programs to write.

---

## What makes it worth choosing

Be honest here. These are the claims that are actually true and actually
checkable — not a feature list.

### 1. It never sends your data anywhere

The engine is plain TypeScript with no network calls. The web app is a static
bundle with no backend; the transformation happens in your browser tab. Your
input is not written to `localStorage` either — it's gone on refresh.

**And the claim is enforced, not asserted.** A test (`local-first.test.ts`)
fails the build if any shipped module so much as references `fetch`,
`XMLHttpRequest`, `WebSocket`, `sendBeacon` or any web storage API.

This is the argument that lands in a regulated or security-conscious team: it
is the only one of these tools you can point a compliance reviewer at.

### 2. The output actually compiles

Most converters produce text that *looks* right. DevBridge's CI generates two
deliberately awkward fixtures into every target and runs the **real toolchain**
over the result:

| Target | Verified by |
| --- | --- |
| TypeScript | `tsc --strict` |
| Java | `javac -Xlint:all` — zero warnings |
| Go | `go vet` **plus** `gofmt -l` (canonical formatting) |
| Python | `py_compile` + `typing.get_type_hints` on every dataclass |
| C# | `dotnet build` with `TreatWarningsAsErrors` |
| DBML | parsed by the official `@dbml/core` parser |
| Mermaid | rendered against mermaid 11.15 in a browser |

That last row found a real bug: Mermaid rejects a comma inside an attribute
type, so `decimal(10,2)` broke the diagram. Output that merely looked correct
would have shipped.

So did the second fixture, the moment it was added. An OpenAPI document can
describe a type that refers back to itself — two schemas referencing each
other — and **Go rejects a struct that contains itself by value**. The Go
generator had been emitting uncompilable code for that case, and nothing had
caught it because no JSON sample can express a cycle, so a compiler had never
been shown one. Reading the generator would not have found it; running `go
vet` over its output did, immediately.

### 3. It is right in the places this is easy to get wrong

Each of these is a real bug that was found and fixed, and each has a
regression test:

| Input | Naive result | DevBridge |
| --- | --- | --- |
| `[1, 2.5]` | `number \| number` | `number[]` |
| `[{tags:[]}, {tags:["a"]}]` | `unknown[] \| string[]` | `string[]` |
| `[{p:{city}}, {p:{city,zip}}]` | `zip` silently lost | merged, `zip` optional |
| `{a:{b:{c:{x}}}, d:{b:{c:{y}}}}` | one type, `y` lost | two types, both intact |
| `{company:{address}, customer:{address}}` | name collision | `CompanyAddress`, `CustomerAddress` |

The naming rule is *shortest unique name*: a bare property name wins when
nothing else wants it, and a conflict pulls in only as many parent names as
needed to disambiguate.

### 4. One engine, every surface

The same engine runs in the CLI, the web app, the VS Code extension, and as a
library. A transformation behaves identically in all of them, because it is
literally the same code — the extension bundles the engine rather than calling
a service, so it works on a plane.

---

## Use cases

### For a frontend developer
You get a JSON response from an endpoint that has no schema and no docs. Paste
it, get `export interface` declarations with correct optionality, nullability
and quoted keys for anything that isn't a valid identifier.

### For a backend developer consuming a third-party API
The vendor's docs show example responses but publish no OpenAPI spec. Paste
three representative responses, get Java classes with proper boxing — a field
that's absent in one sample becomes `Integer`, not `int`, because `int` cannot
represent "absent".

### For anyone writing a design doc or RFC
You need a diagram of the 40-table schema that already exists. Paste the
schema dump, get a Mermaid ERD. **GitHub, GitLab and Notion render Mermaid
natively**, so it drops straight into the document as a live diagram — not a
screenshot that goes stale the day someone adds a column.

### For onboarding
A new joiner cannot hold a legacy schema in their head. An ERD generated from
the real DDL — not a hand-drawn diagram from two years ago — is accurate by
construction.

### For a polyglot team
The same event payload is consumed by a Go service, a Python worker and a C#
client. Generate all three from one sample and the field names agree, because
one naming engine produced all of them.

### For anyone handed an OpenAPI spec
A team publishes a spec but no Postman collection, so everyone hand-builds
requests and gets the auth header subtly wrong. Paste the spec, get a
collection with every endpoint, bodies prefilled from the schemas, path
parameters wired up, and auth configured once at the collection level.

### For anyone handed an OpenAPI spec and no client library
The same spec, pointed at a language instead: `components/schemas` become
models in TypeScript, Java, Go, Python or C#. One document, two useful
outputs — the collection to call the API with, and the types to hold what it
returns.

This is also the *best* input the models can have, and noticeably better than
pasting a sample response. A sample leaves four things to guesswork that a
schema simply states:

- **Is this field optional?** A sample can only tell you it was absent that
  time. `required` tells you.
- **Are these two objects the same type?** Two identical-looking shapes might
  be one concept or two. A `$ref` says.
- **Will this id overflow an `int`?** A sample containing `42` gives no clue.
  `format: int64` does — and a 32-bit overflow in production is a genuinely
  expensive way to find out.
- **Is this field one of a fixed set?** Seeing `"available"` tells you it's a
  string. `enum: [available, pending, sold]` tells you the set is *closed* —
  so you get a real `enum` in Java, Python and C#, typed constants in Go, and
  a union of literals in TypeScript, instead of an unconstrained `string` the
  compiler cannot help you with.
- **Are these keys fields, or data?** `{"en": "Hello", "fr": "Bonjour"}` is
  indistinguishable from an object with two fields — until the schema says
  `additionalProperties`. Then you get `Record<string, string>` or
  `Map<String, String>`, rather than a class with permanent `en` and `fr`
  fields that breaks the day someone adds Spanish.

Recursive structures work too — a category tree, a comment thread — which no
number of sample payloads can express.

### For documenting or migrating a legacy database
`SQL → DBML` gives you a document you can keep in version control and open in
dbdiagram.io, rather than a diagram trapped in someone's licensed desktop tool.

### For CI drift detection
Regenerate models from the committed fixture and fail the build if they differ
from what's checked in. Because the generator is deterministic, any diff is a
real contract change.

---

## How to use it

### Web app

```bash
pnpm dev:web
```

Pick a source format, paste or open a file, pick a target. Options shown are
only the ones that target actually reads. Java and C# emit one file per type,
so they get file tabs and a "Download all" button that builds a `.zip` in the
browser.

### Command line

```bash
devbridge transform payload.json --to java --package com.example --out ./generated
```

```bash
devbridge transform schema.sql --to mermaid
```

```bash
cat payload.json | devbridge transform - --from json --to typescript
```

```bash
devbridge validate payload.json
```

`devbridge formats` lists each source with the targets it can feed.

### As a library

```ts
import { transform } from "@devbridge/engine";

const result = transform({
  input: schemaText,
  source: "sql",
  target: "mermaid",
});

console.log(result.preview);
console.log(result.names); // table names
```

---

## Handling the obvious objections

**"quicktype already does this."**
It does, and it's mature with more target languages. Be honest about that. What
DevBridge offers that's different: it is local-first *by construction and by
test*, its output is compile-verified in CI, and it covers SQL→diagram, which
quicktype does not do at all. If someone's need is purely JSON→types and they
already trust a hosted tool, quicktype is a reasonable answer. The pitch is
strongest where privacy, verification, or the SQL family matter.

**"I'll just write the types by hand."**
For five fields, do. For a forty-field payload with nested arrays, you will get
the optional/nullable distinction wrong somewhere, and you won't find out until
something is `undefined` in production. See the table above — those are bugs
that were found in *this* codebase while building it, by a machine, with tests.

**"Why not just ask an LLM?"**
A fair question with a real answer. An LLM is non-deterministic, costs tokens
per call, requires sending the payload to a third party, and will occasionally
invent a field. DevBridge is deterministic — same input, same output, every
time — runs offline, and is free per invocation. The project's own scope rules
reserve AI for things deterministic code genuinely cannot do, and keep it
clearly separated from the conversion path.

**"How do I know it works?"**
422 automated tests. CI on both Ubuntu and Windows. Generated code compiled by
real compilers on every commit. That's a stronger claim than most tools in this
category can make.

**"Is this a big dependency to take on?"**
No. The CLI is a single Node binary; the web app is a static bundle with no
backend. There is nothing to host, no account, and no service to depend on.

---

## What it does *not* do

Credibility comes from the limits as much as the features.

- **Three source formats today**: JSON, SQL and OpenAPI 3. Swagger 2.0 is
  detected and named, not converted.
- **OpenAPI feeds Postman only.** The schemas in an OpenAPI document could
  also produce language models, but that is not wired up yet.
- **Inference is sample-based.** DevBridge knows what your samples show. If a
  field is absent from every sample, it cannot exist in the output. Give it
  representative data, not one lucky record.
- **The SQL parser is dialect-tolerant, not a full SQL implementation.** It
  reads `CREATE TABLE`, `ALTER TABLE ... ADD CONSTRAINT` and
  `CREATE UNIQUE INDEX` from MySQL, PostgreSQL, SQL Server and SQLite dumps,
  and skips the rest.
- **Integer precision has a hard ceiling.** Whole numbers are classified as
  32-bit or 64-bit by magnitude, so a large id becomes `long` / `int64` rather
  than silently overflowing an `int`. But JSON itself is parsed by
  `JSON.parse`, which rounds anything past 2^53 — DevBridge warns when that
  happens rather than pretending the value survived.
- **No AI assistance.** Deliberately. Everything is deterministic.

---

## The thirty-second pitch

> You already translate artifacts by hand all day — JSON into types, schemas
> into diagrams. The tools that do it for you are a dozen different websites,
> which means copy-pasting production data into someone else's server.
>
> DevBridge does it on your machine. One engine, many formats: paste JSON, get
> typed models in five languages; paste a schema, get an ERD that drops
> straight into your README and renders.
>
> It's a travel adapter, not a drawer full of cables — which is why adding the
> SQL support required no change to any of the existing generators.
>
> And the output isn't just plausible: every commit compiles it with the real
> compilers.
