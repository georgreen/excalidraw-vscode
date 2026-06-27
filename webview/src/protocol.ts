/**
 * Shared message protocol for host <-> webview canvas commands.
 *
 * Mirror of `src/protocol.ts` (host side). Keep the two files in sync.
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
  | "placeLibraryElements"
  | "addLibraryItems"
  | "drawFromMermaid"
  | "setActiveTool"
  | "save"
  | "setCodeLink"
  | "getCodeLinks";

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
