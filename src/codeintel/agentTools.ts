import * as vscode from "vscode";
import { canvasCommand } from "../canvasTools";
import { generateGraph, expandRelations, RelationKind } from "./generate";
import { resolveEdgeRelation } from "./edges";
import {
  CodeLink,
  bestWorkspaceSymbol,
  diagnosticsForLinks,
  hoverMarkdown,
  navigateToLink,
  symbolMetrics,
  staleLinks,
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
  const metrics = await symbolMetrics(rec.codeLink);
  return {
    id,
    symbol: rec.codeLink.symbol,
    hover: hover ?? null,
    references: metrics.references,
    implementations: metrics.implementations,
  };
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

/** Diagram linter: list links that have drifted from the code (missing/moved). */
export async function staleLinkReport(
  path?: string
): Promise<Record<string, unknown>> {
  const links = await fetchLinks(path);
  const stale = await staleLinks(links);
  const byId = new Map(links.map((l) => [l.id, l.codeLink.symbol]));
  const items = Object.entries(stale).map(([id, s]) => ({
    id,
    symbol: byId.get(id),
    reason: s.reason,
    newFile: s.newFile,
  }));
  return { staleCount: items.length, total: links.length, stale: items };
}

/** Generate a diagram from a symbol's call/type hierarchy and place it, pre-linked. */
export async function generateDiagramFromSymbol(input: {
  path?: string;
  symbol: string;
  file?: string;
  mode?: "calls" | "types";
  depth?: number;
  maxNodes?: number;
  includeExternal?: boolean;
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

/** Grow the diagram from an existing linked element by one relationship hop. */
export async function expandElementRelations(input: {
  path?: string;
  id: string;
  kind: RelationKind;
  maxNodes?: number;
  includeExternal?: boolean;
}): Promise<Record<string, unknown>> {
  const rec = (await fetchLinks(input.path)).find((l) => l.id === input.id);
  if (!rec) {
    throw new Error(
      `Element "${input.id}" has no code link. Link it first, or use a generated/linked node.`
    );
  }
  const result = await expandRelations({
    codeLink: rec.codeLink,
    kind: input.kind,
    maxNodes: input.maxNodes,
    includeExternal: input.includeExternal,
  });
  if (result.neighbors.length === 0) {
    return {
      kind: result.kind,
      added: 0,
      connected: 0,
      note: `No ${input.kind} found for "${rec.codeLink.symbol}".`,
    };
  }
  const placed = (await canvasCommand(input.path, "expandFromElement", {
    sourceId: input.id,
    direction: result.direction,
    neighbors: result.neighbors,
  })) as Record<string, unknown>;
  return {
    kind: result.kind,
    direction: result.direction,
    truncated: result.truncated,
    ...placed,
  };
}

/** Resolve the concrete code relationship behind an arrow between two linked nodes. */
export async function edgeRelation(
  path: string | undefined,
  arrowId: string
): Promise<Record<string, unknown>> {
  const ends = (await canvasCommand(path, "getEdgeEndpoints", { arrowId })) as {
    from?: CodeLink | null;
    to?: CodeLink | null;
    relation?: { kind?: string } | null;
    bound?: boolean;
  };
  if (!ends?.from || !ends?.to) {
    return {
      arrowId,
      bound: false,
      note: "This arrow's endpoints are not both linked to code symbols.",
    };
  }
  const rel = await resolveEdgeRelation(ends.from, ends.to);
  const declared = ends.relation?.kind;
  const mismatch = !!declared && rel.kind !== "none" && declared !== rel.kind;
  return {
    arrowId,
    from: ends.from.symbol,
    to: ends.to.symbol,
    kind: rel.kind,
    verified: rel.verified,
    sites: rel.sites,
    note: rel.note,
    declaredKind: declared,
    mismatch,
  };
}

/** Declare (or clear) an arrow's intended relationship metadata. */
export async function setEdgeRelationMeta(
  path: string | undefined,
  arrowId: string,
  kind: string | null
): Promise<Record<string, unknown>> {
  const relation = kind ? { kind } : null;
  return (await canvasCommand(path, "setEdgeRelation", {
    arrowId,
    relation,
  })) as Record<string, unknown>;
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

class GetStaleLinksTool implements vscode.LanguageModelTool<PathInput> {
  async invoke(options: vscode.LanguageModelToolInvocationOptions<PathInput>) {
    return jsonResult({
      ok: true,
      ...(await staleLinkReport(options.input.path)),
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
  includeExternal?: boolean;
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

interface ExpandInput {
  path?: string;
  id: string;
  kind: RelationKind;
  maxNodes?: number;
  includeExternal?: boolean;
}

class ExpandRelationsTool implements vscode.LanguageModelTool<ExpandInput> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<ExpandInput>
  ) {
    return {
      invocationMessage: `Expanding ${options.input.kind} of element ${options.input.id}`,
    };
  }
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ExpandInput>
  ) {
    return jsonResult({
      ok: true,
      ...(await expandElementRelations(options.input)),
    });
  }
}

interface EdgeInput {
  path?: string;
  arrowId: string;
}

class GetEdgeRelationTool implements vscode.LanguageModelTool<EdgeInput> {
  async invoke(options: vscode.LanguageModelToolInvocationOptions<EdgeInput>) {
    const { path, arrowId } = options.input;
    return jsonResult({ ok: true, ...(await edgeRelation(path, arrowId)) });
  }
}

interface SetEdgeInput {
  path?: string;
  arrowId: string;
  kind?: string | null;
}

class SetEdgeRelationTool implements vscode.LanguageModelTool<SetEdgeInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<SetEdgeInput>
  ) {
    const { path, arrowId, kind } = options.input;
    return jsonResult({
      ok: true,
      ...(await setEdgeRelationMeta(path, arrowId, kind ?? null)),
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
      "get_excalidraw_stale_links",
      new GetStaleLinksTool()
    ),
    vscode.lm.registerTool(
      "generate_diagram_from_symbol",
      new GenerateDiagramTool()
    ),
    vscode.lm.registerTool(
      "expand_element_relations",
      new ExpandRelationsTool()
    ),
    vscode.lm.registerTool("get_edge_relation", new GetEdgeRelationTool()),
    vscode.lm.registerTool("set_edge_relation", new SetEdgeRelationTool())
  );
}
