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

/** A symbol that lives outside the user's source (dependencies / language libs). */
export function isExternalUri(uri: vscode.Uri): boolean {
  const p = uri.path;
  return (
    /\/node_modules\//.test(p) ||
    /\/lib\.[^/]*\.d\.ts$/.test(p) ||
    /\/typescript\/lib\//.test(p)
  );
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
  includeExternal?: boolean;
}): Promise<GenGraph> {
  const mode = opts.mode === "types" ? "types" : "calls";
  const depth = Math.max(1, Math.min(opts.depth ?? 2, 5));
  const maxNodes = Math.max(1, Math.min(opts.maxNodes ?? 30, 100));
  const includeExternal = opts.includeExternal ?? false;

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
        if (!includeExternal && isExternalUri(to.uri)) {
          continue;
        }
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

export type RelationKind =
  | "callees"
  | "callers"
  | "supertypes"
  | "subtypes"
  | "implementations"
  | "members";

export interface RelationNeighbor {
  key: string;
  label: string;
  codeLink: CodeLink;
}

export interface ExpandResult {
  kind: RelationKind;
  /** "out": edge source→neighbor; "in": edge neighbor→source. */
  direction: "out" | "in";
  neighbors: RelationNeighbor[];
  truncated: boolean;
}

function locationToItem(loc: vscode.Location | vscode.LocationLink): {
  uri: vscode.Uri;
  range: vscode.Range;
} {
  const link = loc as vscode.LocationLink;
  if (link.targetUri) {
    return {
      uri: link.targetUri,
      range: link.targetSelectionRange ?? link.targetRange,
    };
  }
  const l = loc as vscode.Location;
  return { uri: l.uri, range: l.range };
}

/**
 * Find the document symbol at a position: prefer the one whose selectionRange
 * (the identifier) contains it, else the deepest whose full range contains it.
 */
function findSymbolAtPosition(
  symbols: vscode.DocumentSymbol[],
  pos: vscode.Position
): vscode.DocumentSymbol | undefined {
  let bySelection: vscode.DocumentSymbol | undefined;
  let byRange: vscode.DocumentSymbol | undefined;
  const dfs = (list: vscode.DocumentSymbol[]) => {
    for (const s of list) {
      if (s.selectionRange.contains(pos)) {
        bySelection = s;
      }
      if (s.range.contains(pos)) {
        byRange = s;
        dfs(s.children || []);
      }
    }
  };
  dfs(symbols);
  return bySelection || byRange;
}

/**
 * Name the enclosing symbol at a position (deepest document symbol whose range
 * contains it). Used to label implementation/reference targets, which come back
 * as bare locations.
 */
async function nameAtLocation(
  uri: vscode.Uri,
  pos: vscode.Position
): Promise<{ name: string; kind: vscode.SymbolKind; selection: vscode.Range }> {
  const symbols =
    (await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      "vscode.executeDocumentSymbolProvider",
      uri
    )) || [];
  let best: vscode.DocumentSymbol | undefined;
  const dfs = (list: vscode.DocumentSymbol[]) => {
    for (const s of list) {
      if (s.range.contains(pos)) {
        best = s;
        dfs(s.children || []);
      }
    }
  };
  dfs(symbols);
  if (best) {
    return { name: best.name, kind: best.kind, selection: best.selectionRange };
  }
  return {
    name: uri.path.split("/").pop() || "symbol",
    kind: vscode.SymbolKind.File,
    selection: new vscode.Range(pos, pos),
  };
}

/**
 * Expand one relationship hop from an already-linked element. Returns the
 * neighbor symbols (each with a precise codeLink) and the edge direction, so the
 * caller can place them next to the source on the canvas.
 */
