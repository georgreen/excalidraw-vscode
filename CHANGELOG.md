# Changelog

## 3.26.0

Code-aware: edge / relationship intelligence (Phase 2 P2.7–P2.9).

- **Arrows are now relationships.** Select an arrow between two linked nodes and the panel shows the
  derived relationship — **inherits / calls / references** — with a verified badge and the number of
  concrete code sites. **"Go to relationship"** jumps to the actual site (or peeks when there are
  several).
- **Diagram linter for edges**: if no concrete inheritance/call/reference backs the arrow, it's
  reported as **conceptual or transitive** instead of failing silently.
- New tool **get_edge_relation** (Language Model + MCP): resolve the relationship behind an arrow by id.

## 3.25.1

Code-aware: the stale badge (⟳) is now actionable.

- Clicking a stale link badge offers a quick fix: for a **moved** symbol, *"Update link"* re-points the
  diagram element at the new file; for a **missing** symbol, options to *open the last-known file* or
  *remove the link*. (Previously the badge only showed a tooltip.)

## 3.25.0

Code-aware: open all references/implementations from the panel.

- The reference and implementation **counts in the selection panel are now clickable** — clicking
  "N references" (or "M implementations") opens VS Code's **peek** view listing every location, so you
  can jump straight from a diagram box to all of its usages.

## 3.24.0

Code-aware: reverse index + CodeLens (Phase 2 P2.6).

- A **CodeLens** now appears on a code symbol that is referenced by a diagram — *"Appears in
  architecture.excalidraw"* — and clicking it opens that diagram and **focuses/selects the element**.
  Built from a reverse index over `customData.codeLink` across the workspace's `.excalidraw` files,
  kept up to date as diagrams change.

## 3.23.0

Code-aware: link freshness / diagram linter (Phase 2 P2.5).

- The extension now re-checks linked symbols when files are **saved or renamed** and flags links that
  have drifted from the code: a **stale badge** (⟳) appears on a node whose symbol no longer exists
  ("missing") or now lives in a different file ("moved", with the new path in the tooltip). The check
  is non-destructive (an overlay, like the diagnostics badges — it never edits the document).

## 3.22.0

Code-aware: insert class/interface members (Phase 2 P2.4).

- `expand_element_relations` gains a **`members`** kind: insert a class/interface's methods and fields
  as pre-linked nodes connected to it. Each member is navigable and its full signature is available on
  hover (and the node label includes the member's signature detail when the language server provides
  it).

## 3.21.0

Code-aware: reference & implementation counts (Phase 2 P2.3).

- The selection/hover panel now shows **how many references** a linked symbol has (and, for
  classes/interfaces, how many **implementations**), computed on demand via the language server.
- `get_code_hover_for_element` also returns `references` / `implementations` counts for agents.

## 3.20.0

Code-aware: expand relations on demand + cleaner generated graphs (Phase 2 P2.2).

- New tool **expand_element_relations** (Language Model + MCP): grow the diagram from an existing
  linked element by one relationship hop — `callees`, `callers`, `supertypes`, `subtypes`, or
  `implementations` — adding the neighbours as pre-linked, connected nodes. Existing nodes are reused
  rather than duplicated.
- **generate_diagram_from_symbol** and the expand tool now **exclude external symbols**
  (`node_modules` / language libraries) by default for cleaner graphs; pass `includeExternal: true` to
  include them.

## 3.19.0

MCP bridge: multi-window safe discovery.

- Each VS Code window now writes its **own** discovery file under
  `~/.excalidraw-vscode/servers/<workspace>.json` (plus a convenience `mcp.json` pointer), so multiple
  open windows no longer clobber each other — the directory lists every running server with its
  `url`/`port`/`workspace`.
- If the preferred `excalidraw.mcp.port` is already taken by another window, the bridge now **falls
  back to a free port** (and logs it) instead of failing to start. Stale discovery files (dead
  processes) are cleaned up on startup.
- Guidance: pin `excalidraw.mcp.port` in a **workspace** `.vscode/settings.json` (not global) when you
  want a stable URL for one project.

## 3.18.1

Fix: MCP tools with object-array parameters (`add_excalidraw_elements`, `update_excalidraw_elements`,
`set_excalidraw_scene`, `place_excalidraw_library_item`) declared their array `items` without a type,
which strict MCP clients (e.g. VS Code) reject with "tool parameters array type must have items". The
item schema now declares `type: object`.

