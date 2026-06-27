# Proposal: Code-Aware Diagrams (Diagram ↔ Code Intelligence)

| | |
|---|---|
| **Status** | Draft / for discussion |
| **Author** | @georgreen |
| **Date** | 2026-06-25 |
| **Area** | excalidraw-vscode extension (agent tools + webview) |
| **Related** | `examples/EXCALIDRAW_AGENT_TOOLS_CHANGELOG.md`, host↔webview command channel (`src/protocol.ts`) |

## TL;DR

Let an Excalidraw diagram be *linked to the code it depicts* and made "intelligent" by
**reusing the project's already-running language servers** — no new LSP to build. Boxes that
represent classes/functions get hover docs, jump-to-code, live error badges, and can be
**generated from** code structure (type/call hierarchy). The diagram becomes a living, navigable
map of the codebase instead of a screenshot that rots.

---

## 1. Current State

**The extension today.** `excalidraw-vscode` renders Excalidraw inside a VS Code custom editor
(`.excalidraw[.json|.svg|.png]`). A webview (React + Excalidraw) talks to the extension host over a
request/response command channel. We have shipped a large suite of agent/Language-Model tools and an
MCP bridge that let agents read and draw on the canvas. Two primitives already relevant here:

- **Elements carry metadata.** Every Excalidraw element has `customData?: Record<string, any>` and a
  `link: string | null` (verified in `@excalidraw/excalidraw` element types). Both persist through
  `serializeAsJSON` and the PNG/SVG scene embed — so per-element code links can be stored in the file
  with **no schema change**.
- **Diagram→file navigation half-exists.** The webview already emits a `link-open` message and the
  host's `openLink` (`src/editor.ts`) resolves file URIs and opens them in the editor.

**What's missing.** Diagrams are inert. A box labelled `OrderService` has no relationship to the
real `OrderService` class. There is no hover, no navigation, no awareness of whether the depicted
code compiles, and no way to derive a diagram from existing code. The picture and the code drift
apart the moment either changes.

**Platform capabilities we can build on (validated against `@types/vscode`).** VS Code exposes the
active language servers to extensions through `vscode.execute*Provider` commands and namespace APIs.
The host can call them; the sandboxed webview reaches them through the existing command channel.

| Need | Validated API |
|---|---|
| Hover documentation | `executeHoverProvider` → `Hover.contents` (Markdown) |
| Jump to definition / find symbol | `executeDefinitionProvider`, `executeWorkspaceSymbolProvider` |
| Live errors/warnings per file | `languages.getDiagnostics(uri)` + `onDidChangeDiagnostics` |
| References / implementations count | `executeReferenceProvider`, `executeImplementationProvider` |
| Members + signatures | `executeDocumentSymbolProvider`, `executeSignatureHelpProvider` |
| Inheritance graph | `prepareTypeHierarchy` → supertypes / subtypes |
| Call graph | `prepareCallHierarchy` → incoming / outgoing calls |
| Live execution position | `debug.activeStackItem` + `onDidChangeActiveStackItem` |
| Breakpoints from the diagram | `debug.breakpoints`, `addBreakpoints`, `onDidChangeBreakpoints` |
| Keep links fresh on refactor | `workspace.onDidRenameFiles`, `onDidChangeTextDocument` |

> Note: VS Code's **Test API** (`tests.createTestController`) is *provider-side only* — there is no
> public API to read another extension's test results — so "test pass/fail on a node" is **not**
> cleanly supported and is out of scope.

---

## 2. Problem Statement

Developers think in boxes-and-arrows and frequently sketch models, relationships, and flows while
designing or reading code. But those sketches are **disconnected artifacts**:

1. **Diagram rot.** A diagram is true only at the moment it is drawn. Code changes; the picture
   doesn't. Teams stop trusting (and then stop drawing) diagrams.
2. **No navigation.** You cannot use the picture to move through the code — there's no "click the box,
   land on the class," no hover to recall a signature.
