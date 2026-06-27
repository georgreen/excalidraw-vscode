# Implementation & Design — Code-Aware Diagrams

> Companion to [`proposal.md`](./proposal.md). This document specifies *how* to build the layer:
> architecture, data model, protocol/tool surface, host resolvers, and webview surfacing. It is
> grounded in the current codebase (host↔webview command channel, per-element `customData`, the
> drawing tools) and in APIs validated against `@types/vscode`.

## 1. Goals & non-goals

**Goals**
- Link diagram elements to code symbols and persist the link in the file with no format change.
- Surface language-server intelligence (hover, navigation, diagnostics, references, hierarchy) on
  linked elements by **delegating to the running language servers** — build no LSP of our own.
- Generate diagrams *from* code structure (type/call hierarchy), pre-linked.
- Expose the capabilities to humans (commands/UI) **and** agents (LM tools + MCP).

**Non-goals (initially)**
- A custom language server, parser, or index of our own.
- Inline type-ahead completion inside Excalidraw text (stretch; needs custom overlay UI).
- Test pass/fail overlays (no consumable public API).
- Real-time multiplayer CRDT editing.

## 2. Architecture

```
┌─────────────────────────┐      command channel        ┌──────────────────────────┐
│  Webview (React/Excalidraw)│  {type:"command",...}      │  Extension host           │
│  - element customData      │ ─────────────────────────► │  Intelligence Router      │
│    .codeLink               │                            │   (no LSP of its own)     │
│  - hover popover           │ ◄───────────────────────── │   maps codeLink→(uri,pos) │
│  - error badges            │  {type:"command-result"}   │   calls execute*Provider  │
│  - click→navigate          │                            │        │                  │
└─────────────────────────┘                              │        ▼                  │
                                                          │  VS Code language APIs    │
                                                          │  (running TS/Py/Rust/… )  │
                                                          └──────────────────────────┘
```

Reused, already-shipped building blocks:
- **Command channel** (`src/protocol.ts` ↔ `webview/src/protocol.ts`, `ExcalidrawEditor.sendCommand`,
  `webview/src/commands.ts` dispatcher). New actions are added the same way as the canvas actions.
- **Per-element metadata** — `customData` already persists through `serializeAsJSON` and the PNG/SVG
  embed.
- **Drawing tools** — `add_elements`, `connect_elements`, `draw_from_mermaid` render generated graphs.
- **Dual host** — node host (`src/extension.node.ts`) for indexing/debug pieces; web host keeps
  hover/jump/diagnostics where possible.

## 3. Metadata model

### 3.1 Per-element code link (`customData.codeLink`)

```ts
interface CodeLink {
  kind: "class" | "interface" | "function" | "method" | "module" | "field" | "symbol";
  symbol: string;          // resolvable name, e.g. "OrderService" or "OrderService.createOrder"
  containerName?: string;  // disambiguation (namespace/class)
  file?: string;           // workspace-relative hint; re-resolved if stale
  // resolution cache (advisory; always re-resolvable from `symbol`)
  uri?: string;
  selectionStart?: { line: number; character: number };
  lastResolved?: string;   // ISO timestamp
  status?: "linked" | "unresolved" | "stale";
}
// stored at: element.customData.codeLink
```

Design choices:
- **Store a re-resolvable `symbol`, not a brittle `file#line`.** Positions drift on edit; the symbol
  is re-resolved via `executeWorkspaceSymbolProvider`. `file`/`uri` are caches/hints.
- **Authorship/status reuse** the same `customData` for collaboration (`author`, `status`, `ts`).

### 3.2 Diagram ↔ project binding

Options (start with the first two):
1. **Implicit** — diagram lives in the repo; links resolve against the workspace. No extra metadata.
2. **Per-element** — every linked element is self-describing via `codeLink`. No diagram-level state
   needed for MVP.
3. **(Later) Root binding** — a tag on a root frame's `customData` for defaults (e.g. base module).

## 4. Host "Intelligence Router"

A new node-host module (e.g. `src/codeintel/router.ts`) with pure-ish functions that map a `CodeLink`
to a language result by calling VS Code commands. No webview imports.