## 3.18.0

Code-aware: generate diagrams from code (Phase 2 P2.1).

- New tool **generate_diagram_from_symbol** (Language Model + MCP): walks the language server's call
  hierarchy (`mode: "calls"`, default) or type hierarchy (`mode: "types"`) from a symbol and lays the
  result out on the canvas as **pre-linked** boxes (depth- and node-capped). Every generated node
  carries a precise code link, so the diagram is immediately navigable (hover / jump / diagnostics).

## 3.17.1

Fix: add `onLanguageModelTool` activation events for the five code-aware tools
(`link_excalidraw_to_symbol`, `get_excalidraw_code_links`, `get_code_hover_for_element`,
`navigate_to_element_code`, `get_linked_diagnostics`), so invoking them activates the extension.

## 3.17.0

Code-aware: auto-linking, unlinking, and schema validation (Phase 1 P1.1/P1.2).

- New command **"Excalidraw: Auto-link Elements to Code Symbols"** — scans the diagram for unlinked,
  labelled shapes, matches each label to a workspace symbol, and links the ones you confirm.
- **Unlink**: `link_excalidraw_to_symbol` accepts `unlink: true` (with `ids`) to remove links;
  `setCodeLink` validates that a link carries a non-empty `symbol`, and clearing only removes the
  extension's own `code:` link (a user-set URL is preserved).

## 3.16.1

Code-aware: diagnostic badges are now clickable.

- Clicking a diagnostic badge opens the linked file at its **first problem** (errors before warnings)
  and selects that diagnostic's range — a one-click jump from a diagram box to the actual error.

## 3.16.0

Code-aware: diagnostics and hover polish.

- **Persistent diagnostic badges**: a colored marker now sits on every linked element whose file has
  errors/warnings (not just the focused one), anchored to the element and following scroll/zoom. Red
  for errors, amber for warnings, with the actual diagnostic messages as a tooltip.
- **Hover panel**: the signature is rendered as a distinct code block, separate from the prose docs,
  with clearer loading / "no hover info" states.

## 3.15.2

Code-aware: cleaner symbol names when linking.

- Strip the call suffix (`()` / `(params)`) that TypeScript's workspace symbols report for
  functions/methods, so `link_excalidraw_to_symbol` stores `resolveSymbol` (not `resolveSymbol()`) and
  exact-name matching during resolution is more reliable.

## 3.15.1

Code-aware: more robust symbol resolution for agents.

- `resolveSymbol` now falls back to the **document symbol provider** on a link's `file` when the
  workspace symbol index is cold — opening the document activates the language server on demand. This
  fixes empty hover/diagnostics for `get_code_hover_for_element` / `get_linked_diagnostics` when no
  source file from the project is open yet (previously you had to open a file first).

## 3.15.0

MCP bridge: **on by default, no authentication** (localhost-only, trusted-machine model).

- `excalidraw.mcp.enabled` now defaults to **`true`** — the desktop MCP HTTP server starts on
  activation without extra configuration.
- Removed the bearer-token requirement. The server binds to `127.0.0.1` only; the discovery file
  (`~/.excalidraw-vscode/mcp.json`) and the VS Code MCP definition no longer carry a token.
- Point any MCP client at the `url` from the discovery file with no auth header. Set
  `excalidraw.mcp.enabled: false` to turn the bridge off.

## 3.14.0

Code-aware diagrams: **agent tools** (Phase 1, P1.6). Lets the VS Code AI agent and external MCP
clients link diagram elements to code and read the resulting intelligence.

- `link_excalidraw_to_symbol`: link elements to a code symbol by name, or `auto`-match by label.
- `get_excalidraw_code_links`: list the diagram's element→symbol index.
- `get_code_hover_for_element`: language-server signature/docs for a linked element.
- `navigate_to_element_code`: open the code behind a linked element (go to definition).
- `get_linked_diagnostics`: error/warning counts for the files behind linked elements.
- All five are exposed both as VS Code Language Model tools and over the MCP bridge, reusing the same
  host operations (delegating to the running language servers — no custom index).

## 3.13.1

Experimental: **code-aware diagrams** (Phase 0 spike). Link diagram elements to real code symbols and
surface language intelligence by delegating to the running language servers (no custom LSP).

