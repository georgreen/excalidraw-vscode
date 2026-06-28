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

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(preferredPort, "127.0.0.1", () => resolve());
  });

  const address = httpServer.address();
  const port =
    typeof address === "object" && address ? address.port : preferredPort;
  const url = `http://127.0.0.1:${port}/mcp`;

  const dir = path.join(os.homedir(), ".excalidraw-vscode");
  await fs.mkdir(dir, { recursive: true });
  const discoveryFile = path.join(dir, "mcp.json");
  await fs.writeFile(
    discoveryFile,
    JSON.stringify(
      {
        url,
        port,
        pid: process.pid,
        workspace: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
        startedAt: new Date().toISOString(),
      },
      null,
      2
    ),
    "utf8"
  );

  state = { httpServer, discoveryFile, output };
  currentInfo = { url };
  onDidChangeEmitter.fire();
  context.subscriptions.push({ dispose: () => void stopMcpBridge() });

  output.appendLine(`Excalidraw MCP bridge listening on ${url}`);
  output.appendLine(`Discovery file: ${discoveryFile}`);
  output.appendLine("Localhost-only, no authentication (trusted machine).");
}

export async function stopMcpBridge(): Promise<void> {
  if (!state) {
    return;
  }
  const { httpServer, discoveryFile, output } = state;
  state = undefined;
  currentInfo = undefined;
  onDidChangeEmitter.fire();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  try {
    await fs.unlink(discoveryFile);
  } catch {
    // ignore
  }
  output.appendLine("Excalidraw MCP bridge stopped.");
  output.dispose();
}
