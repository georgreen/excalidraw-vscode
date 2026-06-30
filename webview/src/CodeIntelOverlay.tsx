import { useEffect, useRef, useState, type ReactNode } from "react";
import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { vscode } from "./vscode.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface CodeInfo {
  elementId: string;
  symbol: string;
  codeLink: any;
  loading: boolean;
  hoverMd: string;
  anchor: { left: number; top: number };
  metrics?: { references?: number; implementations?: number };
}

type DiagBadge = {
  errors: number;
  warnings: number;
  file: string;
  messages?: string[];
};

// Pending intel requests (webview -> host -> webview), correlated by id.
const intelPending = new Map<string, (data: any) => void>();

const PANEL_W = 360;
const PANEL_H = 220;

/** Scene rect of an element -> on-screen anchor next to it (right, or left if it would overflow). */
function computeAnchor(el: any, appState: any): { left: number; top: number } {
  const zoom = appState?.zoom?.value ?? 1;
  const sx = appState?.scrollX ?? 0;
  const sy = appState?.scrollY ?? 0;
  const rightX = (el.x + el.width + sx) * zoom + 8;
  const leftX = (el.x + sx) * zoom - PANEL_W - 8;
  const winW = typeof window !== "undefined" ? window.innerWidth : 1200;
  const winH = typeof window !== "undefined" ? window.innerHeight : 800;
  let left = rightX + PANEL_W > winW ? leftX : rightX;
  left = Math.max(8, Math.min(left, winW - PANEL_W - 8));
  let top = (el.y + sy) * zoom;
  top = Math.max(8, Math.min(top, winH - PANEL_H - 8));
  return { left, top };
}

/** Top-right corner of an element, in on-screen coords (for a diagnostic badge). */
function computeBadgeAnchor(
  el: any,
  appState: any
): { left: number; top: number } {
  const zoom = appState?.zoom?.value ?? 1;
  const sx = appState?.scrollX ?? 0;
  const sy = appState?.scrollY ?? 0;
  return {
    left: (el.x + el.width + sx) * zoom - 14,
    top: (el.y + sy) * zoom - 8,
  };
}

/** Split LSP hover Markdown into a signature (first code block) and the rest. */
function splitHover(md: string): { sig: string; doc: string } {
  const cleaned = md
    .replace(/```[a-zA-Z-]*\n?/g, "\u0000")
    .replace(/```/g, "\u0000");
  const parts = cleaned.split("\u0000").map((s) => s.trim());
  // The first non-empty fenced section is the signature; the rest is docs.
  const nonEmpty = parts.filter((p) => p !== "");
  const sig = nonEmpty[0] || "";
  const doc = nonEmpty
    .slice(1)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^-{3,}$/gm, "")
    .trim();
  return { sig, doc };
}

function intel(op: string, params: any): Promise<any> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve) => {
    intelPending.set(id, resolve);
    vscode.postMessage({ type: "intel", id, op, params });
  });
}

interface PointerPayload {
  pointer: { x: number; y: number; tool: "pointer" | "laser" };
  button: "down" | "up";
}

/**
 * Code-aware layer UI. Shows a panel for the diagram element that is hovered or
 * selected and carries a `customData.codeLink`: its hover docs (from the running
 * language server, via the host), live diagnostics, and a "Go to code" action.
 *
 * Design constraints (Excalidraw has no element-hover event):
 *  - hover is derived from the `onPointerUpdate` prop (scene coords), forwarded
 *    by App via `registerPointer`, and hit-tested against linked elements;
 *  - we never add global keyboard handlers or intercept the canvas's pointer/
 *    keyboard handling — navigation rides the native link/`onLinkOpen` affordance;
 *  - hover is gated to the selection tool and ignored while dragging, so it does
 *    not interfere with drawing/other modes.
 */
