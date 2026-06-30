import { vi } from "vitest";

/**
 * Minimal mock of the `vscode` module for unit-testing host code in plain Node
 * (no Extension Host). Vitest aliases `vscode` to this file (see vitest.config.ts).
 * Tests configure behaviour via the exported `vi.fn()` stubs, e.g.
 * `commands.executeCommand.mockResolvedValueOnce(...)`.
 */

export class Position {
  constructor(public line: number, public character: number) {}
}

export class Range {
  start: Position;
  end: Position;
  constructor(
    startLine: number | Position,
    startChar: number | Position,
    endLine?: number,
    endChar?: number
  ) {
    if (startLine instanceof Position && startChar instanceof Position) {
      this.start = startLine;
      this.end = startChar;
    } else {
      this.start = new Position(startLine as number, startChar as number);
      this.end = new Position(endLine as number, endChar as number);
    }
  }
}

export class Selection extends Range {}

export class Uri {
  private constructor(public scheme: string, public path: string) {}
  get fsPath(): string {
    return this.path;
  }
  toString(): string {
    return `${this.scheme}://${this.path}`;
  }
  static parse(value: string): Uri {
    const i = value.indexOf("://");
    return i >= 0
      ? new Uri(value.slice(0, i), value.slice(i + 3))
      : new Uri("file", value);
  }
  static file(p: string): Uri {
    return new Uri("file", p);
  }
  static joinPath(base: Uri, ...parts: string[]): Uri {
    return new Uri(base.scheme, [base.path, ...parts].join("/"));
  }
}

export enum SymbolKind {
  File = 0,
  Module = 1,
  Namespace = 2,
  Package = 3,
  Class = 4,
  Method = 5,
  Property = 6,
  Field = 7,
  Constructor = 8,
  Enum = 9,
  Interface = 10,
  Function = 11,
  Variable = 12,
}

export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}

export enum TextEditorRevealType {
  Default = 0,
  InCenter = 1,
}

export const commands = {
  executeCommand: vi.fn(),
};

export const languages = {
  getDiagnostics: vi.fn(() => [] as unknown[]),
};

export const workspace = {
  workspaceFolders: [] as { uri: Uri }[],
  asRelativePath: vi.fn((uri: Uri) => uri.path.replace(/^\/+/, "")),
  openTextDocument: vi.fn(),
  findFiles: vi.fn(async () => [] as Uri[]),
  fs: {
    stat: vi.fn(async () => ({})),
  },
};

export const window = {
  showTextDocument: vi.fn(async () => ({
    selection: undefined as unknown,
    revealRange: vi.fn(),
  })),
  showWarningMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  showInformationMessage: vi.fn(),
};

/** Reset all stubs to a clean baseline between tests. */
export function __reset() {
  commands.executeCommand.mockReset();
  languages.getDiagnostics.mockReset().mockReturnValue([]);
  workspace.asRelativePath.mockClear();
  workspace.openTextDocument.mockReset();
  workspace.findFiles.mockReset().mockResolvedValue([]);
  workspace.workspaceFolders = [];
  window.showTextDocument.mockReset().mockResolvedValue({
    selection: undefined,
    revealRange: vi.fn(),
  });
}
