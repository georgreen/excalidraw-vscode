# Code-Aware Diagrams

Make Excalidraw diagrams *linked to the code they depict* and "intelligent" by **reusing the
project's already-running language servers** — hover docs, jump-to-code, live error badges, and
generating diagrams from code structure (type/call hierarchy). The diagram becomes a living,
navigable map of the codebase instead of a screenshot that rots.

| | |
|---|---|
| **Status** | Draft / for discussion |
| **Owner** | @georgreen |
| **Created** | 2026-06-25 |
| **Area** | excalidraw-vscode (agent tools + webview + host) |

## Documents

| Doc | Purpose |
|---|---|
| [`proposal.md`](./proposal.md) | The idea: current state, problem, value (incl. for agents & collaboration), existing solutions, is it worth solving. |
| [`design.md`](./design.md) | Implementation & technical design: architecture, metadata model, protocol/tools, host resolvers, webview surfacing. |
| [`execution-plan.md`](./execution-plan.md) | Phased delivery plan: milestones, tasks, validation, exit criteria, risks. |

## TL;DR

Boxes that represent classes/functions carry a code link in their `customData`. A thin **host
"intelligence router"** resolves that link to a `(uri, position)` and **delegates to the running
language server** via VS Code's `execute*Provider` commands (hover, definition, references,
diagnostics, type/call hierarchy). The sandboxed webview reaches it all through the existing
host↔webview command channel. No new language server is built; nothing in the file format changes
(links live in `customData`, which already persists).

## Status at a glance

- ✅ Idea validated against `@types/vscode` (every required API confirmed).
- ✅ Rides existing infra: command channel, per-element metadata, drawing tools, dual host.
- ⏭ Next: Phase 0 spike — `executeHoverProvider` + `getDiagnostics` round-trip into the webview on
  one linked element. See [`execution-plan.md`](./execution-plan.md).

## Convention

Each proposal lives in its own folder under `docs/proposals/<name>/` and contains: `README.md`,
`proposal.md`, `design.md`, and `execution-plan.md`.
