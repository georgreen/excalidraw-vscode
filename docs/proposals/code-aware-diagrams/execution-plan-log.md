# Execution Plan — Issues & Decisions Log

> Running log of issues, deviations, and decisions encountered while executing
> [`execution-plan.md`](./execution-plan.md). Append-only. Each entry is dated and references a task
> ID. Status changes to tasks themselves live in `execution-plan.md` (checkboxes) and its Change Log;
> this file captures the *why* and the *gotchas*.

## Legend

- **ISSUE** — a problem found (with resolution if any).
- **DECISION** — a scoping/implementation choice and its rationale.
- **DEVIATION** — implemented differently than the task text; explained and (if needed) reflected as a
  follow-up task in `execution-plan.md`.

---

## 2026-06-26 — Phase 0 spike kickoff

- **DECISION (P0 overall):** The spike proves the round-trip *LSP intelligence → webview* on one
  linked element. To keep it robust and avoid Excalidraw-internal hit-testing, the spike surfaces
  intelligence via **element selection** (select a linked box → info panel with hover + diagnostics +
  "Go to code"), not raw mouse-hover. True mouse-hover trigger and always-on per-element badges are
  Phase 1 refinements (P1.3, P1.4). See per-task notes below.

### Per-task notes

- **DEVIATION (P0.4 / P0.5):** Surfacing uses an **on-selection overlay panel** (bottom-right) rather
  than mouse-hover and always-on per-element badges. Selecting a single linked element fetches its
  hover and shows the symbol, live diagnostics count, hover Markdown, and a "Go to code" button. This
  proves the full round-trip without Excalidraw-internal pointer hit-testing. True mouse-hover trigger
  → Phase 1 **P1.3**; always-on per-element badge overlay layer → Phase 1 **P1.4**.
- **DECISION (P0.4):** Hover Markdown is rendered as preformatted text (`<pre>`) in the spike, not a
  full Markdown renderer. Rich Markdown rendering → P1.3.
- **DECISION (P0.6):** Navigation goes through the new `intel`→`navigate` path (host runs
  `executeDefinitionProvider`, falling back to the resolved symbol position) and opens the file —
  rather than reusing the element `link`/`link-open` sentinel. Keeps the spike self-contained; the
  link-sentinel route can be added in P1.5 for click-the-link-icon UX.
- **ISSUE (P0.5 — diagnostics granularity):** `languages.getDiagnostics(uri)` is **per-file**, so the
  badge reflects "the linked symbol's file has N errors/warnings," not errors within the symbol's
  range. Acceptable for the spike; refine to range-overlap in P2 (alongside `status:"stale"`).
- **ISSUE (P0.5 — perf):** `refreshDiagnostics` calls `getCodeLinks` then re-resolves each link via
  `executeWorkspaceSymbolProvider` on every diagnostics change (debounced 400ms). Resolutions are
  cached per refresh by URI but not across refreshes. Fine for spike scale; add a session-level
  symbol→URI cache in P1 (X.3 performance).
- **DECISION (architecture):** The code-intel router (`src/codeintel/router.ts`) uses only
  `vscode.*` provider commands, so it lives in shared `src/` and works in **both** web and node hosts
  (no dual-host split needed for Phase 0). Command registration is in `activateShared`.
- **VALIDATION STATUS:** host `tsc`, webview `tsc`, host eslint, and webview build + dual webpack all
  pass. Spike strings (`linkElementToSymbol`, `intel-result`, `code-intel-overlay`) confirmed present
  in the built bundles. P0.V1–V4 (live hover/diagnostics/navigate behaviour) await a manual Extension
  Host run against a real TS project.

### 2026-06-27 — Test fixture added (supports P0.V)

