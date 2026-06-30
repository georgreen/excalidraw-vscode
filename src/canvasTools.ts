import * as vscode from "vscode";
import * as path from "path";
import { Base64 } from "js-base64";
import { ExcalidrawEditor } from "./editor";
import { CommandAction } from "./protocol";
import { getActiveWorkspace } from "./utils";

const VIEW_TYPE = "editor.excalidraw";

function resolveUri(input: string): vscode.Uri {
  if (input.includes("://")) {
    return vscode.Uri.parse(input);
  }
  if (/^([a-zA-Z]:[\\/]|[\\/])/.test(input)) {
    return vscode.Uri.file(input);
  }
  const ws = getActiveWorkspace();
  if (!ws) {
    throw new Error(
      "No workspace folder is open. Provide an absolute path or open a folder first."
    );
  }
  return vscode.Uri.joinPath(ws.uri, input);
}

/** Find the URI of the active (or any visible) Excalidraw custom editor tab. */
function getActiveExcalidrawUri(): vscode.Uri | undefined {
  const active = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (
    active instanceof vscode.TabInputCustom &&
    active.viewType === VIEW_TYPE
  ) {
    return active.uri;
  }
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (
        input instanceof vscode.TabInputCustom &&
        input.viewType === VIEW_TYPE
      ) {
        return input.uri;
      }
    }
  }
  return undefined;
}

async function resolveTargetEditor(
  pathInput?: string
): Promise<ExcalidrawEditor> {
  let uri: vscode.Uri | undefined;
  if (pathInput) {
    uri = resolveUri(pathInput);
  } else {
    uri = getActiveExcalidrawUri();
    if (!uri) {
      throw new Error(
        "No 'path' was provided and no Excalidraw editor is currently open. Open or create a diagram first, or pass a 'path'."
      );
    }
  }
  return ExcalidrawEditor.resolveEditor(uri);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolve the target editor, optionally reveal it, and send a canvas command.
 * Shared by the Language Model tools and the MCP bridge.
 */
export async function canvasCommand(
  pathInput: string | undefined,
  action: CommandAction,
  params?: unknown,
  opts?: { revealBefore?: boolean; timeoutMs?: number }
): Promise<unknown> {
  const editor = await resolveTargetEditor(pathInput);
  if (opts?.revealBefore) {
    editor.reveal();
    await delay(250);
  }
  return editor.sendCommand(action, params, opts?.timeoutMs);
}

function textResult(message: string): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([
    new vscode.LanguageModelTextPart(message),
  ]);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Serialize a tool result as a JSON string so agents get machine-readable output. */
function jsonResult(data: unknown): vscode.LanguageModelToolResult {
  const payload = isPlainObject(data)
    ? { ok: true, ...data }
    : { ok: true, data };
  return textResult(JSON.stringify(payload));
}

function describeTarget(pathInput?: string): string {
  return pathInput ? path.basename(pathInput) : "the active diagram";
}

interface CanvasInput {
  path?: string;
}

/**
 * Generic Language Model Tool that forwards a single canvas action to the
 * target editor's webview and formats the result. Keeps every concrete tool a
 * one-liner registration.
 */
class CanvasTool<T extends CanvasInput> implements vscode.LanguageModelTool<T> {
  constructor(
    private readonly action: CommandAction,
    private readonly options: {
      buildParams?: (input: T) => unknown;
      invocationMessage: (input: T) => string;
      /** Reveal the target webview before sending (needed for rAF-dependent rendering, e.g. Mermaid). */
      revealBefore?: boolean;
      /** Override the default command timeout (ms). */
      timeoutMs?: number;
    }
  ) {}

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<T>
  ) {
    return { invocationMessage: this.options.invocationMessage(options.input) };
  }

  async invoke(options: vscode.LanguageModelToolInvocationOptions<T>) {
    const input = options.input;
    const params = this.options.buildParams
      ? this.options.buildParams(input)
      : input;
    const data = await canvasCommand(input.path, this.action, params, {
      revealBefore: this.options.revealBefore,
      timeoutMs: this.options.timeoutMs,
    });
    return jsonResult(data);
  }
}