```ts
// resolve a symbol name to a concrete (uri, position)
async function resolve(link: CodeLink): Promise<{ uri: Uri; pos: Position } | undefined>;
//   → executeWorkspaceSymbolProvider(link.symbol) [+ filter by kind/containerName/file]

async function hover(link): Promise<Markdown | undefined>;     // executeHoverProvider
async function definition(link): Promise<Location | undefined>; // executeDefinitionProvider
async function references(link): Promise<number>;               // executeReferenceProvider (count)
async function implementations(link): Promise<number>;          // executeImplementationProvider
async function diagnosticsFor(uri): Promise<DiagSummary>;       // languages.getDiagnostics(uri)
async function members(link): Promise<SymbolNode[]>;            // executeDocumentSymbolProvider
async function typeHierarchy(link): Promise<Graph>;            // prepareTypeHierarchy + super/subtypes
async function callHierarchy(link): Promise<Graph>;           // prepareCallHierarchy + in/out calls
```

Validated API mapping (see proposal §1 table): `executeHoverProvider`, `executeDefinitionProvider`,
`executeWorkspaceSymbolProvider`, `executeReferenceProvider`, `executeImplementationProvider`,
`executeDocumentSymbolProvider`, `executeSignatureHelpProvider`, `prepareTypeHierarchy`,
`prepareCallHierarchy`, `languages.getDiagnostics` + `onDidChangeDiagnostics`,
`workspace.onDidRenameFiles` / `onDidChangeTextDocument`.

## 5. Protocol & tool surface

### 5.1 New host↔webview command actions (mirror in both `protocol.ts` files)

| Action | Direction | Purpose |
|---|---|---|
| `codeHover` | host→webview request handled in host? | Webview asks host for hover markdown of an element's link. |
| `codeNavigate` | webview→host (extends existing `link-open`) | Click → open definition. |
| `codeDiagnostics` | host→webview push | Host pushes diagnostic summaries to badge elements. |
| `setCodeLink` | webview/host | Attach/update `customData.codeLink` on elements. |
| `placeGeneratedGraph` | host→webview | Stamp generated (hierarchy) elements onto the canvas. |

Note: webview-initiated intelligence requests are *new* (the channel today is mostly host→webview for
commands + webview→host for `change`/`link-open`/results). We add a webview→host **request** path
(`{type:"intel", id, op, params}` → `{type:"intel-result", id, ...}`) or reuse the existing
correlation pattern in reverse. Either way it mirrors the Phase-0 design.

### 5.2 Agent tools (LM + MCP) — additive to the existing 36

| Tool | Maps to |
|---|---|
| `link_excalidraw_to_symbol` `{ids, symbol|auto}` | set `customData.codeLink` (auto = label↔symbol match) |
| `get_excalidraw_code_links` `{path?}` | read all links (the curated codebase index for agents) |
| `get_code_hover_for_element` `{id}` | router.hover |
| `navigate_to_element_code` `{id}` | router.definition → open |
| `get_linked_diagnostics` `{path?}` | router.diagnosticsFor over linked files |
| `generate_diagram_from_symbol` `{symbol, mode:"types"|"calls", depth}` | hierarchy → draw, pre-linked |
| `expand_element_relations` `{id, kind:"callers"|"implementations"|...}` | grow graph on demand |

### 5.3 Human UX (non-agent)

- Editor/title + context commands: **"Link to symbol…"** (quick-pick over workspace symbols),
  **"Visualize as Excalidraw"** (from a code symbol via type/call hierarchy).
- CodeLens on linked symbols: *"Appears in architecture.excalidraw"* → open + focus the element
  (reverse index over `customData.codeLink` across `.excalidraw` files).

## 6. Webview surfacing

- **Hover popover** — on element hover, request `codeHover`; render returned Markdown in a small
  overlay (custom React layer above the Excalidraw canvas; not Excalidraw-native).
- **Error badges** — host subscribes to `onDidChangeDiagnostics`, pushes summaries; webview overlays
  a colored badge/outline on linked elements and tooltips the messages. Implemented as an overlay
  layer keyed by element id (not by mutating elements, to avoid dirtying the document).
- **Navigation** — extend the existing `link-open`/`onLinkOpen` path to resolve `codeLink` →
  definition and open.
- **Generated graphs** — reuse `convertToExcalidrawElements` + `updateScene`; set `customData.codeLink`
  on each node so the output is immediately navigable.

## 7. Generate-from-code flow

```
symbol ──prepareCallHierarchy/prepareTypeHierarchy──► items (name,kind,uri,range)
      ──incoming/outgoing | super/sub types─────────► edges
      ──map to skeletons (rectangle/diamond + label)─► convertToExcalidrawElements
      ──set customData.codeLink per node────────────► updateScene  (pre-linked, navigable)
```

