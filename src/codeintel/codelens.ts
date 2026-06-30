import * as vscode from "vscode";
import { ExcalidrawEditor } from "../editor";

/**
 * Reverse index from code symbols to the diagram elements that link to them, and
 * a CodeLens that surfaces "Appears in <diagram>" on the symbol in source, which
 * opens the diagram and focuses the element. Built by scanning `customData.codeLink`
 * across the workspace's `.excalidraw` files.
 */

interface IndexEntry {
  diagram: vscode.Uri;
  elementId: string;
  symbol: string;
  // Locator: either a concrete uri+line, or a file hint + symbol name.
  uri?: string;
  line?: number;
  file?: string;
}

const DIAGRAM_GLOB = "**/*.excalidraw";

function bareName(symbol: string): string {
  const i = symbol.lastIndexOf(".");
  return i >= 0 ? symbol.slice(i + 1) : symbol;
}

class ReverseIndex {
  private entries: IndexEntry[] = [];
  private building: Promise<void> | undefined;

  async rebuild(): Promise<void> {
    const files = await vscode.workspace.findFiles(
      DIAGRAM_GLOB,
      "**/node_modules/**",
      500
    );
    const out: IndexEntry[] = [];
    for (const file of files) {
      try {
        const bytes = await vscode.workspace.fs.readFile(file);
        const scene = JSON.parse(new TextDecoder().decode(bytes));
        for (const el of scene.elements || []) {
          const cl = el?.customData?.codeLink;
          if (!cl?.symbol) {
            continue;
          }
          out.push({
            diagram: file,
            elementId: el.id,
            symbol: cl.symbol,
            uri: cl.uri,
            line: cl.selectionStart?.line,
            file: cl.file,
          });
        }
      } catch {
        // unreadable / not JSON — skip
      }
    }
    this.entries = out;
  }

  ensureBuilt(): Promise<void> {
    if (!this.building) {
      this.building = this.rebuild();
    }
    return this.building;
  }

  invalidate(): void {
    this.building = this.rebuild();
  }

  /** Entries relevant to a document, each resolved to a line in that document. */
  async forDocument(
    document: vscode.TextDocument
  ): Promise<{ line: number; entries: IndexEntry[] }[]> {
    await this.ensureBuilt();
    const docUri = document.uri.toString();
    const docPath = document.uri.path;
    const byLine = new Map<number, IndexEntry[]>();

    // Symbols (by bare name) we need to locate via document symbols (file-hint
    // entries without a concrete line).
    const needNames = new Map<string, IndexEntry[]>();

    for (const e of this.entries) {
      if (e.uri === docUri && typeof e.line === "number") {
        const arr = byLine.get(e.line) || [];
        arr.push(e);
        byLine.set(e.line, arr);
      } else if (!e.uri && e.file && docPath.endsWith(e.file)) {
        const name = bareName(e.symbol);
        const arr = needNames.get(name) || [];
        arr.push(e);
        needNames.set(name, arr);
      }
    }

    if (needNames.size > 0) {
      const symbols =
        (await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
          "vscode.executeDocumentSymbolProvider",
          document.uri
        )) || [];
      const walk = (list: vscode.DocumentSymbol[]) => {
        for (const s of list) {
          const hit = needNames.get(s.name);
          if (hit) {
            const line = s.selectionRange.start.line;
            const arr = byLine.get(line) || [];
            arr.push(...hit);
            byLine.set(line, arr);
          }
          walk(s.children || []);
        }
      };
      walk(symbols);
    }

    return [...byLine.entries()]
      .map(([line, entries]) => ({ line, entries }))
      .sort((a, b) => a.line - b.line);
  }
}

class DiagramCodeLensProvider implements vscode.CodeLensProvider {
  private changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changeEmitter.event;

  constructor(private readonly index: ReverseIndex) {}

  fireChange(): void {
    this.changeEmitter.fire();
  }

  async provideCodeLenses(
    document: vscode.TextDocument
  ): Promise<vscode.CodeLens[]> {
    const groups = await this.index.forDocument(document);
    const lenses: vscode.CodeLens[] = [];
    for (const { line, entries } of groups) {
      const range = new vscode.Range(line, 0, line, 0);
      const diagrams = [...new Set(entries.map((e) => e.diagram.toString()))];
      const title =
        diagrams.length === 1
          ? `$(symbol-structure) Appears in ${vscode.workspace.asRelativePath(
              entries[0].diagram
            )}`
          : `$(symbol-structure) Appears in ${diagrams.length} diagrams`;
      lenses.push(
        new vscode.CodeLens(range, {
          title,
          command: "excalidraw.focusElementInDiagram",
          arguments: [entries[0].diagram, entries[0].elementId],
        })
      );
    }
    return lenses;
  }
}

async function focusElementInDiagram(
  diagram: vscode.Uri,
  elementId: string
): Promise<void> {
  const editor = await ExcalidrawEditor.resolveEditor(diagram);
  editor.reveal();
  try {
    await editor.sendCommand("selectElements", { ids: [elementId] });
    await editor.sendCommand("scrollToContent", { ids: [elementId] });
  } catch {
    // selection/scroll best-effort
  }
}

export function registerReverseIndexCodeLens(
  context: vscode.ExtensionContext
): void {
  const index = new ReverseIndex();
  const provider = new DiagramCodeLensProvider(index);

  const watcher = vscode.workspace.createFileSystemWatcher(DIAGRAM_GLOB);
  const onChange = () => {
    index.invalidate();
    provider.fireChange();
  };
  watcher.onDidCreate(onChange);
  watcher.onDidChange(onChange);
  watcher.onDidDelete(onChange);

  context.subscriptions.push(
    watcher,
    vscode.languages.registerCodeLensProvider({ scheme: "file" }, provider),
    vscode.commands.registerCommand(
      "excalidraw.focusElementInDiagram",
      focusElementInDiagram
    )
  );
}