// ---- Input types -----------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
interface AddElementsInput extends CanvasInput {
  elements: any[];
}
interface ConnectInput extends CanvasInput {
  startId: string;
  endId: string;
  label?: string;
}
interface UpdateInput extends CanvasInput {
  updates: any[];
}
interface MoveInput extends CanvasInput {
  ids: string[];
  dx?: number;
  dy?: number;
  x?: number;
  y?: number;
}
interface PanInput extends CanvasInput {
  scrollX?: number;
  scrollY?: number;
  dx?: number;
  dy?: number;
  zoom?: number;
  zoomDelta?: number;
}
interface ReorderInput extends CanvasInput {
  ids: string[];
  mode: string;
}
interface LockInput extends CanvasInput {
  ids: string[];
  locked?: boolean;
}
interface DuplicateInput extends CanvasInput {
  ids: string[];
  dx?: number;
  dy?: number;
}
interface FlipInput extends CanvasInput {
  ids: string[];
  axis: string;
}
interface LinkInput extends CanvasInput {
  ids: string[];
  link?: string;
}
interface ArrowheadsInput extends CanvasInput {
  ids: string[];
  start?: string;
  end?: string;
}
interface DeleteInput extends CanvasInput {
  ids: string[];
}
interface SetSceneInput extends CanvasInput {
  elements: any[];
}
interface SelectInput extends CanvasInput {
  ids: string[];
}
interface ScrollInput extends CanvasInput {
  ids?: string[];
}
interface StyleInput extends CanvasInput {
  ids: string[];
  style: any;
}
interface GroupInput extends CanvasInput {
  ids: string[];
}
interface FrameInput extends CanvasInput {
  ids: string[];
  name?: string;
}
interface AlignInput extends CanvasInput {
  ids: string[];
  align: string;
}
interface MermaidInput extends CanvasInput {
  mermaid: string;
}
interface SetToolInput extends CanvasInput {
  tool: string;
}
interface ExportInput extends CanvasInput {
  outPath: string;
  format?: string;
}
interface AddImageInput extends CanvasInput {
  imagePath: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}
interface LibraryInput {
  library: string;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function mimeForPath(filePath: string): string {
  const ext = path.parse(filePath).ext.toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function asRecord(data: unknown): Record<string, unknown> {
  return (data as Record<string, unknown>) || {};
}

/** Export the canvas to an image file. Returns the format and written path. */
export async function exportImageToFile(
  pathInput: string | undefined,
  outPath: string,
  format = "png"
): Promise<{ format: unknown; path: string }> {
  const editor = await resolveTargetEditor(pathInput);
  const data = asRecord(
    await editor.sendCommand("exportImage", { format: format.toLowerCase() })
  );
  const outUri = resolveUri(outPath);
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(outUri, ".."));
  const bytes =
    data.encoding === "base64"
      ? Base64.toUint8Array(String(data.data))
      : new TextEncoder().encode(String(data.data));
  await vscode.workspace.fs.writeFile(outUri, bytes);
  return { format: data.format, path: outPath };
}

/** Read an image file and embed it onto the canvas. */
export async function addImageFromFile(
  pathInput: string | undefined,
  imagePath: string,
  dims: { x?: number; y?: number; width?: number; height?: number }
): Promise<Record<string, unknown>> {
  const imageUri = resolveUri(imagePath);
  let bytes: Uint8Array;
  try {
    bytes = await vscode.workspace.fs.readFile(imageUri);
  } catch {
    throw new Error(`Could not read image file: ${imagePath}`);
  }
  const mimeType = mimeForPath(imagePath);
  const dataURL = `data:${mimeType};base64,${Base64.fromUint8Array(bytes)}`;
  const editor = await resolveTargetEditor(pathInput);
  return asRecord(
    await editor.sendCommand("addImage", { dataURL, mimeType, ...dims })
  );
}

/**
 * Persist the current drawing to disk: ask the webview to serialize the live
 * scene, push it into the document, then invoke VS Code's save pipeline.
 */
export async function saveDiagram(
  pathInput?: string
): Promise<{ path: string; saved: boolean }> {
  const editor = await resolveTargetEditor(pathInput);
  const data = asRecord(await editor.sendCommand("save"));
  if (Array.isArray(data.content)) {
    await editor.document.update(new Uint8Array(data.content as number[]));
  }
  const savedUri = await vscode.workspace.save(editor.document.uri);
  if (!savedUri) {
    // Fallback: write the file directly if VS Code did not handle the save.
    await editor.document.save();
  }
  return {
    path: vscode.workspace.asRelativePath(editor.document.uri),
    saved: true,
  };
}

/** Save the current drawing via VS Code. */
class SaveDiagramTool implements vscode.LanguageModelTool<CanvasInput> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<CanvasInput>
  ) {
    return {
      invocationMessage: `Saving ${describeTarget(options.input.path)}`,
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<CanvasInput>
  ) {
    const result = await saveDiagram(options.input.path);
    return jsonResult({ ok: true, ...result });
  }
}

