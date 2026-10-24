# DevBridge for VS Code

Turn a JSON, SQL or OpenAPI document into the artifact you need next, without
leaving the editor and without sending anything anywhere.

## Commands

| Command | What it does |
| --- | --- |
| **DevBridge: Transform…** | Transforms the selection, or the whole file when nothing is selected. Asks which target, then opens the result in a new editor. |
| **DevBridge: Validate this document** | Reports whether the document parses, with the line and column of the first problem. |

## What it can transform

| From | To |
| --- | --- |
| JSON | TypeScript, Java, Go, Python, C# |
| SQL | Mermaid ERD, DBML |
| OpenAPI 3 | Postman collection |

The source format is taken from the editor's language mode, falling back to
the file extension. If neither is conclusive you are asked.

## Offline by construction

The transformation runs inside the extension host. There is no service, no
account and no network call — the same engine that powers the DevBridge CLI
and web app, bundled into the extension.

## Installing from a VSIX

```
code --install-extension devbridge.vsix
```