3. **Manual, error-prone authoring.** Names and types in diagrams are typed by hand and silently go
   stale or wrong.
4. **No feedback loop.** A diagram cannot tell you that a depicted component currently fails to
   compile, has no implementations, or was renamed away.
5. **Redrawing what the compiler already knows.** Inheritance and call graphs are computed by the
   language server, yet developers re-draw them by hand.

The underlying problem: **there is no living link between a freeform diagram and the code it
represents.**

---

## 3. Value Proposition (if solved)

If a diagram is linked to code and backed by the running language servers:

- **Diagrams stay honest.** Links are verifiable; stale ones surface as warnings — the diagram
  becomes a lint target, not decaying documentation.
- **Navigate the codebase as a picture.** Click a box → land on the symbol; hover → real docs/types;
  expand → "who calls this?" grows the map.
- **Design and implementation converge.** Sketch the model, link as you implement, and the gap
  between intent and reality becomes measurable.
- **Faster onboarding.** A living, navigable architecture map beats a static PNG in a wiki.
- **A health dashboard.** Components with current errors glow on the map; debugging animates across it.
- **Less manual drawing.** "Visualize this class as Excalidraw" emits a pre-linked diagram from the
  language server's own graph.

In short: the diagram graduates from *decoration* to a **first-class, trustworthy view of the code.**

---

## 4. Value Proposition for Agents

This extension already exposes a large suite of agent / Language-Model tools (and an MCP bridge) for
reading and drawing on the canvas. The code-aware layer compounds their value. "Agents can draw" is
not itself the point — the value is in the *jobs* a canvas does for an agent.

**Core: a diagram is an agent's spatial working memory.** LLMs reason in linear text and lose
structural state across turns. A canvas is a persistent, spatial, **re-readable** workspace where
position and grouping encode relationships cheaply. Critically it is **bidirectional** —
`get_excalidraw_scene` / `get_excalidraw_mermaid` let the agent read back what it (or the human) drew,
so it can *perceive and revise* its own externalized reasoning rather than just emit pixels.

Agent-specific value:

- **Externalize & verify a plan/model.** Lay out an architecture, state machine, data model, or
  migration as boxes-and-arrows, then re-read it to check consistency before/while coding. Structure
  it can *inspect* beats structure buried in prose.
- **Work in its strong modality.** Agents are fluent in Mermaid; `draw_from_mermaid` ↔
  `get_excalidraw_mermaid` bridge text↔visual, so the agent thinks in Mermaid while the human gets a
  real, editable diagram.
- **The diagram is the deliverable.** Sometimes the user wants the picture (onboarding map, RFC
  figure); the agent produces an editable artifact, not a static screenshot.

**The code-aware layer is the multiplier — it turns drawing into *grounding*:**

- **Human-curated codebase index.** `customData.codeLink` makes "which box = which symbol"
  machine-readable — the human's mental model of the repo, handed to the agent as high-signal context
  it cannot easily reconstruct from raw files.
- **Verifiable, non-hallucinated structure.** An agent generating a class/call diagram from
  `prepareTypeHierarchy` / `prepareCallHierarchy` draws the language server's *truth*; the links make
  the output checkable rather than guessed.
- **A navigable spec.** The agent proposes a design as a linked diagram (nodes may reference
  not-yet-existing symbols), implements against it, and navigates back. The picture becomes an
  executable plan.

**Where it is *not* worth it (honest).** For a focused single-file edit a diagram is overhead; value
concentrates in **design, comprehension, communication, and planning** tasks. The canvas must be open
for live tools, and reading a large scene as JSON is token-heavy (the Mermaid view mitigates this).
Agents already reason well in text — the marginal value appears when **spatial/relational** structure
or **human visual handoff** matters.

---

## 5. Collaborative Space (Human ↔ Agent)

