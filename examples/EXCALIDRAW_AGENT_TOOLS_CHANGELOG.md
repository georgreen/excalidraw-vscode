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
