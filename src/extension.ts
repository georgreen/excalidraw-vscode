import * as vscode from "vscode";
import { activateShared } from "./activateShared";

// Web extension host entry point (vscode.dev / github.dev). The MCP bridge is
// not available here because the web extension host cannot open a server.
export async function activate(context: vscode.ExtensionContext) {
  await activateShared(context);
}

export function deactivate() {}