Guards: depth limit, node cap, on-demand expansion (don't render the whole graph at once).

## 8. Reliability, performance, security

- **Freshness** — `onDidRenameFiles` updates `file` hints; `onDidChangeTextDocument` marks cached
  positions dirty; links re-resolve from `symbol`. Unresolvable → `status:"stale"` (a lint signal).
- **Performance** — all intelligence round-trips the host; debounce hover/typeahead; cache resolved
  symbols per session; cap hierarchy size.
- **Security/trust** — respect the existing read-only guard; generation/edits go through the same
  command path; agent edits can be confined to a frame (collaboration conventions, proposal §5).
- **Web vs desktop** — hover/jump/diagnostics can work in both hosts; heavy indexing (reverse
  CodeLens) and debug overlay are desktop-first, consistent with the existing split.

## 9. Testing strategy

- **Router unit tests** with a stubbed `vscode.commands.executeCommand` returning canned
  Hover/Location/Diagnostic/Hierarchy payloads (pure mapping logic, no live LSP).
- **Resolution tests** — symbol→location disambiguation by kind/container/file.
- **Generate-from-code** — hierarchy fixture → expected skeleton/edge set (like the `sceneToMermaid`
  unit test already in the repo).
- **Manual E2E** in the Extension Host against a real TS project (hover, jump, error badge,
  visualize-as-Excalidraw), per the execution plan.

## 10. Background: the Language Server Protocol (LSP) and how this layer uses it

We are essentially building **LSP-like behaviour for an Excalidraw diagram** — but with a twist that
lets us avoid writing (or running) a language server at all. This section captures the LSP research
behind the design and how we map it onto our goal.

### 10.1 What LSP is (research summary)

The **Language Server Protocol** standardises how a development tool (the *client*, e.g. VS Code) and
a *language server* (e.g. the TypeScript or Python server) communicate. It exists to collapse the
"N editors × M languages" integration explosion into "N + M": each language is implemented once as a
server, and each editor speaks one protocol.

- **Transport.** JSON-RPC 2.0 messages (requests, responses, notifications) over a header + content
  framing (`Content-Length` + body). Confirmed from the spec base-protocol section.
- **Capability negotiation.** The session opens with an `initialize` request in which client and
  server exchange **capability flags** (e.g. `hoverProvider`, `definitionProvider`,
  `callHierarchyProvider`, `typeHierarchyProvider`). A feature is only available if the server
  advertised it — which is exactly why our layer must **degrade gracefully** when a result is empty.
- **Versions.** Current spec is **3.18** (under development); the prior released line is **3.17**,
  which added **type hierarchy, inlay hints, pull diagnostics, and notebook support** — several of
  which we rely on. (Sources: `microsoft.github.io/language-server-protocol`,
  `/specifications/lsp/3.18/specification/` and `/3.17/specification/`.)

### 10.2 The twist (why this is *not* a normal LSP integration)

Two twists make "an LSP for diagrams" tractable:

1. **We consume LSP capabilities indirectly, through VS Code's command façade — we never speak LSP
   ourselves.** VS Code already runs the project's language servers and re-exposes their results as
   built-in commands (`vscode.execute*Provider`, `vscode.prepare{Call,Type}Hierarchy`, …). For
   LSP-backed language extensions these commands ultimately drive the corresponding **LSP method** on
   the running server. So we inherit every installed server **in-process, with no JSON-RPC transport,
   no server lifecycle, and no per-language work** — and, as a bonus, the same façade also covers
   language features implemented *natively* (non-LSP) in VS Code, because they implement the same
   provider interfaces.
2. **We make a *visual* artifact LSP-addressable.** A diagram is not a text document and has no
   "positions." Our `customData.codeLink` (design §3) maps a **shape → a symbol → an LSP
   `TextDocumentPositionParams`** (a `(uri, position)`). Once an element resolves to a position,
   every diagram interaction becomes a *standard* language query **at that position**: hover the box
   → `hover`; click → `definition`; badge → diagnostics for that file; "expand callers" → call
   hierarchy. The diagram becomes a spatial front-end over ordinary language-server requests.

In short: **the diagram is the document, `customData.codeLink` is the cursor, and the project's
language servers are the brain — reached via VS Code's façade rather than raw LSP.**

### 10.3 LSP method → VS Code façade → our feature

The "API provided by LSP" we depend on, and how each is reached and used:

| LSP method (spec) | VS Code façade command | How we use it |
|---|---|---|
| `textDocument/hover` | `executeHoverProvider` | Hover popover with real docs/signature |
| `textDocument/definition` | `executeDefinitionProvider` | Click → jump to code |
| `textDocument/typeDefinition` | `executeTypeDefinitionProvider` | Navigate to a type |
| `textDocument/implementation` | `executeImplementationProvider` | "implementations" badge / expand |
| `textDocument/references` | `executeReferenceProvider` | "callers" count / expand graph |
| `workspace/symbol` | `executeWorkspaceSymbolProvider` | Resolve a `codeLink.symbol`; link picker |
| `textDocument/documentSymbol` | `executeDocumentSymbolProvider` | Insert members as nodes |
| `textDocument/signatureHelp` | `executeSignatureHelpProvider` | Fill method signatures |
| `textDocument/completion` (+ `completionItem/resolve`) | `executeCompletionItemProvider` | (stretch) autocomplete names |
| `textDocument/publishDiagnostics` (push) / `textDocument/diagnostic` (pull, 3.17) | `languages.getDiagnostics` + `onDidChangeDiagnostics` | Live error/warning badges |
| `textDocument/prepareCallHierarchy`, `callHierarchy/incomingCalls`, `callHierarchy/outgoingCalls` | `vscode.prepareCallHierarchy`, `vscode.provideIncomingCalls`, `vscode.provideOutgoingCalls` | Generate call-graph diagrams; expand callers/callees |
| `textDocument/prepareTypeHierarchy`, `typeHierarchy/supertypes`, `typeHierarchy/subtypes` (3.17) | `vscode.prepareTypeHierarchy`, `vscode.provideSupertypes`, `vscode.provideSubtypes` | Generate inheritance diagrams |
| `textDocument/codeLens` | `executeCodeLensProvider` | Metric badges on elements |
| `textDocument/inlayHint` (3.17) | `executeInlayHintProvider` | (niche) inline inferred types |
| `textDocument/rename` / `textDocument/prepareRename` | `executeDocumentRenameProvider` | Propagate code renames to labels |
| `textDocument/documentLink` | `executeLinkProvider` | Resolve embedded links |
| workspace file ops (`workspace/didRenameFiles`, watched-file events) | `workspace.onDidRenameFiles`, `onDidChangeTextDocument` | Keep `codeLink` fresh; mark stale |

`CallHierarchyItem` / `TypeHierarchyItem` carry `{ name, kind, uri, range, selectionRange }` — exactly
enough to emit a pre-linked diagram node (design §7).

### 10.4 Why the façade instead of speaking LSP directly

- **No transport/lifecycle.** We don't spawn, initialize, or shut down servers, or implement
  JSON-RPC framing — VS Code owns that.
- **Respects the user's toolchain.** Whatever server the user has configured (and its `initialize`
  capabilities) is what we query; no version skew with our own client.
