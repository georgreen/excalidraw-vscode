# Excalidraw

This extension integrates Excalidraw into VS Code.
To use it, create an empty file with a `.excalidraw`, `.excalidraw.json`, `.excalidraw.svg` or `.excalidraw.png` extension and open it in Visual Studio Code.

Try the web version at : <https://excalidraw.com/>

![demo](./medias/screenshot.png)

- [Features](#features)
  - [Edit Images](#edit-images)
  - [Draw from your browser](#draw-from-your-browser)
  - [Switch Editor Theme](#switch-editor-theme)
  - [Import Public Library](#import-public-library)
  - [View Drawing Source](#view-drawing-source)
  - [Associate Additional Extensions with the Excalidraw Editor](#associate-additional-extensions-with-the-excalidraw-editor)
  - [Sharing your Library](#sharing-your-library)
  - [Configure Language](#configure-language)
- [Contact](#contact)
- [Note for Contributors](#note-for-contributors)

## Features

### Edit Images

The source of the drawing can be embedded directly in a PNG or SVG image. Just create a new `.excalidraw.png` or `.excalidraw.svg` file.
You can also switch between text and image format by updating the file extension (ex: rename a `.excalidraw` file to `.excalidraw.png`).

![Image can be edited directly](./medias/edit_image.gif)

You can control the default export options using the `excalidraw.image` setting:

```json
{
  "excalidraw.image": {
    "exportScale": 1,
    "exportWithBackground": true,
    "exportWithDarkMode": false
  }
}
```

### Draw from your browser

You can install this extension in [`github.dev`](https://github.dev) or [`vscode.dev`](https://vscode.dev).
Editing an Excalidraw schema stored in a GitHub repository has never been easier !

### Switch Editor Theme

The extension support three theme options:

- light (default)
- dark
- auto (sync with VS Code Theme)

![theme switching](./medias/change-theme.gif)

### Import Public Library

Check out the available libraries at [libraries.excalidraw.com](https://libraries.excalidraw.com), and don't hesitate to contribute your own !

![Public libraries can be imported from the browser](./medias/import-library.gif)

### View Drawing Source

You can switch between the Excalidraw editor and the source (text or image) using the editor toolbar.

![Use the dedicated toolbar button to view the diagram source](./medias/view_source.gif)

### Associate Additional Extensions with the Excalidraw Editor

By default, this extension only handles `*.excalidraw`, `*.excalidraw.svg` and `*.excalidraw.png` files.

Add this to your VS Code `settings.json` file if you want to associate it with additional file extensions (ex: SVG):

```json
{
  "workbench.editorAssociations": {
    "*.svg": "editor.excalidraw"
  }
}
```

You won't be able to edit arbitrary SVG files though - only those that have been created with Excalidraw or this extension!

### Sharing your Library

If you want to use a workspace specific library (and share it with other contributors), set the `excalidraw.workspaceLibraryPath` in your Visual Studio Code workspace settings file (`.vscode/settings.json`):

```json
{
  "excalidraw.workspaceLibraryPath": "path/to/library.excalidrawlib"
}
```

The `workspaceLibraryPath` path is relative to your workspace root. Absolute path are also supported, but it will be specific to your device.

### Configure Language

By default, the extension will use the [Visual Studio Code Display Language](https://code.visualstudio.com/docs/getstarted/locales) to determine the language to use. You can overwrite it using the `excalidraw.language` setting:

```json
{
  "excalidraw.language": "fr-FR"
}
```

## AI Agent Tools

This extension exposes a set of [Language Model Tools](https://code.visualstudio.com/api/extension-guides/ai/tools) so that VS Code's Copilot **agent mode** can create and draw on Excalidraw diagrams for you. In agent mode you can reference a tool with `#` (e.g. `#addExcalidrawElements`) or simply describe what you want and let the agent pick the tools.

### File tools

- **create_excalidraw_diagram** — create a new `.excalidraw[.json/.svg/.png]` file (optionally seeded with scene JSON) and open it.
- **open_excalidraw_diagram** — open an existing diagram in the editor.
- **list_excalidraw_diagrams** — list diagrams in the workspace.
- **save_excalidraw_diagram** — save the current drawing to disk (persist your agent's edits).

### Canvas tools

These drive a **live** Excalidraw editor. Most take an optional `path`; when omitted, the currently active Excalidraw editor is used. If the target file is not open, it is opened automatically.

- **Read**: `get_excalidraw_scene`, `get_excalidraw_selection`, `get_excalidraw_appstate`, `get_excalidraw_mermaid`, `export_excalidraw_image`.
- **Author**: `add_excalidraw_elements`, `connect_excalidraw_elements`, `update_excalidraw_elements`, `move_excalidraw_elements`, `delete_excalidraw_elements`, `set_excalidraw_scene`, `clear_excalidraw_canvas`.
- **Style & layout**: `style_excalidraw_elements`, `select_excalidraw_elements`, `reorder_excalidraw_elements` (z-order), `lock_excalidraw_elements`, `duplicate_excalidraw_elements`, `flip_excalidraw_elements`, `set_excalidraw_link`, `set_excalidraw_arrowheads`, `scroll_to_excalidraw_content`, `pan_excalidraw_canvas`, `group_excalidraw_elements`, `ungroup_excalidraw_elements`, `frame_excalidraw_elements`, `align_excalidraw_elements` (align + distribute).
- **Images & library**: `add_excalidraw_image`, `add_excalidraw_library_items`, `get_excalidraw_library`, `place_excalidraw_library_item`.
- **Convenience**: `draw_from_mermaid` (convert a Mermaid definition into Excalidraw elements), `set_excalidraw_tool` (switch tool/mode, e.g. `hand` for panning).

> Note: the canvas tools require an Excalidraw editor to be open (the extension opens one automatically when you pass a `path`). They are not available on read-only documents (e.g. git diff views).

Example prompts:

- "Create a diagram at `docs/architecture.excalidraw` with a `Client`, `API`, and `Database` box connected by arrows."
- "Read the active diagram, then align the three boxes on their left edge."
- "Summarize the current diagram — read it as Mermaid first (`#getExcalidrawMermaid`)."
- "Draw this as a flowchart: `#drawFromMermaid` `graph TD; A-->B; B-->C`."

### Controlling Excalidraw from external agents (MCP)

The extension can also expose these tools over the **Model Context Protocol (MCP)** so that *external* agents — GitHub Copilot CLI, Claude Desktop, Cursor, Zed, etc. — can control Excalidraw, not just VS Code's built-in agent.

When **enabled by default**, the **desktop** extension host starts a localhost-only MCP HTTP server on activation (it shuts down with VS Code). It binds to `127.0.0.1` with **no authentication** — it is meant for a single trusted machine. This feature is desktop-only; the web build keeps the in-editor tools.

1. It is on by default. To disable it, set:

   ```json
   {
     "excalidraw.mcp.enabled": false
   }
   ```

2. On startup the extension writes a discovery file to `~/.excalidraw-vscode/mcp.json`:

   ```json
   {
     "url": "http://127.0.0.1:<port>/mcp",
     "port": 12345
   }
   ```

3. Point your MCP client at that URL. For example, an `http` MCP server entry:

   ```json
   {
     "servers": {
       "excalidraw": {
         "type": "http",
         "url": "http://127.0.0.1:<port>/mcp"
       }
     }
   }
   ```

The same canvas/file tools listed above are available over MCP. The server binds to `127.0.0.1` only (no token required). Use `excalidraw.mcp.port` to pin a fixed port (default `0` = pick a free one). Progress and the active URL are logged to the **Excalidraw MCP** output channel.

VS Code's own Copilot can also auto-discover this server (via the MCP server definition provider) on VS Code versions that support it — no manual configuration needed.

## Contact

Only bug reports / feature requests specifics to the VS Code integration should go to the extension repository. If it is not the case, please report your issue directly to the Excalidraw project.

## Note for Contributors

Thank you for considering contributing to the extension :sparkling_heart: !

This extension only goal is to integrate Excalidraw to the Visual Studio Code ecosystem. Users should be able to use both the website and the extension with a minimal amount of friction. As such, we will not accept any contribution that significantly modify the user experience compared to the Excalidraw website.

There are exceptions to this rule (for example, the switch theme icon was deported to Visual Studio Code editor toolbar to allow a better integration). In case of uncertainty, create a thread in the project [Discussion Page](https://github.com/excalidraw/excalidraw-vscode/discussions).
