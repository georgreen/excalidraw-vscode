import * as vscode from "vscode";
import * as path from "path";
import { Base64 } from "js-base64";

import { ExcalidrawDocument } from "./document";
import { languageMap } from "./lang";
import { showEditor } from "./commands";
import { CommandAction, isMutatingAction } from "./protocol";
import {
  hoverMarkdown,
  navigateToLink,
  navigateToDiagnostic,
  symbolMetrics,
  diagnosticsForLinks,
  staleLinks,
  CodeLink,
} from "./codeintel/router";

function randomId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) {
    return g.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export class ExcalidrawEditorProvider
  implements vscode.CustomEditorProvider<ExcalidrawDocument>
{
  public static async register(
    context: vscode.ExtensionContext
  ): Promise<vscode.Disposable> {
    const provider = new ExcalidrawEditorProvider(context);
    const providerRegistration = vscode.window.registerCustomEditorProvider(
      ExcalidrawEditorProvider.viewType,
      provider,
      {
        supportsMultipleEditorsPerDocument: false,
        webviewOptions: { retainContextWhenHidden: true },
      }
    );

    ExcalidrawEditorProvider.migrateLegacyLibraryItems(context);

    return providerRegistration;
  }

  private static migrateLegacyLibraryItems(context: vscode.ExtensionContext) {
    const libraryItems = context.globalState.get("libraryItems");
    if (!libraryItems) {
      return;
    }
    context.globalState
      .update(
        "library",
        JSON.stringify({
          type: "excalidrawlib",
          version: 2,
          source:
            "https://marketplace.visualstudio.com/items?itemName=pomdtr.excalidraw-editor",
          libraryItems,
        })
      )
      .then(() => {
        context.globalState.update("libraryItems", undefined);
      });
  }

  private static readonly viewType = "editor.excalidraw";

  constructor(private readonly context: vscode.ExtensionContext) {}

  public async resolveCustomEditor(
    document: ExcalidrawDocument,
    webviewPanel: vscode.WebviewPanel
  ) {
    const editor = new ExcalidrawEditor(document, webviewPanel, this.context);
    const editorDisposable = await editor.setupWebview();

    webviewPanel.onDidDispose(() => {
      editorDisposable.dispose();
    });
  }

  private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<
    vscode.CustomDocumentContentChangeEvent<ExcalidrawDocument>
  >();
  public readonly onDidChangeCustomDocument =
    this._onDidChangeCustomDocument.event;

  async backupCustomDocument(
    document: ExcalidrawDocument,
    context: vscode.CustomDocumentBackupContext
  ): Promise<vscode.CustomDocumentBackup> {
    return document.backup(context.destination);
  }

  // TODO: Backup Support
  async openCustomDocument(
    uri: vscode.Uri,
    openContext: vscode.CustomDocumentOpenContext
  ): Promise<ExcalidrawDocument> {
    let content: Uint8Array;
    if (uri.scheme === "untitled") {
      content = new TextEncoder().encode(
        JSON.stringify({ type: "excalidraw", elements: [] })
      );
    } else {
      content = await vscode.workspace.fs.readFile(
        openContext.backupId ? vscode.Uri.parse(openContext.backupId) : uri
      );
    }
    const document = new ExcalidrawDocument(uri, content);

    const onDidDocumentChange = document.onDidContentChange(() => {
      this._onDidChangeCustomDocument.fire({ document });
    });

    document.onDidDispose(() => {
      onDidDocumentChange.dispose();
    });

    return document;
  }

  revertCustomDocument(document: ExcalidrawDocument): Thenable<void> {
    return document.revert();
  }

  saveCustomDocument(document: ExcalidrawDocument): Thenable<void> {
    return document.save();
  }

  async saveCustomDocumentAs(
    document: ExcalidrawDocument,
    destination: vscode.Uri
  ) {
    await document.saveAs(destination);
  }
}

export class ExcalidrawEditor {
  // Allows to pass events between editors
  private static _onDidChangeLibrary = new vscode.EventEmitter<string>();
  private static onDidChangeLibrary =
    ExcalidrawEditor._onDidChangeLibrary.event;
  private static _onLibraryImport = new vscode.EventEmitter<{
    library: string;
  }>();
  private static onLibraryImport = ExcalidrawEditor._onLibraryImport.event;
  private textDecoder = new TextDecoder();

  // Registry of live editors, keyed by document URI, used to route agent
  // commands to the right webview (and to auto-open one when needed).
  private static registry = new Map<string, ExcalidrawEditor>();
  private static registrationWaiters = new Map<string, Array<() => void>>();

  // Pending command-result resolvers, keyed by request id.
  private pending = new Map<
    string,
    { resolve: (data: unknown) => void; reject: (err: Error) => void }
  >();
  private ready = false;
  private readyResolvers: Array<() => void> = [];
  private diagnosticsTimer: ReturnType<typeof setTimeout> | undefined;
  private freshnessTimer: ReturnType<typeof setTimeout> | undefined;

  private docKey() {
    return this.document.uri.toString();
  }

  readonly webview: vscode.Webview;

  constructor(
    readonly document: ExcalidrawDocument,
    readonly panel: vscode.WebviewPanel,
    readonly context: vscode.ExtensionContext
  ) {
    this.webview = panel.webview;
  }

  /** Bring this editor's webview to the foreground so its DOM/rAF is active. */
  public reveal() {
    this.panel.reveal(undefined, true);
  }

  isViewOnly() {
    return (
      this.document.uri.scheme === "git" ||
      this.document.uri.scheme === "conflictResolution"
    );
  }

  public async setupWebview() {
    // Setup initial content for the webview
    // Receive message from the webview.
    this.webview.options = {
      enableScripts: true,
    };

    let libraryUri = await this.getLibraryUri();

    const onDidReceiveMessage = this.webview.onDidReceiveMessage(
      async (msg) => {
        switch (msg.type) {
          case "library-change":
            const library = msg.library;
            await this.saveLibrary(library, libraryUri);
            ExcalidrawEditor._onDidChangeLibrary.fire(library);
            break;
          case "change":
            await this.document.update(new Uint8Array(msg.content));
            break;
          case "link-open":
            await openLink(vscode.Uri.parse(msg.url), this.document.uri);
            break;
          case "error":
            vscode.window.showErrorMessage(msg.content);
            break;
          case "info":
            vscode.window.showInformationMessage(msg.content);
            break;
          case "ready":
            this.ready = true;
            this.readyResolvers.forEach((resolve) => resolve());
            this.readyResolvers = [];
            break;
          case "command-result": {
            const entry = this.pending.get(msg.id);
            if (entry) {
              this.pending.delete(msg.id);
              if (msg.ok) {
                entry.resolve(msg.data);
              } else {
                entry.reject(
                  new Error(msg.error || "Excalidraw command failed")
                );
              }
            }
            break;
          }
          case "intel": {
            await this.handleIntel(msg);
            break;
          }
        }
      },
      this
    );

    const onDidChangeThemeConfiguration =
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration("excalidraw.theme", this.document.uri)) {
          return;
        }
        this.webview.postMessage({
          type: "theme-change",
          theme: this.getTheme(),
        });
      }, this);

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration("excalidraw.language", this.document.uri)) {
        return;
      }
      this.webview.postMessage({
        type: "language-change",
        langCode: this.getLanguage(),
      });
    }, this);

    const onDidChangeEmbedConfiguration =
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration("excalidraw.image", this.document.uri)) {
          return;
        }
        this.webview.postMessage({
          type: "image-params-change",
          imageParams: this.getImageParams(),
        });
      }, this);

    const onDidChangeLibraryConfiguration =
      vscode.workspace.onDidChangeConfiguration(async (e) => {
        if (
          !e.affectsConfiguration(
            "excalidraw.workspaceLibraryPath",
            this.document.uri
          )
        ) {
          return;
        }

        libraryUri = await this.getLibraryUri();
        const library = await this.loadLibrary(libraryUri);
        this.webview.postMessage({
          type: "library-change",
          library,
          merge: false,
        });
      });

    const onLibraryImport = ExcalidrawEditor.onLibraryImport(
      async ({ library }) => {
        this.webview.postMessage({
          type: "library-change",
          library,
          merge: true,
        });
      }
    );

    const onDidChangeLibrary = ExcalidrawEditor.onDidChangeLibrary(
      (library) => {
        this.webview.postMessage({
          type: "library-change",
          library,
          merge: false,
        });
      }
    );

    this.webview.html = await this.buildHtmlForWebview({
      content: Array.from(this.document.content),
      contentType: this.document.contentType,
      library: await this.loadLibrary(libraryUri),
      viewModeEnabled: this.isViewOnly() || undefined,
      theme: this.getTheme(),
      imageParams: this.getImageParams(),
      langCode: this.getLanguage(),
      name: this.extractName(this.document.uri),
    });

    ExcalidrawEditor.registry.set(this.docKey(), this);
    const waiters = ExcalidrawEditor.registrationWaiters.get(this.docKey());
    if (waiters) {
      ExcalidrawEditor.registrationWaiters.delete(this.docKey());
      waiters.forEach((resolve) => resolve());
    }

    // Push code diagnostics to the webview when diagnostics change anywhere
    // (debounced). Also refresh once the webview is ready.
    const onDidChangeDiagnostics = vscode.languages.onDidChangeDiagnostics(() =>
      this.scheduleDiagnosticsRefresh()
    );
    // Re-check link freshness ("diagram linter") when files are saved or renamed.
    const onDidSave = vscode.workspace.onDidSaveTextDocument(() =>
      this.scheduleFreshnessRefresh()
    );
    const onDidRename = vscode.workspace.onDidRenameFiles(() =>
      this.scheduleFreshnessRefresh()
    );
    this.whenReady()
      .then(() => {
        this.refreshDiagnostics();
        this.refreshFreshness();
      })
      .catch(() => {});

    return new vscode.Disposable(() => {
      onDidReceiveMessage.dispose();
      onDidChangeThemeConfiguration.dispose();
      onLibraryImport.dispose();
      onDidChangeLibraryConfiguration.dispose();
      onDidChangeLibrary.dispose();
      onDidChangeEmbedConfiguration.dispose();
      onDidChangeDiagnostics.dispose();
      onDidSave.dispose();
      onDidRename.dispose();
      if (this.diagnosticsTimer) {
        clearTimeout(this.diagnosticsTimer);
      }
      if (this.freshnessTimer) {
        clearTimeout(this.freshnessTimer);
      }
      if (ExcalidrawEditor.registry.get(this.docKey()) === this) {
        ExcalidrawEditor.registry.delete(this.docKey());
      }
      this.ready = false;
      this.pending.forEach((entry) =>
        entry.reject(new Error("Excalidraw editor was closed"))
      );
      this.pending.clear();
    });
  }

  private whenReady(timeoutMs = 10000): Promise<void> {
    if (this.ready) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(new Error("Excalidraw webview did not become ready in time")),
        timeoutMs
      );
      this.readyResolvers.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /**
   * Send a command to this editor's webview and await its result. Rejects on
   * timeout, on a webview-side failure, or when the action is not allowed on a
   * read-only document.
   */
  public async sendCommand(
    action: CommandAction,
    params?: unknown,
    timeoutMs = 15000
  ): Promise<unknown> {
    if (isMutatingAction(action) && this.isViewOnly()) {
      throw new Error(
        "This Excalidraw document is read-only and cannot be modified."
      );
    }
    await this.whenReady();
    const id = randomId();
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Excalidraw command "${action}" timed out`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (data) => {
          clearTimeout(timer);
          resolve(data);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      this.webview.postMessage({ type: "command", id, action, params });
    });
  }

  // --- Code intelligence (webview <-> host) ---

  private async handleIntel(msg: {
    id: string;
    op: string;
    params?: { codeLink?: CodeLink };
  }) {
    try {
      const link = msg.params?.codeLink as CodeLink | undefined;
      let data: unknown;
      if (!link) {
        throw new Error("Missing codeLink");
      }
      if (msg.op === "hover") {
        data = await hoverMarkdown(link);
      } else if (msg.op === "metrics") {
        data = await symbolMetrics(link);
      } else if (msg.op === "navigate") {
        const opened = await navigateToLink(link);
        if (!opened) {
          vscode.window.showWarningMessage(
            `Excalidraw: couldn't open code for "${link.symbol}". ` +
              `Make sure the project folder is open and indexed by a language server.`
          );
        }
        data = opened;
      } else if (msg.op === "navigateDiagnostic") {
        const opened = await navigateToDiagnostic(link);
        if (!opened) {
          vscode.window.showWarningMessage(
            `Excalidraw: couldn't open the file for "${link.symbol}".`
          );
        }
        data = opened;
      } else {
        throw new Error(`Unknown intel op "${msg.op}"`);
      }
      this.webview.postMessage({
        type: "intel-result",
        id: msg.id,
        ok: true,
        data,
      });
    } catch (e) {
      vscode.window.showErrorMessage(
        `Excalidraw code intel error: ${(e as Error).message || String(e)}`
      );
      this.webview.postMessage({
        type: "intel-result",
        id: msg.id,
        ok: false,
        error: (e as Error).message || String(e),
      });
    }
  }

  private scheduleDiagnosticsRefresh() {
    if (this.diagnosticsTimer) {
      clearTimeout(this.diagnosticsTimer);
    }
    this.diagnosticsTimer = setTimeout(() => this.refreshDiagnostics(), 400);
  }

  private async refreshDiagnostics() {
    if (!this.ready) {
      return;
    }
    try {
      const res = (await this.sendCommand("getCodeLinks")) as {
        links?: { id: string; codeLink: CodeLink }[];
      };
      const links = res?.links || [];
      const badges = links.length ? await diagnosticsForLinks(links) : {};
      this.webview.postMessage({ type: "code-diagnostics", badges });
    } catch {
      // editor may have closed; ignore
    }
  }

  private scheduleFreshnessRefresh() {
    if (this.freshnessTimer) {
      clearTimeout(this.freshnessTimer);
    }
    this.freshnessTimer = setTimeout(() => this.refreshFreshness(), 800);
  }

  private async refreshFreshness() {
    if (!this.ready) {
      return;
    }
    try {
      const res = (await this.sendCommand("getCodeLinks")) as {
        links?: { id: string; codeLink: CodeLink }[];
      };
      const links = res?.links || [];
      const stale = links.length ? await staleLinks(links) : {};
      this.webview.postMessage({ type: "code-stale", stale });
    } catch {
      // editor may have closed; ignore
    }
  }

  /** Returns a live editor for the given document URI, if one is open. */
  public static getLiveEditor(uri: vscode.Uri): ExcalidrawEditor | undefined {
    return ExcalidrawEditor.registry.get(uri.toString());
  }

  /**
   * Resolves a live editor for the given document, opening the file in the
   * Excalidraw custom editor first if none is currently open.
   */
  public static async resolveEditor(
    uri: vscode.Uri,
    timeoutMs = 15000
  ): Promise<ExcalidrawEditor> {
    const existing = ExcalidrawEditor.registry.get(uri.toString());
    if (existing) {
      return existing;
    }

    const key = uri.toString();
    const registered = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Timed out opening the Excalidraw editor")),
        timeoutMs
      );
      const waiters = ExcalidrawEditor.registrationWaiters.get(key) || [];
      waiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
      ExcalidrawEditor.registrationWaiters.set(key, waiters);
    });

    await showEditor(uri);
    await registered;

    const editor = ExcalidrawEditor.registry.get(key);
    if (!editor) {
      throw new Error("Failed to resolve the Excalidraw editor after opening");
    }
    return editor;
  }

  private getImageParams() {
    return vscode.workspace.getConfiguration("excalidraw").get("image");
  }

  private getLanguage() {
    return (
      vscode.workspace.getConfiguration("excalidraw").get("language") ||
      languageMap[vscode.env.language as keyof typeof languageMap]
    );
  }

  private getTheme() {
    return vscode.workspace
      .getConfiguration("excalidraw")
      .get("theme", "light");
  }

  public extractName(uri: vscode.Uri) {
    const name = path.parse(uri.fsPath).name;
    return name.endsWith(".excalidraw") ? name.slice(0, -11) : name;
  }

  public async getLibraryUri() {
    const libraryPath = await vscode.workspace
      .getConfiguration("excalidraw")
      .get<string>("workspaceLibraryPath");
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!libraryPath || !workspaceFolders) {
      return;
    }

    const fileWorkspace = getFileWorkspaceFolder(
      this.document.uri,
      workspaceFolders as vscode.WorkspaceFolder[]
    );
    if (!fileWorkspace) {
      return;
    }

    return vscode.Uri.joinPath(fileWorkspace.uri, libraryPath);
  }

  public static importLibrary(library: string) {
    this._onLibraryImport.fire({ library });
  }

  /** Load the current library content (workspace file or global storage). */
  public async getLibrary(): Promise<string | undefined> {
    return this.loadLibrary(await this.getLibraryUri());
  }

  public async loadLibrary(libraryUri?: vscode.Uri) {
    if (!libraryUri) {
      return this.context.globalState.get<string>("library");
    }
    try {
      const libraryContent = await vscode.workspace.fs.readFile(libraryUri);
      return this.textDecoder.decode(libraryContent);
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to load library: ${e}`);
      return this.context.globalState.get<string>("library");
    }
  }

  public async saveLibrary(library: string, libraryUri?: vscode.Uri) {
    if (!libraryUri) {
      return this.context.globalState.update("library", library);
    }
    try {
      await vscode.workspace.fs.writeFile(
        libraryUri,
        new TextEncoder().encode(library)
      );
    } catch (e) {
      await vscode.window.showErrorMessage(`Failed to save library: ${e}`);
    }
  }

  private async buildHtmlForWebview(config: any): Promise<string> {
    const webviewUri = vscode.Uri.joinPath(
      this.context.extensionUri,
      "webview",
      "dist"
    );
    const content = await vscode.workspace.fs.readFile(
      vscode.Uri.joinPath(webviewUri, "index.html")
    );
    let html = this.textDecoder.decode(content);

    html = html.replace(
      "{{data-excalidraw-config}}",
      Base64.encode(JSON.stringify(config))
    );

    html = html.replace(
      "{{excalidraw-asset-path}}",
      `${this.webview.asWebviewUri(webviewUri).toString()}/`
    );

    return this.fixLinks(html, webviewUri);
  }
  private fixLinks(document: string, documentUri: vscode.Uri): string {
    return document.replace(
      new RegExp("((?:src|href)=['\"])(.*?)(['\"])", "gmi"),
      (subString: string, p1: string, p2: string, p3: string): string => {
        const lower = p2.toLowerCase();
        if (
          p2.startsWith("#") ||
          lower.startsWith("http://") ||
          lower.startsWith("https://")
        ) {
          return subString;
        }
        const newUri = vscode.Uri.joinPath(documentUri, p2);
        const newUrl = [p1, this.webview.asWebviewUri(newUri), p3].join("");
        return newUrl;
      }
    );
  }
}

function getFileWorkspaceFolder(
  uri: vscode.Uri,
  workspaceFolders: vscode.WorkspaceFolder[]
): vscode.WorkspaceFolder | undefined {
  const parts = uri.path.split(path.sep).slice(0, -1);
  while (parts.length > 0) {
    const joined = parts.join(path.sep);
    const folder = workspaceFolders.find((f) => f.uri.path === joined);
    if (folder) {
      return folder;
    }
    parts.pop();
  }
}

async function openLink(uri: vscode.Uri, source: vscode.Uri): Promise<void> {
  if (uri.scheme !== "file") {
    await vscode.env.openExternal(uri);
    return;
  }

  const targetUri = vscode.Uri.joinPath(source, "..", uri.path);
  try {
    // Ensure the resource exists and is a file
    const stat = await vscode.workspace.fs.stat(targetUri);
    if (stat.type !== vscode.FileType.File) {
      throw new Error(`${targetUri.fsPath} is not a file`);
    }
  } catch (e) {
    // Otherwise, open it externally
    await vscode.env.openExternal(uri);
    return;
  }

  const extensions = [
    ".excalidraw",
    ".excalidraw.json",
    ".excalidraw.png",
    ".excalidraw.svg",
  ];
  for (const ext of extensions) {
    if (targetUri.fsPath.endsWith(ext)) {
      await showEditor(targetUri);
      return;
    }
  }

  await vscode.window.showTextDocument(targetUri, {
    preview: true,
  });
}
