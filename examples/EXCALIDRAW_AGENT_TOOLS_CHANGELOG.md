# Excalidraw Agent Tools — Changelog & QA Notes

**Audience:** QA / testers verifying the agent integration.
**Companion doc:** `EXCALIDRAW_MCP_TOOL_TEST_REPORT.md` (the previous 24/24 functional report).
**Scope of this doc:** what exists, what changed since that report, and what still needs verifying.

---

## How to build & run

> Build with **Node 22** (Node 25 crashes esbuild). The root `npm run build` is flaky;
> run the two steps separately.

```bash
cd webview && npm run build      # builds webview/dist (Node 22)
cd ..      && npx webpack --mode development   # builds dist/extension.js (web) + dist/node/extension.js (node)
```

- **Web/in-editor tools** (Language Model tools): press **F5** ("Launch extension"). Open Copilot
  **agent mode** and drive the tools.
- **MCP bridge** (external agents): this is **desktop-only** and the default F5 config launches the
  **web** host. To test MCP, launch a **desktop** Extension Host (run the extension without
  `--extensionDevelopmentKind=web`) and set `"excalidraw.mcp.enabled": true`.

---

## What changed since the last QA report

### 1. Fixed — `draw_from_mermaid` timed out unless the editor was focused (High)
- **Root cause:** hidden VS Code webviews pause `requestAnimationFrame`; Mermaid rendering depends
  on it, so the conversion stalled when the target editor was in a background tab.
- **Fix:** the tool now **reveals** the target editor (preserve-focus) and waits briefly for
  rendering to resume before converting, plus a longer (30s) timeout.
- **Re-test:** create a diagram, switch focus to another tab, then run `draw_from_mermaid` against
  the first diagram by `path` — it should succeed without manually focusing it. Also test
  create-then-mermaid on the same path in one go.

### 2. Changed — all tools now return **machine-readable JSON**
- Previously most tools returned prose ("Added 7 element(s). ids: …"). They now return
  `{"ok":true, ...}` JSON. Example: `get_excalidraw_scene` → `{"ok":true,"elements":[…],"count":N}`.
- This now includes the **file tools** too (addressed after the re-test flagged them):
  `create_excalidraw_diagram` → `{"ok":true,"path","created":true,"opened":true}`,
  `open_excalidraw_diagram` → `{"ok":true,"path","opened":true,"toSide":bool}`,
  `list_excalidraw_diagrams` → `{"ok":true,"diagrams":[…],"count":N}`.
- **Re-test:** confirm each tool's result is valid JSON with `ok:true` and the documented fields.

### 3. Changed — id transparency for authoring tools (report observations #2/#3)
- `add_excalidraw_elements`, `connect_excalidraw_elements`, `set_excalidraw_scene`,
  `add_excalidraw_image`, `draw_from_mermaid` now return an `elements` array where each entry is
  `{ id, type, containerId?, boundTextId? }`.
- A **labeled shape** reports its auto-created label via `boundTextId`; the label element reports
  its `containerId`. This lets you tell shape ids from label ids.
- **Re-test:** add a labeled rectangle; confirm the response distinguishes the rectangle id from
  its label id.

### 4. New — MCP bridge for external agents (NOT yet live-tested)
- The desktop extension host can run a localhost, token-protected **MCP HTTP server** on startup,
  exposing the same tools to external agents (Copilot CLI, Claude, Cursor, Zed…).
- Enable: `"excalidraw.mcp.enabled": true`. On startup it writes
  `~/.excalidraw-vscode/mcp.json` → `{ url, port, token }`. Point an `http`-type MCP client at
  `url` with header `Authorization: Bearer <token>`.
- Logs to the **Excalidraw MCP** output channel. `excalidraw.mcp.port` pins a port (default 0 = auto).
- **Status:** SDK usage was smoke-tested in isolation (initialize/tools/list/tools/call round-trip
  works), but the **end-to-end connection from a real external agent has not been verified**.