/** Export the canvas to an image file (host writes the bytes the webview returns). */
class ExportImageTool implements vscode.LanguageModelTool<ExportInput> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<ExportInput>
  ) {
    return {
      invocationMessage: `Exporting ${describeTarget(
        options.input.path
      )} to an image`,
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ExportInput>
  ) {
    const input = options.input;
    const result = await exportImageToFile(
      input.path,
      input.outPath,
      input.format || "png"
    );
    return jsonResult(result);
  }
}

/** Embed an image file onto the canvas (host reads the file, webview adds it). */
class AddImageTool implements vscode.LanguageModelTool<AddImageInput> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<AddImageInput>
  ) {
    return {
      invocationMessage: `Adding an image to ${describeTarget(
        options.input.path
      )}`,
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<AddImageInput>
  ) {
    const input = options.input;
    const data = await addImageFromFile(input.path, input.imagePath, {
      x: input.x,
      y: input.y,
      width: input.width,
      height: input.height,
    });
    return jsonResult(data);
  }
}

/** Import items into the shared Excalidraw library (broadcasts to open editors). */
class AddLibraryItemsTool implements vscode.LanguageModelTool<LibraryInput> {
  async prepareInvocation() {
    return { invocationMessage: "Adding items to the Excalidraw library" };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<LibraryInput>
  ) {
    if (!options.input.library) {
      throw new Error('"library" must be an .excalidrawlib JSON string.');
    }
    ExcalidrawEditor.importLibrary(options.input.library);
    return jsonResult({ imported: true });
  }
}

interface NormalizedLibraryItem {
  id: string;
  name?: string;
  status?: string;
  elements: any[];
}

/** Parse an .excalidrawlib JSON string into a normalized item list (v1 + v2). */
function parseLibraryItems(raw?: string): NormalizedLibraryItem[] {
  if (!raw) {
    return [];
  }
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  // v2: { libraryItems: [{ id, status, name?, elements }] }
  if (Array.isArray(parsed?.libraryItems)) {
    return parsed.libraryItems.map((it: any, i: number) => ({
      id: it.id ?? `item-${i}`,
      name: it.name,
      status: it.status,
      elements: Array.isArray(it.elements) ? it.elements : [],
    }));
  }
  // v1: { library: [ [...elements], ... ] }
  if (Array.isArray(parsed?.library)) {
    return parsed.library.map((els: any, i: number) => ({
      id: `item-${i}`,
      elements: Array.isArray(els) ? els : [],
    }));
  }
  return [];
}