The same layer can serve as a **shared workspace** for humans and agents — and mechanically it largely
already is one. Both parties act on the **same live document**: the agent edits via
`sendCommand → updateScene` (which re-renders the user's open canvas immediately, kept alive by
`retainContextWhenHidden`), and the user's edits are read back by the agent via `get_excalidraw_scene`
/ `get_excalidraw_selection` / `get_excalidraw_mermaid`. With `customData` for tagging and the MCP
bridge for multiple participants, the gap is **coordination, not capability**.

### 5.1 Modes of collaboration

1. **Live illustration** — the agent maintains the diagram in real time as the user talks; the user
   tweaks layout; the agent re-reads it.
2. **Co-design / planning** — user sketches rough boxes, agent fills structure/labels/connectors,
   user rearranges, agent reads the new grouping as intent.
3. **Pointing / deixis via selection** — the user selects a box; the agent reads
   `get_excalidraw_selection` → "do X to *that*." Selection becomes a shared focus pointer.
4. **Propose → review → apply** — the agent draws proposals in a distinct style/area; the user
   approves/rejects; the agent implements approved parts.
5. **Multi-agent blackboard (MCP)** — several agents plus the user contribute to one canvas.

### 5.2 Conventions that work with today's shipped tools

- **Region ownership via frames** — give the agent its own `frame` ("Agent scratch" / "Proposals") so
  it never overwrites the user's area.
- **Authorship & status in `customData`** — tag `{ author: "agent", status: "proposed", ts }` and
  render proposals in a distinct color (`style_excalidraw_elements`); the user accepts by promoting /
  the agent promotes on confirmation.
- **Awareness signals** — `setToast` ("Agent updated the Payment flow"),
  `scroll_to_excalidraw_content` to direct attention, `select_excalidraw_elements` to "point" at a
  change.
- **Comments as elements** — text notes (or `customData` threads) for back-and-forth and
  `@user`/`@agent` handoff.
- **Read-only respect** — the existing guard already blocks mutation of view-only documents.

### 5.3 Why the code-aware layer makes collaboration *precise*

Once boxes link to symbols, the diagram becomes a **shared, code-anchored vocabulary**: "the
`OrderService` box" means the *same anchored object* to the human, the agent, and other agents.
The user selects a linked box and the agent acts on real code; the agent generates a diagram from the
LSP and the user's regrouping/annotation becomes design intent grounded in real symbols. Without this,
collaboration is over an ambiguous picture; with it, it is over a **common model** — the differentiator
versus a plain shared whiteboard.

### 5.4 What is still missing for first-class collaboration

- **Push events to the agent.** Today the agent learns of user edits by polling (`get_scene`) or on
  its turn — there is no "notify the agent when the canvas changed." The webview→host `change` signal
  exists but routing it to an idle agent needs new plumbing (a `wait_for_canvas_change` /
  subscription tool).
- **Concurrency / conflict handling.** `updateScene` replaces elements, so simultaneous edits to the
  *same* element can clobber; we are **not** using Excalidraw's real-time collab/CRDT server. Fine for
  turn-ish co-editing, risky for true simultaneous edits. Frames-as-ownership + `lock_excalidraw_elements`
  mitigate.
- **Presence / cursors.** No live "agent is here" cursor (Excalidraw's collaborator cursors aren't
  wired up); approximated via select/toast/scroll.
- **Provenance / reviewable changesets** of agent actions, and **cost/latency** of re-reading large
  scenes (desktop-only for multi-agent).

These gaps are additive and non-blocking: the canvas is usable as a human↔agent collaborative space
today with conventions, and the high-value additions are **event-driven awareness** and **soft
concurrency**.

---

## 6. Potential Solution

A **"diagram code-intelligence" layer** with three parts, all riding infrastructure we already have:

1. **Linking model (metadata).** Store a code link in each element's `customData`, e.g.
   `customData.codeLink = { kind: "class", symbol: "OrderService", file?: "src/order.ts", lastResolved }`.
   Links are created explicitly ("Link to symbol…", a quick-pick backed by
   `executeWorkspaceSymbolProvider`) or auto-suggested when a shape's label matches a workspace symbol.
