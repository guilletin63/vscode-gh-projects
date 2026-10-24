// Typed postMessage protocol between the board webview and the extension host. Both bundles
// import this file, so a change here is checked on both sides by the compiler.
import type { FieldInput } from '../model/edits';
import type { BoardFilter } from '../model/filter';
import { normalizeFilter } from '../model/filter';
import type { ItemDetail, ProjectDetails, ProjectItem } from '../model/types';

export interface BoardState {
  project: ProjectDetails;
  items: ProjectItem[];
  /** View currently shown (its "Column by" field drives the columns). */
  viewId?: string;
  /** Explicit "Column by" override chosen in the toolbar. */
  groupFieldId?: string;
  /** Filter remembered for this project (workspaceState). */
  filter: BoardFilter;
  /** ISO time of the last successful load. */
  loadedAt: string;
  /** Items matching the current view's own filter, as GitHub filters them. */
  viewMatches?: { viewId: string; itemIds: string[] } | { viewId: string; error: string };
}

export interface DraftValue {
  fieldId: string;
  input: Exclude<FieldInput, null>;
}

/** Extension -> webview */
export type HostMessage =
  | { type: 'loading'; loaded: number; total: number }
  | { type: 'state'; state: BoardState }
  | { type: 'error'; message: string }
  | { type: 'rateLimit'; waitMs: number; reason: string }
  /** Outcome of a `setField` / `setPosition` request; on failure the webview rolls the edit back. */
  | { type: 'editResult'; requestId: string; ok: boolean; message?: string }
  /** Outcome of an `addDraft` request (the new item arrives with the next `state`). */
  | { type: 'addResult'; requestId: string; ok: boolean; message?: string }
  | { type: 'detail'; itemId: string; detail: ItemDetail }
  | { type: 'detailError'; itemId: string; message: string }
  /** Host capabilities that change what the webview offers. */
  | { type: 'env'; prExtension: boolean };

/** Webview -> extension */
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'selectView'; viewId: string }
  | { type: 'selectGroupField'; fieldId: string }
  | { type: 'openExternal'; url: string }
  | { type: 'setFilter'; filter: BoardFilter }
  /** Optimistic edit already applied in the webview (moving a card = setting the column field). */
  | { type: 'setField'; requestId: string; itemId: string; fieldId: string; input: FieldInput }
  /** Optimistic move in the project order: right after `afterId`, or to the top. */
  | { type: 'setPosition'; requestId: string; itemId: string; afterId?: string }
  /** New draft issue with the values of the column, group or swimlane it was added to. */
  | { type: 'addDraft'; requestId: string; title: string; values: DraftValue[] }
  | { type: 'openDetail'; itemId: string }
  | { type: 'copyLink'; url: string }
  /** Open the issue/PR in the GitHub Pull Requests extension. */
  | { type: 'openInPrExtension'; itemId: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isString = (v: unknown): v is string => typeof v === 'string';

/** Validates messages coming from the webview before the extension acts on them. */
export function parseWebviewMessage(raw: unknown): WebviewMessage | undefined {
  if (!isObject(raw) || !isString(raw.type)) return undefined;
  switch (raw.type) {
    case 'ready':
    case 'refresh':
      return { type: raw.type };
    case 'selectView':
      return isString(raw.viewId) ? { type: 'selectView', viewId: raw.viewId } : undefined;
    case 'selectGroupField':
      return isString(raw.fieldId) ? { type: 'selectGroupField', fieldId: raw.fieldId } : undefined;
    case 'openExternal':
      // Links from issue bodies can point anywhere on the web; VS Code's link protection still
      // asks before opening untrusted domains. Only http(s) is accepted.
      return isString(raw.url) && /^https?:\/\//i.test(raw.url) ? { type: 'openExternal', url: raw.url } : undefined;
    case 'copyLink':
      return isString(raw.url) && /^https:\/\/github\.com\//.test(raw.url) ? { type: 'copyLink', url: raw.url } : undefined;
    case 'openDetail':
    case 'openInPrExtension':
      return isString(raw.itemId) ? { type: raw.type, itemId: raw.itemId } : undefined;
    case 'setFilter':
      return { type: 'setFilter', filter: normalizeFilter(raw.filter) };
    case 'setField': {
      const input = parseFieldInput(raw.input);
      if (!isString(raw.requestId) || !isString(raw.itemId) || !isString(raw.fieldId) || input === undefined) return undefined;
      return { type: 'setField', requestId: raw.requestId, itemId: raw.itemId, fieldId: raw.fieldId, input };
    }
    case 'setPosition':
      if (!isString(raw.requestId) || !isString(raw.itemId) || (raw.afterId !== undefined && !isString(raw.afterId))) return undefined;
      return { type: 'setPosition', requestId: raw.requestId, itemId: raw.itemId, ...(isString(raw.afterId) ? { afterId: raw.afterId } : {}) };
    case 'addDraft': {
      const title = isString(raw.title) ? raw.title.trim().slice(0, 256) : '';
      if (!isString(raw.requestId) || !title) return undefined;
      const rawValues = raw.values === undefined ? [] : raw.values;
      if (!Array.isArray(rawValues) || rawValues.length > 5) return undefined;
      const values: DraftValue[] = [];
      for (const v of rawValues as unknown[]) {
        const input = isObject(v) ? parseFieldInput(v.input) : undefined;
        if (!isObject(v) || !isString(v.fieldId) || !input) return undefined;
        values.push({ fieldId: v.fieldId, input });
      }
      return { type: 'addDraft', requestId: raw.requestId, title, values };
    }
    default:
      return undefined;
  }
}

function parseFieldInput(raw: unknown): FieldInput | undefined {
  if (raw === null) return null;
  if (!isObject(raw)) return undefined;
  switch (raw.kind) {
    case 'singleSelect':
      return isString(raw.optionId) ? { kind: 'singleSelect', optionId: raw.optionId } : undefined;
    case 'iteration':
      return isString(raw.iterationId) ? { kind: 'iteration', iterationId: raw.iterationId } : undefined;
    case 'text':
      return isString(raw.text) ? { kind: 'text', text: raw.text.slice(0, 1024) } : undefined;
    case 'number':
      return typeof raw.number === 'number' && Number.isFinite(raw.number) ? { kind: 'number', number: raw.number } : undefined;
    case 'date':
      return isString(raw.date) ? { kind: 'date', date: raw.date } : undefined;
    default:
      return undefined;
  }
}
