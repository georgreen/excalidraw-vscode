/* eslint-disable @typescript-eslint/no-explicit-any */
// Heuristic Excalidraw -> Mermaid flowchart exporter. Gives an LLM a compact
// textual view of graph-like diagrams (shapes connected by arrows). The
// shape/edge mapping mirrors (inverts) @excalidraw/mermaid-to-excalidraw's
// flowchart converter. Non-graph content (freedraw, images, unconnected text)
// is not represented.

const NODE_TYPES = new Set(["rectangle", "ellipse", "diamond"]);

type EdgeStyle = "normal" | "dashed" | "thick";

interface Edge {
  from: any;
  to: any;
  directed: boolean;
  style: EdgeStyle;
  label: string;
}

function escapeLabel(text: string): string {
  return (text || "")
    .replace(/\r?\n/g, " ")
    .replace(/"/g, "&quot;")
    .replace(/\|/g, "/")
    .trim();
}

/** Mermaid node delimiters for an Excalidraw shape (inverse of the m2e map). */
function nodeDelimiters(el: any): [string, string] {
  switch (el.type) {
    case "diamond":
      return ["{", "}"];
    case "ellipse":
      return ["((", "))"];
    case "rectangle":
      // m2e maps mermaid round/stadium -> rectangle + roundness; invert it.
      return el.roundness ? ["(", ")"] : ["[", "]"];
    default:
      return ["[", "]"];
  }
}

/** Inverse of m2e's stroke handling: dashed/dotted -> dashed, thick -> thick. */
function edgeStyle(el: any): EdgeStyle {
  const stroke = String(el.strokeStyle || "").toLowerCase();
  if (stroke === "dashed" || stroke === "dotted") {
    return "dashed";
  }
  if ((el.strokeWidth || 0) >= 3) {
    return "thick";
  }
  return "normal";
}

/** Build the mermaid connector (with optional label) for an edge. */
function connector(style: EdgeStyle, directed: boolean, label: string): string {
  if (!label) {
    if (style === "dashed") {
      return directed ? "-.->" : "-.-";
    }
    if (style === "thick") {
      return directed ? "==>" : "===";
    }
    return directed ? "-->" : "---";
  }
  if (style === "dashed") {
    return directed ? `-. ${label} .->` : `-. ${label} .-`;
  }
  if (style === "thick") {
    return directed ? `== ${label} ==>` : `== ${label} ===`;
  }
  return directed ? `-->|${label}|` : `---|${label}|`;
}

export function sceneToMermaid(elements: any[]): {
  mermaid: string;
  nodeCount: number;
  edgeCount: number;
  subgraphCount: number;
} {
  const byId = new Map<string, any>(elements.map((e) => [e.id, e]));

  // Bound text (labels) keyed by their container's id.
  const containerLabel = new Map<string, string>();
  for (const el of elements) {
    if (el.type === "text" && el.containerId) {
      containerLabel.set(el.containerId, el.text || "");
    }
  }

  // Edges from bound arrows/lines.
  const edges: Edge[] = [];
  for (const el of elements) {
    if (el.type !== "arrow" && el.type !== "line") {
      continue;
    }
    const from = el.startBinding?.elementId
      ? byId.get(el.startBinding.elementId)
      : undefined;
    const to = el.endBinding?.elementId
      ? byId.get(el.endBinding.elementId)
      : undefined;
    if (!from || !to) {
      continue;
    }
    let label = "";
    const boundText = (el.boundElements || []).find(
      (b: any) => b.type === "text"
    );
    if (boundText) {
      label = byId.get(boundText.id)?.text || "";
    }
    edges.push({
      from,
      to,
      directed: el.type === "arrow",
      style: edgeStyle(el),
      label,
    });
  }

  // Nodes: every shape, plus any text element used as an edge endpoint.
  const nodeEls: any[] = [];
  const seen = new Set<string>();
  const addNode = (el: any) => {
    if (el && !seen.has(el.id)) {
      seen.add(el.id);
      nodeEls.push(el);
    }
  };
  for (const el of elements) {
    if (NODE_TYPES.has(el.type)) {
      addNode(el);
    }
  }
  for (const edge of edges) {
    addNode(edge.from);
    addNode(edge.to);
  }

  // Frames -> subgraphs (inverse of m2e's subgraph -> grouped container).
  const frames = elements.filter((el) => el.type === "frame");
  const frameIds = new Set(frames.map((f) => f.id));

  // Stable mermaid ids.
  const mermaidId = new Map<string, string>();
  nodeEls.forEach((el, i) => mermaidId.set(el.id, `n${i + 1}`));

  const labelFor = (el: any): string => {
    if (NODE_TYPES.has(el.type)) {
      return containerLabel.get(el.id) ?? "";
    }
    if (el.type === "text") {
      return el.text || "";
    }
    return "";
  };

  const renderNode = (el: any): string => {
    const id = mermaidId.get(el.id)!;
    const [open, close] = nodeDelimiters(el);
    const label = `"${escapeLabel(labelFor(el)) || el.type}"`;
    return `${id}${open}${label}${close}`;
  };

  const lines = ["flowchart TD"];
  const rendered = new Set<string>();
  let subgraphCount = 0;

  // Subgraphs first, with their member node definitions inside.
  frames.forEach((frame, i) => {
    const members = nodeEls.filter(
      (n) => n.frameId === frame.id && frameIds.has(frame.id)
    );
    if (members.length === 0) {
      return;
    }
    subgraphCount++;
    const title = `"${escapeLabel(frame.name || "Frame")}"`;
    lines.push(`    subgraph sg${i + 1}[${title}]`);
    for (const m of members) {
      lines.push(`        ${renderNode(m)}`);
      rendered.add(m.id);
    }
    lines.push("    end");
  });

  // Remaining (un-framed) node definitions.
  for (const el of nodeEls) {
    if (!rendered.has(el.id)) {
      lines.push(`    ${renderNode(el)}`);
      rendered.add(el.id);
    }
  }

  // Edges.
  for (const edge of edges) {
    const a = mermaidId.get(edge.from.id);
    const b = mermaidId.get(edge.to.id);
    if (!a || !b) {
      continue;
    }
    const conn = connector(edge.style, edge.directed, escapeLabel(edge.label));
    lines.push(`    ${a} ${conn} ${b}`);
  }

  if (nodeEls.length === 0 && edges.length === 0) {
    lines.push(
      "    %% No graph-like elements (shapes connected by arrows) were found."
    );
  }

  return {
    mermaid: lines.join("\n"),
    nodeCount: nodeEls.length,
    edgeCount: edges.length,
    subgraphCount,
  };
}
