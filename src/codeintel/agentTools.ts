import * as vscode from "vscode";
import { canvasCommand } from "../canvasTools";
import { generateGraph } from "./generate";
import {
  CodeLink,
  bestWorkspaceSymbol,
  diagnosticsForLinks,
  hoverMarkdown,
  navigateToLink,
  symbolInformationToCodeLink,
} from "./router";

/**
 * Host-side operations that expose the code-aware layer to agents. These are
 * shared by the VS Code Language Model tools (below) and the MCP bridge, so the
 * behaviour is identical for the built-in agent and external CLI agents.
 *
 * They reuse `canvasCommand` to read/write the diagram (active editor or a given
 * path) and the intelligence router to delegate hover/navigation/diagnostics to
 * the running language servers.
 */

interface LinkRecord {
  id: string;
  codeLink: CodeLink;
}

interface LabelRecord {
  id: string;
  type: string;
  label: string;
  linked: boolean;
}

async function fetchLinks(path?: string): Promise<LinkRecord[]> {
  const data = (await canvasCommand(path, "getCodeLinks")) as {
    links?: LinkRecord[];
  };
  return data?.links || [];
}

/** Link one or more diagram elements to a code symbol. */
export async function linkToSymbol(input: {
  path?: string;
  ids?: string[];
  symbol?: string;
  auto?: boolean;
  unlink?: boolean;
}): Promise<Record<string, unknown>> {
  const { path, ids, symbol, auto, unlink } = input;

  if (unlink) {
    if (!ids || ids.length === 0) {
      throw new Error("Provide the 'ids' of the elements to unlink.");
    }
    await canvasCommand(path, "setCodeLink", { ids, codeLink: null });
    return { unlinked: ids, count: ids.length };
  }

  if (auto && !symbol) {
    const data = (await canvasCommand(path, "getElementLabels")) as {
      elements?: LabelRecord[];
    };
    const targets = (data?.elements || []).filter(
      (e) => (!ids || ids.includes(e.id)) && e.label.trim() !== ""
    );
    const linked: Record<string, unknown>[] = [];
    const unmatched: Record<string, unknown>[] = [];
    for (const t of targets) {
      const sym = await bestWorkspaceSymbol(t.label.trim());
      if (!sym) {
        unmatched.push({ id: t.id, label: t.label });
        continue;
      }
      const codeLink = symbolInformationToCodeLink(sym);
      await canvasCommand(path, "setCodeLink", { ids: [t.id], codeLink });
      linked.push({ id: t.id, symbol: codeLink.symbol, file: codeLink.file });
    }
    return {
      mode: "auto",
      linkedCount: linked.length,
      linked,
      unmatched,
    };
  }

  if (!symbol) {
    throw new Error(
      "Provide 'symbol' to link to, or set 'auto: true' to match elements by their label."
    );
  }
  if (!ids || ids.length === 0) {
    throw new Error("Provide the 'ids' of the elements to link.");
  }
  const sym = await bestWorkspaceSymbol(symbol);
  if (!sym) {
    throw new Error(
      `No workspace symbol found for "${symbol}". Make sure the project folder is open and indexed by a language server.`
    );
  }
  const codeLink = symbolInformationToCodeLink(sym);
  await canvasCommand(path, "setCodeLink", { ids, codeLink });
  return {
    linkedCount: ids.length,
    ids,
    symbol: codeLink.symbol,
    kind: codeLink.kind,
    file: codeLink.file,
  };
}

/** List every element on the diagram that is linked to a code symbol. */
export async function listCodeLinks(
  path?: string
): Promise<Record<string, unknown>> {
  const links = await fetchLinks(path);
  return { count: links.length, links };
}

/** Hover documentation (signature/docs) for a linked element. */
export async function hoverForElement(
  path: string | undefined,
  id: string
): Promise<Record<string, unknown>> {
  const rec = (await fetchLinks(path)).find((l) => l.id === id);
  if (!rec) {
    throw new Error(
      `Element "${id}" has no code link. Link it first with link_excalidraw_to_symbol.`
    );
  }
  const hover = await hoverMarkdown(rec.codeLink);
  return { id, symbol: rec.codeLink.symbol, hover: hover ?? null };
}

/** Open the code behind a linked element in an editor. */
export async function navigateElement(
  path: string | undefined,
  id: string
): Promise<Record<string, unknown>> {
  const rec = (await fetchLinks(path)).find((l) => l.id === id);
  if (!rec) {
    throw new Error(`Element "${id}" has no code link.`);
  }
  const opened = await navigateToLink(rec.codeLink);
  return { id, symbol: rec.codeLink.symbol, opened };
}

