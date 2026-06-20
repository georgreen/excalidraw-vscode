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
              `Unknown align mode "${mode}". Use left, right, centerX, top, bottom, or centerY.`
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
