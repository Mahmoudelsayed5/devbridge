# Changelog

Notable changes to DevBridge. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the version is below `1.0.0`, a minor bump may change the generated
output or the library API. Generated code is checked into *your* repository,
so a diff after an upgrade is expected and is the point at which to read this
file.

## [Unreleased]

Nothing yet.

## [0.1.0] — 2026-11-07

First release. Everything below is new, so this entry describes what the
project *is* rather than what changed.

### Added

**Three source formats, eight targets.** A source is parsed into a shared
intermediate representation and generated from that, so a new target is one
new piece rather than one per source.

| From | To |
| --- | --- |
| JSON | TypeScript, Java, Go, Python, C# |
| SQL (MySQL, PostgreSQL, SQL Server, SQLite dialects) | Mermaid ERD, DBML |
| OpenAPI 3 — `paths` | Postman collection v2.1 |
| OpenAPI 3 — `components/schemas` | TypeScript, Java, Go, Python, C# |

**Four surfaces, one engine.** A web app, a CLI, a VS Code extension and the
libraries themselves all run the same code, so a transformation behaves
identically in each.

- Web app — <https://mahmoudelsayed5.github.io/devbridge/>
- CLI — `devbridge transform`, `devbridge validate`, `devbridge formats`
- VS Code — **DevBridge: Transform…** and **DevBridge: Validate this
  document**, shipped as an installable `.vsix`

**What the OpenAPI reading gets right that inference cannot.** A schema
states things a sample can only hint at, and the generated models are better
for it: `$ref` means two shapes are genuinely one type, `required` states
optionality outright, `format: int64` states integer width, `enum` states
that a set is closed, `additionalProperties` distinguishes a dictionary from
an object, `discriminator` tells union branches apart, and `allOf` with a
`$ref` is read as inheritance rather than flattened.

**Local-first, and enforced.** Nothing is uploaded and no input is stored.
The web app is a static bundle with no backend, and a test fails the build if
any module that reaches the browser so much as references `fetch`,
`XMLHttpRequest`, `WebSocket`, `sendBeacon` or web storage.

**Generated output is compiled, not just asserted on.** CI generates two
deliberately awkward fixtures into every target and runs that language's real
toolchain over the result — `tsc --strict`, `javac -Xlint:all`, `go vet` plus
`gofmt -l`, `py_compile` plus `typing.get_type_hints`, and `dotnet build`
with `TreatWarningsAsErrors`. DBML is parsed by the official `@dbml/core`
parser.

### Known limitations

Stated here because they are deliberate, and each is reported as a diagnostic
rather than passed off silently. The full list is in
[docs/roadmap.md](docs/roadmap.md).

- Inference from JSON is sample-based: a field in no sample cannot appear,
  and neither enums nor maps are guessed from samples — only read from a
  schema that declares them.
- An object cannot also be a map; a schema with both `properties` and
  `additionalProperties` keeps the named fields and reports the rest.
- C# cannot round-trip an enum value that is not a case-variant of an
  identifier, before .NET 9's `JsonStringEnumMemberName`.
- A bare `oneOf` with no shared base type is emitted untyped in Java, C# and
  Go; give the branches a base schema carrying the discriminator and all
  three emit polymorphic serialization.
- Only single inheritance, because Java and C# allow one base apiece.
- The SQL parser ignores views, triggers, stored procedures and partitioning
  clauses.

### Not published

The libraries are not on npm and the extension is not on the Marketplace.
Install the extension from the `.vsix` attached to this release:

```bash
code --install-extension devbridge-0.1.0.vsix
```

[Unreleased]: https://github.com/Mahmoudelsayed5/devbridge/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Mahmoudelsayed5/devbridge/releases/tag/v0.1.0