- **To test:**
  1. Desktop host + `excalidraw.mcp.enabled: true`; confirm `~/.excalidraw-vscode/mcp.json` appears
     and the output channel logs the URL.
  2. `curl http://127.0.0.1:<port>/health` → `ok`.
  3. Configure Copilot CLI (or another MCP client) with the http URL + bearer token; list tools and
     call e.g. `list_excalidraw_diagrams`, then `create_excalidraw_diagram` + `add_excalidraw_elements`.
  4. Verify auth: a request without the token returns 401.

### 5. New — read the whole canvas as Mermaid (`get_excalidraw_mermaid`)
- Converts the live scene into a Mermaid `flowchart` so the model can "see" the diagram as text.
  Shape fidelity mirrors `@excalidraw/mermaid-to-excalidraw` (inverted): rectangle `[..]`, rounded
  rectangle `(..)`, ellipse `((..))`, diamond `{..}`; edge styles preserved (`-->`, `-.->` dashed,
  `==>` thick); **frames become `subgraph` blocks** containing their member nodes. Returns
  `{ ok, mermaid, nodeCount, edgeCount, subgraphCount }`.
- Best for graph/flowchart-like diagrams; freedraw, images, and text not connected by arrows are
  not represented. Round-trips conceptually with `draw_from_mermaid`.
- **Re-test:** build connected labeled shapes (incl. a rounded rect, a dashed/thick arrow, and a
  frame around some shapes); call `get_excalidraw_mermaid`; confirm shapes, edge styles, and the
  subgraph block render correctly; an empty canvas returns a `%%` placeholder.

---

## Full tool catalog (25 tools)

All canvas tools take an optional `path` (workspace-relative or absolute); if omitted, the
**active** Excalidraw editor is used. Canvas tools require an editor to be open (auto-opened when a
`path` is given) and are blocked on read-only docs (git diff views).

### File tools
| Tool | Inputs | Purpose |
|---|---|---|
| `create_excalidraw_diagram` | `path*`, `content?`, `overwrite?` | Create a `.excalidraw[.json/.svg/.png]` file (optionally seeded with scene JSON) and open it. |
| `open_excalidraw_diagram` | `path*`, `toSide?` | Open an existing diagram. |
| `list_excalidraw_diagrams` | `path?` | List diagrams in the workspace. |

### Read tools
| Tool | Inputs | Returns |
|---|---|---|
| `get_excalidraw_scene` | `path?` | `{ elements, count }` |
| `get_excalidraw_selection` | `path?` | `{ selectedElementIds }` |
| `get_excalidraw_appstate` | `path?` | viewport, zoom, theme, default colors |
| `get_excalidraw_mermaid` | `path?` | `{ mermaid, nodeCount, edgeCount, subgraphCount }` — canvas as a Mermaid flowchart (rounded/ellipse/diamond shapes, dashed/thick edges, frames→subgraphs) |
| `get_excalidraw_mermaid` | `path?` | `{ mermaid, nodeCount, edgeCount }` — whole canvas as a Mermaid flowchart (shapes→nodes, bound arrows→edges) so the model can read the diagram as text. Graph-like diagrams only. |

### Authoring tools
| Tool | Inputs | Notes |
|---|---|---|
| `add_excalidraw_elements` | `path?`, `elements*` | Skeletons: rectangle/ellipse/diamond (+`label`), text, line, arrow (+`start`/`end` bindings, `label`), image (`fileId`), frame (`children`). Returns `ids`, `added`, `elements`. |
| `connect_excalidraw_elements` | `path?`, `startId*`, `endId*`, `label?` | Bound arrow between two elements. |
| `update_excalidraw_elements` | `path?`, `updates*` | Array of `{ id, ...changes }` (move/resize/rotate/restyle/re-text). |
| `delete_excalidraw_elements` | `path?`, `ids*` | Delete by id. |
| `set_excalidraw_scene` | `path?`, `elements*` | Replace whole canvas (destructive). |
| `clear_excalidraw_canvas` | `path?` | Empty the canvas. |

### Selection / viewport
| Tool | Inputs |
|---|---|
| `select_excalidraw_elements` | `path?`, `ids*` |
| `scroll_to_excalidraw_content` | `path?`, `ids?` |

