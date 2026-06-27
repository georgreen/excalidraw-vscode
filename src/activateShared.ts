import * as vscode from "vscode";
import { registerCommands } from "./commands";
import { ExcalidrawEditorProvider } from "./editor";
import { ExcalidrawUriHandler } from "./uri-handler";
import { registerTools } from "./tools";
import { registerCodeIntelCommands } from "./codeintel/commands";

/**
 * Activation logic shared by both the web (`extension.ts`) and node
 * (`extension.node.ts`) entry points. The node entry additionally starts the
 * MCP bridge, which the web extension host cannot run.
 */
export async function activateShared(context: vscode.ExtensionContext) {
  // Register our custom editor providers
  context.subscriptions.push(await ExcalidrawEditorProvider.register(context));
  context.subscriptions.push(ExcalidrawUriHandler.register());
  registerCommands(context);
  registerTools(context);
  registerCodeIntelCommands(context);
}