2. **Intelligence router (host).** A thin host module that, given an element's `codeLink`, resolves it
   to a `(uri, position)` and **delegates to the running language server** via the `execute*Provider`
   commands — for hover, definition, references, diagnostics, hierarchy, etc. We build *no* language
   server; we route to the ones already serving the project.
3. **Webview surfacing.** The webview requests intelligence over the existing command channel and
   renders results: hover popovers, error badges, click-to-navigate, and "generate diagram" output
   drawn with the tools we already ship (`add_elements`, `connect_elements`, `draw_from_mermaid`).

Because the **host↔webview command channel**, the **per-element metadata fields**, and the
**drawing tools** already exist, this is mostly *new host resolver functions + webview affordances*,
not new architecture.

---

## 7. How the Solution Looks in Detail

### 7.1 Data flow

```
Excalidraw element                Host "intelligence router"      Project's running
customData.codeLink=OrderService  (no LSP of its own)             language server
   │  hover/click/diagnostics ──sendCommand──► resolve symbol ──executeWorkspaceSymbolProvider──► Location
   │                                           hover at loc   ──executeHoverProvider────────────► Markdown
   │                                           errors         ──languages.getDiagnostics(uri)───► Diagnostic[]
   ◄──── command-result (hover md / location / error count / generated nodes) ───┘
   render popover / badge / open file / draw graph
```

### 7.2 Feature set (phased)

**Phase 1 — Read & navigate (low risk, all validated):**
- Link an element to a symbol (quick-pick) and auto-suggest links by label↔symbol match.
- Click → `executeDefinitionProvider` → open the symbol.
- Hover → `executeHoverProvider` → render the language server's Markdown.
- **Error visualization** → `getDiagnostics` + `onDidChangeDiagnostics` → badge linked elements with
  error/warning counts and tooltips, live.

**Phase 2 — Generate & enrich:**
- **Visualize from code:** right-click a class/function → emit an Excalidraw diagram from
  `prepareTypeHierarchy` (inheritance) or `prepareCallHierarchy` (calls), pre-linked.
- Reference/implementation **count badges** ("12 callers", "3 implementations").
- **Expand on demand:** "show callers/implementations" grows the diagram with new linked nodes+arrows.
- Insert a class's **members with real signatures** (`executeDocumentSymbolProvider` + signature help).
- **Link freshness:** `onDidRenameFiles` / `onDidChangeTextDocument` re-resolve or mark links stale.

**Phase 3 — Debug overlay:**
- Highlight the element for the **currently-executing** frame (`activeStackItem` +
  `onDidChangeActiveStackItem`) as you step.
- Set/clear breakpoints by clicking a diagram node (`addBreakpoints`).

### 7.3 Pros

- **Reuses the project's real language servers** — inherits TS, Python, Rust, Go, … for free; no
  parser/LSP to maintain.
- **Rides existing infrastructure** — command channel, metadata fields, drawing tools, dual host all
  already shipped.
- **No file-format change** — links live in `customData`, which already persists.
- **Incremental & low-risk** — Phase 1 is small and independently valuable; later phases layer on.
- **Novel combination** — freeform sketches + live code intelligence + local/offline + open source.
- **Agent synergy** — the agent tools can both *create* links and *consume* intelligence.

### 7.4 Cons / Risks

- **All cross-process via the host.** The webview can't call `vscode.*`; everything round-trips
  through the channel — fine for hover/click/diagnostics, but per-keystroke features need debouncing.
- **No native completion UI in Excalidraw.** Inline "type-ahead inside a shape" is hard; realistic
  MVP is command/quick-pick driven, with inline autocomplete a stretch goal needing custom overlay UI.
- **Provider quality varies by language.** Rich for TS/Python, thinner for smaller servers; must
  degrade gracefully.
