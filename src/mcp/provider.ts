import * as vscode from "vscode";
import { getBridgeInfo, onDidChangeBridge } from "./bridge";

/**
 * Advertise the running MCP bridge to VS Code's own Copilot via the MCP server
 * definition provider API. This API is newer than our minimum engine, so it is
 * feature-detected and degrades to a no-op on older VS Code.
 */
export function registerMcpProvider(context: vscode.ExtensionContext): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lm = vscode.lm as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const McpHttpServerDefinition = (vscode as any).McpHttpServerDefinition;
  if (
    typeof lm?.registerMcpServerDefinitionProvider !== "function" ||
    !McpHttpServerDefinition
  ) {
    return;
  }

  const changeEmitter = new vscode.EventEmitter<void>();
  context.subscriptions.push(
    changeEmitter,
    onDidChangeBridge(() => changeEmitter.fire())
  );

  const disposable = lm.registerMcpServerDefinitionProvider("excalidraw-mcp", {
    onDidChangeMcpServerDefinitions: changeEmitter.event,
    provideMcpServerDefinitions: () => {
      const info = getBridgeInfo();
      if (!info) {
        return [];
      }
      return [
        new McpHttpServerDefinition("Excalidraw", vscode.Uri.parse(info.url)),
      ];
    },
  });
  context.subscriptions.push(disposable);
}