- **Broader than LSP.** Native VS Code providers (not all languages use LSP) are covered by the same
  commands for free.

**Honest caveats (LSP-specific):**
- The façade **flattens** some LSP richness (e.g. partial results, resolve round-trips, work-done
  progress) — acceptable for our read-mostly features.
- **Result quality follows server capabilities** advertised at `initialize`; a server without
  `typeHierarchyProvider` simply yields nothing → we hide that affordance. Quality varies (TS/Python
  rich; smaller servers thinner).
- If we ever need a capability VS Code does **not** surface as a command, the fallback is to speak LSP
  directly via `vscode-languageclient` against a server we manage — but that reintroduces lifecycle
  and is explicitly **out of scope** for this proposal.

### 10.5 References

- LSP overview & base protocol: <https://microsoft.github.io/language-server-protocol/>
- Current spec (3.18, draft): <https://microsoft.github.io/language-server-protocol/specifications/lsp/3.18/specification/>
- Prior release (3.17): <https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/>
- VS Code built-in commands (the façade): VS Code API "Commands" / "executeXxxProvider".

---

## 11. Edge / relationship convention (arrows are relationships)

If two nodes carry `customData.codeLink`, an **arrow between them is a relationship between two
symbols (A → B)** — and a language server can usually compute *where that relationship physically
lives* in the code. So edges are first-class: hover summarises the relationship, click jumps to the
**concrete site** (not merely a definition).

### 11.1 Direction convention

**`A → B` means "A depends on / uses / calls / inherits B"** (source touches target). Resolution and
navigation therefore land **in A**, at the place where it references B. The two endpoint symbols are
derived from the arrow's **bound endpoints' `codeLink`s** — the arrow itself needs no metadata to be
resolvable.

### 11.2 Relationship kinds → LSP source → behaviour