- New command **"Excalidraw: Link element to symbol…"** — attach a `customData.codeLink` to a selected
  element via a workspace-symbol quick-pick.
- **Hover** a linked box to see the language server's real signature/docs, in a panel anchored next to
  the element (follows scroll/zoom).
- Live **error/warning badges** on boxes whose linked file has diagnostics.
- **Navigate**: click a linked box's link badge / "Go to code" to jump to the symbol.
- Example: `examples/code-aware-demo.excalidraw` (classes, functions, methods, interfaces pre-linked to
  this repo). Design & plan under `docs/proposals/code-aware-diagrams/`.

## 3.13.0

Lets agents browse and use the Excalidraw library.

- Add `get_excalidraw_library`: list the reusable components in the library (id, name, element count).
- Add `place_excalidraw_library_item`: stamp a library item onto the canvas by id/index (or raw elements) at an optional position; the item is cloned with fresh ids, preserving internal labels, bindings, and grouping.
- (`add_excalidraw_library_items` already allowed importing an `.excalidrawlib` into the library.)

## 3.12.0

Rounds out coverage of Excalidraw's editor actions for agents.

- Add `reorder_excalidraw_elements`: change z-order (bring to front / send to back / forward / backward).
- Add `lock_excalidraw_elements`: lock or unlock elements.
- Add `duplicate_excalidraw_elements`: clone elements (with their bound labels) at an offset.
- Add `flip_excalidraw_elements`: mirror elements horizontally or vertically about the selection center.
- Add `set_excalidraw_link`: set or clear a hyperlink on elements.
- Add `set_excalidraw_arrowheads`: set start/end arrowheads on arrows and lines.
- `align_excalidraw_elements` now also supports `distributeX`/`distributeY` (equal-gap distribution).
- `set_excalidraw_tool` adds the `magicframe` and `embeddable` tools, completing the toolbar set.

## 3.11.0

More agent canvas control: moving/dragging elements, panning/zooming the viewport, switching modes, and saving on demand.

- Add `move_excalidraw_elements`: move/drag elements by a relative offset (`dx`/`dy`) or to an absolute position (`x`/`y`). Bound labels and connectors between moved shapes move along with them.
- Add `pan_excalidraw_canvas`: pan and zoom the viewport (relative `dx`/`dy`/`zoomDelta` or absolute `scrollX`/`scrollY`/`zoom`) without changing any elements.
- Add `save_excalidraw_diagram`: persist the current drawing to its file via VS Code's save, so agent edits are written to disk on demand.
- `set_excalidraw_tool` can now switch into `hand` (pan mode), `frame`, and `laser`, in addition to the selection and shape tools.

## 3.10.0

Adds AI agent support: tools that let VS Code's Copilot agent (and external agents via MCP) read and draw on Excalidraw diagrams.

### Agent tools (VS Code Language Model Tools)

- Adds 25 agent tools (requires VS Code 1.95+), referenceable in agent mode:
  - File: `create_excalidraw_diagram`, `open_excalidraw_diagram`, `list_excalidraw_diagrams`.
  - Read: `get_excalidraw_scene`, `get_excalidraw_selection`, `get_excalidraw_appstate`, `get_excalidraw_mermaid`, `export_excalidraw_image` (PNG/SVG).
  - Authoring: `add_excalidraw_elements`, `connect_excalidraw_elements`, `update_excalidraw_elements`, `delete_excalidraw_elements`, `set_excalidraw_scene`, `clear_excalidraw_canvas`.
  - Styling/layout: `style_excalidraw_elements`, `select_excalidraw_elements`, `scroll_to_excalidraw_content`, `group_excalidraw_elements`, `ungroup_excalidraw_elements`, `frame_excalidraw_elements`, `align_excalidraw_elements`.
  - Images/library/convenience: `add_excalidraw_image`, `add_excalidraw_library_items`, `draw_from_mermaid`, `set_excalidraw_tool`.
- Canvas tools drive a live editor via a new host↔webview request/response command channel; they auto-open the target diagram and are blocked on read-only documents.
- `get_excalidraw_mermaid`: export the whole canvas as a Mermaid flowchart (rounded/ellipse/diamond shapes, `-->`/`-.->`/`==>` edge styles, frames → `subgraph`) so a model can read a diagram as text.
- All tools return machine-readable JSON; authoring tools report each created element's final geometry and distinguish shape ids from auto-created label ids (`boundTextId`/`containerId`).
- Fix `draw_from_mermaid` timing out when the target editor was in a background tab (reveal the webview so rendering resumes).

