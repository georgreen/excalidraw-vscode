import * as vscode from "vscode";
import { ExcalidrawEditor } from "../editor";
import { CodeLink } from "./router";

const VIEW_TYPE = "editor.excalidraw";

/** URI of the active (or any visible) Excalidraw custom editor tab. */
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

/** A live-updating quick-pick over workspace symbols (LSP `workspace/symbol`). */
function pickWorkspaceSymbol(): Promise<vscode.SymbolInformation | undefined> {
  return new Promise((resolve) => {
    type Item = vscode.QuickPickItem & { sym: vscode.SymbolInformation };
    const qp = vscode.window.createQuickPick<Item>();
    qp.placeholder = "Type a class / function / symbol name to link…";
    qp.matchOnDescription = true;
    let token = 0;
    qp.onDidChangeValue(async (value) => {
      if (!value.trim()) {
        qp.items = [];
        return;
      }
      const my = ++token;
      qp.busy = true;
      const syms =
        (await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
          "vscode.executeWorkspaceSymbolProvider",
          value
        )) || [];
      if (my !== token) {
        return;
      }
      qp.items = syms.slice(0, 50).map((s) => ({
        label: s.name,
        description: [
          vscode.SymbolKind[s.kind],
          s.containerName,
          vscode.workspace.asRelativePath(s.location.uri),
        ]
          .filter(Boolean)
          .join(" · "),
        sym: s,
      }));
      qp.busy = false;
    });
    qp.onDidAccept(() => {
      resolve(qp.selectedItems[0]?.sym);
      qp.hide();
    });
    qp.onDidHide(() => {
      resolve(undefined);
      qp.dispose();
    });
    qp.show();
  });
}

function toCodeLink(sym: vscode.SymbolInformation): CodeLink {
  const start = sym.location.range.start;
  return {
    kind: vscode.SymbolKind[sym.kind].toLowerCase(),
    symbol: sym.name,
    containerName: sym.containerName || undefined,
    file: vscode.workspace.asRelativePath(sym.location.uri),
    uri: sym.location.uri.toString(),
    selectionStart: { line: start.line, character: start.character },
    lastResolved: new Date().toISOString(),
    status: "linked",
  };
}

async function linkElementToSymbol() {
  const uri = getActiveExcalidrawUri();
  if (!uri) {
    vscode.window.showErrorMessage(
      "Open an Excalidraw diagram and select an element first."
    );
    return;
  }
  const editor = await ExcalidrawEditor.resolveEditor(uri);
  const sel = (await editor.sendCommand("getSelection")) as {
    selectedElementIds?: string[];
  };
  const ids = sel?.selectedElementIds || [];
  if (ids.length === 0) {
    vscode.window.showErrorMessage("Select an element to link to a symbol.");
    return;
  }
  const sym = await pickWorkspaceSymbol();
  if (!sym) {
    return;
  }
  const codeLink = toCodeLink(sym);
  await editor.sendCommand("setCodeLink", { ids, codeLink });
  vscode.window.showInformationMessage(
    `Linked ${ids.length} element(s) to ${codeLink.symbol}.`
  );
}

export function registerCodeIntelCommands(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "excalidraw.linkElementToSymbol",
      linkElementToSymbol
    )
  );
}