| Arrow meaning | LSP / VS Code source | Concrete site(s) | Click ("go to relationship") | Hover |
|---|---|---|---|---|
| **calls** (A invokes B) | `prepareCallHierarchy(A)` + `provideOutgoingCalls(A)` (or `provideIncomingCalls(B)`) → `fromRanges` | call sites **inside A** | jump to the call site; **peek** all if many | "A calls B — N call sites" |
| **references / uses** (type use, field, `new B`) | `executeReferenceProvider(B)` filtered to A's file/range | usages of B inside A | jump / peek | "N references in A" |
| **inherits / extends / implements** (A ⟶ B) | `prepareTypeHierarchy(A)` → supertypes ∋ B | A's `extends`/`implements B` clause | jump to A's declaration | "A extends/implements B" |
| **contains / has-a** (A has a field of type B) | `executeDocumentSymbolProvider(A)` + field type | the field declaration in A | jump to field | "A.field: B" |
| **association / data-flow / conceptual** (hand-drawn intent) | none | — | no precise anchor → focus both endpoints / no-op | "conceptual (no code anchor)" |

### 11.3 Click mechanism (the "calls" case)

1. `vscode.prepareCallHierarchy(uriOfA, posOfA)` → item A.
2. `vscode.provideOutgoingCalls(A)` → entries `{ to, fromRanges }`; pick the entry whose `to` is B —
   its `fromRanges` are the exact call-site ranges inside A.
3. **1 site** → open it. **Many** → `editor.action.showReferences(uriOfA, posOfA, fromRanges)` opens
   VS Code's peek UI scoped to just the A→B sites.

References and type-hierarchy kinds follow the same probe → resolve → (open | peek) shape.

### 11.4 Declared vs. derived edges, and the diagram linter

- **Derived edges** (generated from call/type hierarchy in §7) are **guaranteed concrete** — clicking
  always lands on a real site.
- **Hand-drawn edges** may be **conceptual or transitive**. Example from `examples/code-aware-demo.excalidraw`:
  the arrow `ExcalidrawEditor → resolveSymbol` has **no direct call site** — `ExcalidrawEditor` calls
  `hoverMarkdown`/`navigateToLink`, which call `resolveSymbol`. The relationship is real but *indirect*.
  When no direct site is found we **must not fail silently**:
  - Report: *"No direct call/reference from A to B — this arrow may be conceptual or transitive."*
  - Optionally **path-find**: BFS over call hierarchy up to depth N (A → … → B) and peek the first hop
    (opt-in; depth-capped to avoid blow-up).
  - This doubles as a **diagram linter**: an arrow asserting a relationship the code doesn't have is
    flagged `unverified`/`stale` — directly realising the proposal's "diagrams stay honest" value.

### 11.5 Optional edge metadata (`arrow.customData.relation`)

Arrows are resolvable from their endpoints, so metadata is optional. Add it to **declare intent**,
support **unbound** arrows, and **cache** verification:

```ts
interface EdgeRelation {
  kind?: "calls" | "references" | "inherits" | "implements" | "contains" | "association";
  verified?: boolean;        // last probe found a concrete site
  lastChecked?: string;      // ISO timestamp
  // optional explicit endpoints if not derivable from bound elements:
  from?: string; to?: string; // symbol names
}
// stored at: arrowElement.customData.relation
```

When `kind` is declared, we **verify against it** (declared "inherits" but code shows only "calls" →
flag mismatch). The auto-detected kind may also be written as the arrow's label ("calls", "extends").

### 11.6 Behaviour summary

- **Hover arrow** → derive A,B from bound endpoints; probe most-specific kind first
  (inherits > calls > references); show kind + count + **verified/unverified** badge + first-site preview.
- **Click arrow** → jump to concrete site; **peek** if multiple; else show the conceptual/transitive
  message (with optional path-finding).
- **Select arrow** → same panel, pinned, with only the applicable actions: *Go to call sites* /
  *Find references* / *Show inheritance*.
- All operations are **read-only / derive-only** — no Excalidraw mode interference.

### 11.7 Limitations

- **Endpoints must be linked** — an arrow between two unlinked boxes has nothing to resolve.
- **`fromRanges` fidelity varies by language server** (TS rich; some thinner) — degrade to plain
  references.
- **Thin-target hit-testing** — selecting an arrow (via `onChange`) is more reliable than bbox hover
  for diagonal arrows; use point-proximity, not just bounding box.
- **Transitive path-finding can explode** — depth-capped and opt-in.

---

## 12. Open questions

- Webview hover overlay vs. a side panel (Webview view) for richer Markdown/actions?
- Badge rendering as an overlay layer vs. element styling (overlay preferred to avoid dirtying).
- Auto-link aggressiveness (label↔symbol) — opt-in suggestion vs. automatic?
- Multi-root workspaces and monorepos — symbol disambiguation strategy.
- How much of this should be agent-only vs. also first-class human UI in v1.
