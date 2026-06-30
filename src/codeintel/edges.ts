import * as vscode from "vscode";
import { CodeLink, resolveSymbol } from "./router";

/**
 * Edge / relationship intelligence (design §11). An arrow A→B between two linked
 * diagram nodes is a relationship between two code symbols. We probe the running
 * language servers to find where that relationship is *concrete* in the code
 * (call sites, an `extends` clause, references) so clicking the arrow can jump
 * there — and flag arrows that have no concrete backing ("conceptual/transitive").
 */

export interface EdgeSite {
  uri: string;
  file: string;
  line: number;
  character: number;
}

export interface EdgeRelation {
  kind: "inherits" | "calls" | "references" | "none";
  verified: boolean;
  sites: EdgeSite[];
  /** Where to anchor a multi-site peek (the source symbol A). */
  anchor?: { uri: string; line: number; character: number };
  note?: string;
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

function bareName(symbol: string): string {
  const i = symbol.lastIndexOf(".");
  return i >= 0 ? symbol.slice(i + 1) : symbol;
}

function toSite(uri: vscode.Uri, pos: vscode.Position): EdgeSite {
  return {
    uri: uri.toString(),
    file: vscode.workspace.asRelativePath(uri),
    line: pos.line,
    character: pos.character,
  };
}

/** Enclosing document symbol range at a position (to scope references to A's body). */
async function enclosingRange(
  uri: vscode.Uri,
  pos: vscode.Position
): Promise<vscode.Range | undefined> {
  const symbols =
    (await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      "vscode.executeDocumentSymbolProvider",
      uri
    )) || [];
  let found: vscode.Range | undefined;
  const dfs = (list: vscode.DocumentSymbol[]) => {
    for (const s of list) {
      if (s.range.contains(pos)) {
        found = s.range;
        dfs(s.children || []);
      }
    }
  };
  dfs(symbols);
  return found;
}

async function tryInherits(
  a: { uri: vscode.Uri; position: vscode.Position },
  bName: string
): Promise<boolean> {
  try {
    const roots =
      (await vscode.commands.executeCommand<HierarchyItem[]>(
        "vscode.prepareTypeHierarchy",
        a.uri,
        a.position
      )) || [];
    if (!roots[0]) {
      return false;
    }
    const supers =
      (await vscode.commands.executeCommand<HierarchyItem[]>(
        "vscode.provideSupertypes",
        roots[0]
      )) || [];
    return supers.some((s) => cleanName(s.name) === bName);
  } catch {
    return false;
  }
}

async function tryCalls(
  a: { uri: vscode.Uri; position: vscode.Position },
  b: { uri: vscode.Uri; position: vscode.Position },
  bName: string
): Promise<vscode.Range[]> {
  try {
    const roots =
      (await vscode.commands.executeCommand<HierarchyItem[]>(
        "vscode.prepareCallHierarchy",
        a.uri,
        a.position
      )) || [];
    if (!roots[0]) {
      return [];
    }
    const calls =
      (await vscode.commands.executeCommand<
        { to: HierarchyItem; fromRanges: vscode.Range[] }[]
      >("vscode.provideOutgoingCalls", roots[0])) || [];
    const match = calls.find((c) => {
      const sameName = cleanName(c.to.name) === bName;
      const sameUri = c.to.uri.toString() === b.uri.toString();
      return sameName && (sameUri || true);
    });
    return match?.fromRanges || [];
  } catch {
    return [];
  }
}

async function tryReferences(
  a: { uri: vscode.Uri; position: vscode.Position },
  b: { uri: vscode.Uri; position: vscode.Position }
): Promise<vscode.Range[]> {
  try {
    const range = await enclosingRange(a.uri, a.position);
    const refs =
      (await vscode.commands.executeCommand<vscode.Location[]>(
        "vscode.executeReferenceProvider",
        b.uri,
        b.position
      )) || [];
    return refs
      .filter(
        (l) =>
          l.uri.toString() === a.uri.toString() &&
          (range ? range.contains(l.range.start) : true)
      )
      .map((l) => l.range);
  } catch {
    return [];
  }
}

/**
 * Probe the concrete relationship between two linked symbols A (source) and B
 * (target). Order: inheritance (for types) → calls → references. Returns the
 * concrete sites inside A and whether a relationship was verified.
 */
export async function resolveEdgeRelation(
  from: CodeLink,
  to: CodeLink
): Promise<EdgeRelation> {
  const a = await resolveSymbol(from);
  const b = await resolveSymbol(to);
  if (!a || !b) {
    return {
      kind: "none",
      verified: false,
      sites: [],
      note: "One or both endpoints could not be resolved in the code.",
    };
  }
  const anchor = {
    uri: a.uri.toString(),
    line: a.position.line,
    character: a.position.character,
  };
  const bName = bareName(to.symbol);
  const aKind = (from.kind || "").toLowerCase();
  const bKind = (to.kind || "").toLowerCase();

  // Inheritance first when both endpoints are types.
  if (
    ["class", "interface"].includes(aKind) &&
    ["class", "interface"].includes(bKind)
  ) {
    if (await tryInherits(a, bName)) {
      return {
        kind: "inherits",
        verified: true,
        sites: [toSite(a.uri, a.position)],
        anchor,
      };
    }
  }

  const callRanges = await tryCalls(a, b, bName);
  if (callRanges.length > 0) {
    return {
      kind: "calls",
      verified: true,
      sites: callRanges.map((r) => toSite(a.uri, r.start)),
      anchor,
    };
  }

  const refRanges = await tryReferences(a, b);
  if (refRanges.length > 0) {
    return {
      kind: "references",
      verified: true,
      sites: refRanges.map((r) => toSite(a.uri, r.start)),
      anchor,
    };
  }

  return {
    kind: "none",
    verified: false,
    sites: [],
    anchor,
    note: `No direct call/reference/inheritance from "${from.symbol}" to "${to.symbol}" — this arrow may be conceptual or transitive.`,
  };
}

/**
 * Navigate to an edge's concrete site(s): open the single site, or peek when
 * there are several. Returns the relation so the caller can message the user.
 */
export async function navigateEdge(
  from: CodeLink,
  to: CodeLink
): Promise<EdgeRelation> {
  const rel = await resolveEdgeRelation(from, to);
  if (rel.sites.length === 1) {
    const s = rel.sites[0];
    const uri = vscode.Uri.parse(s.uri);
    const pos = new vscode.Position(s.line, s.character);
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, { preview: true });
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(
      new vscode.Range(pos, pos),
      vscode.TextEditorRevealType.InCenter
    );
  } else if (rel.sites.length > 1 && rel.anchor) {
    const anchorUri = vscode.Uri.parse(rel.anchor.uri);
    const anchorPos = new vscode.Position(
      rel.anchor.line,
      rel.anchor.character
    );
    const locations = rel.sites.map(
      (s) =>
        new vscode.Location(
          vscode.Uri.parse(s.uri),
          new vscode.Position(s.line, s.character)
        )
    );
    const doc = await vscode.workspace.openTextDocument(anchorUri);
    await vscode.window.showTextDocument(doc, { preview: true });
    await vscode.commands.executeCommand(
      "editor.action.showReferences",
      anchorUri,
      anchorPos,
      locations
    );
  } else {
    vscode.window.showInformationMessage(
      `Excalidraw: ${
        rel.note || "no concrete relationship found for this arrow."
      }`
    );
  }
  return rel;
}