/** Error/warning counts for the files behind the diagram's linked elements. */
export async function linkedDiagnostics(
  path?: string
): Promise<Record<string, unknown>> {
  const links = await fetchLinks(path);
  const badges = await diagnosticsForLinks(links);
  return { files: Object.keys(badges).length, badges };
}

/** Generate a diagram from a symbol's call/type hierarchy and place it, pre-linked. */
export async function generateDiagramFromSymbol(input: {
  path?: string;
  symbol: string;
  file?: string;
  mode?: "calls" | "types";
  depth?: number;
  maxNodes?: number;
  originX?: number;
  originY?: number;
}): Promise<Record<string, unknown>> {
  const graph = await generateGraph(input);
  const placed = (await canvasCommand(input.path, "placeGeneratedGraph", {
    nodes: graph.nodes,
    edges: graph.edges,
    originX: input.originX,
    originY: input.originY,
  })) as { nodes?: unknown };
  return {
    mode: graph.mode,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    truncated: graph.truncated,
    nodes: placed?.nodes,
  };
}

// ---- Language Model tools --------------------------------------------------

function jsonResult(data: unknown): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([
    new vscode.LanguageModelTextPart(JSON.stringify(data)),
  ]);
}

function target(path?: string): string {
  return path ? path : "the active diagram";
}

interface LinkInput {
  path?: string;
  ids?: string[];
  symbol?: string;
  auto?: boolean;
  unlink?: boolean;
}
interface PathInput {
  path?: string;
}
interface ElementInput {
  path?: string;
  id: string;
}

class LinkToSymbolTool implements vscode.LanguageModelTool<LinkInput> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<LinkInput>
  ) {
    const i = options.input;
    return {
      invocationMessage: i.unlink
        ? `Unlinking elements in ${target(i.path)}`
        : i.auto
        ? `Auto-linking elements in ${target(i.path)} to code symbols`
        : `Linking elements in ${target(i.path)} to ${i.symbol}`,
    };
  }
  async invoke(options: vscode.LanguageModelToolInvocationOptions<LinkInput>) {
    return jsonResult({ ok: true, ...(await linkToSymbol(options.input)) });
  }
}

class GetCodeLinksTool implements vscode.LanguageModelTool<PathInput> {
  async invoke(options: vscode.LanguageModelToolInvocationOptions<PathInput>) {
    return jsonResult({
      ok: true,
      ...(await listCodeLinks(options.input.path)),
    });
  }
}

class GetCodeHoverTool implements vscode.LanguageModelTool<ElementInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ElementInput>
  ) {
    const { path, id } = options.input;
    return jsonResult({ ok: true, ...(await hoverForElement(path, id)) });
  }
}

class NavigateToCodeTool implements vscode.LanguageModelTool<ElementInput> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<ElementInput>
  ) {
    return {
      invocationMessage: `Opening code for element ${options.input.id}`,
    };
  }
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ElementInput>
  ) {
    const { path, id } = options.input;
    return jsonResult({ ok: true, ...(await navigateElement(path, id)) });
  }
}

class GetLinkedDiagnosticsTool implements vscode.LanguageModelTool<PathInput> {
  async invoke(options: vscode.LanguageModelToolInvocationOptions<PathInput>) {
    return jsonResult({
      ok: true,
      ...(await linkedDiagnostics(options.input.path)),
    });
  }
}

interface GenerateInput {
  path?: string;
  symbol: string;
  file?: string;
  mode?: "calls" | "types";
  depth?: number;
  maxNodes?: number;
  originX?: number;
  originY?: number;
}

class GenerateDiagramTool implements vscode.LanguageModelTool<GenerateInput> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<GenerateInput>
  ) {
    const i = options.input;
    return {
      invocationMessage: `Generating a ${i.mode ?? "calls"} diagram from ${
        i.symbol
      }`,
    };
  }
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<GenerateInput>
  ) {
    return jsonResult({
      ok: true,
      ...(await generateDiagramFromSymbol(options.input)),
    });
  }
}

export function registerCodeIntelTools(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.lm.registerTool("link_excalidraw_to_symbol", new LinkToSymbolTool()),
    vscode.lm.registerTool("get_excalidraw_code_links", new GetCodeLinksTool()),
    vscode.lm.registerTool(
      "get_code_hover_for_element",
      new GetCodeHoverTool()
    ),
    vscode.lm.registerTool(
      "navigate_to_element_code",
      new NavigateToCodeTool()
    ),
    vscode.lm.registerTool(
      "get_linked_diagnostics",
      new GetLinkedDiagnosticsTool()
    ),
    vscode.lm.registerTool(
      "generate_diagram_from_symbol",
      new GenerateDiagramTool()
    )
  );
}
