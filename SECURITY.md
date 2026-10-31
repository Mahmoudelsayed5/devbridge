# Security policy

## What DevBridge does with your data

DevBridge transforms text. Every parser and generator in `packages/` is a pure
function from a string to a string, and nothing in the library, the CLI, or the
VS Code extension sends your input anywhere.

This is enforced by a test, not by a promise: `local-first.test.ts` fails the
build if any shipped module imports a network or child-process API. The web app
at [the GitHub Pages site](https://mahmoudelsayed5.github.io/devbridge/) runs
the same code in your browser — it is a static page with no backend, so the
schema you paste into it never leaves your machine.

That matters because the inputs are rarely public: a production database
schema, an internal API specification, and a captured JSON response all tell an
attacker a great deal about a system.

## Reporting a vulnerability

Report privately through GitHub's
[security advisory form](https://github.com/Mahmoudelsayed5/devbridge/security/advisories/new).
Please do not open a public issue for anything exploitable.

Include the input that triggers it, the command or page you ran, and what you
expected instead. A minimal reproducing input is the most useful thing you can
send.

Expect an acknowledgement within a week. Because DevBridge is a small
unfunded project there is no bounty, and no guaranteed fix timeline — but you
will be told plainly what the plan is, and credited in the advisory unless you
ask otherwise.

## What counts

Worth reporting:

- **Generated output that is unsafe to run or compile.** The generators write
  code. An input that makes one of them emit something that executes, injects,
  or escapes its intended context is the most serious class of bug here —
  for example a schema whose column name breaks out of a string literal in a
  generated SQL or TypeScript file.
- **Path escape.** The CLI writes files under `--out`. An input that gets it to
  write outside that directory is a vulnerability. (`safeFileName` in the
  Postman generator exists for exactly this reason.)
- **Anything that leaves the machine.** A network call, a spawned process, or
  telemetry of any kind in shipped code.
- **Denial of service on untrusted input** — an input of reasonable size that
  hangs a parser or exhausts memory, since the extension parses files as you
  open them.

Not a vulnerability:

- A parser rejecting a valid document, or accepting an invalid one, without
  further consequence. That is a correctness bug — please open a normal issue.
- Generated code that does not compile. Also a normal issue; see
  `pnpm verify:generated`.
- Vulnerabilities in a dependency with no path to exploitation through
  DevBridge. Dependabot handles routine bumps.

## Supported versions

The project is pre-1.0. Fixes land on `main` and ship in the next release;
earlier versions are not patched.
