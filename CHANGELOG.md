# Changelog

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
