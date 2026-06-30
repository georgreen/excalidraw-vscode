/* eslint-disable @typescript-eslint/no-explicit-any */
// This dispatcher bridges loosely-typed Excalidraw element "skeletons" coming
// from agents, so `any` is used deliberately at the boundary.
import {
  convertToExcalidrawElements,
  exportToBlob,
  exportToSvg,
  restoreElements,
} from "@excalidraw/excalidraw";
import { parseMermaidToExcalidraw } from "@excalidraw/mermaid-to-excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { CommandRequest, CommandResult } from "./protocol";
import { sceneToMermaid } from "./sceneToMermaid";

type AnyParams = Record<string, any>;

function randomId(): string {
  const c = (globalThis as any).crypto;
  return c?.randomUUID
    ? c.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function summarizeElement(el: any) {
  return {
    id: el.id,
    type: el.type,
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
    angle: el.angle,
    strokeColor: el.strokeColor,
    backgroundColor: el.backgroundColor,
    ...(el.text !== undefined ? { text: el.text } : {}),
    ...(el.containerId ? { containerId: el.containerId } : {}),
  };
}

function getSelectedIds(api: ExcalidrawImperativeAPI): string[] {
  const selected = api.getAppState().selectedElementIds || {};
  return Object.keys(selected).filter((id) => selected[id]);
}

/**
 * Describe a freshly converted element: its final geometry plus whether it is a
 * container and the id of any auto-created bound text (label). Final width/height
 * may differ from a requested size because a bound label enforces a minimum
 * container size (Excalidraw grows the shape to fit the text).
 */
function describeCreated(el: any) {
  const out: AnyParams = {
    id: el.id,
    type: el.type,
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
  };
  if (el.containerId) {
    out.containerId = el.containerId;
  }
  const boundText = (el.boundElements || []).find(
    (b: any) => b.type === "text"
  );
  if (boundText) {
    out.boundTextId = boundText.id;
  }
  return out;
}

/**
 * Execute a single canvas command against the live Excalidraw API and return a
 * protocol result. All handlers are wrapped so a thrown error becomes
 * `{ ok: false, error }` rather than crashing the message loop.
 */
export async function handleCommand(
  api: ExcalidrawImperativeAPI,
  request: CommandRequest
): Promise<CommandResult> {
  const params: AnyParams = (request.params as AnyParams) || {};
  try {
    const data = await runAction(api, request.action, params);
    return { type: "command-result", id: request.id, ok: true, data };
  } catch (e) {
    return {
      type: "command-result",
      id: request.id,
      ok: false,
      error: (e as Error).message || String(e),
    };
  }
}

async function runAction(
  api: ExcalidrawImperativeAPI,
  action: CommandRequest["action"],
  params: AnyParams
): Promise<unknown> {
  switch (action) {
    case "getScene": {
      const elements = api.getSceneElements().map(summarizeElement);
      return { elements, count: elements.length };
    }

    case "getSelection": {
      return { selectedElementIds: getSelectedIds(api) };
    }

    case "getAppState": {
      const s = api.getAppState();
      return {
        scrollX: s.scrollX,
        scrollY: s.scrollY,
        zoom: s.zoom?.value ?? s.zoom,
        theme: s.theme,
        viewBackgroundColor: s.viewBackgroundColor,
        currentItemStrokeColor: s.currentItemStrokeColor,
        currentItemBackgroundColor: s.currentItemBackgroundColor,
      };
    }

    case "getMermaid": {
      return sceneToMermaid(api.getSceneElements() as any[]);
    }

    case "setCodeLink": {
      const idSet = new Set<string>(params.ids || []);
      const codeLink = params.codeLink;
      const clearing = codeLink === null || codeLink === undefined;
      if (
        !clearing &&
        (typeof codeLink.symbol !== "string" || codeLink.symbol.trim() === "")
      ) {
        throw new Error(
          "setCodeLink requires codeLink.symbol (a non-empty string), or codeLink: null to unlink."
        );
      }
      // Mirror the link into the element's native `link` so Excalidraw shows its
      // badge/tooltip and a click fires onLinkOpen (handled as code navigation).
      const linkLabel = clearing ? null : `code: ${codeLink.symbol}`;
      const elements = api.getSceneElementsIncludingDeleted().map((el) => {
        if (!idSet.has(el.id)) {
          return el;
        }
        const customData = { ...((el as any).customData || {}) };
        const existingLink = (el as any).link ?? null;
        if (clearing) {
          delete customData.codeLink;
          // Only clear our own "code:" link; preserve a user-set URL link.
          const link =
            typeof existingLink === "string" && existingLink.startsWith("code:")
              ? null
              : existingLink;
          return { ...el, link, customData };
        }
        customData.codeLink = codeLink;
        return { ...el, link: linkLabel, customData };
      });
      api.updateScene({ elements });
      return { updated: (params.ids || []).length, cleared: clearing };
    }

    case "getCodeLinks": {
      const links = api
        .getSceneElements()
        .filter((el) => (el as any).customData?.codeLink)
        .map((el) => ({
          id: el.id,
          codeLink: (el as any).customData.codeLink,
        }));
      return { links };
    }

    case "getElementLabels": {
      const all = api.getSceneElements() as any[];
      const textById = new Map<string, string>();
      for (const el of all) {
        if (el.type === "text" && typeof el.text === "string") {
          textById.set(el.id, el.text);
        }
      }
      const labelFor = (el: any): string => {
        if (typeof el.text === "string") {
          return el.text;
        }
        const bound = (el.boundElements || []).find(
          (b: any) => b.type === "text"
        );
        return (bound && textById.get(bound.id)) || "";
      };
      // Shapes that can stand for a code symbol (skip bound labels themselves).
      const elements = all
        .filter(
          (el) =>
            el.type !== "text" || !el.containerId
        )
        .map((el) => ({
          id: el.id,
          type: el.type,
          label: labelFor(el),
          linked: !!el.customData?.codeLink,
        }))
        .filter((e) => e.label.trim() !== "");
      return { elements };
    }

    case "placeGeneratedGraph": {
      const nodes = (params.nodes as any[]) || [];
      const edges = (params.edges as any[]) || [];
      const ox = typeof params.originX === "number" ? params.originX : 120;
      const oy = typeof params.originY === "number" ? params.originY : 120;
      const GAPX = 300;
      const GAPY = 120;
      const kindColor = (kind?: string): string => {
        switch (kind) {
          case "interface":
            return "#d0bfff";
          case "function":
            return "#a5d8ff";
          case "method":
            return "#ffd8a8";
          case "class":
            return "#b2f2bb";
          default:
            return "#ffec99";
        }
      };
      const nodeSkeletons: any[] = nodes.map((n: any) => ({
        type: "rectangle",
        x: ox + (n.rank || 0) * GAPX,
        y: oy + (n.row || 0) * GAPY,
        width: 230,
        height: 70,
        backgroundColor: kindColor(n.codeLink?.kind),
        label: { text: String(n.label ?? n.codeLink?.symbol ?? "") },
        link: n.codeLink?.symbol ? `code: ${n.codeLink.symbol}` : undefined,
        customData: n.codeLink ? { codeLink: n.codeLink } : undefined,
      }));
      const nodeEls = convertToExcalidrawElements(nodeSkeletons, {
        regenerateIds: true,
      });
      // convertToExcalidrawElements emits container + bound label; the i-th
      // non-text element corresponds to node[i].
      const containers = nodeEls.filter((e) => e.type !== "text");
      const keyToId = new Map<string, string>();
      nodes.forEach((n: any, i: number) => {
        if (containers[i]) {
          keyToId.set(n.key, containers[i].id);
        }
      });
      api.updateScene({ elements: [...api.getSceneElements(), ...nodeEls] });

      const arrowSkeletons = edges
        .map((e: any) => {
          const startId = keyToId.get(e.from);
          const endId = keyToId.get(e.to);
          if (!startId || !endId) {
            return null;
          }
          const s = api.getSceneElements().find((el) => el.id === startId)!;
          return {
            type: "arrow",
            x: s.x + (s.width || 0) / 2,
            y: s.y + (s.height || 0) / 2,
            start: { id: startId },
            end: { id: endId },
            ...(e.label ? { label: { text: String(e.label) } } : {}),
          };
        })
        .filter(Boolean) as any[];
      if (arrowSkeletons.length > 0) {
        const arrowEls = convertToExcalidrawElements(arrowSkeletons, {
          regenerateIds: true,
        });
        api.updateScene({ elements: [...api.getSceneElements(), ...arrowEls] });
      }
      return {
        nodes: nodes.map((n: any) => ({
          key: n.key,
          id: keyToId.get(n.key),
          symbol: n.codeLink?.symbol,
        })),
        edgeCount: arrowSkeletons.length,
      };
    }

    case "expandFromElement": {
      const sourceId = params.sourceId as string;
      const direction = params.direction === "in" ? "in" : "out";
      const neighbors = (params.neighbors as any[]) || [];
      const all = api.getSceneElements() as any[];
      const source = all.find((e) => e.id === sourceId);
      if (!source) {
        throw new Error(`Source element "${sourceId}" not found.`);
      }
      // Index existing linked elements so we connect to (not duplicate) nodes
      // that already represent a neighbor symbol.
      const linkKey = (cl: any): string =>
        cl?.uri && cl?.selectionStart
          ? `${cl.uri}@${cl.selectionStart.line}:${cl.selectionStart.character}`
          : `${cl?.symbol}|${cl?.file}`;
      const existingByKey = new Map<string, string>();
      for (const el of all) {
        const cl = el.customData?.codeLink;
        if (cl) {
          existingByKey.set(linkKey(cl), el.id);
        }
      }
      const kindColor = (kind?: string): string => {
        switch (kind) {
          case "interface":
            return "#d0bfff";
          case "function":
            return "#a5d8ff";
          case "method":
            return "#ffd8a8";
          case "class":
            return "#b2f2bb";
          default:
            return "#ffec99";
        }
      };
      // Place new nodes in a column offset from the source (right for "out",
      // left for "in"), stacked vertically.
      const colX =
        direction === "out"
          ? source.x + (source.width || 230) + 140
          : source.x - 230 - 140;
      const newSkeletons: any[] = [];
      const targetIdByKey = new Map<string, string>();
      let row = 0;
      for (const nb of neighbors) {
        const existingId = existingByKey.get(linkKey(nb.codeLink));
        if (existingId) {
          targetIdByKey.set(nb.key, existingId);
          continue;
        }
        newSkeletons.push({
          type: "rectangle",
          x: colX,
          y: source.y + row * 110,
          width: 230,
          height: 70,
          backgroundColor: kindColor(nb.codeLink?.kind),
          label: { text: String(nb.label ?? nb.codeLink?.symbol ?? "") },
          link: nb.codeLink?.symbol ? `code: ${nb.codeLink.symbol}` : undefined,
          customData: nb.codeLink ? { codeLink: nb.codeLink } : undefined,
          __key: nb.key,
        });
        row++;
      }
      if (newSkeletons.length > 0) {
        const skeletons = newSkeletons.map((s) => {
          const { __key, ...rest } = s;
          void __key;
          return rest;
        });
        const created = convertToExcalidrawElements(skeletons, {
          regenerateIds: true,
        });
        const containers = created.filter((e) => e.type !== "text");
        newSkeletons.forEach((s, i) => {
          if (containers[i]) {
            targetIdByKey.set(s.__key, containers[i].id);
          }
        });
        api.updateScene({ elements: [...api.getSceneElements(), ...created] });
      }
      // Connect arrows between the source and each neighbor in the right order.
      const arrowSkeletons = neighbors
        .map((nb: any) => {
          const otherId = targetIdByKey.get(nb.key);
          if (!otherId) {
            return null;
          }
          const startId = direction === "out" ? sourceId : otherId;
          const endId = direction === "out" ? otherId : sourceId;
          const s = api.getSceneElements().find((el) => el.id === startId)!;
          return {
            type: "arrow",
            x: s.x + (s.width || 0) / 2,
            y: s.y + (s.height || 0) / 2,
            start: { id: startId },
            end: { id: endId },
          };
        })
        .filter(Boolean) as any[];
      if (arrowSkeletons.length > 0) {
        const arrowEls = convertToExcalidrawElements(arrowSkeletons, {
          regenerateIds: true,
        });
        api.updateScene({ elements: [...api.getSceneElements(), ...arrowEls] });
      }
      return {
        added: newSkeletons.length,
        connected: arrowSkeletons.length,
        reused: neighbors.length - newSkeletons.length,
      };
    }

    case "getEdgeEndpoints": {
      const arrowId = params.arrowId as string;
      const all = api.getSceneElements() as any[];
      const arrow = all.find((e) => e.id === arrowId);
      if (!arrow || arrow.type !== "arrow") {
        throw new Error(`Element "${arrowId}" is not an arrow.`);
      }
      const startId = arrow.startBinding?.elementId;
      const endId = arrow.endBinding?.elementId;
      const startEl = all.find((e) => e.id === startId);
      const endEl = all.find((e) => e.id === endId);
      const from = startEl?.customData?.codeLink;
      const to = endEl?.customData?.codeLink;
      return {
        arrowId,
        from: from || null,
        to: to || null,
        bound: !!(from && to),
      };
    }

    case "addElements": {
      const skeleton = params.elements;
      if (!Array.isArray(skeleton)) {
        throw new Error(
          '"elements" must be an array of Excalidraw element skeletons.'
        );
      }
      const converted = convertToExcalidrawElements(skeleton, {
        regenerateIds: true,
      });
      const existing = api.getSceneElements();
      api.updateScene({ elements: [...existing, ...converted] });
      return {
        ids: converted.map((e) => e.id),
        added: converted.length,
        elements: converted.map(describeCreated),
      };
    }

    case "connectElements": {
      const { startId, endId, label } = params;
      const elements = api.getSceneElements();
      const start = elements.find((e) => e.id === startId);
      const end = elements.find((e) => e.id === endId);
      if (!start || !end) {
        throw new Error(
          `Both startId and endId must reference existing elements. Missing: ${
            !start ? startId : ""
          } ${!end ? endId : ""}`.trim()
        );
      }
      const skeleton: any = {
        type: "arrow",
        x: start.x + (start.width || 0) / 2,
        y: start.y + (start.height || 0) / 2,
        start: { id: startId },
        end: { id: endId },
        ...(label ? { label: { text: String(label) } } : {}),
      };
      const converted = convertToExcalidrawElements([skeleton], {
        regenerateIds: true,
      });
      api.updateScene({ elements: [...elements, ...converted] });
      return {
        ids: converted.map((e) => e.id),
        elements: converted.map(describeCreated),
      };
    }

    case "updateElements": {
      const updates = params.updates;
      if (!Array.isArray(updates)) {
        throw new Error(
          '"updates" must be an array of { id, ...patch } objects.'
        );
      }
      const patchById = new Map<string, AnyParams>(
        updates.map((u: AnyParams) => [u.id, u])
      );
      const updatedIds: string[] = [];
      const elements = api.getSceneElementsIncludingDeleted().map((el) => {
        const patch = patchById.get(el.id);
        if (!patch) {
          return el;
        }
        updatedIds.push(el.id);
        const rest: AnyParams = { ...patch };
        delete rest.id;
        return { ...el, ...rest };
      });
      if (updatedIds.length === 0) {
        throw new Error(
          "None of the provided ids matched an element on the canvas."
        );
      }
      api.updateScene({ elements });
      return { updatedIds };
    }

    case "moveElements": {
      const ids: string[] = params.ids || [];
      if (ids.length === 0) {
        throw new Error("Provide ids of the elements to move.");
      }
      const all = api.getSceneElementsIncludingDeleted();
      const byId = new Map<string, any>(all.map((e) => [e.id, e]));
      const targetSet = new Set(ids);

      // Resolve the translation delta.
      let dx = Number(params.dx) || 0;
      let dy = Number(params.dy) || 0;
      if (params.x !== undefined || params.y !== undefined) {
        const targets = ids.map((id) => byId.get(id)).filter(Boolean);
        if (targets.length === 0) {
          throw new Error("None of the provided ids matched an element.");
        }
        const minX = Math.min(...targets.map((e) => e.x));
        const minY = Math.min(...targets.map((e) => e.y));
        if (params.x !== undefined) {
          dx = Number(params.x) - minX;
        }
        if (params.y !== undefined) {
          dy = Number(params.y) - minY;
        }
      }
      if (dx === 0 && dy === 0) {
        throw new Error("Provide dx/dy (relative) or x/y (absolute) to move.");
      }

      // Move the targets, their bound labels, and connectors whose BOTH ends
      // are being moved (so groups / connected shapes translate together).
      const moveSet = new Set<string>(ids);
      for (const el of all) {
        if (el.type === "arrow" || el.type === "line") {
          const s = el.startBinding?.elementId;
          const t = el.endBinding?.elementId;
          if (s && t && targetSet.has(s) && targetSet.has(t)) {
            moveSet.add(el.id);
          }
        }
      }
      for (const id of Array.from(moveSet)) {
        const el = byId.get(id);
        for (const bound of el?.boundElements || []) {
          if (bound.type === "text") {
            moveSet.add(bound.id);
          }
        }
      }

      const next = all.map((el) =>
        moveSet.has(el.id) ? { ...el, x: el.x + dx, y: el.y + dy } : el
      );
      api.updateScene({ elements: next });
      return { movedIds: Array.from(moveSet), dx, dy };
    }

    case "deleteElements": {
      const ids: string[] = params.ids || [];
      const idSet = new Set(ids);
      const elements = api
        .getSceneElementsIncludingDeleted()
        .map((el) => (idSet.has(el.id) ? { ...el, isDeleted: true } : el));
      api.updateScene({ elements });
      return { deleted: ids.length };
    }

    case "setScene": {
      const skeleton = params.elements;
      if (!Array.isArray(skeleton)) {
        throw new Error(
          '"elements" must be an array of Excalidraw element skeletons.'
        );
      }
      const converted = convertToExcalidrawElements(skeleton, {
        regenerateIds: true,
      });
      api.updateScene({ elements: converted });
      return {
        ids: converted.map((e) => e.id),
        count: converted.length,
        elements: converted.map(describeCreated),
      };
    }

    case "clearCanvas": {
      api.updateScene({ elements: [] });
      return { cleared: true };
    }

    case "selectElements": {
      const ids: string[] = params.ids || [];
      const selectedElementIds: { [id: string]: true } = {};
      for (const id of ids) {
        selectedElementIds[id] = true;
      }
      api.updateScene({ appState: { selectedElementIds } });
      return { selectedElementIds: ids };
    }

    case "reorderElements": {
      const ids: string[] = params.ids || [];
      const mode: string = params.mode || "front";
      const idSet = new Set(ids);
      const all = api.getSceneElementsIncludingDeleted();
      const targets = all.filter((e) => idSet.has(e.id));
      const others = all.filter((e) => !idSet.has(e.id));
      let ordered: any[];
      switch (mode) {
        case "back":
          ordered = [...targets, ...others];
          break;
        case "forward": {
          ordered = [...all];
          for (let i = ordered.length - 2; i >= 0; i--) {
            if (idSet.has(ordered[i].id) && !idSet.has(ordered[i + 1].id)) {
              [ordered[i], ordered[i + 1]] = [ordered[i + 1], ordered[i]];
            }
          }
          break;
        }
        case "backward": {
          ordered = [...all];
          for (let i = 1; i < ordered.length; i++) {
            if (idSet.has(ordered[i].id) && !idSet.has(ordered[i - 1].id)) {
              [ordered[i], ordered[i - 1]] = [ordered[i - 1], ordered[i]];
            }
          }
          break;
        }
        case "front":
        default:
          ordered = [...others, ...targets];
          break;
      }
      // Null the fractional indices so Excalidraw regenerates them in array order.
      api.updateScene({
        elements: ordered.map((e) => ({ ...e, index: null })),
      });
      return { reordered: ids.length, mode };
    }

    case "lockElements": {
      const idSet = new Set<string>(params.ids || []);
      const locked = params.locked !== false;
      const elements = api
        .getSceneElementsIncludingDeleted()
        .map((el) => (idSet.has(el.id) ? { ...el, locked } : el));
      api.updateScene({ elements });
      return { locked, count: (params.ids || []).length };
    }

    case "duplicateElements": {
      const ids: string[] = params.ids || [];
      const dx = params.dx ?? 10;
      const dy = params.dy ?? 10;
      const all = api.getSceneElementsIncludingDeleted();
      const byId = new Map<string, any>(all.map((e) => [e.id, e]));

      // Include bound text labels of selected containers.
      const toClone = new Set<string>(ids);
      for (const id of ids) {
        for (const b of byId.get(id)?.boundElements || []) {
          if (b.type === "text") {
            toClone.add(b.id);
          }
        }
      }
      const idMap = new Map<string, string>();
      for (const id of toClone) {
        idMap.set(id, randomId());
      }
      const clones: any[] = [];
      for (const id of toClone) {
        const src = byId.get(id);
        if (!src) {
          continue;
        }
        const clone: any = {
          ...src,
          id: idMap.get(id),
          x: src.x + dx,
          y: src.y + dy,
          index: null,
        };
        if (src.containerId) {
          clone.containerId = idMap.get(src.containerId) ?? null;
        }
        if (Array.isArray(src.boundElements)) {
          clone.boundElements = src.boundElements
            .filter((b: any) => idMap.has(b.id))
            .map((b: any) => ({ ...b, id: idMap.get(b.id) }));
        }
        // Drop external bindings so duplicates don't claim originals' bindings.
        clone.startBinding = null;
        clone.endBinding = null;
        clones.push(clone);
      }
      api.updateScene({ elements: [...all, ...clones] });
      return {
        ids: clones.map((c) => c.id),
        idMap: Object.fromEntries(idMap),
      };
    }

    case "flipElements": {
      const idSet = new Set<string>(params.ids || []);
      const axis = params.axis === "vertical" ? "vertical" : "horizontal";
      const all = api.getSceneElementsIncludingDeleted();
      const targets = all.filter((e) => idSet.has(e.id));
      if (targets.length === 0) {
        throw new Error("No matching elements to flip.");
      }
      const minX = Math.min(...targets.map((e) => e.x));
      const maxX = Math.max(...targets.map((e) => e.x + (e.width || 0)));
      const minY = Math.min(...targets.map((e) => e.y));
      const maxY = Math.max(...targets.map((e) => e.y + (e.height || 0)));
      const next = all.map((el) => {
        if (!idSet.has(el.id)) {
          return el;
        }
        if (axis === "horizontal") {
          return { ...el, x: minX + maxX - (el.x + (el.width || 0)) };
        }
        return { ...el, y: minY + maxY - (el.y + (el.height || 0)) };
      });
      api.updateScene({ elements: next });
      return { flipped: targets.length, axis };
    }

    case "setLink": {
      const idSet = new Set<string>(params.ids || []);
      const link = params.link ? String(params.link) : null;
      const elements = api
        .getSceneElementsIncludingDeleted()
        .map((el) => (idSet.has(el.id) ? { ...el, link } : el));
      api.updateScene({ elements });
      return { link, count: (params.ids || []).length };
    }

    case "setArrowheads": {
      const idSet = new Set<string>(params.ids || []);
      const patch: AnyParams = {};
      if (params.start !== undefined) {
        patch.startArrowhead = params.start;
      }
      if (params.end !== undefined) {
        patch.endArrowhead = params.end;
      }
      const elements = api.getSceneElementsIncludingDeleted().map((el) => {
        if (!idSet.has(el.id) || (el.type !== "arrow" && el.type !== "line")) {
          return el;
        }
        return { ...el, ...patch };
      });
      api.updateScene({ elements });
      return { updated: (params.ids || []).length };
    }

    case "scrollToContent": {
      const ids: string[] | undefined = params.ids;
      const elements = api.getSceneElements();
      const targets =
        ids && ids.length > 0
          ? elements.filter((e) => ids.includes(e.id))
          : elements;
      api.scrollToContent(targets, { fitToContent: true });
      return { scrolled: true };
    }

    case "panCanvas": {
      const s = api.getAppState();
      let scrollX = s.scrollX;
      let scrollY = s.scrollY;
      let zoomValue = Number(s.zoom?.value ?? 1);
      if (params.scrollX !== undefined) {
        scrollX = Number(params.scrollX);
      }
      if (params.scrollY !== undefined) {
        scrollY = Number(params.scrollY);
      }
      if (params.dx !== undefined) {
        scrollX += Number(params.dx);
      }
      if (params.dy !== undefined) {
        scrollY += Number(params.dy);
      }
      if (params.zoom !== undefined) {
        zoomValue = Number(params.zoom);
      }
      if (params.zoomDelta !== undefined) {
        zoomValue += Number(params.zoomDelta);
      }
      zoomValue = Math.min(30, Math.max(0.1, zoomValue));
      api.updateScene({
        appState: { scrollX, scrollY, zoom: { value: zoomValue } } as any,
      });
      return { scrollX, scrollY, zoom: zoomValue };
    }

    case "styleElements": {
      const idSet = new Set<string>(params.ids || []);
      const style: AnyParams = params.style || {};
      const elements = api
        .getSceneElementsIncludingDeleted()
        .map((el) => (idSet.has(el.id) ? { ...el, ...style } : el));
      api.updateScene({ elements });
      return { styled: (params.ids || []).length };
    }

    case "groupElements": {
      const ids: string[] = params.ids || [];
      if (ids.length < 2) {
        throw new Error("Provide at least two element ids to group.");
      }
      const idSet = new Set(ids);
      const groupId = randomId();
      const elements = api
        .getSceneElementsIncludingDeleted()
        .map((el) =>
          idSet.has(el.id)
            ? { ...el, groupIds: [...(el.groupIds || []), groupId] }
            : el
        );
      api.updateScene({ elements });
      return { groupId };
    }

    case "ungroupElements": {
      const idSet = new Set<string>(params.ids || []);
      const elements = api
        .getSceneElementsIncludingDeleted()
        .map((el) => (idSet.has(el.id) ? { ...el, groupIds: [] } : el));
      api.updateScene({ elements });
      return { ungrouped: (params.ids || []).length };
    }

    case "frameElements": {
      const ids: string[] = params.ids || [];
      const all = api.getSceneElements();
      const targets = all.filter((e) => ids.includes(e.id));
      if (targets.length === 0) {
        throw new Error("No matching elements to frame.");
      }
      const pad = 24;
      const minX = Math.min(...targets.map((e) => e.x)) - pad;
      const minY = Math.min(...targets.map((e) => e.y)) - pad;
      const maxX = Math.max(...targets.map((e) => e.x + (e.width || 0))) + pad;
      const maxY = Math.max(...targets.map((e) => e.y + (e.height || 0))) + pad;
      const partial: any = {
        type: "frame",
        id: randomId(),
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
        name: params.name || "Frame",
      };
      const frame = restoreElements([partial], null)[0];
      if (!frame) {
        throw new Error("Failed to create frame element.");
      }
      const idSet = new Set(ids);
      const updated = api
        .getSceneElementsIncludingDeleted()
        .map((el) => (idSet.has(el.id) ? { ...el, frameId: frame.id } : el));
      api.updateScene({ elements: [frame, ...updated] });
      return { frameId: frame.id };
    }

    case "alignElements": {
      const ids: string[] = params.ids || [];
      const mode: string = params.align;
      const idSet = new Set(ids);
      const all = api.getSceneElementsIncludingDeleted();
      const targets = all.filter((e) => idSet.has(e.id));
      if (targets.length < 2) {
        throw new Error("Provide at least two element ids to align.");
      }
      const minX = Math.min(...targets.map((e) => e.x));
      const maxR = Math.max(...targets.map((e) => e.x + (e.width || 0)));
      const minY = Math.min(...targets.map((e) => e.y));
      const maxB = Math.max(...targets.map((e) => e.y + (e.height || 0)));
      const cX = (minX + maxR) / 2;
      const cY = (minY + maxB) / 2;

      // Distribute: equal gaps between elements along the axis.
      if (mode === "distributeX" || mode === "distributeY") {
        if (targets.length < 3) {
          throw new Error("Provide at least three element ids to distribute.");
        }
        const horizontal = mode === "distributeX";
        const sized = targets
          .map((e) => ({
            id: e.id,
            pos: horizontal ? e.x : e.y,
            size: (horizontal ? e.width : e.height) || 0,
          }))
          .sort((a, b) => a.pos - b.pos);
        const first = sized[0];
        const last = sized[sized.length - 1];
        const span = last.pos + last.size - first.pos;
        const totalSize = sized.reduce((s, e) => s + e.size, 0);
        const gap = (span - totalSize) / (sized.length - 1);
        const newPos = new Map<string, number>();
        let cursor = first.pos;
        for (const e of sized) {
          newPos.set(e.id, cursor);
          cursor += e.size + gap;
        }
        const elements = all.map((el) =>
          newPos.has(el.id)
            ? horizontal
              ? { ...el, x: newPos.get(el.id)! }
              : { ...el, y: newPos.get(el.id)! }
            : el
        );
        api.updateScene({ elements });
        return { distributed: targets.length, mode };
      }

      const place = (el: any): AnyParams => {
        const w = el.width || 0;
        const h = el.height || 0;
        switch (mode) {
          case "left":
            return { x: minX };
          case "right":
            return { x: maxR - w };
          case "centerX":
            return { x: cX - w / 2 };
          case "top":
            return { y: minY };
          case "bottom":
            return { y: maxB - h };
          case "centerY":
            return { y: cY - h / 2 };
          default:
            throw new Error(
              `Unknown align mode "${mode}". Use left, right, centerX, top, bottom, centerY, distributeX, or distributeY.`
            );
        }
      };
      const elements = all.map((el) =>
        idSet.has(el.id) ? { ...el, ...place(el) } : el
      );
      api.updateScene({ elements });
      return { aligned: ids.length, mode };
    }

    case "addImage": {
      const fileId = randomId();
      api.addFiles([
        {
          id: fileId,
          dataURL: params.dataURL,
          mimeType: params.mimeType || "image/png",
          created: Date.now(),
        } as any,
      ]);
      const skeleton: any = {
        type: "image",
        fileId,
        x: params.x ?? 100,
        y: params.y ?? 100,
        width: params.width ?? 200,
        height: params.height ?? 200,
      };
      const converted = convertToExcalidrawElements([skeleton], {
        regenerateIds: true,
      });
      api.updateScene({ elements: [...api.getSceneElements(), ...converted] });
      return {
        ids: converted.map((e) => e.id),
        fileId,
        elements: converted.map(describeCreated),
      };
    }

    case "placeLibraryElements": {
      const src: any[] = params.elements;
      if (!Array.isArray(src) || src.length === 0) {
        throw new Error("No library item elements to place.");
      }
      const minX = Math.min(...src.map((e) => e.x ?? 0));
      const minY = Math.min(...src.map((e) => e.y ?? 0));
      let dx = 0;
      let dy = 0;
      if (params.x !== undefined) {
        dx = Number(params.x) - minX;
      }
      if (params.y !== undefined) {
        dy = Number(params.y) - minY;
      }

      // Clone with fresh ids, remapping internal references so the placed copy
      // is self-contained (containers/labels, arrow bindings, and grouping).
      const idMap = new Map<string, string>();
      for (const el of src) {
        idMap.set(el.id, randomId());
      }
      const groupRemap = new Map<string, string>();
      const clones = src.map((el) => {
        const clone: any = {
          ...el,
          id: idMap.get(el.id),
          x: (el.x ?? 0) + dx,
          y: (el.y ?? 0) + dy,
          index: null,
        };
        if (el.containerId) {
          clone.containerId = idMap.get(el.containerId) ?? null;
        }
        if (Array.isArray(el.boundElements)) {
          clone.boundElements = el.boundElements
            .filter((b: any) => idMap.has(b.id))
            .map((b: any) => ({ ...b, id: idMap.get(b.id) }));
        }
        if (el.startBinding) {
          clone.startBinding = idMap.has(el.startBinding.elementId)
            ? {
                ...el.startBinding,
                elementId: idMap.get(el.startBinding.elementId),
              }
            : null;
        }
        if (el.endBinding) {
          clone.endBinding = idMap.has(el.endBinding.elementId)
            ? {
                ...el.endBinding,
                elementId: idMap.get(el.endBinding.elementId),
              }
            : null;
        }
        if (Array.isArray(el.groupIds)) {
          clone.groupIds = el.groupIds.map((g: string) => {
            if (!groupRemap.has(g)) {
              groupRemap.set(g, randomId());
            }
            return groupRemap.get(g);
          });
        }
        return clone;
      });
      api.updateScene({ elements: [...api.getSceneElements(), ...clones] });
      return { ids: clones.map((c) => c.id), placed: clones.length };
    }

    case "drawFromMermaid": {
      const { elements: skeleton, files } = await parseMermaidToExcalidraw(
        params.mermaid,
        params.config
      );
      const converted = convertToExcalidrawElements(skeleton);
      if (files) {
        api.addFiles(Object.values(files));
      }
      api.updateScene({ elements: [...api.getSceneElements(), ...converted] });
      return {
        added: converted.length,
        ids: converted.map((e) => e.id),
        elements: converted.map(describeCreated),
      };
    }

    case "setActiveTool": {
      const tool = params.tool || "selection";
      api.setActiveTool({ type: tool } as any);
      return { tool };
    }

    case "exportImage": {
      const elements = api.getSceneElements();
      const appState = api.getAppState();
      const files = api.getFiles();
      const format = String(params.format || "png").toLowerCase();
      if (format === "svg") {
        const svg = await exportToSvg({
          elements,
          appState: { ...appState, exportBackground: true } as any,
          files,
        });
        return { format: "svg", encoding: "utf8", data: svg.outerHTML };
      }
      const blob = await exportToBlob({
        elements,
        appState: appState as any,
        files,
        mimeType: "image/png",
      });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (const b of bytes) {
        binary += String.fromCharCode(b);
      }
      return { format: "png", encoding: "base64", data: btoa(binary) };
    }

    default:
      throw new Error(`Action "${action}" is not implemented yet.`);
  }
}