- Added `examples/code-aware-demo.excalidraw`: an architecture diagram of this codebase with **7
  boxes pre-linked** (via `customData.codeLink`) to real exported symbols — `ExcalidrawEditorProvider`,
  `ExcalidrawEditor`, `ExcalidrawDocument`, `registerCanvasTools`, `createMcpServer`, `resolveSymbol`,
  `sceneToMermaid`. Links use `{ kind, symbol, file, status }` only (no machine-specific `uri`), so
  they re-resolve portably via the workspace symbol provider. Use this to exercise P0.V1–V3
  (select a box → hover/diagnostics; "Go to code" → navigate) without manual linking.

### 2026-06-27 — Spike didn't work on first test; root-caused via Excalidraw event-model investigation

**Investigation (real API, `@excalidraw/excalidraw` types):**
- **Events Excalidraw emits:** `onChange(elements, appState, files)` (incl. selection),
  `onPointerUpdate({pointer:{x,y,tool}, button})` (component prop only — pointer position in **scene
  coords**, no element identity), `onPointerDown/onPointerUp` (tool + low-level `PointerDownState`),
  `onScrollChange`, `onLinkOpen`, `onPaste`, `onDuplicate`, `onLibraryChange`, `onUserFollow`.
- **There is NO element-hover event** and **no generic element-click event**. Imperative API
  subscriptions: `onChange`, `onPointerDown`, `onPointerUp`, `onScrollChange`, `onUserFollow`
  (note: `onPointerUpdate` is **not** on the imperative API — prop only).
- **`customData` IS preserved** through `loadFromBlob`/restore (verified in prod bundle), so links
  survive save/load.

**ISSUE (root cause of "doesn't work"):** the overlay was invisible. `.excalidraw-wrapper` had no
`position`, and the panel used `z-index: 5`, so it rendered **behind** Excalidraw's UI/canvas.
**Fix:** `.excalidraw-wrapper { position: relative }` + overlay `z-index: 1000`.