export async function expandRelations(opts: {
  codeLink: CodeLink;
  kind: RelationKind;
  maxNodes?: number;
  includeExternal?: boolean;
}): Promise<ExpandResult> {
  const kind = opts.kind;
  const maxNodes = Math.max(1, Math.min(opts.maxNodes ?? 20, 100));
  const includeExternal = opts.includeExternal ?? false;

  const r = await resolveSymbol(opts.codeLink);
  if (!r) {
    throw new Error(
      `Could not resolve "${opts.codeLink.symbol}". Make sure the project is open and indexed.`
    );
  }

  const items: HierarchyItem[] = [];
  let direction: "out" | "in" = "out";

  if (kind === "members") {
    const symbols =
      (await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        "vscode.executeDocumentSymbolProvider",
        r.uri
      )) || [];
    const container = findSymbolAtPosition(symbols, r.position);
    const className = cleanName(opts.codeLink.symbol);
    const neighbors: RelationNeighbor[] = [];
    const seenKeys = new Set<string>();
    let truncated = false;
    for (const ch of container?.children || []) {
      if (neighbors.length >= maxNodes) {
        truncated = true;
        break;
      }
      const start = ch.selectionRange.start;
      const key = `${r.uri.toString()}@${start.line}:${start.character}`;
      if (seenKeys.has(key)) {
        continue;
      }
      seenKeys.add(key);
      const member = cleanName(ch.name);
      neighbors.push({
        key,
        label: ch.detail ? `${member} ${ch.detail}`.trim() : member,
        codeLink: {
          kind: vscode.SymbolKind[ch.kind]?.toLowerCase(),
          symbol: `${className}.${member}`,
          containerName: className,
          file: vscode.workspace.asRelativePath(r.uri),
          uri: r.uri.toString(),
          selectionStart: { line: start.line, character: start.character },
          lastResolved: new Date().toISOString(),
          status: "linked",
        },
      });
    }
    return { kind, direction: "out", neighbors, truncated };
  }

  if (kind === "callees" || kind === "callers") {
    const roots =
      (await vscode.commands.executeCommand<HierarchyItem[]>(
        "vscode.prepareCallHierarchy",
        r.uri,
        r.position
      )) || [];
    if (roots[0]) {
      if (kind === "callees") {
        direction = "out";
        const out =
          (await vscode.commands.executeCommand<{ to: HierarchyItem }[]>(
            "vscode.provideOutgoingCalls",
            roots[0]
          )) || [];
        items.push(...out.map((c) => c.to).filter(Boolean));
      } else {
        direction = "in";
        const inc =
          (await vscode.commands.executeCommand<{ from: HierarchyItem }[]>(
            "vscode.provideIncomingCalls",
            roots[0]
          )) || [];
        items.push(...inc.map((c) => c.from).filter(Boolean));
      }
    }
  } else if (kind === "supertypes" || kind === "subtypes") {
    const roots =
      (await vscode.commands.executeCommand<HierarchyItem[]>(
        "vscode.prepareTypeHierarchy",
        r.uri,
        r.position
      )) || [];
    if (roots[0]) {
      direction = kind === "supertypes" ? "out" : "in";
      const cmd =
        kind === "supertypes"
          ? "vscode.provideSupertypes"
          : "vscode.provideSubtypes";
      items.push(
        ...((await vscode.commands.executeCommand<HierarchyItem[]>(
          cmd,
          roots[0]
        )) || [])
      );
    }
  } else if (kind === "implementations") {
    direction = "in";
    const locs =
      (await vscode.commands.executeCommand<
        (vscode.Location | vscode.LocationLink)[]
      >("vscode.executeImplementationProvider", r.uri, r.position)) || [];
    for (const loc of locs) {
      const { uri, range } = locationToItem(loc);
      const named = await nameAtLocation(uri, range.start);
      items.push({
        name: named.name,
        kind: named.kind,
        uri,
        range,
        selectionRange: named.selection,
      });
    }
  }

  // Dedupe by key, drop the source itself, optionally drop externals.
  const seen = new Set<string>([
    `${r.uri.toString()}@${r.position.line}:${r.position.character}`,
  ]);
  const neighbors: RelationNeighbor[] = [];
  let truncated = false;
  for (const it of items) {
    if (!includeExternal && isExternalUri(it.uri)) {
      continue;
    }
    const key = keyOf(it);
    if (seen.has(key)) {
      continue;
    }
    if (neighbors.length >= maxNodes) {
      truncated = true;
      break;
    }
    seen.add(key);
    neighbors.push({
      key,
      label: cleanName(it.name),
      codeLink: itemToCodeLink(it),
    });
  }

  return { kind, direction, neighbors, truncated };
}
