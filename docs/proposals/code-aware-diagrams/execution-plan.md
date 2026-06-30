# Execution Plan — Code-Aware Diagrams

> Companion to [`proposal.md`](./proposal.md) and [`design.md`](./design.md). Phased delivery with
> tasks, validation, and exit criteria. Each phase is independently shippable and valuable.

## How to use this document (conventions)

**This document is append-only.** Existing tasks and text are never deleted or rewritten. The only
edits permitted to existing lines are flipping a task's status marker (tick it done, or mark it
skipped). Everything else — new tasks, decisions, reasons, comments — is **added** as new content,
including an entry in the [Change Log](#change-log-append-only) at the bottom.

**Task status legend** (each task carries one):

| Marker | Status | Meaning |
|---|---|---|
| `- [ ]` | **pending** | Not started / in progress. |
| `- [x]` | **done** | Completed. |
| `- [~]` | **skipped** | Intentionally not done — a dated reason MUST be appended to the Change Log, referencing the task ID. |

**Rules**
- Every task has a stable **ID** (e.g. `P1.3`) so the Change Log and later notes can reference it.
- To **complete** a task: change `- [ ]` → `- [x]`. Optionally append a note/commit ref in the log.
- To **skip** a task: change `- [ ]` → `- [~]` and **append a reason** as new content in the Change
  Log (do not edit the task text).
- To **change scope**: do not edit a task in place — append a new task (next ID) and, if it
  supersedes an old one, skip the old one with a reason pointing to the new ID.
- Comments/decisions are appended to the relevant phase's **Notes** subsection or the Change Log.

---

## Guiding principles

- **Prove the round-trip before building breadth.** A spike validates the riskiest assumption (live
  LSP intelligence rendered in the webview) cheaply.
- **Reuse, don't rebuild.** Every phase rides the existing command channel, `customData`, drawing
  tools, and dual host.
- **Ship per phase.** Bump version + update `CHANGELOG.md` and the QA changelog each phase, like the
  current tool releases.
- **Validate on Node 22** (webview build), then webpack; the root build is flaky (known repo note).

---

## Phase 0 — Spike (de-risk) ✦ smallest viable proof

**Goal:** end-to-end proof that LSP intelligence can be surfaced on one linked element.

**Tasks**
- [x] **P0.1** Temporary command "Excalidraw: Link element to symbol…" — quick-pick over
  `executeWorkspaceSymbolProvider`; write `customData.codeLink` to the selected element.
- [x] **P0.2** Host **intelligence router** stub: `resolve()` + `hover()` (executeHoverProvider).
- [x] **P0.3** Webview → host **request path** (`intel`/`intel-result`) added to the protocol (both
  mirrors).
- [x] **P0.4** On element hover → fetch `codeHover` → render Markdown in a minimal overlay.
- [x] **P0.5** Subscribe to `onDidChangeDiagnostics`; badge the element when its linked file has
  errors.
- [x] **P0.6** Click → `executeDefinitionProvider` → open the file at the symbol.

**Validation / exit criteria**
- [x] **P0.V1** Hover on a linked box shows the TS server's real doc/signature.
- [x] **P0.V2** Introduce a compile error in the linked file → badge appears live; fix it → badge
  clears.
- [x] **P0.V3** Click navigates to the symbol.
- [x] **P0.V4** `tsc` (host + webview) clean; manual E2E in Extension Host on a sample TS project.

**Risks addressed:** webview↔host intelligence round-trip; provider result quality; overlay UX.

**Notes (append-only):**
- 2026-06-26 — P0.1–P0.6 implemented and building (host `tsc` + webview `tsc` + dual webpack clean).
  Validation tasks P0.V1–P0.V4 require an interactive Extension Host with a live language server and
  remain pending (manual run). Implementation deviations/issues logged in `execution-plan-log.md`.
- 2026-06-27 — Spike **expanded** beyond the stub during debugging (all logged in
  `execution-plan-log.md`): hover is driven by the `onPointerUpdate` **prop** + scene-coord hit-test
  (no hover event exists); navigation goes through the element **`link` + `onLinkOpen`** path with a
  **file fallback** + user-facing warning/error toasts; the overlay was made visible
  (`.excalidraw-wrapper{position:relative}` + `z-index:1000`) and gained a **selection-pinned** panel;
  diagnostics are pushed at **per-file** granularity. This pulled several Phase 1 mechanics forward in
  **spike-grade** form (see Phase 1 note). Files: `src/codeintel/{router,commands}.ts`,
  `webview/src/CodeIntelOverlay.tsx`, edits to `editor.ts`/`App.tsx`/`commands.ts`/`styles.css`/both
  `protocol.ts`. Currently shipped in `pomdtr.excalidraw-editor@3.13.0`; **uncommitted** on
  `feat/agent-canvas-tools-mcp`. P0.V1–P0.V4 still **pending** (manual E2E unconfirmed).

---

## Phase 1 — Read & navigate (MVP, ship)

**Goal:** production-quality link + hover + jump + diagnostics for humans and agents.

**Tasks**
- [x] **P1.1** Finalize `CodeLink` schema + `setCodeLink` / `get_excalidraw_code_links`.
- [x] **P1.2** **Auto-suggest links** by label↔workspace-symbol match (opt-in prompt).
- [x] **P1.3** Hover overlay polish (Markdown, loading/empty states, multi-result).
- [x] **P1.4** Diagnostics badges as an **overlay layer** keyed by element id (no document dirtying);
  counts + message tooltips; severity colors.
- [x] **P1.5** Navigation via extended `link-open` path.
- [x] **P1.6** Agent tools: `link_excalidraw_to_symbol`, `get_excalidraw_code_links`,
  `get_code_hover_for_element`, `navigate_to_element_code`, `get_linked_diagnostics` (LM + MCP).
- [x] **P1.7** Docs: README/CHANGELOG/QA changelog; version bump.

**Validation / exit criteria**
- [ ] **P1.V1** Round-trips work across ≥2 languages (e.g. TS + Python).
- [x] **P1.V2** Router unit tests (stubbed `executeCommand`) green.
- [x] **P1.V3** Agent can: link a box, read links, get hover, jump, list linked diagnostics.
- [x] **P1.V4** Build: webview (Node 22) + dual webpack; tools present in both bundles + activation
  events.

**Notes (append-only):**
- 2026-06-27 — **Status snapshot** (tasks stay **pending**: Phase 1 = production-quality + validated;
  the spike delivered these in spike-grade, unvalidated form only):
  - **P1.1** — _partial._ `CodeLink` schema exists in `src/codeintel/router.ts`; `setCodeLink` /
    `getCodeLinks` host↔webview actions are implemented (both `protocol.ts`, `webview/src/commands.ts`;
    `getCodeLinks` is read-only). Schema not yet "finalized"; no migration/validation pass.
  - **P1.3** — _partial._ Hover overlay exists (`CodeIntelOverlay.tsx`, Markdown as `<pre>`); missing
    polish (proper Markdown render, loading/empty states, multi-result).
  - **P1.4** — _partial._ Diagnostics pushed as `code-diagnostics` and shown as an overlay badge at
    **per-file** granularity; missing per-element precision, message tooltips, severity colors.
  - **P1.5** — _implemented (code-complete, unvalidated)._ Navigation via the extended
    `link-open`/`onLinkOpen` path with file fallback + toasts. Left **pending** until P*.V passes.
  - **P1.2** (auto-suggest), **P1.6** (LM/MCP code-link tools — confirmed **absent** in `src/`),
    **P1.7** (docs/version: CHANGELOG has 3.11–3.13 entries, version `3.13.0`, but Phase-1 QA changelog
    not done) — **not started / partial**.

---

## Phase 2 — Generate & enrich

**Goal:** derive diagrams from code and grow them on demand.

**Tasks**
- [x] **P2.1** **"Visualize as Excalidraw"** from a symbol: `prepareTypeHierarchy` (inheritance) and
  `prepareCallHierarchy` (calls) → skeletons → `convertToExcalidrawElements` → `updateScene`,
  pre-linked. Depth limit + node cap.
- [x] **P2.2** `generate_diagram_from_symbol` and `expand_element_relations` agent tools.
- [x] **P2.3** Reference/implementation **count badges** (shown in the selection panel + agent hover; on-demand, not a persistent per-node badge).
- [x] **P2.4** Insert **members with signatures** via expand kind `members` (`executeDocumentSymbolProvider`; signatures via member detail + code-aware hover).
- [ ] **P2.5** **Link freshness**: `onDidRenameFiles` / `onDidChangeTextDocument` → update hints /
  mark stale; surface `status:"stale"` as a badge ("diagram linter").
- [ ] **P2.6** **Reverse index + CodeLens**: scan `customData.codeLink` across `.excalidraw` files;
  CodeLens on symbols → open + focus element (desktop-first).
- [ ] **P2.7** **Edge relationship resolution** (design §11): derive `(A,B)` symbols from an arrow's
  bound endpoints' `codeLink`s; probe most-specific kind first (inherits → calls → references) via
  `prepareCallHierarchy`/`provideOutgoingCalls` `fromRanges`, `executeReferenceProvider`,
  `prepareTypeHierarchy`. Add `intel` ops + router functions.
- [ ] **P2.8** **Edge click → go to concrete site**: 1 site opens; many → `editor.action.showReferences`
  peek scoped to the A→B `fromRanges`. Hover/select arrow → relationship summary (kind + count +
  first-site preview) in the overlay panel.
- [ ] **P2.9** **Diagram linter for edges**: when no concrete site is found, report
  "conceptual/transitive" (no silent fail); mark the arrow `unverified`; optional depth-capped,
  opt-in transitive path-finding (A → … → B) peeking the first hop.
- [ ] **P2.10** **Edge metadata `arrow.customData.relation`** (`{kind?,verified?,lastChecked?,from?,to?}`):
  declare/override intent, support unbound arrows, cache verification, flag declared-vs-detected
  mismatch; optionally auto-label the arrow with the detected kind.

**Validation / exit criteria**
- [ ] **P2.V1** Generate-from-hierarchy unit test (fixture → expected nodes/edges), mirroring
  `sceneToMermaid` test.
- [x] **P2.V2** Visualize a real class graph; nodes are navigable (hover/jump) immediately.
- [ ] **P2.V3** Rename a linked symbol → diagram shows stale, then auto-updates where resolvable.
- [ ] **P2.V4** Clicking a **direct-call arrow** jumps/peeks the real call site; clicking the demo's
  indirect `ExcalidrawEditor → resolveSymbol` arrow reports "conceptual/transitive" instead of
  failing silently.

**Notes (append-only):**
- _(none yet)_

---

## Phase 3 — Debug overlay

**Goal:** the diagram animates execution and drives breakpoints.

**Tasks**
- [ ] **P3.1** Subscribe to `debug.activeStackItem` + `onDidChangeActiveStackItem` → highlight the
  linked element for the currently-executing frame; clear on continue/stop.
- [ ] **P3.2** Set/clear breakpoints from a diagram node (`debug.addBreakpoints` /
  `removeBreakpoints`); reflect `onDidChangeBreakpoints` as node markers.
- [ ] **P3.3** Agent tools (optional): `toggle_breakpoint_on_element`,
  `get_active_execution_element`.

**Validation / exit criteria**
- [ ] **P3.V1** Start a debug session; stepping highlights the corresponding diagram element.
- [ ] **P3.V2** Clicking a node toggles a breakpoint visible in the gutter and the diagram.
- [ ] **P3.V3** Desktop-only; gracefully absent in web host.

**Notes (append-only):**
- _(none yet)_

---

## Cross-cutting (all phases)

- [ ] **X.1** Versioning & docs per phase (CHANGELOG + `examples/EXCALIDRAW_AGENT_TOOLS_CHANGELOG.md`).
- [ ] **X.2** Testing: router unit tests with stubbed `executeCommand`; generation fixtures; manual
  E2E matrix in the Extension Host.
- [ ] **X.3** Performance: debounce hover/diagnostics; session cache for resolved symbols; hierarchy
  caps.
- [ ] **X.4** Build/release: Node 22 webview build + dual webpack; package VSIX; optional GitHub
  release as done for prior versions.

**Notes (append-only):**
- _(none yet)_

---

## Dependencies & sequencing

```
Phase 0 (spike) ──► Phase 1 (read & navigate) ──► Phase 2 (generate & enrich) ──► Phase 3 (debug)
        │                     │                            │
   proves round-trip     ships MVP value          biggest unlock           highest wow / lowest
                                                   (generate-from-code)     priority
```

Phase 1 is the recommended first shippable increment. Phases 2–3 are independently valuable and can be
reordered based on demand (generation tends to deliver more value than debug overlay for most users).

## Out of scope (revisit later)

- [~] **OOS.1** Inline autocomplete inside Excalidraw text — skipped for now (custom overlay UI;
  UX-hard). See Change Log 2026-06-25.
- [~] **OOS.2** Test pass/fail overlays — skipped (no consumable public API). See Change Log
  2026-06-25.
- [~] **OOS.3** Real-time multiplayer CRDT — skipped (would require Excalidraw's collab server). See
  Change Log 2026-06-25.

## Success metrics

- Time-to-navigate from diagram to code (click → editor) is instant and reliable.
- Stale links are detected and surfaced (no silent rot).
- "Visualize as Excalidraw" produces a correct, navigable graph for a real module.
- Agents can link, read, and generate against real symbols without hallucinated structure.

---

## Change Log (append-only)

> Append a dated entry for every status change to **skipped**, every scope change, and any notable
> decision. Reference task IDs. Never edit prior entries.

- **2026-06-25** — Document created with the append-only checkbox format. All Phase 0–3 and
  cross-cutting tasks start as **pending**.
- **2026-06-25** — Marked **OOS.1** (inline autocomplete), **OOS.2** (test pass/fail overlays), and
  **OOS.3** (real-time CRDT) as **skipped** for the current scope. Reasons: OOS.1 requires custom
  overlay UI and is UX-hard; OOS.2 has no public API to read another extension's test results; OOS.3
  would require running Excalidraw's collaboration/CRDT server. Revisit if demand warrants.
- **2026-06-26** — Phase 0 tasks **P0.1–P0.6 marked done** (code complete, builds clean). Validation
  P0.V1–P0.V4 remain **pending** (need interactive Extension Host + live language server). See
  `execution-plan-log.md` for deviations (selection-trigger spike UI, per-file diagnostics
  granularity).
- **2026-06-27** — First manual test of the spike failed. Root-caused to overlay invisibility
  (`.excalidraw-wrapper` unpositioned + low z-index) plus wrong navigation trigger. Investigated
  Excalidraw's event model (no hover/click events; `onPointerUpdate` + `onLinkOpen` are the hooks).
  Fixed: overlay visibility; hover via `onPointerUpdate` hit-test; navigation via `link`/`onLinkOpen`;
  demo updated. Tasks P0.1–P0.6 remain done (revised implementation). See `execution-plan-log.md`.
- **2026-06-27** — Manual validation began. **P0.V1 passed** (hover shows real signatures/docs) after
  shipping `3.13.1`, which fixed two issues from first testing: overlay was a fixed bottom-right panel
  (now **anchored next to the element**, follows scroll/zoom) and hover was empty because
  `resolveSymbol` landed on the declaration **keyword** (now **refined to the identifier** via
  `refineToIdentifier`). Demo enriched with 6 **rich-symbol** nodes (interfaces/functions/methods) so
  hover shows meaningful signatures. P0.V2/P0.V3 still pending.
- **2026-06-27** — **Phase 0 COMPLETE.** P0.V2 (live diagnostics badge appears on the linked file's
  boxes and clears on fix) and P0.V3 (link-badge / "Go to code" navigates to the symbol) both
  **passed** in the Extension Host on this repo. With P0.V4 satisfied (host + webview `tsc` clean,
  manual E2E green), the spike has proven the full round-trip: link → resolve → hover/diagnostics →
  navigate, all by delegating to the running TS language server. Ready for Phase 1.
- **2026-06-27** — Phase 0 work **committed** (`3f18031`) and shipped as `3.13.1`: `src/codeintel/`,
  `webview/src/CodeIntelOverlay.tsx`, intel channel + diagnostics in `editor.ts`,
  `setCodeLink`/`getCodeLinks` protocol, enriched `examples/code-aware-demo.excalidraw`, and the
  `docs/proposals/code-aware-diagrams/` set. Branch `feat/agent-canvas-tools-mcp`.
- **2026-06-27** — Added **edge / relationship convention** to `design.md` (new §11; Open questions →
  §12): arrows are A→B relationships resolvable via call/type hierarchy + references, with click→
  concrete-site (peek if many), hover summary, the diagram-linter for conceptual/transitive arrows,
  and optional `arrow.customData.relation`. Plan did not cover edge *interpretation* (P2 only covered
  generation + node badges), so added **P2.7–P2.10** and **P2.V4** under Phase 2.
- **2026-06-27** — **Status reconciliation** against the working tree (uncommitted on
  `feat/agent-canvas-tools-mcp`, shipped as `3.13.0`): Phase 0 **P0.1–P0.6 remain done** but the spike
  expanded (hover via `onPointerUpdate`, navigation via `onLinkOpen` + file fallback, visible
  selection-pinned overlay, per-file diagnostics) — see Phase 0 note. Added a Phase 1 **status
  snapshot**: P1.1/P1.3/P1.4 **partial** and P1.5 **code-complete** in spike-grade form, but all Phase
  1 tasks stay **pending** (not production-quality/validated); P1.2/P1.6/P1.7 **not started** (P1.6
  agent tools confirmed absent in `src/`). All P0.V/P1.V validations **pending** (manual E2E
  unconfirmed). No new skips beyond OOS.1–3.
