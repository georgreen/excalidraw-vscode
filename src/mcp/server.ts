import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  canvasCommand,
  exportImageToFile,
  addImageFromFile,
  saveDiagram,
} from "../canvasTools";
import { createDiagram, openDiagram, listDiagrams } from "../tools";
import { ExcalidrawEditor } from "../editor";

const PATH = z
  .string()
  .optional()
  .describe(
    "Target diagram path (workspace-relative unless absolute). If omitted, the active Excalidraw editor is used."
  );

type Json = { content: { type: "text"; text: string }[] };

function result(data: unknown): Json {
  return {
    content: [{ type: "text", text: JSON.stringify(data ?? { ok: true }) }],
  };
}

/**
 * Build an MCP server exposing the Excalidraw tools. Tool handlers reuse the
 * same host-side operations as the VS Code Language Model tools, so the canvas
 * behaviour is identical for external agents.
 */
export function createMcpServer(version: string): McpServer {
  const server = new McpServer({ name: "excalidraw-vscode", version });

  // --- File tools ---
  server.registerTool(
    "create_excalidraw_diagram",
    {
      description:
        "Create a new Excalidraw diagram file and open it. 'path' is workspace-relative unless absolute; '.excalidraw' is appended if it lacks a known extension. Optional 'content' seeds a text scene with Excalidraw scene JSON.",
      inputSchema: {
        path: z.string(),
        content: z.string().optional(),
        overwrite: z.boolean().optional(),
      },
    },
    async (args) => result({ ok: true, path: await createDiagram(args) })
  );

  server.registerTool(
    "open_excalidraw_diagram",
    {
      description: "Open an existing Excalidraw diagram in the editor.",
      inputSchema: { path: z.string(), toSide: z.boolean().optional() },
    },
    async (args) => result({ ok: true, path: await openDiagram(args) })
  );

  server.registerTool(
    "list_excalidraw_diagrams",
    {
      description: "List Excalidraw diagrams in the workspace.",
      inputSchema: { path: z.string().optional() },
    },
    async (args) => result({ ok: true, diagrams: await listDiagrams(args) })
  );

  // --- Canvas read tools ---
  const read = (
    name: string,
    description: string,
    action: Parameters<typeof canvasCommand>[1]
  ) =>
    server.registerTool(
      name,
      { description, inputSchema: { path: PATH } },
      async ({ path }) => result(await canvasCommand(path, action))
    );

  read(
    "get_excalidraw_scene",
    "Return the elements currently on the canvas (ids, types, geometry, colors).",
    "getScene"
  );
  read(
    "get_excalidraw_selection",
    "Return the ids of the currently selected elements.",
    "getSelection"
  );
  read(
    "get_excalidraw_appstate",
    "Return the canvas app state (viewport, zoom, theme, default colors).",
    "getAppState"
  );
  read(
    "get_excalidraw_mermaid",
    "Return the canvas as a Mermaid flowchart (shapes as nodes, bound arrows as edges) so the diagram can be read as text. Best for graph-like diagrams; freedraw/images/unconnected text are not represented.",
    "getMermaid"
  );

  // --- Authoring tools ---
  server.registerTool(
    "add_excalidraw_elements",
    {
      description:
        "Append elements from an array of Excalidraw element skeletons (rectangle/ellipse/diamond/text/line/arrow/image/frame, each optionally with a label and style). Returns { ids, added, elements } where elements expose containerId/boundTextId.",
      inputSchema: { path: PATH, elements: z.array(z.any()) },
    },
    async ({ path, elements }) =>
      result(await canvasCommand(path, "addElements", { elements }))
  );

  server.registerTool(
    "connect_excalidraw_elements",
    {
      description:
        "Draw an arrow bound to two existing elements by id, with an optional label.",
      inputSchema: {
        path: PATH,
        startId: z.string(),
        endId: z.string(),
        label: z.string().optional(),
      },
    },
    async ({ path, startId, endId, label }) =>
      result(
        await canvasCommand(path, "connectElements", { startId, endId, label })
      )
  );

  server.registerTool(
    "update_excalidraw_elements",
    {
      description:
        "Patch existing elements by id. 'updates' is an array of { id, ...propertiesToChange } (x, y, width, height, angle, text, colors, etc.).",
      inputSchema: { path: PATH, updates: z.array(z.any()) },
    },
    async ({ path, updates }) =>
      result(await canvasCommand(path, "updateElements", { updates }))
  );

  server.registerTool(
    "move_excalidraw_elements",
    {
      description:
        "Move (drag) elements by id. Provide a relative offset via dx/dy, or an absolute target via x/y (moves the group's top-left to x/y). Bound labels and connectors between moved shapes move too.",
      inputSchema: {
        path: PATH,
        ids: z.array(z.string()),
        dx: z.number().optional(),
        dy: z.number().optional(),
        x: z.number().optional(),
        y: z.number().optional(),
      },
    },
    async ({ path, ids, dx, dy, x, y }) =>
      result(await canvasCommand(path, "moveElements", { ids, dx, dy, x, y }))
  );

  server.registerTool(
    "delete_excalidraw_elements",
    {
      description: "Delete elements from the canvas by id.",
      inputSchema: { path: PATH, ids: z.array(z.string()) },
    },
    async ({ path, ids }) =>
      result(await canvasCommand(path, "deleteElements", { ids }))
  );

  server.registerTool(
    "set_excalidraw_scene",
    {
      description:
        "Replace ALL elements on the canvas with a new set of skeletons (destructive).",
      inputSchema: { path: PATH, elements: z.array(z.any()) },
    },
    async ({ path, elements }) =>
      result(await canvasCommand(path, "setScene", { elements }))
  );

  server.registerTool(
    "clear_excalidraw_canvas",
    {
      description: "Remove every element from the canvas.",
      inputSchema: { path: PATH },
    },
    async ({ path }) => result(await canvasCommand(path, "clearCanvas"))
  );

  // --- Selection / viewport ---
  server.registerTool(
    "select_excalidraw_elements",
    {
      description: "Select elements on the canvas by id.",
      inputSchema: { path: PATH, ids: z.array(z.string()) },
    },
    async ({ path, ids }) =>
      result(await canvasCommand(path, "selectElements", { ids }))
  );

  server.registerTool(
    "reorder_excalidraw_elements",
    {
      description:
        "Change z-order (stacking) of elements by id. mode: front (bring to front), back (send to back), forward (one step up), backward (one step down).",
      inputSchema: {
        path: PATH,
        ids: z.array(z.string()),
        mode: z.enum(["front", "back", "forward", "backward"]),
      },
    },
    async ({ path, ids, mode }) =>
      result(await canvasCommand(path, "reorderElements", { ids, mode }))
  );

  server.registerTool(
    "lock_excalidraw_elements",
    {
      description:
        "Lock or unlock elements by id (locked elements can't be selected/edited in the UI). Set locked false to unlock.",
      inputSchema: {
        path: PATH,
        ids: z.array(z.string()),
        locked: z.boolean().optional(),
      },
    },
    async ({ path, ids, locked }) =>
      result(await canvasCommand(path, "lockElements", { ids, locked }))
  );

  server.registerTool(
    "duplicate_excalidraw_elements",
    {
      description:
        "Duplicate elements by id (clones get new ids, offset by dx/dy, default 10/10). Bound text labels are duplicated with their shapes.",
      inputSchema: {
        path: PATH,
        ids: z.array(z.string()),
        dx: z.number().optional(),
        dy: z.number().optional(),
      },
    },
    async ({ path, ids, dx, dy }) =>
      result(await canvasCommand(path, "duplicateElements", { ids, dx, dy }))
  );

  server.registerTool(
    "flip_excalidraw_elements",
    {
      description:
        "Mirror elements' layout about the selection's center along an axis. axis: horizontal or vertical.",
      inputSchema: {
        path: PATH,
        ids: z.array(z.string()),
        axis: z.enum(["horizontal", "vertical"]),
      },
    },
    async ({ path, ids, axis }) =>
      result(await canvasCommand(path, "flipElements", { ids, axis }))
  );

  server.registerTool(
    "set_excalidraw_link",
    {
      description:
        "Set (or clear) a hyperlink on elements by id. Omit 'link' or pass empty to clear.",
      inputSchema: {
        path: PATH,
        ids: z.array(z.string()),
        link: z.string().optional(),
      },
    },
    async ({ path, ids, link }) =>
      result(await canvasCommand(path, "setLink", { ids, link }))
  );

  server.registerTool(
    "set_excalidraw_arrowheads",
    {
      description:
        "Set arrowheads on arrow/line elements by id. 'start'/'end' are arrowhead types (arrow, bar, dot, circle, triangle, diamond, crowfoot_one, crowfoot_many, etc.) or null for none.",
      inputSchema: {
        path: PATH,
        ids: z.array(z.string()),
        start: z.string().nullable().optional(),
        end: z.string().nullable().optional(),
      },
    },
    async ({ path, ids, start, end }) =>
      result(await canvasCommand(path, "setArrowheads", { ids, start, end }))
  );

  server.registerTool(
    "scroll_to_excalidraw_content",
    {
      description:
        "Zoom and scroll the canvas to fit the given element ids, or the whole scene.",
      inputSchema: { path: PATH, ids: z.array(z.string()).optional() },
    },
    async ({ path, ids }) =>
      result(await canvasCommand(path, "scrollToContent", { ids }))
  );

  server.registerTool(
    "pan_excalidraw_canvas",
    {
      description:
        "Pan/zoom the canvas viewport. Set absolute scrollX/scrollY and/or zoom, or pan relatively with dx/dy and zoom relatively with zoomDelta.",
      inputSchema: {
        path: PATH,
        scrollX: z.number().optional(),
        scrollY: z.number().optional(),
        dx: z.number().optional(),
        dy: z.number().optional(),
        zoom: z.number().optional(),
        zoomDelta: z.number().optional(),
      },
    },
    async ({ path, scrollX, scrollY, dx, dy, zoom, zoomDelta }) =>
      result(
        await canvasCommand(path, "panCanvas", {
          scrollX,
          scrollY,
          dx,
          dy,
          zoom,
          zoomDelta,
        })
      )
  );

  // --- Styling / layout ---
  server.registerTool(
    "style_excalidraw_elements",
    {
      description:
        "Apply style properties (strokeColor, backgroundColor, fillStyle, strokeWidth, opacity, fontSize, etc.) to elements by id.",
      inputSchema: {
        path: PATH,
        ids: z.array(z.string()),
        style: z.record(z.any()),
      },
    },
    async ({ path, ids, style }) =>
      result(await canvasCommand(path, "styleElements", { ids, style }))
  );

  server.registerTool(
    "group_excalidraw_elements",
    {
      description: "Group two or more elements by id.",
      inputSchema: { path: PATH, ids: z.array(z.string()) },
    },
    async ({ path, ids }) =>
      result(await canvasCommand(path, "groupElements", { ids }))
  );

  server.registerTool(
    "ungroup_excalidraw_elements",
    {
      description: "Ungroup elements by id.",
      inputSchema: { path: PATH, ids: z.array(z.string()) },
    },
    async ({ path, ids }) =>
      result(await canvasCommand(path, "ungroupElements", { ids }))
  );

  server.registerTool(
    "frame_excalidraw_elements",
    {
      description: "Wrap elements in a named frame.",
      inputSchema: {
        path: PATH,
        ids: z.array(z.string()),
        name: z.string().optional(),
      },
    },
    async ({ path, ids, name }) =>
      result(await canvasCommand(path, "frameElements", { ids, name }))
  );

  server.registerTool(
    "align_excalidraw_elements",
    {
      description:
        "Align or distribute elements by id. Align modes: left, right, centerX, top, bottom, centerY. Distribute modes (3+ elements, equal gaps): distributeX, distributeY.",
      inputSchema: {
        path: PATH,
        ids: z.array(z.string()),
        align: z.enum([
          "left",
          "right",
          "centerX",
          "top",
          "bottom",
          "centerY",
          "distributeX",
          "distributeY",
        ]),
      },
    },
    async ({ path, ids, align }) =>
      result(await canvasCommand(path, "alignElements", { ids, align }))
  );

  // --- Convenience ---
  server.registerTool(
    "draw_from_mermaid",
    {
      description:
        "Convert a Mermaid diagram definition into Excalidraw elements and add them to the canvas.",
      inputSchema: { path: PATH, mermaid: z.string() },
    },
    async ({ path, mermaid }) =>
      result(
        await canvasCommand(
          path,
          "drawFromMermaid",
          { mermaid },
          {
            revealBefore: true,
            timeoutMs: 30000,
          }
        )
      )
  );

  server.registerTool(
    "set_excalidraw_tool",
    {
      description:
        "Switch the active Excalidraw tool (selection, rectangle, ellipse, diamond, arrow, line, text, freedraw, image, eraser).",
      inputSchema: { path: PATH, tool: z.string() },
    },
    async ({ path, tool }) =>
      result(await canvasCommand(path, "setActiveTool", { tool }))
  );

  server.registerTool(
    "save_excalidraw_diagram",
    {
      description:
        "Save the current drawing to disk via VS Code (serializes the live scene and persists the file).",
      inputSchema: { path: PATH },
    },
    async ({ path }) => result({ ok: true, ...(await saveDiagram(path)) })
  );

  // --- Host-side file I/O ---
  server.registerTool(
    "export_excalidraw_image",
    {
      description:
        "Render the canvas to an image file. 'outPath' is the destination; 'format' is png (default) or svg.",
      inputSchema: {
        path: PATH,
        outPath: z.string(),
        format: z.enum(["png", "svg"]).optional(),
      },
    },
    async ({ path, outPath, format }) =>
      result({ ok: true, ...(await exportImageToFile(path, outPath, format)) })
  );

  server.registerTool(
    "add_excalidraw_image",
    {
      description: "Embed an image file onto the canvas.",
      inputSchema: {
        path: PATH,
        imagePath: z.string(),
        x: z.number().optional(),
        y: z.number().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
      },
    },
    async ({ path, imagePath, x, y, width, height }) =>
      result({
        ok: true,
        ...(await addImageFromFile(path, imagePath, { x, y, width, height })),
      })
  );

  server.registerTool(
    "add_excalidraw_library_items",
    {
      description:
        "Import reusable components into the Excalidraw library. 'library' is an .excalidrawlib JSON string.",
      inputSchema: { library: z.string() },
    },
    async ({ library }) => {
      ExcalidrawEditor.importLibrary(library);
      return result({ ok: true, imported: true });
    }
  );

  return server;
}
