import * as vscode from "vscode";
import { activateShared } from "./activateShared";
import { startMcpBridge, stopMcpBridge } from "./mcp/bridge";
import { registerMcpProvider } from "./mcp/provider";

// Desktop (Node) extension host entry point. In addition to the shared
// activation, it can start the MCP bridge server so external CLI agents can
// control Excalidraw.
export async function activate(context: vscode.ExtensionContext) {
  await activateShared(context);
  registerMcpProvider(context);
  await startMcpBridge(context);
}

export async function deactivate() {
  await stopMcpBridge();
}