/** Return the items currently in the Excalidraw library. */
export async function getLibrary(
  pathInput?: string
): Promise<Record<string, unknown>> {
  const editor = await resolveTargetEditor(pathInput);
  const items = parseLibraryItems(await editor.getLibrary());
  return {
    count: items.length,
    items: items.map((it, index) => ({
      index,
      id: it.id,
      name: it.name,
      status: it.status,
      elementCount: it.elements.length,
    })),
  };
}

/** Place (stamp) a library item's elements onto the canvas. */
export async function placeLibraryItem(
  pathInput: string | undefined,
  selector: { id?: string; index?: number; elements?: any[] },
  x?: number,
  y?: number
): Promise<Record<string, unknown>> {
  const editor = await resolveTargetEditor(pathInput);
  let elements = selector.elements;
  if (!elements) {
    const items = parseLibraryItems(await editor.getLibrary());
    if (items.length === 0) {
      throw new Error(
        "The Excalidraw library is empty. Use add_excalidraw_library_items first, or pass elements directly."
      );
    }
    let item: NormalizedLibraryItem | undefined;
    if (selector.id !== undefined) {
      item = items.find((it) => it.id === selector.id);
    } else if (selector.index !== undefined) {
      item = items[selector.index];
    }
    if (!item) {
      throw new Error(
        `Library item not found. Use get_excalidraw_library to list available items (got ${items.length}).`
      );
    }
    elements = item.elements;
  }
  if (!Array.isArray(elements) || elements.length === 0) {
    throw new Error("The selected library item has no elements to place.");
  }
  return asRecord(
    await editor.sendCommand("placeLibraryElements", { elements, x, y })
  );
}

class GetLibraryTool implements vscode.LanguageModelTool<CanvasInput> {
  async prepareInvocation() {
    return { invocationMessage: "Reading the Excalidraw library" };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<CanvasInput>
  ) {
    return jsonResult({ ok: true, ...(await getLibrary(options.input.path)) });
  }
}

interface PlaceLibraryInput extends CanvasInput {
  id?: string;
  index?: number;
  elements?: any[];
  x?: number;
  y?: number;
}

class PlaceLibraryItemTool
  implements vscode.LanguageModelTool<PlaceLibraryInput>
{
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<PlaceLibraryInput>
  ) {
    return {
      invocationMessage: `Placing a library item on ${describeTarget(
        options.input.path
      )}`,
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<PlaceLibraryInput>
  ) {
    const i = options.input;
    const data = await placeLibraryItem(
      i.path,
      { id: i.id, index: i.index, elements: i.elements },
      i.x,
      i.y
    );
    return jsonResult({ ok: true, ...data });
  }
}