### Styling / layout
| Tool | Inputs |
|---|---|
| `style_excalidraw_elements` | `path?`, `ids*`, `style*` (strokeColor, backgroundColor, fillStyle, strokeWidth, opacity, fontSize…) |
| `group_excalidraw_elements` | `path?`, `ids*` |
| `ungroup_excalidraw_elements` | `path?`, `ids*` |
| `frame_excalidraw_elements` | `path?`, `ids*`, `name?` |
| `align_excalidraw_elements` | `path?`, `ids*`, `align*` (left/right/centerX/top/bottom/centerY) |

### Images / library
| Tool | Inputs |
|---|---|
| `add_excalidraw_image` | `path?`, `imagePath*`, `x?`, `y?`, `width?`, `height?` |
| `add_excalidraw_library_items` | `library*` (.excalidrawlib JSON) |

### Convenience
| Tool | Inputs |
|---|---|
| `draw_from_mermaid` | `path?`, `mermaid*` |
| `set_excalidraw_tool` | `path?`, `tool*` (selection/rectangle/ellipse/diamond/arrow/line/text/freedraw/image/eraser) |

`*` = required.

---

## Suggested regression checklist (the changed/new bits)
- [ ] `draw_from_mermaid` against a **background** (unfocused) editor by `path` → succeeds.
- [ ] `create_excalidraw_diagram` immediately followed by `draw_from_mermaid` on the same path → succeeds.
- [ ] Every tool returns valid JSON with `ok:true`.
- [ ] `add_excalidraw_elements` with a labeled shape → response separates shape id vs `boundTextId`.
- [ ] MCP: discovery file written, `/health` returns `ok`, external client lists & calls tools, 401 without token.
- [ ] Web host (vscode.dev) still loads and the in-editor LM tools work (MCP absent there, by design).

---

## Known notes / non-bugs
- Labeled shapes expand element counts (each `label` is a separate bound text element) — now made
  explicit via `boundTextId`.
- Shape dimensions can grow to fit a bound label (e.g. a diamond height auto-expands); this is
  intrinsic Excalidraw behavior. Authoring tools now return each created element's final
  `x/y/width/height` so the actual size is visible — read it back to place adjacent elements.
- The MCP bridge is **desktop-only**; the web extension host cannot open a server.
- Engine requires VS Code **1.95+** (Language Model Tools API). The MCP server **definition
  provider** only activates on VS Code versions that support that newer API; otherwise it is a
  no-op (external clients still use the discovery file).

---

## Addendum — 2026-06-20 (post re-test changes)

This batch lands after `EXCALIDRAW_RETEST_REPORT.md`. New/changed items below, each with focused
test steps. Total tool count is now **25** (added `get_excalidraw_mermaid`).

### A. Fixed — file tools now return JSON (re-test deviation #A)
The three file tools previously returned prose; they now return JSON like the rest.

| Tool | New return |
|---|---|
| `create_excalidraw_diagram` | `{ "ok": true, "path": "…", "created": true, "opened": true }` |
| `open_excalidraw_diagram` | `{ "ok": true, "path": "…", "opened": true, "toSide": false }` |
| `list_excalidraw_diagrams` | `{ "ok": true, "diagrams": ["…"], "count": N }` |

**Test:** call each; assert the result parses as JSON with `ok:true` and the documented fields.
The earlier "every tool returns JSON" checklist item should now pass for all 25 tools.

### B. Improved — authoring tools report final geometry (re-test note #B)
`add_excalidraw_elements`, `connect_excalidraw_elements`, `set_excalidraw_scene`,
`add_excalidraw_image`, and `draw_from_mermaid` now include `x/y/width/height` on every entry in the
returned `elements[]` (alongside `containerId`/`boundTextId`).

**Test:** add a diamond with a label and a deliberately small `height` (e.g. 60). Confirm the
response's `elements[].height` reflects the **actual** (grown) value rather than the requested one,
so the size change is visible instead of silent. (The growth itself is intrinsic Excalidraw
behavior — not a bug.)