- **Mapping fragility.** Refactors/renames break links; mitigated by storing a *re-resolvable* symbol
  name plus rename-event handling. (Stale detection is itself a feature.)
- **Graph blow-up.** Hierarchy generation can explode on large codebases; needs depth limits and
  on-demand expansion.
- **Desktop-first.** Indexing/debug pieces won't run in the web extension host (consistent with the
  existing web/node split). Hover/jump/diagnostics can work in both.
- **Test results genuinely unsupported** by public API — must not be promised.

---

## 8. Existing Solutions

- **Diagrams-as-code (Mermaid, PlantUML, Structurizr/C4).** Text → rendered diagram. Versionable and
  somewhat in-sync with intent, but **not freeform**, **not linked** to live symbols, and offer no
  hover/jump/error feedback. (We already convert Mermaid↔Excalidraw, but that's content, not linkage.)
- **IDE auto-UML (IntelliJ Diagrams, Visual Studio Class Designer / Code Map).** Auto-generate class
  diagrams with navigation — closest on *navigation*, but **auto-only and rigid**: you can't hand-sketch
  a mental model and link it, they're IDE-locked (JetBrains/VS), and the layout isn't a freeform
  whiteboard.
- **CodeSee (code maps linked to code).** The closest prior art — cloud code maps that link to source.
  But it was **SaaS, auto-generated, and is now effectively defunct/absorbed**, leaving an open,
  local, sketch-first niche unfilled.
- **VS Code built-in Call/Type Hierarchy views.** Provide the *data* we'd visualize, but only as
  **text tree views** — not a spatial, editable, shareable diagram.
- **draw.io / diagrams.net VS Code extension.** Freeform diagrams in the editor, but **zero code
  awareness**.
- **Sourcegraph / code-nav tools.** Great navigation, but text/list-oriented, not diagram-centric.

**Gap:** nobody combines *freeform, hand-drawn diagrams* with *live code intelligence sourced from
the existing language servers*, locally and open-source. That intersection is the opportunity.

---

## 9. Is the Problem Worth Solving?

**Yes — qualified.** Arguments:

**For:**
- Diagram rot and the design↔code gap are real, universal, and currently unsolved for *freeform*
  diagrams.
- The technical risk is low: every dependency is a **validated, stable VS Code API**, and the heavy
  lifting (rendering, metadata, channel, drawing tools) is **already built** in this extension.
- A small Phase 1 (link + hover + jump + error badges) is independently shippable and immediately
  useful — fast path to validating demand.
- The closest competitor (CodeSee) is gone, and IDE UML tools are auto/rigid — there's a clear,
  differentiated niche (freeform + live + local + open).
- Strong synergy with this project's existing agent/MCP direction.

**Against / to watch:**
- The "wow" features (inline autocomplete, debug animation) are the hardest; value must be proven by
  the cheaper read/navigate features first.
- Adoption depends on the linking step being nearly effortless (auto-suggest is essential, not
  optional).
- Maintenance surface grows with each language's quirks, though delegation limits this.

**Recommendation:** Proceed with a **Phase 1 spike** — prove `executeHoverProvider` + `getDiagnostics`
round-tripping into the webview on a single linked element. If the round-trip and UX feel right, the
rest of the design is low-risk layering. If the linking friction is too high or provider results too
thin, we learn that cheaply before investing in generation and debug overlays.

---

## Appendix: Smallest viable proof (spike)

1. Add `customData.codeLink` to one element via a temporary "Link to symbol…" command (quick-pick over
   `executeWorkspaceSymbolProvider`).
2. On element hover (webview) → `sendCommand("codeHover", {symbol})` → host resolves symbol →
   `executeHoverProvider` → return Markdown → render in a webview popover.
3. Subscribe to `onDidChangeDiagnostics`; when the linked file has errors, badge the element.
4. Click → `executeDefinitionProvider` → open the file at the symbol.

If steps 2–4 work, the entire proposal is validated end-to-end.