**DECISION (navigation — "go to code"):** the canvas owns its own pointer/keyboard handling and
exposes no generic element-click; the supported hook is the element **`link`** + **`onLinkOpen`**.
Fix: `setCodeLink` now also sets `element.link = "code: <symbol>"` (native link badge + hover
tooltip + click), and `App.onLinkOpen` detects `customData.codeLink` and navigates via the intel
router (`preventDefault` so Excalidraw doesn't try to open it as a URL). Updated
`examples/code-aware-demo.excalidraw` so its 7 boxes carry the `link` too.

**DECISION (hover):** since there's no hover event, hover is derived from the `onPointerUpdate`
**prop** (forwarded from `App` via `registerPointer`) and hit-tested (scene coords) against linked
elements. Selection still pins the panel.

**Non-interference measures:** hover is **gated** to `activeTool === "selection"` and ignored while
`button === "down"` (dragging); throttled to ~80ms; we do **not** set `handleKeyboardGlobally` and add
**no** global keyboard/pointer handlers; navigation uses Excalidraw's own link affordance; the overlay
is a small corner panel above the canvas. Read-only safety unchanged (link-setting is a mutating
action subject to the existing guard).

**Status:** rebuilt + reinstalled `pomdtr.excalidraw-editor@3.13.0`. Re-test pending (P0.V).

### 2026-06-27 — "Go to code" did nothing (silent navigate failure)

- **ISSUE:** clicking "Go to code" silently failed. `navigateToLink` returned `false` (or threw) with
  no user feedback, so nothing happened. Likely causes: the project folder not open / language server
  not yet indexed → `executeWorkspaceSymbolProvider` returns nothing → `resolveSymbol` undefined.
- **FIX 1 (robustness):** `navigateToLink` now **falls back to opening the linked `file`** (resolved
  against the workspace folders, then `findFiles`) when symbol resolution yields nothing. Since the
  demo's links carry `file`, "Go to code" now opens the file even before the symbol index is ready.
- **FIX 2 (visibility):** navigation failures now surface a `showWarningMessage` ("couldn't open code
  for <symbol> — make sure the project folder is open and indexed"), and intel exceptions surface a
  `showErrorMessage`. No more silent failures — re-tests will tell us exactly what's wrong.
- Rebuilt + reinstalled. If it still doesn't open, the warning/error text now pinpoints the cause
  (e.g. "no workspace folder open").

### 2026-06-27 — P0.V1 feedback: panel mis-positioned + empty hover ("no docs")

First successful hover test surfaced two issues (fixed in `3.13.1`):

- **ISSUE (UX):** the overlay rendered as a **fixed bottom-right panel**, not next to the hovered
  element. **FIX:** anchor the panel to the element. `CodeIntelOverlay` now computes on-screen
  coordinates from the element's scene rect + `appState.{scrollX,scrollY,zoom}`
  (`viewport = (scene + scroll) * zoom`), places the panel to the element's right (flips left near the
  edge, clamps on-screen), and re-anchors on every `onChange` so it follows scroll/zoom/move. CSS
  switched from `bottom/right` to inline `left/top`.
- **ISSUE (root cause of "no docs"):** `resolveSymbol` returned `SymbolInformation.location.range.start`,
  which sits on the **declaration keyword** (`export`/`class`/`function`), where
  `executeHoverProvider` (and definition) return **nothing** → overlay showed "No hover info". The demo
  nodes are classes/functions (not modules) but most carry no JSDoc, which masked it further.
  **FIX:** `router.refineToIdentifier` scans the first few lines of the declaration range for the bare
  name and moves the position **onto the identifier**, so hover/definition resolve. Also tidied hover
  Markdown for plain rendering (`cleanHoverMd`: strip ``` fences, collapse blank runs).
- **Build note:** `vsce package` re-runs the *production* webview build, which **EINVAL-flaked** writing
  to `webview/dist/assets` on the external SSD volume. Worked around by building the **dev** bundles
  (Node 22: `cd webview && npm run build`, then `npx webpack --mode development`) and packaging with
  `vscode:prepublish` temporarily neutralized. Shipped `pomdtr.excalidraw-editor@3.13.1`.

### 2026-06-27 — Demo enriched with class/function/method nodes

Per feedback that the original 7 nodes were top-level/module-ish symbols with thin hover, added **6
rich-symbol nodes** to `examples/code-aware-demo.excalidraw` (now 13 linked nodes) to exercise the
hover/diagnostics intelligence with real signatures + docs:
- **interfaces** (field types): `CodeLink`, `DiagnosticBadge` (`src/codeintel/router.ts`)
- **typed functions** (params/returns + JSDoc): `navigateToLink`, `hoverMarkdown` (router.ts)
- **methods** (dotted `Container.member`, resolved via `bareName` + `containerName` filter):
  `ExcalidrawEditor.sendCommand`, `ExcalidrawEditor.setupWebview` (`src/editor.ts`)
Color-coded (interface=purple, function=blue, method=orange). Data-only change — no rebuild; reopen
the file (Shift+1 to zoom-to-fit, the new cluster sits below the original row).

### 2026-06-27 — P1.6 agent tools (LM + MCP) implemented (3.14.0)

Added 5 code-aware agent tools, registered both as VS Code Language Model tools
(`src/codeintel/agentTools.ts` → `registerCodeIntelTools`, wired in `tools.ts`) and over the MCP
bridge (`src/mcp/server.ts`), sharing one set of host ops:
- `link_excalidraw_to_symbol` `{path?, ids?, symbol?, auto?}` — explicit-symbol or label-`auto` linking.
- `get_excalidraw_code_links` `{path?}` — the element→symbol index.
- `get_code_hover_for_element` `{path?, id}` — router.hoverMarkdown.
- `navigate_to_element_code` `{path?, id}` — router.navigateToLink.
- `get_linked_diagnostics` `{path?}` — router.diagnosticsForLinks.

Supporting changes:
- New read-only webview action **`getElementLabels`** (both `protocol.ts`, `webview/src/commands.ts`,
  added to `READ_ONLY_ACTIONS`) so `auto` linking can match a shape's label to a workspace symbol.
- Refactor: `symbolInformationToCodeLink` + `bestWorkspaceSymbol` exported from `router.ts` (now also
  used by the link command); the codeLink `symbol` is stored dotted (`Container.member`) for methods.
- `package.json`: 5 `languageModelTools` manifests (41 total); version → **3.14.0**.

Build/validate: host `tsc` clean, webview `tsc` clean, `npm run lint` clean (after `--fix`), dual
webpack OK (codeintel = 3 modules). Packaged + installed `pomdtr.excalidraw-editor@3.14.0`. Manual
agent E2E (P1.V3) pending.

### 2026-06-28 — P1.6 validated over the live MCP bridge (3.15.0)

Exercised the agent tools directly against the running bridge (`http://127.0.0.1:39127/mcp`, no auth)
via JSON-RPC `tools/call`:
- **MCP transport / no-auth**: discovery file holds url/port only (no token); `/health` → `ok`;
  `tools/list` returns **41 tools**, including all 5 code-aware tools. ✓
- `get_excalidraw_code_links` → returned the live demo's **13 links** (classes/functions/methods/
  interfaces). ✓
- `get_linked_diagnostics` → `{files:0, badges:{}}` (no current errors). ✓ (valid empty result)
- `get_code_hover_for_element` (rich_sc / rich_cl / intel) → `hover: null`. ✗ — root cause: the TS
  **language server was dormant** in the reloaded window (only webview-only tools resolve without it;
  hover/diagnostics/navigate all need `executeWorkspaceSymbolProvider`). Same "wake the server"
  condition as Phase 0 — opening a `.ts` file in that window should restore hover. Re-confirm pending.

Net: registration, transport, read, and diagnostics paths are validated end-to-end for agents; hover
needs an active language server. P1.V3 partially validated.

### 2026-06-28 — Robustness: cold-index symbol resolution (3.15.1)

MCP E2E (above) showed hover/diagnostics return empty when the TS server is dormant (workspace symbol
index cold). Confirmed by navigating first (opens the file → wakes the server) then hovering, which
returned the full `ExcalidrawEditor.sendCommand` signature + JSDoc. Fix: `resolveSymbol` now falls
back to `executeDocumentSymbolProvider` on the link's `file` when `executeWorkspaceSymbolProvider`
yields nothing — opening the document activates the language server on demand. Committed (2b4a0b3),
shipped 3.15.1. Cold-start re-validation pending a window reload.

Commits this session: 3f18031 (Phase 0), 2d8c475 (P1.6 + MCP default/no-auth), 2b4a0b3 (cold-index fix).

### 2026-06-28 — P1.V3 PASSED (cold) + symbol-name normalization (3.15.2)

After reloading to 3.15.1, re-ran the agent tools over MCP on a **cold** TS server (no file pre-opened):
- `get_code_hover_for_element` (resolveSymbol, and dotted `ExcalidrawEditor.sendCommand`) → full
  signature + JSDoc. ✓ (cold-index fallback works)
- `get_linked_diagnostics` → resolved files; reported `{doc: {errors:1, file:"src/document.ts"}}` (a live
  in-editor error), badging the `ExcalidrawDocument` box. ✓
- `link_excalidraw_to_symbol {ids:["intel"], symbol:"resolveSymbol"}` → linked, file resolved. ✓
- `navigate_to_element_code` → `opened:true`. ✓
So **P1.V3 passes** and **P1.5** (navigation) is validated.

Minor bug found + fixed: linking stored `resolveSymbol()` (TS workspace symbols carry a call suffix).
`cleanSymbolName` now strips `(…)`; exact-match filters use it too. Committed (7d158e4), shipped 3.15.2.

Commit: 09e5f83 (validation log), 7d158e4 (symbol-name normalization).

### 2026-06-28 — P1.3 + P1.4 diagnostics/hover polish (3.16.0)

- **P1.4**: diagnostics are now a **persistent overlay layer** keyed by element id — a colored badge
  on every linked element whose file has problems (red=error, amber=warning), anchored to the
  element's corner and re-anchored on scroll/zoom/move (throttled). `diagnosticsForLinks` now also
  returns the top diagnostic **messages** (with severity + line), shown as the badge tooltip.
- **P1.3**: hover panel splits the signature (code block) from the prose docs (`splitHover`), with
  explicit loading / "No hover info" states.
Host + webview tsc clean; webview rebuilt (Node 22, slow/EINVAL-flaky on the SSD — retried) + dual
webpack. Shipped 3.16.0. Tasks marked done (code-complete); **visual confirmation pending** a reload.

### 2026-06-28 — Clickable diagnostic badges (3.16.1)

Q: what should clicking a diagnostic badge do? Decision: **jump to the problem**. New router op
`navigateToDiagnostic(link)` opens the linked file at its first diagnostic (errors before warnings)
and selects that range; host `handleIntel` op `navigateDiagnostic`; the webview badge `onClick` looks
up the element's codeLink and posts it (tooltip now hints "click to open the problem in code"). Falls
back to opening the file when no diagnostics remain. Host + webview tsc + lint clean; shipped 3.16.1.

### 2026-06-29 — P1.1 / P1.2 / P1.7 (3.17.0)

- **P1.1** (schema): `setCodeLink` now validates a link carries a non-empty `symbol`, supports
  **unlink** (`codeLink: null` removes `customData.codeLink` and only the extension's own `code:`
  link, preserving a user-set URL). Agent tool `link_excalidraw_to_symbol` gains `unlink: true` (LM +
  MCP manifests).
- **P1.2** (auto-suggest): command **"Excalidraw: Auto-link Elements to Code Symbols"** —
  `getElementLabels` → `bestWorkspaceSymbol` per label → multi-select confirmation → `setCodeLink`.
  The opt-in human counterpart to the agent's `auto` mode.
- **P1.7** (docs): README "Code-aware diagrams" section; CHANGELOG 3.16.0–3.17.0; QA changelog
  section + checklist.
Host + webview tsc + lint clean; built/installed 3.17.0. Phase 1 task list now complete (P1.1–P1.7);
remaining Phase 1 items are validations P1.V1 (multi-language), P1.V2 (router unit tests), P1.V4
(bundle/activation check).

### 2026-06-29 — P1.V4 PASSED (+ activation-events fix, 3.17.1)

Verified: all 5 code-aware LM tools present in the **web** bundle and (with the 5 MCP tools +
`navigateToDiagnostic`) in the **node** bundle; `autoLinkElements` command bundled. **Bug found**: the
5 code-aware LM tools had no `onLanguageModelTool:*` activation events (every canvas tool does), so
invoking one might not activate the extension. Added them (3.17.1). P1.V4 done.

Remaining Phase 1 validations: P1.V1 (multi-language — mechanism is language-agnostic; needs a
non-TS project to confirm) and P1.V2 (router unit tests — **no test harness exists** in the repo; needs
a decision on adding one).

### 2026-06-29 — P1.V2 PASSED: router unit tests (Vitest)

Added a lightweight test harness (no test infra existed): **Vitest** (`vitest@^1.6.1`, pinned to match
the repo's `@types/node@18`) with a mocked `vscode` module (`src/test/vscode.mock.ts`, aliased via
`vitest.config.ts`). `npm test` → `vitest run`. Tests in `src/codeintel/router.test.ts` (12, all green)
cover `symbolInformationToCodeLink` (call-suffix stripping, dotted methods), `bestWorkspaceSymbol`
(clean-name match, container preference), `resolveSymbol` (cached path, workspace+refine path,
undefined), `hoverMarkdown`, and `diagnosticsForLinks` (counts, messages, per-file caching).
`tsconfig.json` excludes `*.test.ts` / `src/test` / `vitest.config.ts` so `tsc`/webpack ignore them
(the mock intentionally diverges from `@types/vscode`). Host tsc + lint + dual webpack still clean.
Addresses P1.V2 and part of X.2.

Remaining Phase 1: **P1.V1** (multi-language) — language-agnostic by design; needs a non-TS project
(e.g. Python) to confirm. That leaves Phase 1 ready to close pending that one manual check.