### C. New tool — `get_excalidraw_mermaid` (read canvas as text)
Returns the whole canvas as a Mermaid `flowchart` so a model can read the diagram's structure
compactly. Returns `{ ok, mermaid, nodeCount, edgeCount, subgraphCount }`.

Mapping (mirrors `@excalidraw/mermaid-to-excalidraw`, inverted):
- **Shapes:** rectangle → `[..]`, rounded rectangle → `(..)`, ellipse → `((..))`, diamond → `{..}`.
- **Edges:** normal → `-->`, dashed/dotted → `-.->`, thick → `==>` (undirected lines use
  `---`/`-.-`/`===`); arrow labels preserved.
- **Frames → `subgraph … end`** containing their member nodes.
- Node labels come from each shape's bound text.

**Not represented:** freedraw strokes, images, and text not connected by arrows. For a full-fidelity
text dump use `get_excalidraw_scene` (structured JSON).

**Test steps:**
1. Build a small graph: a plain rectangle "Client", a **rounded** rectangle "API", a diamond
   "Auth?", an ellipse "DB".
2. Connect them: Client → API (normal, label "http"); API → Auth? (dashed); Auth? → DB (thick,
   label "yes").
3. Put API/Auth?/DB inside a **frame** named "Backend".
4. Call `get_excalidraw_mermaid`. Expect roughly:
   ```mermaid
   flowchart TD
       subgraph sg1["Backend"]
           n2("API")
           n3{"Auth?"}
           n4(("DB"))
       end
       n1["Client"]
       n1 -->|http| n2
       n2 -.-> n3
       n3 == yes ==> n4
   ```
5. Verify: rounded rect uses `(..)`, diamond `{..}`, ellipse `((..))`; the dashed and thick edges
   render as `-.->` and `==>`; the frame becomes a `subgraph`; `subgraphCount` = 1.
6. Empty canvas → mermaid contains a `%% No graph-like elements…` placeholder; all counts 0.
7. Round-trip sanity: feed the returned `mermaid` back into `draw_from_mermaid` on a new diagram and
   confirm a comparable graph is drawn.

### Updated regression checklist (this addendum)
- [ ] File tools (`create`/`open`/`list`) return JSON with `ok:true`.
- [ ] Authoring tools' `elements[]` include final `x/y/width/height`.
- [ ] `get_excalidraw_mermaid`: shapes/edge-styles/subgraph render per the mapping above.
- [ ] `get_excalidraw_mermaid` on an empty canvas → `%%` placeholder, counts 0.
- [ ] `get_excalidraw_mermaid` → `draw_from_mermaid` round-trip produces a comparable diagram.
- [ ] (Still pending, desktop only) MCP bridge end-to-end from an external agent.

---

## Addendum 2 — 2026-06-21 (movement, panning & modes)

Adds explicit move/drag and viewport/pan control, plus a pan mode. Tool count is now **27**.

