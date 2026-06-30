import * as vscode from "vscode";
import { ExcalidrawEditor } from "../editor";
import { bestWorkspaceSymbol, symbolInformationToCodeLink } from "./router";

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

function toCodeLink(sym: vscode.SymbolInformation) {
  return symbolInformationToCodeLink(sym);
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

interface LabelRecord {
  id: string;
  type: string;
  label: string;
  linked: boolean;
}

/**
 * Scan the active diagram for unlinked, labelled shapes, match each label to a
 * workspace symbol, and (after the user confirms the proposed links in a
 * multi-select) attach them. The opt-in, human counterpart to the agent's
 * `link_excalidraw_to_symbol { auto: true }`.
 */
async function autoLinkElements() {
  const uri = getActiveExcalidrawUri();
  if (!uri) {
    vscode.window.showErrorMessage("Open an Excalidraw diagram first.");
    return;
  }
  const editor = await ExcalidrawEditor.resolveEditor(uri);
  const data = (await editor.sendCommand("getElementLabels")) as {
    elements?: LabelRecord[];
  };
  const candidates = (data?.elements || []).filter(
    (e) => !e.linked && e.label.trim() !== ""
  );
  if (candidates.length === 0) {
    vscode.window.showInformationMessage(
      "Excalidraw: no unlinked, labelled elements to auto-link."
    );
    return;
  }

  type Proposal = vscode.QuickPickItem & {
    id: string;
    codeLink: ReturnType<typeof symbolInformationToCodeLink>;
  };
  const proposals = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Matching diagram labels to symbols…",
    },
    async () => {
      const out: Proposal[] = [];
      for (const c of candidates) {
        const sym = await bestWorkspaceSymbol(c.label.trim());
        if (!sym) {
          continue;
        }
        const codeLink = symbolInformationToCodeLink(sym);
        out.push({
          id: c.id,
          codeLink,
          label: `${c.label}  →  ${codeLink.symbol}`,
          description: codeLink.file,
          picked: true,
        });
      }
      return out;
    }
  );

  if (proposals.length === 0) {
    vscode.window.showInformationMessage(
      "Excalidraw: no labels matched a workspace symbol."
    );
    return;
  }

  const chosen = await vscode.window.showQuickPick(proposals, {
    canPickMany: true,
    title: "Auto-link diagram elements to code symbols",
    placeHolder: "Confirm the links to apply",
  });
  if (!chosen || chosen.length === 0) {
    return;
  }
  for (const p of chosen) {
    await editor.sendCommand("setCodeLink", {
      ids: [p.id],
      codeLink: p.codeLink,
    });
  }
  vscode.window.showInformationMessage(
    `Excalidraw: linked ${chosen.length} element(s) to code symbols.`
  );
}

export function registerCodeIntelCommands(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "excalidraw.linkElementToSymbol",
      linkElementToSymbol
    ),
    vscode.commands.registerCommand(
      "excalidraw.autoLinkElements",
      autoLinkElements
    )
  );
}