export function CodeIntelOverlay(props: {
  api: ExcalidrawImperativeAPI | undefined;
  registerPointer: (cb: (payload: PointerPayload) => void) => void;
}) {
  const { api, registerPointer } = props;
  const [info, setInfo] = useState<CodeInfo | undefined>();
  const [badges, setBadges] = useState<Record<string, DiagBadge>>({});
  const [stale, setStale] = useState<Record<string, { reason: string; newFile?: string }>>({});
  // Bumped on canvas change so the diagnostic badge layer re-anchors.
  const [, setTick] = useState(0);

  const hoveredId = useRef<string | null>(null);
  const selectedId = useRef<string | null>(null);
  const shownId = useRef<string | null>(null);
  const apiRef = useRef(api);
  apiRef.current = api;
  const badgesRef = useRef(badges);
  badgesRef.current = badges;
  const staleRef = useRef(stale);
  staleRef.current = stale;
  const lastBadgeTick = useRef(0);

  // Listen for intel results and diagnostics pushes from the host.
  useEffect(() => {
    const listener = (e: any) => {
      const m = e.data;
      if (m?.type === "intel-result") {
        const resolve = intelPending.get(m.id);
        if (resolve) {
          intelPending.delete(m.id);
          resolve(m.ok ? m.data : undefined);
        }
      } else if (m?.type === "code-diagnostics") {
        setBadges(m.badges || {});
      } else if (m?.type === "code-stale") {
        setStale(m.stale || {});
      }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);

  // Show the panel for whichever element is selected (pinned) or hovered.
  const reconcile = () => {
    const a = apiRef.current;
    if (!a) {
      return;
    }
    const id = selectedId.current || hoveredId.current;
    if (id === shownId.current) {
      return;
    }
    shownId.current = id;
    if (!id) {
      setInfo(undefined);
      return;
    }
    const el: any = a.getSceneElements().find((e) => e.id === id);
    const codeLink = el?.customData?.codeLink;
    if (!codeLink) {
      shownId.current = null;
      setInfo(undefined);
      return;
    }
    const anchor = computeAnchor(el, a.getAppState());
    setInfo({
      elementId: id,
      symbol: codeLink.symbol,
      codeLink,
      loading: true,
      hoverMd: "",
      anchor,
    });
    intel("hover", { codeLink }).then((md: string | undefined) => {
      setInfo((cur) =>
        cur && cur.elementId === id
          ? {
              ...cur,
              loading: false,
              hoverMd: md || "",
            }
          : cur
      );
    });
    intel("metrics", { codeLink }).then((m: any) => {
      setInfo((cur) =>
        cur && cur.elementId === id ? { ...cur, metrics: m || {} } : cur
      );
    });
  };

  // Hover via onPointerUpdate (the only pointer hook), hit-tested against
  // linked elements. Gated to avoid interfering with drawing/dragging.
  useEffect(() => {
    let lastAt = 0;
    registerPointer((payload) => {
      const a = apiRef.current;
      if (!a || payload.button === "down") {
        return;
      }
      const now = Date.now();
      if (now - lastAt < 80) {
        return;
      }
      lastAt = now;
      const appState: any = a.getAppState();
      if (appState.activeTool?.type !== "selection") {
        return;
      }
      const p = payload.pointer;
      const els = a.getSceneElements();
      let hit: string | null = null;
      for (let i = els.length - 1; i >= 0; i--) {
        const el: any = els[i];
        if (!el.customData?.codeLink) {
          continue;
        }
        if (
          p.x >= el.x &&
          p.x <= el.x + el.width &&
          p.y >= el.y &&
          p.y <= el.y + el.height
        ) {
          hit = el.id;
          break;
        }
      }
      if (hoveredId.current !== hit) {
        hoveredId.current = hit;
        reconcile();
      }
    });
  }, [registerPointer]);

  // Selection pins the panel.
  useEffect(() => {
    if (!api) {
      return;
    }
    const unsub = api.onChange((elements, appState) => {
      const sel = Object.keys(appState.selectedElementIds || {}).filter(
        (id) => (appState.selectedElementIds as any)[id]
      );
      let pinned: string | null = null;
      if (sel.length === 1) {
        const el: any = elements.find((e) => e.id === sel[0]);
        if (el?.customData?.codeLink) {
          pinned = sel[0];
        }
      }
      if (selectedId.current !== pinned) {
        selectedId.current = pinned;
        reconcile();
      }
      // Keep the panel anchored to its element as the canvas scrolls/zooms/moves.
      const shown = shownId.current;
      if (shown) {
        const el: any = elements.find((e) => e.id === shown);
        if (el) {
          const anchor = computeAnchor(el, appState);
          setInfo((cur) =>
            cur && cur.elementId === shown ? { ...cur, anchor } : cur
          );
        }
      }
      // Re-anchor the badge layer (throttled) when badges or stale markers exist.
      if (
        Object.keys(badgesRef.current).length > 0 ||
        Object.keys(staleRef.current).length > 0
      ) {
        const now = Date.now();
        if (now - lastBadgeTick.current > 50) {
          lastBadgeTick.current = now;
          setTick((t) => t + 1);
        }
      }
    });
    return unsub;
  }, [api]);

  // Persistent diagnostic badge layer: a marker on every linked element whose
  // file currently has errors/warnings (positioned at the element's corner).
  const a = apiRef.current;
  let badgeLayer: ReactNode = null;
  const badgeIds = Object.keys(badges);
  const staleIds = Object.keys(stale);
  if (a && (badgeIds.length > 0 || staleIds.length > 0)) {
    const appState: any = a.getAppState();
    const els = a.getSceneElements() as any[];
    const markers = badgeIds
      .map((id) => {
        const el = els.find((e) => e.id === id);
        if (!el) {
          return null;
        }
        const b = badges[id];
        const pos = computeBadgeAnchor(el, appState);
        const title = (b.messages && b.messages.length ? b.messages : [b.file])
          .join("\n");
        return (
          <div
            key={id}
            className={`code-diag-badge ${
              b.errors > 0 ? "code-diag-error" : "code-diag-warning"
            }`}
            style={{ left: pos.left, top: pos.top }}
            title={`${title}\n\n(click to open the problem in code)`}
            onClick={() => {
              const codeLink = el?.customData?.codeLink;
              if (codeLink) {
                intel("navigateDiagnostic", { codeLink });
              }
            }}
          >
            {b.errors > 0 ? `⛔ ${b.errors}` : `⚠ ${b.warnings}`}
          </div>
        );
      })
      .filter(Boolean);
    // Stale markers ("diagram linter"): the linked symbol no longer resolves
    // (missing) or moved files. Positioned at the element's top-left corner.
    const staleMarkers = staleIds
      .map((id) => {
        const el = els.find((e) => e.id === id);
        if (!el) {
          return null;
        }
        const s = stale[id];
        const appState2: any = a.getAppState();
        const zoom = appState2?.zoom?.value ?? 1;
        const left = (el.x + (appState2?.scrollX ?? 0)) * zoom - 6;
        const top = (el.y + (appState2?.scrollY ?? 0)) * zoom - 8;
        const title =
          s.reason === "moved"
            ? `Link may be stale: symbol now in ${s.newFile}`
            : "Link is stale: symbol not found in the code";
        return (
          <div
            key={`stale-${id}`}
            className="code-stale-badge"
            style={{ left, top }}
            title={title}
          >
            ⟳
          </div>
        );
      })
      .filter(Boolean);
    badgeLayer = (
      <div className="code-diag-layer">
        {markers}
        {staleMarkers}
      </div>
    );
  }

  const badge = info ? badges[info.elementId] : undefined;
  const hover = info && !info.loading ? splitHover(info.hoverMd) : undefined;

  return (
    <>
      {badgeLayer}
      {info && (
        <div
          className="code-intel-overlay"
          style={{ left: info.anchor.left, top: info.anchor.top }}
        >
          <div className="code-intel-header">
            <span className="code-intel-symbol">{info.symbol}</span>
            {badge && (
              <span className="code-intel-diag">
                {badge.errors > 0 && (
                  <span className="code-intel-err">⛔ {badge.errors}</span>
                )}
                {badge.warnings > 0 && (
                  <span className="code-intel-warn">⚠ {badge.warnings}</span>
                )}
              </span>
            )}
            <button
              className="code-intel-goto"
              onClick={() => intel("navigate", { codeLink: info.codeLink })}
            >
              Go to code
            </button>
          </div>
          <div className="code-intel-body">
            {info.loading ? (
              <span className="code-intel-muted">Loading…</span>
            ) : hover && (hover.sig || hover.doc) ? (
              <>
                {hover.sig && <pre className="code-intel-sig">{hover.sig}</pre>}
                {hover.doc && <div className="code-intel-doc">{hover.doc}</div>}
              </>
            ) : (
              <span className="code-intel-muted">No hover info.</span>
            )}
            {info.metrics &&
              (info.metrics.references !== undefined ||
                info.metrics.implementations !== undefined) && (
                <div className="code-intel-metrics">
                  {info.metrics.references !== undefined && (
                    <button
                      className="code-intel-metric"
                      title="Show all references (peek)"
                      onClick={() =>
                        intel("showReferences", { codeLink: info.codeLink })
                      }
                    >
                      ↪ {info.metrics.references} reference
                      {info.metrics.references === 1 ? "" : "s"}
                    </button>
                  )}
                  {info.metrics.implementations !== undefined && (
                    <button
                      className="code-intel-metric"
                      title="Show all implementations (peek)"
                      onClick={() =>
                        intel("showImplementations", {
                          codeLink: info.codeLink,
                        })
                      }
                    >
                      ⊂ {info.metrics.implementations} implementation
                      {info.metrics.implementations === 1 ? "" : "s"}
                    </button>
                  )}
                </div>
              )}
          </div>
        </div>
      )}
    </>
  );
}
