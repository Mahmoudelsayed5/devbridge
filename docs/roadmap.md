# Roadmap and build history

What exists, how it got here, the decisions that shaped it, and what comes
next.

Last updated after phase 13, with the phase numbering reconciled against the
blueprint's own — see "Beyond the blueprint".

---

## Where the project stands

| | |
| --- | --- |
| Phases complete | 0–7 as the blueprint planned them, then 8–13 beyond it |
| Packages | 14 libraries + web app + VS Code extension |
| Source formats | 3 (JSON, SQL, OpenAPI) |
| Target formats | 8 (TypeScript, Java, Go, Python, C#, Mermaid ERD, DBML, Postman) |
| Tests | 489, all passing |
| Source / test lines | ~11,000 / ~7,300 |
| CI | lint, build + test on Ubuntu and Windows, plus generated-output compilation |
| **Released** | **the web app only** — no tags, no npm packages, extension unpublished |

```
                        ┌── TypeScript ─┐
JSON ────────────────┐  ├── Java ───────┤
                     ├──┼── Go ─────────┤  type-graph IR
OpenAPI  components ─┤  ├── Python ─────┤
   │     /schemas    │  └── C# ─────────┘
   │                 │
   │          SQL ───┴──┬── Mermaid ERD ┐  relational IR
   │                    └── DBML ───────┘
   │
   └──────── paths ───── Postman ─────── api IR
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

The alternative buried in that paragraph — that `components/schemas` fits the
type graph and was simply being left on the floor — was picked up later and
became phase 8 below. The judgement here was right, though: the question was
never which IR OpenAPI *is*, but that it is both, and answering it properly
needed a parser able to offer two.

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
*its own* object, a brace inside a string is not structure, and a key written
`"\u0061"` is the same key as `"a"`. Reported as a warning, not an error: the document is
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

**Alongside those**, three smaller things the same audit produced: the
repository hygiene a public project is expected to have (`CONTRIBUTING.md`,
`SECURITY.md`, `.editorconfig`, a grouped Dependabot config), an MIT licence,
and the web app deployed to GitHub Pages — which required making the
repository public, since Pages is not available on private repositories on
the free plan.

One more change belongs here rather than to a phase. **Integer width** became
a distinction in the IR: `integer` and `long` are separate, decided once by
`integerWidth` and mapped to `long` / `int64` per target, and the parser warns
when a whole number has *already* lost precision in `JSON.parse`. Phase 8
later made that heuristic unnecessary for OpenAPI, where `format: int64`
states the answer outright — but it is still the only thing available when the
source is a JSON sample.

---

## Beyond the blueprint — phases 8 to 13

**The blueprint planned nine phases.** Phases 0–7 above are its build plan,
delivered as written; its own phases 8 and 9 were productization and AI, both
deliberately deferred and still deferred today — see "What's next".

Everything from here was *not* in the plan. It came from two places: auditing
the project as a public repository rather than as a work in progress, and —
much more often — from what each change exposed about the one before it.
That chain is worth reading as a chain:

| | What it added | What it exposed |
| --- | --- | --- |
| 8 | OpenAPI → language models | Go emitted uncompilable code for a reference cycle |
| 9 | Enums in the IR | the JSON parser must *not* infer a closed set |
| 10 | Maps in the IR | the same again — a declaration, not a guess |
| 11 | Discriminated unions | three targets had no base type to hang one on |
| 12 | Inheritance | …so the IR grew one, and Python's dataclass ordering broke |
| 13 | Polymorphic serialization | a tag in a deep hierarchy is a union, not a value |

Four of those six were found by generating the output and compiling it with
the real toolchain, not by reading the code.

### Phase 8 — OpenAPI → language models

The last structural gap: an OpenAPI document's `components/schemas` are data
shapes, and the five language generators had no way to see them. The file
could become a Postman collection or nothing.

**The contract change is four lines.** A parser may declare
`alsoProduces: "type-graph"` and a `parseTypeGraph` method; the engine asks
for whichever IR the chosen target consumes. Deliberately not a general "list
of IRs" on every parser — only one secondary IR has proved worth having, and
it is always the type graph, because that is where the generators are. No
other parser or generator changed.

**The schema reading is better information than inference, in three places.**
This is the part worth keeping:

| | from JSON samples | from OpenAPI schemas |
| --- | --- | --- |
| Shared types | two identical shapes must be *guessed* as one type or two | a `$ref` states they are one |
| Optional fields | inferred from "absent in at least one sample" | the `required` list states it |
| Integer width | inferred from magnitude, so `42` looks like an `int` | `format: int64` states it |

That last row retires a guess the project had already paid for once: the
`integerWidth` heuristic exists because JSON has a single number type. The
same ambiguity simply does not arise here.

**It found a real bug in a generator that had shipped for months.** Because a
`$ref` is a link by name, a cycle is ordinary — a category whose children are
categories, two schemas that reference each other. No finite set of JSON
samples can describe one, so in three phases of language generation nothing
had ever handed a cyclic type graph to a compiler. Go rejects a struct that
contains itself by value: `invalid recursive type`. The other four languages
were unaffected, their fields being references already.

The fix is what a Go author would write by hand — a pointer — applied to
exactly the edge that closes the cycle, so ordinary nested structs stay
values. The generator now does its own cycle detection.

**And it was found the way this project finds things**: by adding
`fixtures/kitchen-sink.openapi.yaml` to `verify:generated` and running the
real `go vet` over the output, not by reading the generator. The fixture now
carries a mutual reference permanently, so the case cannot regress quietly.

Two honest limits came out of it, both the same shape — the IR had no node for
the construct, so it degraded to an untyped value and said so in a diagnostic
rather than pretending: an `enum` became its base type, and a map
(`additionalProperties`) became `unknown`. The first of those became phase 9;
the second is still open.

### Phase 9 — Enums in the IR

`enum` is the fourth thing a schema states that a sample cannot. Seeing
`"available"` in a payload tells you a field is a string; `enum: [available,
pending, sold]` tells you the set is **closed**, which is a stronger claim and
one that changes the generated code. Inferring it from samples would be a
guess about values that have not happened yet, so the JSON parser still does
not, and `EnumNode` is reached from OpenAPI alone.

**The IR change is one node and one map.** `EnumNode` joins the `TypeNode`
union, and `TransformationContext` gains a second map beside its object types.
They are kept apart because every generator wants to emit enums before the
structures that refer to them — but they share one *name* space, since
`enum Status` and `class Status` collide in all five languages, so
`registerEnum` refuses a name an object holds rather than letting that reach a
compiler.

**The design decision worth keeping is separating the member's name from its
value.** They are rarely the same thing. `"n/a"`, `"2xx"` and `""` are not
identifiers anywhere, and even an ordinary `"available"` is written
`AVAILABLE` in Java and `Available` in C#. So the IR stores a neutral
PascalCase name that each generator re-cases through the shared naming
helpers, alongside the value, preserved byte for byte. Collapsing the two
would have forced every generator to re-derive a mapping that only the parser
had the information to make.

**Each target renders the idea the way its language spells it**, which is
where most of the work went:

| Target | Rendering, and why |
| --- | --- |
| TypeScript | a union of literal types. The members *are* the wire values, it narrows in a `switch`, and it has no runtime footprint — a TS `enum` is a runtime object whose members are not the values. `enumStyle: "enum"` is there for those who want the nominal form. |
| Java | an `enum` whose constants carry their value, with `getValue()` / `fromValue()`. A bare constant would lose the mapping entirely, since Java constants are `SHOUTY_CASE`. |
| Go | a defined type plus typed constants — Go has no enum keyword, and this is what its own standard library does. Constants are prefixed because Go constants are package scoped. |
| Python | `class Status(str, Enum)`. The `str` base is not decoration: a plain `Enum` member is not equal to its value and `json.dumps` refuses to serialise it. |
| C# | `enum` with `[JsonConverter(typeof(JsonStringEnumConverter))]`. |

**C# is the one that cannot be made fully correct**, and that is reported
rather than hidden. `System.Text.Json` matches enum member *names*; a value
that is not a case-variant of an identifier has nowhere to live until .NET 9's
`JsonStringEnumMemberName`, which CI's .NET 8 does not have. The generator
emits a warning naming the exact values that will not round-trip — the same
"failure is data" rule the parsers follow, applied for the first time to a
generator.

The fixture gained `["A+", "n/a", "2xx", "kebab-case"]` precisely because
those are the values that make every target's name-versus-value handling real
instead of a pass-through, and `verify:generated` compiles all four in all
five languages.

### Phase 10 — Maps in the IR

The last of the two limits phase 8 recorded, and the easier one: `MapNode` is
**structural**, like `ArrayNode`, not named like `EnumNode`. Every target
spells a dictionary inline — `Record<string, T>`, `Map<String, T>`,
`map[string]T`, `dict[str, T]`, `Dictionary<string, T>` — so there is nothing
to declare, nothing to register, and no namespace to share. One node, one
case per generator.

**The interesting part is why a parser has to tell you.**
`{"en": "Hello", "fr": "Bonjour"}` has exactly the same JSON shape as an
object type with two string fields. The difference — a *field* named `en`,
versus an arbitrary key that happens to be `en` — is invisible in the value.
It is the same situation as enums one phase earlier: a sample cannot
distinguish them, a declaration can, and guessing would be a guess about keys
that have not appeared yet. That is now twice that the honest answer was "the
JSON parser should not infer this", which is worth noticing as a pattern
rather than a coincidence.

**`additionalProperties` carries three meanings in one slot**, and conflating
them would be a real bug: `false` *forbids* extra keys — a closed object, the
opposite claim — while `true` or `{}` permits any, and a schema constrains
their values. Only the last two are maps.

Two things the change surfaced:

- **A schema with both `properties` and `additionalProperties`** says "these
  fields, plus any others", which no target type can hold. The named fields
  win and the overflow is reported. The check lives in `objectNode` rather
  than at the call site, because top-level schemas reach it through the
  placeholder path used for reference cycles and would otherwise have been
  missed — which a test caught.
- **Java's import logic had to stop being a boolean.** It answered "does this
  need `java.util.List`?"; a `Map<String, List<String>>` needs both, so it
  now collects names recursively. C# needed no equivalent change, since
  `List` and `Dictionary` share one `using`.

### Phase 11 — Discriminated unions

`Cat | Dog` is awkward in every language: given one, there is no way to tell
which you have without inspecting fields. OpenAPI's `discriminator` names the
property that carries the answer.

**Most of the work is resolution, which only the parser can do.** The keyword
has two spellings: an explicit `mapping` of tag value to `$ref`, or — with no
mapping — the implicit rule that the tag is each branch's own *schema name*.
Generators never see schema names, so both forms are resolved into one list
of value-to-type pairs before the IR leaves the parser. That is the same
division of labour as everything else here: the parser knows the document,
the generators know their language.

**The payoff is a literal, not the discriminator itself.** `LiteralNode`
joins the IR, and each branch's tag property is narrowed to the value that
selects it — `petType: "cat"` rather than `petType: string`. That is what
makes a `switch` narrow in TypeScript, and `Literal["cat"]` does the same
under a Python type checker. Narrowing is sound beyond the union, too: the
discriminator asserts a Cat's tag is *always* `"cat"`, so it holds wherever
Cat appears, which a test pins.

**Three targets cannot express this at all.** Java, C# and Go would each need
the branches to share a declared base type — a sealed interface, or a class
carrying `[JsonPolymorphic]` — and the type graph has no notion of one object
type extending another. Adding inheritance to the IR to serve one keyword
would be the tail wagging the dog, so they emit the union untyped exactly as
before and warn, naming the discriminator that was lost. Nothing about their
output got worse; what changed is that the omission is now stated.

**The bug worth recording** was in the rewrite, not the parsing. Narrowing a
tag has to mutate the branch *in place* — other properties already hold
references to it — and top-level schemas are completed through the
placeholder path built for reference cycles. The first version tracked the
throwaway node that path discards rather than the placeholder everything
points at, so every rewrite silently hit an orphan and the output was
unchanged. Generating the output and looking at it caught it immediately;
reading the code had not.

### Phase 12 — Inheritance

The structural gap the previous three phases kept running into. OpenAPI
spells inheritance as an `allOf` whose branch is a `$ref` to a base schema,
and until now that was *flattened*: the base's fields were copied into every
subtype. The output compiled, which is why it survived so long, but it
misrepresented the document — the relationship was gone, fields were
duplicated, and nothing could be written that accepts "any Pet".

`ObjectNode.extends` keeps it, and the generators say it the way their
language does: `extends` in TypeScript and Java, `:` in C#, a base class in
Python, and — since Go has no inheritance — an **embedded struct**, which
both promotes the base's fields and makes `encoding/json` write them inline,
exactly matching the wire format.

**Two shapes deliberately keep flattening.** A Java `record` cannot extend a
class, and a C# positional `record` would have to thread base parameters
through its constructor. Rather than refuse those styles or emit something
that does not compile, they use `allPropertiesOf` — the flattened view, which
is what they produced before.

**The find worth recording is Python's.** A dataclass lays its `__init__`
parameters out base-first, so a base with any optional field followed by a
subtype with a required one raises `non-default argument follows default
argument` — at import time, not in a type checker. `@dataclass(kw_only=True)`
across the hierarchy removes the ordering constraint entirely.

That was not reasoned out in advance; it came from putting exactly that shape
in the fixture and watching `verify:generated` fail. It is also *checkable*:
removing `kw_only` and re-running turns the Python check red with that precise
message, which is the difference between a comment that claims something and
one that can be confirmed in thirty seconds.

**A flaky test turned up alongside it.** The DBML suite drives the real
`@dbml/core` parser and had exceeded vitest's 5s default once under parallel
load — it passed in isolation and failed in the full run, which is the worst
way for a test to be wrong. Those four now carry an explicit timeout, because
the work is genuinely slow rather than the assertion being wrong.

**What this unlocks, and does not.** The discriminator work in phase 11 left
Java, C# and Go unable to express a polymorphic union because the IR had no
notion of one type extending another. It does now — but nothing yet connects
a discriminator to a base type's subtypes, so those three still emit the union
untyped. The model is in place; the wiring is the next step, not this one.

### Phase 13 — Polymorphic serialization

The step phase 12 set up. A `discriminator` declared on an **object schema**
rather than on a `oneOf` names *this type's subtypes*, and that is the form
Java and C# can serialise — their annotations go on a base type, and after
phase 12 there is one to put them on.

`ObjectNode.discriminator` carries it. Java emits `@JsonTypeInfo` plus
`@JsonSubTypes`, C# `[JsonPolymorphic]` plus `[JsonDerivedType]`, and both
stop reporting the union as unsupported. With no explicit `mapping`, the
subtypes are whatever ended up extending the base — which is resolvable only
after the whole graph exists, so it happens in the same post-pass as
inheritance.

**The real compiler caught the design error, again.** The first version
narrowed every subtype's tag to its own single value, and TypeScript refused
the fixture outright:

```
types.ts(91,18): error TS2430: Interface 'TipperTruck' incorrectly extends interface 'Truck'.
```

It was right, and the mistake is worth naming: in a hierarchy deeper than
two, `TipperTruck extends Truck` with tags `tipper` and `truck`, narrowing
`Truck.kind` to `"truck"` asserts something false — a `TipperTruck` *is* a
`Truck` and carries `"tipper"`. A type's tag is the union of its own value
and every descendant's, and only a leaf collapses to one. That is now what
`tagFor` returns, and the three-deep case is in the fixture permanently.

Two honest notes:

- **Jackson annotations stay opt-in.** Jackson is a third-party dependency
  and `javac` runs with no classpath for it, so emitting them by default
  would produce code that does not compile — which `verify:generated` would
  have caught, but the gate is right regardless. C# needs no flag, because
  `System.Text.Json` is in the base library. That asymmetry surfaced a real
  gap: the CLI could only turn annotations *off*, so Java's Jackson output
  was unreachable from it. `--annotations` was added.
- **The check proves compilation, not round-tripping.** A serializer
  misconfiguration fails at run time, and `dotnet build` and `javac` cannot
  see that. Verifying it properly would mean executing the generated code,
  which is a larger step than this project takes today.

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

It bent once more, and in a different direction, in phase 8. The rule above
assumes each **source** has one IR, and OpenAPI does not: its paths are
endpoints and its schemas are data shapes. So a parser may now declare a
second IR it can also produce, and the engine picks from the target. The
pairing rule is unchanged — it still refuses java-from-SQL — it just asks
what a source *can* produce rather than what it *is*.

Worth noting what did not happen: no IR was added, no generator was rewritten,
and no source was split into two entries for the user to choose between. The
honest summary of three phases of pressure is that the number of IRs is a
property of the material, not of the design, and the design's job is to stop
pretending otherwise as cheaply as possible.

### Verify generated output with real tools, not assertions

Unit tests assert what the text *looks like*. A separate check asserts the text
is **valid in the target language** — `tsc --strict`, `javac -Xlint:all`,
`go vet` + `gofmt -l`, `py_compile` + `get_type_hints`, `dotnet build` with
`TreatWarningsAsErrors`, `@dbml/core` for DBML, and a browser render for
Mermaid.

This is the decision that paid for itself most often, and it kept paying:
**six** bugs found this way that every unit test had passed.

1. **Mermaid rejects a comma inside an attribute type** — `decimal(10,2)`
   broke the diagram. The same probe also disproved a *second* assumption: the
   `PK, FK` marker list I had avoided as risky is in fact accepted.
2. **DBML's unnamed `Ref` requires a colon** — `Ref: a.b > c.d`, not
   `Ref a.b > c.d`.
3. **A UTF-8 BOM** made valid JSON unparseable — found because PowerShell
   wrote a test fixture with one.
4. **Go rejects a struct containing itself by value** (phase 8) — the Go
   generator had emitted uncompilable code for a reference cycle for
   months, unnoticed because no JSON sample can describe one.
5. **A Python dataclass hierarchy raises at import time** (phase 12) when a
   base's optional field precedes a subtype's required one.
6. **A discriminator tag in a deep hierarchy is a union, not a value**
   (phase 13) — TypeScript rejected the narrowing outright.

The last three all came from *adding a case to a fixture and running the
compiler*. None would have been found by reading the generator.

### Make the privacy claim testable

The web app says "nothing is uploaded or stored" on screen. A claim like
that rots silently, so a test scans the app *and* every library package that
reaches the browser for `fetch`, `XMLHttpRequest`, `WebSocket`,
`sendBeacon` and web storage.

**And it rotted exactly the way predicted.** The list of scanned packages is
hand-maintained, and the five added for the SQL and OpenAPI families were
never added to it — so they shipped to the browser unchecked from phase 5
until this was noticed. None of them violated the rule, which is luck rather
than design. The list now carries a comment saying that completeness *is*
the test, because a guarantee enforced over part of the code is not enforced.

### Failure is data, not an exception

The web UI re-runs on every keystroke, so a half-typed document is the normal
case. `runTransform` never throws, and a test asserts an invalid artifact
*always* yields at least one diagnostic — you cannot land in a blank error
state.

---

## What's next

The engine is done in every direction the blueprint asked for, and in six it
did not. What is left is almost entirely **not** engine work.

### Nothing is released yet

This is the real blocker, and it is bigger than the one item it used to be
in this list. The only way to use any of this today is to clone the repo or
open the web app:

| | State |
| --- | --- |
| All 16 packages | `private: true`, version `0.1.0` — `@devbridge/core` cannot be installed |
| Git tags / GitHub releases | none |
| CHANGELOG | none |
| VS Code extension | builds and packages to a `.vsix` on every CI run; never published |
| Web app | the one thing that *is* live, on GitHub Pages |

Two decisions gate the rest, and neither is technical:

- **The name.** `devbridge` is already taken on npm by an unrelated
  Homebridge tool, so the libraries would need the `@devbridge` scope. More
  importantly, *Devbridge* was a real software consultancy (acquired around
  2022), which is worth checking before the name goes in front of anyone.
  Renaming is nearly free now and expensive once people know it.
- **Who owns it.** Publishing under a personal account and then promoting
  the result inside an employer is where IP assignment clauses bite. Worth
  settling before the first demo, not after.

The zero-risk first step is a **GitHub release**: a `v0.1.0` tag, a
CHANGELOG, and the `.vsix` attached. No accounts, no agreements, no name
registration, and colleagues can install it with one command.

### Repository gaps

| Item | Why |
| --- | --- |
| **No coverage measurement** | 489 tests and no measurement of what they do not reach |
| **No code scanning** | Dependabot covers dependencies; nothing scans this repo's own code |
| **No issue or PR templates** | `.github/` holds only the workflows and `dependabot.yml` |
| **The web app has never had an accessibility audit** | It is the public front door, and carries 12 aria/role attributes in total |

### Engine work, if it is wanted

None of this is blocking anything; it is listed because the shape of each
is already understood.

| Item | Note |
| --- | --- |
| **Enums and maps from JSON** | Deliberately *not* done — a sample cannot prove a set is closed or that a key is data. Would need a confidence rule, and the honest default is to keep refusing. |
| **Real round-trip verification** | `verify:generated` proves the output compiles, not that it serialises correctly. Would mean executing the generated code. |
| **Syntax highlighting in the web editor** | A plain `<textarea>` today, which keeps the bundle dependency-free. CodeMirror is the obvious upgrade. |


### The integration that was declined

**A Chrome extension is in the blueprint and was not built.** The case had
weakened by the time the slot came up:

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

### Productization and AI — still deferred

These were the **blueprint's** phases 8 and 9, which is why the numbering
above does not reach them: the work that actually happened took those
numbers instead.

Productization (accounts, team features, API plans) and AI assistance
(repair, explanation, difficult transformations). Both deferred until the
deterministic engine has proven demand — monetization should follow
evidence of usage rather than drive architecture. Nothing since has
changed that, and the engine still has no users to learn from.

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
- **An object cannot also be a map.** A schema with both `properties` and
  `additionalProperties` loses its extra keys, because no target has a type
  that is both a fixed set of fields and an open map. Reported, not silent.
- **C# cannot round-trip every enum value.** `System.Text.Json` matches enum
  member *names*, so a value that is not a case-variant of an identifier —
  `"n/a"`, `"2xx"` — has nowhere to live before .NET 9's
  `JsonStringEnumMemberName`. The generator warns, naming the values.
- **A document of nothing but enums is refused.** `ParseResult.root` is an
  `ObjectNode`, so a schemas file with no object type has no honest root to
  return. Rare, but real for a shared enums file.
- **A bare `oneOf` is still untyped in Java, C# and Go.** A discriminator on
  a *base schema* is now fully wired, but branches that merely sit in a
  `oneOf` without a shared base have nothing to annotate. The three report it
  and say what to change; Go cannot do it in any case.
- **Jackson annotations are opt-in.** Java emits them only with
  `--annotations`, because Jackson is a third-party dependency and `javac`
  has no classpath for it. C# needs no flag: `System.Text.Json` is in the
  base library.
- **Only single inheritance.** An `allOf` naming several base schemas keeps
  the first and merges the rest, because Java and C# allow one base apiece.

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
