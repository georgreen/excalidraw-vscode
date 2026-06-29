import { beforeEach, describe, expect, it } from "vitest";
import {
  commands,
  languages,
  workspace,
  DiagnosticSeverity,
  Range,
  SymbolKind,
  Uri,
  __reset,
} from "vscode";
import {
  bestWorkspaceSymbol,
  diagnosticsForLinks,
  hoverMarkdown,
  resolveSymbol,
  symbolInformationToCodeLink,
} from "./router";

/* eslint-disable @typescript-eslint/no-explicit-any */

function symInfo(
  name: string,
  kind: SymbolKind,
  containerName: string,
  path: string
) {
  return {
    name,
    kind,
    containerName,
    location: { uri: Uri.file(path), range: new Range(0, 0, 0, 0) },
  } as any;
}

beforeEach(() => __reset());

describe("symbolInformationToCodeLink", () => {
  it("strips the call suffix from function names", () => {
    const link = symbolInformationToCodeLink(
      symInfo("resolveSymbol()", SymbolKind.Function, "", "/repo/src/router.ts")
    );
    expect(link.symbol).toBe("resolveSymbol");
    expect(link.kind).toBe("function");
    expect(link.file).toBe("repo/src/router.ts");
  });

  it("stores dotted Container.member for methods (suffix + params stripped)", () => {
    const link = symbolInformationToCodeLink(
      symInfo("send(a, b)", SymbolKind.Method, "ExcalidrawEditor", "/a.ts")
    );
    expect(link.symbol).toBe("ExcalidrawEditor.send");
    expect(link.containerName).toBe("ExcalidrawEditor");
  });
});

describe("bestWorkspaceSymbol", () => {
  it("matches by clean name (ignoring the call suffix)", async () => {
    (commands.executeCommand as any).mockResolvedValueOnce([
      symInfo("resolveSymbol()", SymbolKind.Function, "", "/a/router.ts"),
      symInfo("resolveSymbolCache", SymbolKind.Variable, "", "/a/cache.ts"),
    ]);
    const sym = await bestWorkspaceSymbol("resolveSymbol");
    expect(sym?.name).toBe("resolveSymbol()");
    expect(commands.executeCommand).toHaveBeenCalledWith(
      "vscode.executeWorkspaceSymbolProvider",
      "resolveSymbol"
    );
  });

  it("prefers the candidate whose container matches a dotted name", async () => {
    (commands.executeCommand as any).mockResolvedValueOnce([
      symInfo("send()", SymbolKind.Method, "Other", "/a.ts"),
      symInfo("send()", SymbolKind.Method, "ExcalidrawEditor", "/b.ts"),
    ]);
    const sym = await bestWorkspaceSymbol("ExcalidrawEditor.send");
    expect(sym?.containerName).toBe("ExcalidrawEditor");
  });

  it("returns undefined when nothing is found", async () => {
    (commands.executeCommand as any).mockResolvedValueOnce([]);
    expect(await bestWorkspaceSymbol("nope")).toBeUndefined();
  });
});

describe("resolveSymbol", () => {
  it("uses the cached uri/position without calling the language server", async () => {
    const r = await resolveSymbol({
      symbol: "X",
      uri: "file:///a.ts",
      selectionStart: { line: 3, character: 5 },
    });
    expect(r?.uri.toString()).toBe("file:///a.ts");
    expect(r?.position).toMatchObject({ line: 3, character: 5 });
    expect(commands.executeCommand).not.toHaveBeenCalled();
  });

  it("resolves via the workspace symbol provider and refines onto the identifier", async () => {
    (commands.executeCommand as any).mockResolvedValueOnce([
      symInfo("foo", SymbolKind.Function, "", "/repo/a.ts"),
    ]);
    (workspace.openTextDocument as any).mockResolvedValueOnce({
      lineAt: (n: number) => ({
        text: n === 0 ? "export function foo() {" : "",
      }),
    });
    const r = await resolveSymbol({ symbol: "foo", file: "a.ts" });
    expect(r?.position.line).toBe(0);
    // "export function " is 16 chars, so "foo" begins at column 16.
    expect(r?.position.character).toBe(16);
  });

  it("returns undefined when the symbol is unknown and no file hint exists", async () => {
    (commands.executeCommand as any).mockResolvedValueOnce([]);
    expect(await resolveSymbol({ symbol: "ghost" })).toBeUndefined();
  });
});

describe("hoverMarkdown", () => {
  it("joins the hover provider's content values", async () => {
    (commands.executeCommand as any).mockResolvedValueOnce([
      { contents: [{ value: "```ts\nfn(): void\n```" }, "docs here"] },
    ]);
    const md = await hoverMarkdown({
      symbol: "fn",
      uri: "file:///a.ts",
      selectionStart: { line: 0, character: 0 },
    });
    expect(md).toContain("fn(): void");
    expect(md).toContain("docs here");
  });
});

describe("diagnosticsForLinks", () => {
  const cached = (id: string, uri: string) => ({
    id,
    codeLink: { symbol: id, uri, selectionStart: { line: 0, character: 0 } },
  });

  it("counts errors/warnings and collects messages", async () => {
    (languages.getDiagnostics as any).mockReturnValueOnce([
      {
        severity: DiagnosticSeverity.Error,
        message: "bad",
        range: new Range(4, 0, 4, 3),
      },
      {
        severity: DiagnosticSeverity.Warning,
        message: "meh",
        range: new Range(9, 0, 9, 2),
      },
    ]);
    const out = await diagnosticsForLinks([cached("e1", "file:///doc.ts")]);
    expect(out.e1.errors).toBe(1);
    expect(out.e1.warnings).toBe(1);
    expect(out.e1.messages[0]).toBe("error (line 5): bad");
  });

  it("caches diagnostics per file across links", async () => {
    (languages.getDiagnostics as any).mockReturnValue([
      {
        severity: DiagnosticSeverity.Error,
        message: "x",
        range: new Range(0, 0, 0, 1),
      },
    ]);
    const out = await diagnosticsForLinks([
      cached("a", "file:///same.ts"),
      cached("b", "file:///same.ts"),
    ]);
    expect(out.a.errors).toBe(1);
    expect(out.b.errors).toBe(1);
    expect(languages.getDiagnostics).toHaveBeenCalledTimes(1);
  });

  it("omits links whose file has no problems", async () => {
    (languages.getDiagnostics as any).mockReturnValue([]);
    const out = await diagnosticsForLinks([cached("clean", "file:///ok.ts")]);
    expect(out.clean).toBeUndefined();
  });
});