export function registerCanvasTools(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    // --- Read tools ---
    vscode.lm.registerTool(
      "get_excalidraw_scene",
      new CanvasTool("getScene", {
        invocationMessage: (i) => `Reading ${describeTarget(i.path)}`,
      })
    ),
    vscode.lm.registerTool(
      "get_excalidraw_selection",
      new CanvasTool("getSelection", {
        invocationMessage: (i) =>
          `Reading selection in ${describeTarget(i.path)}`,
      })
    ),
    vscode.lm.registerTool(
      "get_excalidraw_appstate",
      new CanvasTool("getAppState", {
        invocationMessage: (i) =>
          `Reading app state of ${describeTarget(i.path)}`,
      })
    ),
    vscode.lm.registerTool(
      "get_excalidraw_mermaid",
      new CanvasTool("getMermaid", {
        invocationMessage: (i) =>
          `Reading ${describeTarget(i.path)} as Mermaid`,
      })
    ),

    // --- Authoring tools ---
    vscode.lm.registerTool(
      "add_excalidraw_elements",
      new CanvasTool<AddElementsInput>("addElements", {
        buildParams: (i) => ({ elements: i.elements }),
        invocationMessage: (i) => `Drawing on ${describeTarget(i.path)}`,
      })
    ),
    vscode.lm.registerTool(
      "connect_excalidraw_elements",
      new CanvasTool<ConnectInput>("connectElements", {
        buildParams: (i) => ({
          startId: i.startId,
          endId: i.endId,
          label: i.label,
        }),
        invocationMessage: (i) =>
          `Connecting elements in ${describeTarget(i.path)}`,
      })
    ),
    vscode.lm.registerTool(
      "update_excalidraw_elements",
      new CanvasTool<UpdateInput>("updateElements", {
        buildParams: (i) => ({ updates: i.updates }),
        invocationMessage: (i) =>
          `Updating elements in ${describeTarget(i.path)}`,
      })
    ),
    vscode.lm.registerTool(
      "move_excalidraw_elements",
      new CanvasTool<MoveInput>("moveElements", {
        buildParams: (i) => ({
          ids: i.ids,
          dx: i.dx,
          dy: i.dy,
          x: i.x,
          y: i.y,
        }),
        invocationMessage: (i) =>
          `Moving elements in ${describeTarget(i.path)}`,
      })
    ),
    vscode.lm.registerTool(
      "delete_excalidraw_elements",
      new CanvasTool<DeleteInput>("deleteElements", {
        buildParams: (i) => ({ ids: i.ids }),
        invocationMessage: (i) =>
          `Deleting elements in ${describeTarget(i.path)}`,
      })
    ),
    vscode.lm.registerTool(
      "set_excalidraw_scene",
      new CanvasTool<SetSceneInput>("setScene", {
        buildParams: (i) => ({ elements: i.elements }),
        invocationMessage: (i) =>
          `Replacing scene in ${describeTarget(i.path)}`,
      })
    ),
    vscode.lm.registerTool(
      "clear_excalidraw_canvas",
      new CanvasTool("clearCanvas", {
        invocationMessage: (i) => `Clearing ${describeTarget(i.path)}`,
      })
    ),

    // --- Selection / viewport ---
    vscode.lm.registerTool(
      "select_excalidraw_elements",
      new CanvasTool<SelectInput>("selectElements", {
        buildParams: (i) => ({ ids: i.ids }),
        invocationMessage: (i) =>
          `Selecting elements in ${describeTarget(i.path)}`,
      })
    ),
    vscode.lm.registerTool(
      "reorder_excalidraw_elements",
      new CanvasTool<ReorderInput>("reorderElements", {
        buildParams: (i) => ({ ids: i.ids, mode: i.mode }),
        invocationMessage: (i) =>
          `Reordering elements in ${describeTarget(i.path)}`,
      })
    ),
    vscode.lm.registerTool(
      "lock_excalidraw_elements",
      new CanvasTool<LockInput>("lockElements", {
        buildParams: (i) => ({ ids: i.ids, locked: i.locked }),
        invocationMessage: (i) =>
          `${
            i.locked === false ? "Unlocking" : "Locking"
          } elements in ${describeTarget(i.path)}`,
      })
    ),
    vscode.lm.registerTool(
      "duplicate_excalidraw_elements",
      new CanvasTool<DuplicateInput>("duplicateElements", {
        buildParams: (i) => ({ ids: i.ids, dx: i.dx, dy: i.dy }),
        invocationMessage: (i) =>
          `Duplicating elements in ${describeTarget(i.path)}`,
      })
    ),
    vscode.lm.registerTool(
      "flip_excalidraw_elements",
      new CanvasTool<FlipInput>("flipElements", {
        buildParams: (i) => ({ ids: i.ids, axis: i.axis }),
        invocationMessage: (i) =>
          `Flipping elements in ${describeTarget(i.path)}`,
      })
    ),
    vscode.lm.registerTool(
      "set_excalidraw_link",
      new CanvasTool<LinkInput>("setLink", {
        buildParams: (i) => ({ ids: i.ids, link: i.link }),
        invocationMessage: (i) =>
          `Setting link on elements in ${describeTarget(i.path)}`,
      })
    ),
    vscode.lm.registerTool(
      "set_excalidraw_arrowheads",
      new CanvasTool<ArrowheadsInput>("setArrowheads", {
        buildParams: (i) => ({ ids: i.ids, start: i.start, end: i.end }),
        invocationMessage: (i) =>
          `Setting arrowheads in ${describeTarget(i.path)}`,
      })
    ),
    vscode.lm.registerTool(
      "scroll_to_excalidraw_content",
      new CanvasTool<ScrollInput>("scrollToContent", {
        buildParams: (i) => ({ ids: i.ids }),
        invocationMessage: (i) =>
          `Scrolling ${describeTarget(i.path)} into view`,
      })
    ),
    vscode.lm.registerTool(
      "pan_excalidraw_canvas",
      new CanvasTool<PanInput>("panCanvas", {
        buildParams: (i) => ({
          scrollX: i.scrollX,
          scrollY: i.scrollY,
          dx: i.dx,
          dy: i.dy,
          zoom: i.zoom,
          zoomDelta: i.zoomDelta,
        }),
        invocationMessage: (i) => `Panning ${describeTarget(i.path)}`,
      })
    ),

    // --- Styling / layout ---
    vscode.lm.registerTool(
      "style_excalidraw_elements",
      new CanvasTool<StyleInput>("styleElements", {
        buildParams: (i) => ({ ids: i.ids, style: i.style }),
        invocationMessage: (i) =>
          `Styling elements in ${describeTarget(i.path)}`,
      })
    ),
    vscode.lm.registerTool(
      "group_excalidraw_elements",
      new CanvasTool<GroupInput>("groupElements", {
        buildParams: (i) => ({ ids: i.ids }),
        invocationMessage: (i) =>
          `Grouping elements in ${describeTarget(i.path)}`,
      })
    ),
    vscode.lm.registerTool(
      "ungroup_excalidraw_elements",
      new CanvasTool<GroupInput>("ungroupElements", {
        buildParams: (i) => ({ ids: i.ids }),
        invocationMessage: (i) =>
          `Ungrouping elements in ${describeTarget(i.path)}`,
      })
    ),
    vscode.lm.registerTool(
      "frame_excalidraw_elements",
      new CanvasTool<FrameInput>("frameElements", {
        buildParams: (i) => ({ ids: i.ids, name: i.name }),
        invocationMessage: (i) =>
          `Framing elements in ${describeTarget(i.path)}`,
      })
    ),
    vscode.lm.registerTool(
      "align_excalidraw_elements",
      new CanvasTool<AlignInput>("alignElements", {
        buildParams: (i) => ({ ids: i.ids, align: i.align }),
        invocationMessage: (i) =>
          `Aligning elements in ${describeTarget(i.path)}`,
      })
    ),

    // --- Convenience ---
    vscode.lm.registerTool(
      "draw_from_mermaid",
      new CanvasTool<MermaidInput>("drawFromMermaid", {
        buildParams: (i) => ({ mermaid: i.mermaid }),
        invocationMessage: (i) =>
          `Drawing a Mermaid diagram on ${describeTarget(i.path)}`,
        revealBefore: true,
        timeoutMs: 30000,
      })
    ),
    vscode.lm.registerTool(
      "set_excalidraw_tool",
      new CanvasTool<SetToolInput>("setActiveTool", {
        buildParams: (i) => ({ tool: i.tool }),
        invocationMessage: (i) =>
          `Switching active tool in ${describeTarget(i.path)}`,
      })
    ),

    // --- Tools that need host-side file I/O ---
    vscode.lm.registerTool("save_excalidraw_diagram", new SaveDiagramTool()),
    vscode.lm.registerTool("export_excalidraw_image", new ExportImageTool()),
    vscode.lm.registerTool("add_excalidraw_image", new AddImageTool()),
    vscode.lm.registerTool(
      "add_excalidraw_library_items",
      new AddLibraryItemsTool()
    ),
    vscode.lm.registerTool("get_excalidraw_library", new GetLibraryTool()),
    vscode.lm.registerTool(
      "place_excalidraw_library_item",
      new PlaceLibraryItemTool()
    )
  );
}