### New — `move_excalidraw_elements`
Move/drag elements by id. Provide a relative offset `dx`/`dy` (pixels; +dx = right, +dy = down),
or an absolute target `x`/`y` (moves the group's top-left to x/y). Bound text labels move with their
shapes, and connectors (arrows) whose **both** endpoints are in the moved set translate too.
Returns `{ ok, movedIds, dx, dy }`.

**Test:**
1. Add two labeled rectangles A and B and connect them with an arrow.
2. `move_excalidraw_elements({ ids: ["<A>","<B>"], dx: 120, dy: -40 })` → both boxes, their labels,
   and the connecting arrow shift together; re-read with `get_excalidraw_scene` to confirm new
   coordinates and that labels stayed attached.
3. Move a single box by `dx` only → its label moves with it. (Note: an arrow connecting it to a
   *non-moved* box is left in place by design — move both endpoints to keep a connector attached.)
4. Absolute: `move_excalidraw_elements({ ids:["<A>"], x: 0, y: 0 })` puts A's top-left at the origin.

### New — `pan_excalidraw_canvas`
Pan/zoom the viewport without changing any elements. Relative pan `dx`/`dy`, absolute
`scrollX`/`scrollY`, absolute `zoom` (1 = 100%), or relative `zoomDelta`. Returns
`{ ok, scrollX, scrollY, zoom }`. Allowed on read-only diagrams (viewport only).

**Test:**
1. `pan_excalidraw_canvas({ dx: 300, dy: 0 })` → canvas scrolls; returned `scrollX` changed.
2. `pan_excalidraw_canvas({ zoom: 2 })` → zooms to 200%; `pan_excalidraw_canvas({ zoomDelta: -0.5 })`
   reduces it. Zoom is clamped to 0.1–30.
3. Contrast with `scroll_to_excalidraw_content` (which frames specific elements / the whole scene).

### Changed — `set_excalidraw_tool` gained modes
The tool enum now includes **`hand`** (pan mode), **`frame`**, and **`laser`** in addition to
`selection` and the shape tools.

**Test:** `set_excalidraw_tool({ tool: "hand" })` → editor enters pan mode (cursor changes);
`set_excalidraw_tool({ tool: "selection" })` returns to select/move mode.

### Updated regression checklist (this addendum)
- [ ] `move_excalidraw_elements` (dx/dy and x/y): targets + labels + inter-target connectors move; counts/coords correct.
- [ ] `pan_excalidraw_canvas`: relative/absolute scroll and zoom (incl. clamping) reflected in the return.
- [ ] `set_excalidraw_tool` switches into `hand` (pan) and back to `selection`.

---

## Addendum 3 — 2026-06-21 (save)

Tool count is now **28**.

### New — `save_excalidraw_diagram`
Persists the current drawing to its file via VS Code's save pipeline. Drawing edits made by the
agent are normally only written when the user saves; this tool writes them on demand. It
force-serializes the live scene (JSON/SVG/PNG by file type), pushes it into the document, cancels
the pending debounced change (so the file is not immediately re-marked dirty), and invokes
`vscode.workspace.save` (clearing the dirty state). Returns `{ ok, path, saved }`. Blocked on
read-only documents (e.g. git diff views).

**Test:**
1. Open/create a `.excalidraw` diagram.
2. `add_excalidraw_elements(...)` to draw something — the editor tab shows a dirty dot.
3. `save_excalidraw_diagram({})` (or with a `path`).
4. Confirm: the dirty dot clears, and the file on disk now contains the new elements (reopen or
   `cat` the file). Verify the editor does **not** re-mark dirty a moment later.
5. Repeat for a `.excalidraw.svg` and `.excalidraw.png` file — the saved file should be a valid
   SVG/PNG with the embedded scene.
6. Read-only: attempting to save a diagram opened from a git diff returns an error (`read-only`).

### Updated regression checklist (this addendum)
- [ ] `save_excalidraw_diagram` persists agent edits to disk and clears the dirty state for
      `.excalidraw`, `.excalidraw.svg`, and `.excalidraw.png`.
- [ ] After saving, the editor is not re-marked dirty by a late debounced change.
- [ ] Saving a read-only (git) diagram errors clearly.

---

## Addendum 4 — 2026-06-22 (full editor-action coverage)

Closes the gaps vs. Excalidraw's UI actions. Tool count is now **34**.

### New tools
- **reorder_excalidraw_elements** `{ ids, mode }` — z-order: `front` (to front), `back` (to back),
  `forward` (one up), `backward` (one down).
- **lock_excalidraw_elements** `{ ids, locked? }` — lock (default) or unlock (`locked:false`).
- **duplicate_excalidraw_elements** `{ ids, dx?, dy? }` — clone elements (+ their bound labels) at
  an offset (default 10/10). Returns `{ ok, ids, idMap }`.
- **flip_excalidraw_elements** `{ ids, axis }` — mirror layout about the selection center
  (`horizontal`/`vertical`).
- **set_excalidraw_link** `{ ids, link? }` — set/clear a hyperlink (omit/empty `link` to clear).
- **set_excalidraw_arrowheads** `{ ids, start?, end? }` — set arrow/line arrowheads
  (arrow/bar/dot/circle/triangle/diamond/crowfoot_*; `null` for none).

### Changed
- **align_excalidraw_elements** adds `distributeX`/`distributeY` (equal-gap distribution; needs 3+).
- **set_excalidraw_tool** enum adds `magicframe` and `embeddable` (now covers all 15 Excalidraw tools).

### Test steps
1. Add 3 overlapping rectangles A, B, C. `reorder_excalidraw_elements({ ids:["<A>"], mode:"front" })`
   → A renders on top; `mode:"back"` → behind; `forward`/`backward` move one step (verify visually).
2. `lock_excalidraw_elements({ ids:["<A>"] })` → A can't be selected/dragged in the UI;
   `{ locked:false }` re-enables it.
3. `duplicate_excalidraw_elements({ ids:["<labeled box>"] })` → a copy (with its label) appears
   offset by 10,10; returned `ids`/`idMap` reference the new elements.
4. Lay out 3 boxes unevenly, `align_excalidraw_elements({ ids:[...], align:"distributeX" })`
   → equal horizontal gaps. Try `flip_excalidraw_elements({ ids:[...], axis:"horizontal" })`
   → the group mirrors left-right (a lone symmetric shape won't visibly change — expected).
5. `set_excalidraw_link({ ids:["<A>"], link:"https://excalidraw.com" })` → clicking A opens the link;
   `set_excalidraw_link({ ids:["<A>"] })` (no link) clears it.
6. Add an arrow, `set_excalidraw_arrowheads({ ids:["<arrow>"], start:"dot", end:"triangle" })`
   → endpoints update; `end:null` removes the end head.
7. `set_excalidraw_tool({ tool:"magicframe" })` / `{ tool:"embeddable" }` → editor switches tool.

### Updated regression checklist (this addendum)
- [ ] z-order front/back/forward/backward visibly restack elements.
- [ ] lock/unlock toggles UI selectability.
- [ ] duplicate clones elements + bound labels at an offset with new ids.
- [ ] flip mirrors a multi-element group; distribute gives equal gaps.
- [ ] set link/arrowheads apply and clear correctly.
- [ ] set_excalidraw_tool accepts magicframe/embeddable.

---

## Addendum 5 — 2026-06-22 (use the library)

Agents can now browse and place library items, not just import them. Tool count is now **36**.

### New tools
- **get_excalidraw_library** `{ path? }` — list the reusable components in the library. Returns
  `{ ok, count, items: [{ index, id, name, status, elementCount }] }`. Supports both `.excalidrawlib`
  v2 (`libraryItems`) and v1 (`library`) formats.
- **place_excalidraw_library_item** `{ path?, id? | index? | elements?, x?, y? }` — stamp a library
  item onto the canvas. Identify it by `id`/`index` (from `get_excalidraw_library`) or pass raw
  `elements`. The item is cloned with fresh ids, preserving internal bound labels, arrow bindings,
  and grouping; optional `x`/`y` move the item's top-left corner. Returns `{ ok, ids, placed }`.

(`add_excalidraw_library_items` — import an `.excalidrawlib` JSON string — was already present.)

### Test steps
1. Ensure the library has items (the bundled `examples/library.excalidrawlib` has 17), or import some
   with `add_excalidraw_library_items`.
2. `get_excalidraw_library({})` → returns the item list; note an `index`/`id` and its `elementCount`.
3. `place_excalidraw_library_item({ index: 0, x: 200, y: 200 })` → the item's shapes appear on the
   canvas at ~200,200 with new ids; multi-element items keep their grouping and any labels/arrows.
4. `place_excalidraw_library_item({ id: "<id from step 2>" })` (no x/y) → placed at the item's saved
   coordinates.
5. Place the same item twice → two independent copies (different ids), confirming clone isolation.
6. Error cases: empty library → clear error; bad id/index → "Library item not found".

### Updated regression checklist (this addendum)
- [ ] `get_excalidraw_library` lists items with index/id/elementCount.
- [ ] `place_excalidraw_library_item` by index and by id both stamp the item with fresh ids.
- [ ] Multi-element items keep grouping/labels/bindings after placing.
- [ ] Placing twice yields independent copies; bad selector errors clearly.
