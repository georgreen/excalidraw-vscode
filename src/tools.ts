import * as vscode from "vscode";
import { showEditor } from "./commands";
import { getActiveWorkspace } from "./utils";
import { registerCanvasTools } from "./canvasTools";
import { registerCodeIntelTools } from "./codeintel/agentTools";

const SOURCE =
  "https://marketplace.visualstudio.com/items?itemName=pomdtr.excalidraw-editor";

const EXCALIDRAW_EXTENSIONS = [
  ".excalidraw",
  ".excalidraw.json",
  ".excalidraw.svg",
  ".excalidraw.png",
];

const FIND_GLOB =
  "**/*.{excalidraw,excalidraw.json,excalidraw.svg,excalidraw.png}";

interface CreateDiagramInput {
  path: string;
  content?: string;
  overwrite?: boolean;
}

interface OpenDiagramInput {
  path: string;
  toSide?: boolean;
}

interface ListDiagramsInput {
  path?: string;
}

function resolveUri(input: string): vscode.Uri {
  if (input.includes("://")) {
    return vscode.Uri.parse(input);
  }
  const isAbsolute = /^([a-zA-Z]:[\\/]|[\\/])/.test(input);
  if (isAbsolute) {
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

function ensureExtension(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (EXCALIDRAW_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    return filePath;
  }
  return `${filePath}.excalidraw`;
}

function isImageScene(uri: vscode.Uri): boolean {
  const lower = uri.path.toLowerCase();
  return lower.endsWith(".png") || lower.endsWith(".svg");
}

function buildSceneJson(content?: string): string {
  const emptyScene = {
    type: "excalidraw",
    version: 2,
    source: SOURCE,
    elements: [],
    appState: {},
    files: {},
  };

  if (!content || content.trim() === "") {
    return JSON.stringify(emptyScene, null, 2);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    throw new Error(
      `The "content" parameter must be valid JSON (an Excalidraw scene object or an array of elements). Parse error: ${
        (e as Error).message
      }`
    );
  }

  if (Array.isArray(parsed)) {
    return JSON.stringify({ ...emptyScene, elements: parsed }, null, 2);
  }

  if (parsed && typeof parsed === "object") {
    const scene: Record<string, unknown> = { ...emptyScene, ...parsed };
    scene.type = "excalidraw";
    return JSON.stringify(scene, null, 2);
  }

  throw new Error(
    'The "content" parameter must be a JSON object (Excalidraw scene) or a JSON array of elements.'
  );
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

function textResult(message: string): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([
    new vscode.LanguageModelTextPart(message),
  ]);
}

function jsonResult(data: unknown): vscode.LanguageModelToolResult {
  return textResult(JSON.stringify(data));
}

/** Create a diagram file and open it. Returns the resolved path. */
export async function createDiagram(
  input: CreateDiagramInput
): Promise<string> {
  const target = ensureExtension(input.path);
  const uri = resolveUri(target);

  if ((await fileExists(uri)) && !input.overwrite) {
    throw new Error(
      `A file already exists at ${target}. Pass overwrite: true to replace it, or open the diagram instead.`
    );
  }

  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, ".."));

  let bytes: Uint8Array;
  if (isImageScene(uri)) {
    // Image scenes (.png/.svg) are created empty; the editor renders a blank
    // canvas and writes the encoded image on the first save.
    bytes = new Uint8Array(0);
  } else {
    bytes = new TextEncoder().encode(buildSceneJson(input.content));
  }

  await vscode.workspace.fs.writeFile(uri, bytes);
  await showEditor(uri);
  return target;
}

/** Open an existing diagram. Throws if it does not exist. */
export async function openDiagram(input: OpenDiagramInput): Promise<string> {
  const uri = resolveUri(input.path);
  if (!(await fileExists(uri))) {
    throw new Error(
      `No file found at ${input.path}. List diagrams to find existing ones, or create one first.`
    );
  }
  await showEditor(uri, input.toSide ? vscode.ViewColumn.Beside : undefined);
  return input.path;
}

/** List workspace diagrams, optionally under a sub-directory. */
export async function listDiagrams(
  input: ListDiagramsInput
): Promise<string[]> {
  const include = input.path
    ? new vscode.RelativePattern(resolveUri(input.path), FIND_GLOB)
    : FIND_GLOB;
  const files = await vscode.workspace.findFiles(
    include,
    "**/node_modules/**",
    500
  );
  return files.map((uri) => vscode.workspace.asRelativePath(uri)).sort();
}

class CreateDiagramTool
  implements vscode.LanguageModelTool<CreateDiagramInput>
{
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<CreateDiagramInput>
  ) {
    return {
      invocationMessage: `Creating Excalidraw diagram ${ensureExtension(
        options.input.path
      )}`,
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<CreateDiagramInput>
  ) {
    const target = await createDiagram(options.input);
    return jsonResult({ ok: true, path: target, created: true, opened: true });
  }
}

class OpenDiagramTool implements vscode.LanguageModelTool<OpenDiagramInput> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<OpenDiagramInput>
  ) {
    return {
      invocationMessage: `Opening Excalidraw diagram ${options.input.path}`,
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<OpenDiagramInput>
  ) {
    await openDiagram(options.input);
    return jsonResult({
      ok: true,
      path: options.input.path,
      opened: true,
      toSide: !!options.input.toSide,
    });
  }
}

class ListDiagramsTool implements vscode.LanguageModelTool<ListDiagramsInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ListDiagramsInput>
  ) {
    const diagrams = await listDiagrams(options.input);
    return jsonResult({ ok: true, diagrams, count: diagrams.length });
  }
}

export function registerTools(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.lm.registerTool(
      "create_excalidraw_diagram",
      new CreateDiagramTool()
    ),
    vscode.lm.registerTool("open_excalidraw_diagram", new OpenDiagramTool()),
    vscode.lm.registerTool("list_excalidraw_diagrams", new ListDiagramsTool())
  );
  registerCanvasTools(context);
  registerCodeIntelTools(context);
}
