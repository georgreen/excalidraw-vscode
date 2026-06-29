import * as vscode from "vscode";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./server";

interface BridgeState {
  httpServer: http.Server;
  discoveryFile: string;
  legacyFile: string;
  output: vscode.OutputChannel;
}

let state: BridgeState | undefined;

const onDidChangeEmitter = new vscode.EventEmitter<void>();
/** Fires when the bridge starts or stops (used by the MCP definition provider). */
export const onDidChangeBridge = onDidChangeEmitter.event;

let currentInfo: { url: string } | undefined;

/** The current bridge URL, or undefined when not running. */
export function getBridgeInfo(): { url: string } | undefined {
  return currentInfo;
}

const ROOT_DIR = path.join(os.homedir(), ".excalidraw-vscode");
const SERVERS_DIR = path.join(ROOT_DIR, "servers");

/** Non-cryptographic stable key for a workspace path (FNV-1a, hex). */
function workspaceKey(workspacePath: string | undefined): string {
  const input = workspacePath || `pid-${process.pid}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** True if a process with the given pid is currently alive. */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Remove discovery files whose owning process is no longer running. */
async function cleanupStaleServers(): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(SERVERS_DIR);
  } catch {
    return;
  }
  for (const name of entries) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const file = path.join(SERVERS_DIR, name);
    try {
      const data = JSON.parse(await fs.readFile(file, "utf8")) as {
        pid?: number;
      };
      if (typeof data.pid === "number" && !pidAlive(data.pid)) {
        await fs.unlink(file);
      }
    } catch {
      // unreadable/corrupt: drop it
      try {
        await fs.unlink(file);
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Listen on the preferred port, falling back to an OS-assigned free port when it
 * is already in use (e.g. another VS Code window owns it). This keeps every
 * window's bridge running instead of failing on a port clash.
 */
function listenWithFallback(
  server: http.Server,
  preferredPort: number
): Promise<{ port: number; fellBack: boolean }> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE" && preferredPort !== 0) {
        server.listen(0, "127.0.0.1", () => {
          const addr = server.address();
          resolve({
            port: typeof addr === "object" && addr ? addr.port : 0,
            fellBack: true,
          });
        });
        return;
      }
      reject(err);
    };
    server.once("error", onError);
    server.listen(preferredPort, "127.0.0.1", () => {
      server.removeListener("error", onError);
      const addr = server.address();
      resolve({
        port: typeof addr === "object" && addr ? addr.port : preferredPort,
        fellBack: false,
      });
    });
  });
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      if (!data) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

/**
 * Start the MCP bridge server if enabled. Only runs in the Node extension host.
 * Binds to localhost (127.0.0.1) with no authentication — it is intended for a
 * single trusted machine — and writes a discovery file so external agents can
 * connect.
 */
export async function startMcpBridge(
  context: vscode.ExtensionContext
): Promise<void> {
  const config = vscode.workspace.getConfiguration("excalidraw");
  if (!config.get<boolean>("mcp.enabled", true)) {
    return;
  }
  if (state) {
    return;
  }

  const output = vscode.window.createOutputChannel("Excalidraw MCP");
  const version: string =
    (context.extension.packageJSON as { version?: string }).version || "0.0.0";
  const preferredPort = config.get<number>("mcp.port", 0) || 0;

  const httpServer = http.createServer(async (req, res) => {
    if (req.method === "GET" && (req.url || "").startsWith("/health")) {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405);
      res.end();
      return;
    }

    let body: unknown;
    try {
      body = await readBody(req);
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "invalid JSON body" }));
      return;
    }

    // Stateless JSON mode: a fresh server + transport per request.
    const server = createMcpServer(version);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (e) {
      output.appendLine(`Request error: ${(e as Error).message}`);
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "internal error" }));
      }
    }
  });

  const { port, fellBack } = await listenWithFallback(
    httpServer,
    preferredPort
  );
  const url = `http://127.0.0.1:${port}/mcp`;

  // Per-window/per-workspace discovery: one file per running server, so multiple
  // VS Code windows don't clobber each other. A legacy single-file pointer is
  // also written for backward compatibility (last writer wins; prefer servers/).
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  await fs.mkdir(SERVERS_DIR, { recursive: true });
  await cleanupStaleServers();
  const discoveryFile = path.join(
    SERVERS_DIR,
    `${workspaceKey(workspacePath)}.json`
  );
  const legacyFile = path.join(ROOT_DIR, "mcp.json");
  const payload = JSON.stringify(
    {
      url,
      port,
      pid: process.pid,
      workspace: workspacePath,
      workspaceName: vscode.workspace.name,
      startedAt: new Date().toISOString(),
    },
    null,
    2
  );
  await fs.writeFile(discoveryFile, payload, "utf8");
  await fs.writeFile(legacyFile, payload, "utf8");

  state = { httpServer, discoveryFile, legacyFile, output };
  currentInfo = { url };
  onDidChangeEmitter.fire();
  context.subscriptions.push({ dispose: () => void stopMcpBridge() });

  output.appendLine(`Excalidraw MCP bridge listening on ${url}`);
  if (fellBack) {
    output.appendLine(
      `(Preferred port ${preferredPort} was in use — another window likely owns it — so a free port was chosen.)`
    );
  }
  output.appendLine(`Discovery file: ${discoveryFile}`);
  output.appendLine("Localhost-only, no authentication (trusted machine).");
}

export async function stopMcpBridge(): Promise<void> {
  if (!state) {
    return;
  }
  const { httpServer, discoveryFile, legacyFile, output } = state;
  state = undefined;
  currentInfo = undefined;
  onDidChangeEmitter.fire();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  try {
    await fs.unlink(discoveryFile);
  } catch {
    // ignore
  }
  // Only remove the legacy pointer if it still refers to this server.
  try {
    const data = JSON.parse(await fs.readFile(legacyFile, "utf8")) as {
      pid?: number;
    };
    if (data.pid === process.pid) {
      await fs.unlink(legacyFile);
    }
  } catch {
    // ignore
  }
  output.appendLine("Excalidraw MCP bridge stopped.");
  output.dispose();
}
