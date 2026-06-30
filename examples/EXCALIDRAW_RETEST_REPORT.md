# Excalidraw Agent Tools — QA Re-test Report (post-changelog)

**Date:** 2026-06-20
**Scope:** Re-run of the full 24-tool functional matrix after the dev cleanup described in
`EXCALIDRAW_AGENT_TOOLS_CHANGELOG.md`.
**Result:** 24/24 tools functional. The High-severity mermaid defect is **FIXED**. Two changelog
claims are **partially met** (see Deviations). MCP bridge was **out of scope** for this surface.

---

## Verdict on changelog items

| Changelog item | Status | Evidence |
|---|---|---|
| **1. `draw_from_mermaid` background-editor timeout (High)** | ✅ **FIXED** | Ran mermaid by `path` against a **background/unfocused** editor (another diagram was active) → succeeded first try: `{"ok":true,"added":14,...}`. Previously failed 3/3 in this exact scenario. |
| **2. All tools return machine-readable JSON (`ok:true`)** | ⚠️ **Partial** | All **canvas** tools now return JSON. The three **file tools** still return prose (see Deviations). |
| **3. Id transparency (`boundTextId`/`containerId`)** | ✅ **VERIFIED** | `add_excalidraw_elements`, `connect_excalidraw_elements`, `set_excalidraw_scene`, `add_excalidraw_image`, `draw_from_mermaid` all return an `elements[]` with `boundTextId` on shapes and `containerId` on labels. |
| **4. MCP bridge for external agents** | ⛔ **NOT TESTED** | Desktop-only; not reachable from this agent surface. See Out of Scope. |

---

## Deviations / Open items

### A. Three file tools still return prose, not JSON (changelog claim #2)
The changelog says *"all tools now return machine-readable JSON"* and the regression checklist says
*"Every tool returns valid JSON with `ok:true`."* These three do **not**:

| Tool | Actual return |
|---|---|
| `create_excalidraw_diagram` | `Created and opened Excalidraw diagram at tool-test.excalidraw.` |
| `open_excalidraw_diagram` | `Opened Excalidraw diagram at tool-test.excalidraw.` |
| `list_excalidraw_diagrams` | `Found 7 Excalidraw diagram(s):\n<newline-separated paths>` |

**Impact:** Agents that parse `ok:true`/structured fields uniformly will break on these. In
particular `list_excalidraw_diagrams` returning a human string forces fragile line-parsing to get
paths.
**Suggested fix:** return e.g.
- `create` → `{"ok":true,"path":"…","created":true,"opened":true}`
- `open` → `{"ok":true,"path":"…","opened":true,"toSide":false}`
- `list` → `{"ok":true,"diagrams":["…","…"],"count":N}`

### B. (Carried over, non-bug) Label text can hard-wrap and resize shapes
A diamond requested at `height:80` returns `height:120`; the label "Diamond C" wraps to
`"Diamon\nd C"`. Already acknowledged in the changelog "Known notes". No action required; flagging
only so it isn't mistaken for a regression.

---

## Out of scope this run — MCP bridge (changelog #4)
The new desktop-only MCP HTTP server could not be exercised from this agent surface (no access to a
desktop Extension Host, the `~/.excalidraw-vscode/mcp.json` discovery file, or localhost curl from
here). The changelog's own status says end-to-end external-client connection is unverified. The
remaining checklist items still need a human/desktop run:
- [ ] `excalidraw.mcp.enabled:true` → `~/.excalidraw-vscode/mcp.json` written + URL logged to **Excalidraw MCP** output channel.
- [ ] `curl http://127.0.0.1:<port>/health` → `ok`.
- [ ] External MCP client lists tools and calls `list_excalidraw_diagrams` / `create` / `add_excalidraw_elements`.
- [ ] Request without bearer token → `401`.
- [ ] Web host (vscode.dev): LM tools work; MCP correctly absent.

---

## Full matrix (this run)

Target file: `tool-test.excalidraw`. A second diagram (`tool-test-foreground.excalidraw`) was
created afterward so the mermaid test ran against a **background** editor on purpose.

| # | Tool | Result | Return shape |
|---|------|--------|--------------|
| 1 | `create_excalidraw_diagram` | ✅ | prose ⚠️ |
| 2 | `open_excalidraw_diagram` | ✅ | prose ⚠️ |
| 3 | `list_excalidraw_diagrams` | ✅ (7 found) | prose ⚠️ |
| 4 | `draw_from_mermaid` (background editor) | ✅ **fix confirmed** | `{ok,added:14,ids,elements[boundTextId/containerId]}` |
| 5 | `clear_excalidraw_canvas` | ✅ | `{ok,cleared:true}` |
| 6 | `add_excalidraw_elements` (labeled shapes + text) | ✅ | `{ok,ids,added:7,elements[…]}` — id transparency ✓ |
| 7 | `get_excalidraw_scene` | ✅ | `{ok,elements,count}` |
| 8 | `get_excalidraw_appstate` | ✅ | `{ok,scrollX,scrollY,zoom,theme,…}` |
| 9 | `update_excalidraw_elements` (move+rotate) | ✅ | `{ok,updatedIds}` |
| 10 | `style_excalidraw_elements` | ✅ | `{ok,styled:1}` |
| 11 | `connect_excalidraw_elements` (labeled arrow) | ✅ | `{ok,ids,elements}` — arrow vs label ✓ |
| 12 | `align_excalidraw_elements` (left) | ✅ | `{ok,aligned:2,mode:"left"}` |
| 13 | `group_excalidraw_elements` | ✅ | `{ok,groupId}` |
| 14 | `ungroup_excalidraw_elements` | ✅ | `{ok,ungrouped:2}` |
| 15 | `frame_excalidraw_elements` | ✅ | `{ok,frameId}` |
| 16 | `select_excalidraw_elements` | ✅ | `{ok,selectedElementIds}` |
| 17 | `get_excalidraw_selection` | ✅ | `{ok,selectedElementIds}` |
| 18 | `set_excalidraw_tool` (ellipse) | ✅ | `{ok,tool:"ellipse"}` |
| 19 | `scroll_to_excalidraw_content` | ✅ | `{ok,scrolled:true}` |
| 20 | `add_excalidraw_image` | ✅ | `{ok,ids,fileId,elements}` |
| 21 | `add_excalidraw_library_items` | ✅ | `{ok,imported:true}` |
| 22 | `export_excalidraw_image` (png) | ✅ rendered + visually verified | `{ok,format,path}` |
| 23 | `delete_excalidraw_elements` | ✅ | `{ok,deleted:1}` |
| 24 | `set_excalidraw_scene` (replace) | ✅ | `{ok,ids,count,elements}` — id transparency ✓ |

Export was visually inspected: styled blue rectangle with bound "flows to" arrow, framed
ellipse + plain text ("Test Frame"), left-aligned diamond, and the embedded PNG all rendered
correctly.

---

## Recommendation
- Ship the mermaid fix — confirmed solid.
- Close out changelog claim #2 by converting the three file tools to JSON (item A) **or** soften the
  claim to "all canvas tools return JSON; file tools return prose."
- Schedule a desktop run for the MCP bridge (#4) before advertising external-agent support.
