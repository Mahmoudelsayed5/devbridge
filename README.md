# DevBridge

A developer transformation layer: take an artifact you already have and produce
the one you need next.

Everything in this repository is deterministic and runs locally. Nothing is
uploaded and no input is stored.

```
Source → Parser → Shared IR → Generator → Target
```

Adding a target language is a generator task, not another end-to-end converter.

## Status

| Phase | Goal | Status |
| --- | --- | --- |
| 0 | Monorepo, core package, tests | done |
| 1 | JSON → TypeScript | done |
| 2 | JSON → Java | done |
| 3 | JSON → Go, Python, C# | done |
| 4 | Web MVP | not started |
| 5 | SQL family (ERD / DBML / Mermaid) | not started |
| 6 | OpenAPI family | not started |
| 7 | Chrome and VS Code extensions | not started |

## Packages

| Package | Responsibility |
| --- | --- |
| `@devbridge/core` | IR, `TransformationContext`, naming helpers, diagnostics, parser/generator contracts, registries |
| `@devbridge/json-transformer` | JSON → IR (shape inference, merging, contextual naming) |
| `@devbridge/typescript-transformer` | IR → TypeScript interfaces / type aliases |
| `@devbridge/java-transformer` | IR → Java classes or records |
| `@devbridge/go-transformer` | IR → Go structs with json tags |
| `@devbridge/python-transformer` | IR → Python dataclasses |
| `@devbridge/csharp-transformer` | IR → C# classes or records |
| `@devbridge/engine` | Wires every parser and generator into one `transform()` call |
| `@devbridge/cli` | `devbridge transform`, `devbridge validate`, `devbridge formats` |

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
9 packages build clean, 121 tests pass.

## CLI

```bash
node packages/cli/dist/bin.js transform payload.json --to java --package com.example --out ./generated
```

```bash
cat payload.json | node packages/cli/dist/bin.js transform - --from json --to typescript
```

```bash
node packages/cli/dist/bin.js validate payload.json
```

`devbridge formats` lists every source and target the engine currently knows.

## Library

```ts
import { transform } from "@devbridge/engine";

const result = transform({
  input: '{"user":{"id":1}}',
  source: "json",
  target: "typescript",
});

console.log(result.preview);
console.log(result.types); // ["Root", "User"]
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

## Adding a target

1. Create `packages/<lang>-transformer` with a `TargetGenerator` export.
2. Map `TypeNode` to the language, reusing `splitNullable`, the naming helpers
   and `CodeWriter` from `@devbridge/core`.
3. Register it in `packages/engine/src/index.ts`.
4. Add tests driven by `parseJson`, so every generator is exercised against the
   same fixtures.

No parser changes are needed.

## Scope

The blueprint (`DevBridge_Project_Blueprint.pdf`) is the scope anchor. Out of
scope for now: accounts and billing, a server backend for transformations that
can run locally, AI features before the deterministic path is proven, and
persistent storage of transformation inputs.