### External agents via MCP (desktop only)

- The desktop extension host can run a localhost-only, token-protected MCP HTTP server on startup, exposing the same tools to external agents (e.g. GitHub Copilot CLI, Claude, Cursor). Enable with `excalidraw.mcp.enabled`; tune the port with `excalidraw.mcp.port`.
- Writes a discovery file to `~/.excalidraw-vscode/mcp.json` (`url`, `port`, `token`).
- Optionally advertises the server to VS Code's own Copilot via an MCP server definition provider (on supported VS Code versions).

### Internal

- Ships dual bundles: web (`browser`) and node (`main`) extension hosts sharing activation logic; the MCP bridge runs only in the node host.
- Upgrades TypeScript to 5 (`moduleResolution: bundler`, `skipLibCheck`).

## 3.9.0

- add support for linking to local files
- fix theme switching from dark mode to light mode when opening a context menu

## 3.8.3

- fix library import

## 3.8.2

- add a command to create a new diagram

## 3.8.1

- fix readme images in the marketplace

## 3.8.0

- upgrade excalidraw version to 0.18.0
- deactivate syncing of excalidraw libs between devices

## 3.5.0

- Fix font missing when using the extension offline

## 3.4.1

- Update excalidraw package to 0.14.2

## 3.4.0

- Update excalidraw package to 0.14.1

## 3.3.3

- Upgrade Dependencies

## 3.3.1

### Fixed

- Editor crashing in line editor

## 3.3.0

### Added

- Add Custom Language Support

## 3.2.0

### Added

- Upgrade excalidraw package to 1.2.0
- Add the ability to configure the export options for `excalidraw.png` and `excalidraw.svg` files using the `excalidraw.image` setting.

## 3.1.0

### Fixed

- Fix font rendering on first export of png files
- Fix library item not deleted when two diagrams are open
- Fix font in exported svg files

## 3.0.0

### Added

- allow to open and edit png with embedded scene
- deprecate `excalidraw.syncTheme` preference in favour of `excalidraw.theme`
- sync the user library between devices
- add the ability to store the library in an `excalidrawlib` file using the `excalidraw.workspaceLibraryPath` pref.
- allow to convert between json, svg and png representations by switching the file extension

### Fixed

- Sync library between opened editors
- Fix `cmd+c` and `cmd+v` shortcuts on macOS

## 2.0.16

- The extension is now part of the excalidraw organization !

## 2.0.10

- Allow `Excalidraw` to be used as a web extension !

## 2.0.9

- Fix `contentType` incorrectly detected ([#15](https://github.com/pomdtr/vscode-excalidraw-editor/issues/15))

## 2.0.8

- Webpack support

## 2.0.6

- Fix Assets Path

## 2.0.5

- Editor with a git URL Scheme are now read only
- Limit theme options to `excalidraw.syncTheme`

## 2.0.4

- Change Display Name to `Excalidraw Editor`

## 2.0.3

- Scroll to content in new editors

## 2.0.2

- Re-enable `excalidraw.theme`

## 2.0.0

- Upgrade `Excalidraw` to `0.11.0`
- Add Support for embedding PNG and SVG images the current file
- Add Support for directly editing SVG files (Use the extension `.excalidraw.svg`)
- Add support for links in drawings
- Deprecate `open in application` command. Please use [Open in External App](https://marketplace.visualstudio.com/items?itemName=YuTengjing.open-in-external-app) instead.
- Deprecate `excalidraw.export.globs`. Since the extension support editing SVGs directly, this is no longer necessary.
- Deprecate all SVG export using the command palette. Please use the UI button instead.
- Deprecate theme related options

## 1.3.0

- Upgrade `Excalidraw` to 0.9.0
- Add ability to embed scene during export to SVG

## 1.2.0

- Upgrade `Excalidraw` to 0.8.0
- Add `autoSave` feature (See `excalidraw.save` setting)
- Add support for workspace trust API
- Fix library restore of background tabs
- Disable broken import/export library buttons

## 1.1.0

- Upgrade `Excalidraw` to 0.7.0
  - Support tab-to-indent when editing text
- Support to save schema components into a library
- Add a setting to automatically set the output directory on export
