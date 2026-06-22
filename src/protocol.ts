/**
 * Shared message protocol for host <-> webview canvas commands.
 *
 * The host sends a `CommandRequest` to the webview and awaits a matching
 * `CommandResult` (correlated by `id`). This file is mirrored in
 * `webview/src/protocol.ts` and the two MUST be kept in sync.
 */

export type CommandAction =
  | "getScene"
  | "getSelection"
  | "getAppState"
  | "getMermaid"
  | "exportImage"
  | "addElements"
  | "connectElements"
  | "updateElements"
  | "moveElements"
  | "deleteElements"
  | "setScene"
  | "clearCanvas"
  | "styleElements"
  | "selectElements"
  | "reorderElements"
  | "lockElements"
  | "duplicateElements"
  | "flipElements"
  | "setLink"
  | "setArrowheads"
  | "scrollToContent"
  | "panCanvas"
  | "groupElements"
  | "ungroupElements"
  | "frameElements"
  | "alignElements"
  | "addImage"
  | "addLibraryItems"
  | "drawFromMermaid"
  | "setActiveTool"
  | "save";

export interface CommandRequest {
  type: "command";
  id: string;
  action: CommandAction;
  params?: unknown;
}

export interface CommandResult {
  type: "command-result";
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface ReadyMessage {
  type: "ready";
}

/** Actions that only read state and never mutate the document. */
export const READ_ONLY_ACTIONS: ReadonlyArray<CommandAction> = [
  "getScene",
  "getSelection",
  "getAppState",
  "getMermaid",
  "exportImage",
  "panCanvas",
];

export function isMutatingAction(action: CommandAction): boolean {
  return !READ_ONLY_ACTIONS.includes(action);
}
