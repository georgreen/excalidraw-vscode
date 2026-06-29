import * as vscode from "vscode";
import { CodeLink, resolveSymbol } from "./router";

/**
 * Generate a diagram graph from a code symbol by walking the language server's
 * call or type hierarchy. Nodes carry a precise `codeLink` (uri + selection),
 * so the resulting diagram is immediately navigable.
 */

export interface GenNode {
  key: string;
  label: string;
  codeLink: CodeLink;
  rank: number;
  row: number;
}

export interface GenEdge {
  from: string;
  to: string;
}

export interface GenGraph {
  mode: "calls" | "types";
  root: string;
  nodes: GenNode[];
  edges: GenEdge[];
  truncated: boolean;
}

interface HierarchyItem {
  name: string;
  kind: vscode.SymbolKind;
  uri: vscode.Uri;
  range: vscode.Range;
  selectionRange: vscode.Range;
}

function cleanName(name: string): string {
  const i = name.indexOf("(");
  return (i >= 0 ? name.slice(0, i) : name).trim();
}

function keyOf(it: HierarchyItem): string {
  return `${it.uri.toString()}@${it.selectionRange.start.line}:${
    it.selectionRange.start.character
  }`;
}

function itemToCodeLink(it: HierarchyItem): CodeLink {
  const start = it.selectionRange.start;
  return {
    kind: vscode.SymbolKind[it.kind]?.toLowerCase(),
    symbol: cleanName(it.name),
    file: vscode.workspace.asRelativePath(it.uri),
    uri: it.uri.toString(),
    selectionStart: { line: start.line, character: start.character },
    lastResolved: new Date().toISOString(),
    status: "linked",
  };
}

async function neighbors(
  item: HierarchyItem,
  mode: "calls" | "types"
): Promise<HierarchyItem[]> {
  try {
    if (mode === "types") {
      return (
        (await vscode.commands.executeCommand<HierarchyItem[]>(
          "vscode.provideSupertypes",
          item
        )) || []
      );
    }
    const outgoing =
      (await vscode.commands.executeCommand<{ to: HierarchyItem }[]>(
        "vscode.provideOutgoingCalls",
        item
      )) || [];
    return outgoing.map((c) => c.to).filter(Boolean);
  } catch {
    return [];
  }
}

export async function generateGraph(opts: {
  symbol: string;
  file?: string;
  mode?: "calls" | "types";
  depth?: number;
  maxNodes?: number;
}): Promise<GenGraph> {
  const mode = opts.mode === "types" ? "types" : "calls";
  const depth = Math.max(1, Math.min(opts.depth ?? 2, 5));
  const maxNodes = Math.max(1, Math.min(opts.maxNodes ?? 30, 100));

  const r = await resolveSymbol({ symbol: opts.symbol, file: opts.file });
  if (!r) {
    throw new Error(
      `Could not resolve symbol "${opts.symbol}". Make sure the project is open and indexed.`
    );
  }
  const prepCmd =
    mode === "types"
      ? "vscode.prepareTypeHierarchy"
      : "vscode.prepareCallHierarchy";
  const roots =
    (await vscode.commands.executeCommand<HierarchyItem[]>(
      prepCmd,
      r.uri,
      r.position
    )) || [];
  if (roots.length === 0) {
    throw new Error(
      `No ${mode} hierarchy available for "${opts.symbol}" (the language server may not support it).`
    );
  }
  const root = roots[0];

  const nodes = new Map<string, GenNode>();
  const edges: GenEdge[] = [];
  const edgeSet = new Set<string>();
  let truncated = false;

  const ensureNode = (it: HierarchyItem, rank: number): void => {
    const key = keyOf(it);
    const existing = nodes.get(key);
    if (existing) {
      existing.rank = Math.min(existing.rank, rank);
      return;
    }
    nodes.set(key, {
      key,
      label: cleanName(it.name),
      codeLink: itemToCodeLink(it),
      rank,
      row: 0,
    });
  };

  ensureNode(root, 0);
  let frontier: { item: HierarchyItem; depth: number }[] = [
    { item: root, depth: 0 },
  ];
  const visited = new Set<string>([keyOf(root)]);

  while (frontier.length > 0) {
    const next: { item: HierarchyItem; depth: number }[] = [];
    for (const { item, depth: d } of frontier) {
      if (d >= depth) {
        continue;
      }
      for (const to of await neighbors(item, mode)) {
        const toKey = keyOf(to);
        if (!nodes.has(toKey) && nodes.size >= maxNodes) {
          truncated = true;
          continue;
        }
        ensureNode(to, d + 1);
        const ek = `${keyOf(item)}->${toKey}`;
        if (!edgeSet.has(ek)) {
          edgeSet.add(ek);
          edges.push({ from: keyOf(item), to: toKey });
        }
        if (!visited.has(toKey)) {
          visited.add(toKey);
          next.push({ item: to, depth: d + 1 });
        }
      }
    }
    frontier = next;
  }

  // Lay out: rank → column, row → position within the column.
  const byRank = new Map<number, GenNode[]>();
  for (const n of nodes.values()) {
    const arr = byRank.get(n.rank) || [];
    arr.push(n);
    byRank.set(n.rank, arr);
  }
  for (const arr of byRank.values()) {
    arr.forEach((n, i) => (n.row = i));
  }

  return {
    mode,
    root: keyOf(root),
    nodes: [...nodes.values()],
    edges,
    truncated,
  };
}
