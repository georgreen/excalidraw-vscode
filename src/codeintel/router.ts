import * as vscode from "vscode";

/**
 * A link from a diagram element to a code symbol, stored in
 * `element.customData.codeLink`. The `symbol` is the source of truth and is
 * re-resolvable via the workspace symbol provider; `uri`/`selectionStart` are
 * advisory caches.
 */
export interface CodeLink {
  kind?: string;
  symbol: string;
  containerName?: string;
  file?: string;
  uri?: string;
  selectionStart?: { line: number; character: number };
  lastResolved?: string;
  status?: "linked" | "unresolved" | "stale";
}

interface Resolved {
  uri: vscode.Uri;
  position: vscode.Position;
}

/** Bare symbol name (drop a dotted container, e.g. "Foo.bar" -> "bar"). */
function bareName(symbol: string): string {
  const i = symbol.lastIndexOf(".");
  return i >= 0 ? symbol.slice(i + 1) : symbol;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Move a position onto the symbol's identifier. Workspace-symbol results point
 * at the declaration's start (often the `export`/`class`/`function` keyword),
 * where `executeHoverProvider`/`executeDefinitionProvider` return nothing. We
 * scan the first few lines of the declaration range for the bare name and land
 * on the identifier so hover/definition resolve.
 */
async function refineToIdentifier(
  uri: vscode.Uri,
  range: vscode.Range,
  name: string
): Promise<vscode.Position> {
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    const re = new RegExp(`\\b${escapeRegExp(name)}\\b`);
    const lastLine = Math.min(range.end.line, range.start.line + 4);
    for (let line = range.start.line; line <= lastLine; line++) {
      const text = doc.lineAt(line).text;
      const from = line === range.start.line ? range.start.character : 0;
      const m = re.exec(text.slice(from));
      if (m) {
        return new vscode.Position(line, from + m.index);
      }
    }
  } catch {
    // fall back to the range start
  }
  return range.start;
}

/**
 * Resolve a CodeLink to a concrete (uri, position) by delegating to the running
 * language servers via the workspace symbol provider (LSP `workspace/symbol`).
 * Falls back to the cached uri/position when present.
 */
export async function resolveSymbol(
  link: CodeLink
): Promise<Resolved | undefined> {
  if (link.uri && link.selectionStart) {
    try {
      return {
        uri: vscode.Uri.parse(link.uri),
        position: new vscode.Position(
          link.selectionStart.line,
          link.selectionStart.character
        ),
      };
    } catch {
      // fall through to re-resolve
    }
  }

  const name = bareName(link.symbol);
  const syms =
    (await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
      "vscode.executeWorkspaceSymbolProvider",
      name
    )) || [];
  if (syms.length === 0) {
    return undefined;
  }

  let candidates = syms.filter((s) => s.name === name);
  if (candidates.length === 0) {
    candidates = syms;
  }
  if (link.containerName) {
    const byContainer = candidates.filter(
      (s) => (s.containerName || "") === link.containerName
    );
    if (byContainer.length > 0) {
      candidates = byContainer;
    }
  }
  if (link.file) {
    const byFile = candidates.filter((s) =>
      s.location.uri.path.endsWith(link.file as string)
    );
    if (byFile.length > 0) {
      candidates = byFile;
    }
  }
  const match = candidates[0];
  const position = await refineToIdentifier(
    match.location.uri,
    match.location.range,
    name
  );
  return { uri: match.location.uri, position };
}

function hoverToMarkdown(hovers: vscode.Hover[]): string {
  const parts: string[] = [];
  for (const h of hovers) {
    for (const c of h.contents) {
      if (typeof c === "string") {
        parts.push(c);
      } else if (c && typeof (c as vscode.MarkdownString).value === "string") {
        parts.push((c as vscode.MarkdownString).value);
      }
    }
  }
  return parts.join("\n\n---\n\n").trim();
}

/** Hover documentation for a link (LSP `textDocument/hover`). */
export async function hoverMarkdown(
  link: CodeLink
): Promise<string | undefined> {
  const r = await resolveSymbol(link);
  if (!r) {
    return undefined;
  }
  const hovers =
    (await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      r.uri,
      r.position
    )) || [];
  if (hovers.length === 0) {
    return undefined;
  }
  return hoverToMarkdown(hovers);
}

/** Resolve a workspace-relative (or absolute) file path to a URI. */
async function fileToUri(file: string): Promise<vscode.Uri | undefined> {
  if (file.includes("://")) {
    return vscode.Uri.parse(file);
  }
  if (/^([a-zA-Z]:[\\/]|\/)/.test(file)) {
    return vscode.Uri.file(file);
  }
  for (const folder of vscode.workspace.workspaceFolders || []) {
    const u = vscode.Uri.joinPath(folder.uri, file);
    try {
      await vscode.workspace.fs.stat(u);
      return u;
    } catch {
      // try next folder
    }
  }
  const found = await vscode.workspace.findFiles(file, "**/node_modules/**", 1);
  return found[0];
}

/**
 * Open the linked symbol in an editor (LSP `textDocument/definition`). Falls
 * back to opening the linked `file` when symbol resolution yields nothing, so
 * "Go to code" still navigates. Returns false only when nothing can be opened.
 */
export async function navigateToLink(link: CodeLink): Promise<boolean> {
  let target: Resolved | undefined;

  const r = await resolveSymbol(link);
  if (r) {
    target = r;
    try {
      const defs =
        (await vscode.commands.executeCommand<vscode.Location[]>(
          "vscode.executeDefinitionProvider",
          r.uri,
          r.position
        )) || [];
      if (defs.length > 0) {
        target = { uri: defs[0].uri, position: defs[0].range.start };
      }
    } catch {
      // keep the resolved position
    }
  } else if (link.file) {
    const uri = await fileToUri(link.file);
    if (uri) {
      target = { uri, position: new vscode.Position(0, 0) };
    }
  }

  if (!target) {
    return false;
  }
  const doc = await vscode.workspace.openTextDocument(target.uri);
  const editor = await vscode.window.showTextDocument(doc, { preview: true });
  editor.selection = new vscode.Selection(target.position, target.position);
  editor.revealRange(
    new vscode.Range(target.position, target.position),
    vscode.TextEditorRevealType.InCenter
  );
  return true;
}

export interface DiagnosticBadge {
  errors: number;
  warnings: number;
  file: string;
}

/**
 * Compute error/warning counts for the files behind a set of links
 * (LSP `textDocument/publishDiagnostics`, surfaced via `getDiagnostics`).
 * Spike granularity: per-file, not per-symbol-range.
 */
export async function diagnosticsForLinks(
  links: { id: string; codeLink: CodeLink }[]
): Promise<Record<string, DiagnosticBadge>> {
  const out: Record<string, DiagnosticBadge> = {};
  const cache = new Map<string, DiagnosticBadge | null>();
  for (const { id, codeLink } of links) {
    const r = await resolveSymbol(codeLink);
    if (!r) {
      continue;
    }
    const key = r.uri.toString();
    let badge = cache.get(key);
    if (badge === undefined) {
      const diags = vscode.languages.getDiagnostics(r.uri);
      let errors = 0;
      let warnings = 0;
      for (const d of diags) {
        if (d.severity === vscode.DiagnosticSeverity.Error) {
          errors++;
        } else if (d.severity === vscode.DiagnosticSeverity.Warning) {
          warnings++;
        }
      }
      badge =
        errors || warnings
          ? { errors, warnings, file: vscode.workspace.asRelativePath(r.uri) }
          : null;
      cache.set(key, badge);
    }
    if (badge) {
      out[id] = badge;
    }
  }
  return out;
}
