// Talks to a (self-hosted) AFFiNE server: GraphQL for the account and workspaces, and the same
// Socket.IO sync connection the AFFiNE app uses to read and write pages. AFFiNE stores every page
// as a Yjs document of blocks (page → note → paragraphs, lists, tables); changes are sent as Yjs updates.
//
// AFFiNE 0.27 has no access tokens that can write (its MCP credentials are read-only), so the
// dashboard signs in with an email and password, like the app does, and reuses that session.
import 'server-only';
import crypto from 'crypto';
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';
import { io, type Socket } from 'socket.io-client';
import * as Y from 'yjs';
import type { AffineBlock, ReportBlock } from './types';

const TIMEOUT_MS = 15_000;
export const BAMBU_TAG = 'Bambu';

export type AffineAuth = { url: string; email: string; password: string };

/** Content the dashboard writes (plain text), plus list items that link to another page. */
export type WriteBlock = ReportBlock | { t: 'link'; pageId: string };
/** Content read back from a page. */
export type ReadBlock = AffineBlock;

export class AffineError extends Error {}

// ---------------------------------------------------------------- HTTP
function unreachable(e: unknown): never {
  const err = e as { name?: string; cause?: { code?: string }; message?: string };
  if (err?.name === 'TimeoutError') throw new AffineError('AFFiNE did not answer within 15 seconds');
  throw new AffineError(`Can't reach AFFiNE (${err?.cause?.code ?? err?.message ?? 'network error'})`);
}

export async function serverInfo(url: string): Promise<{ version: string }> {
  const res = await fetch(`${url}/info`, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' }).catch(unreachable);
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.compatibility) throw new AffineError(`${url} doesn't look like an AFFiNE server`);
  return { version: String(j.compatibility) };
}

// Session cookies per server + account, reused until AFFiNE stops accepting them.
const g = globalThis as unknown as { __affineSessions?: Map<string, string> };
const sessions = (g.__affineSessions ??= new Map());
const sessionKey = (a: Pick<AffineAuth, 'url' | 'email'>) => `${a.url} ${a.email.toLowerCase()}`;

async function signIn(auth: AffineAuth): Promise<string> {
  const res = await fetch(`${auth.url}/api/auth/sign-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: auth.email, password: auth.password }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  }).catch(unreachable);
  if (!res.ok) {
    if (res.status === 429) throw new AffineError('AFFiNE is blocking sign-ins for a moment (too many attempts)');
    if (res.status >= 400 && res.status < 500) throw new AffineError('AFFiNE refused the email or password');
    throw new AffineError(`AFFiNE sign-in failed (HTTP ${res.status})`);
  }
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => c.includes('=')).join('; ');
  if (!cookie.includes('affine_session=')) throw new AffineError('AFFiNE did not start a session');
  sessions.set(sessionKey(auth), cookie);
  return cookie;
}

class AuthExpired extends Error {}

/** Runs `fn` with a session cookie; signs in again once when the saved session was rejected. */
async function authed<T>(auth: AffineAuth, fn: (cookie: string) => Promise<T>): Promise<T> {
  const saved = sessions.get(sessionKey(auth));
  try {
    return await fn(saved ?? await signIn(auth));
  } catch (e) {
    if (!(e instanceof AuthExpired)) throw e;
    sessions.delete(sessionKey(auth));
    if (!saved) throw new AffineError('AFFiNE did not accept the new session');
    return fn(await signIn(auth)).catch((e2) => {
      throw e2 instanceof AuthExpired ? new AffineError('AFFiNE did not accept the session') : e2;
    });
  }
}

/** Forgets the saved session, e.g. when the account in Settings changed. */
export const forgetSession = (auth: Pick<AffineAuth, 'url' | 'email'>) => sessions.delete(sessionKey(auth));

export function gql<T>(auth: AffineAuth, query: string, variables?: Record<string, unknown>): Promise<T> {
  return authed(auth, async (cookie) => {
    const res = await fetch(`${auth.url}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    }).catch(unreachable);
    if (res.status === 401 || res.status === 403) throw new AuthExpired();
    const j = await res.json().catch(() => null);
    if (!j) throw new AffineError(`AFFiNE answered HTTP ${res.status}`);
    if (j.errors?.length) {
      const e = j.errors[0];
      if (/AUTHENTICATION_REQUIRED|UNAUTHENTICATED/i.test(e.extensions?.name ?? '')) throw new AuthExpired();
      throw new AffineError(`AFFiNE: ${e.message}`);
    }
    return j.data as T;
  });
}

export async function currentUser(auth: AffineAuth) {
  const d = await gql<{ currentUser: { id: string; name: string; email: string } | null }>(auth, '{ currentUser { id name email } }');
  if (!d.currentUser) throw new AffineError('AFFiNE did not accept the session');
  return d.currentUser;
}

// ---------------------------------------------------------------- sync connection
type Ack = { error?: { name?: string; message?: string }; data?: any };

export class Session {
  private socket: Socket;
  readonly workspaceId: string;
  constructor(socket: Socket, workspaceId: string) {
    this.socket = socket;
    this.workspaceId = workspaceId;
  }

  private emit(event: string, payload: Record<string, unknown>): Promise<Ack> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new AffineError(`AFFiNE did not answer (${event})`)), TIMEOUT_MS);
      this.socket.emit(event, { spaceType: 'workspace', spaceId: this.workspaceId, ...payload }, (ack: Ack) => {
        clearTimeout(timer);
        resolve(ack ?? {});
      });
    });
  }

  async join(clientVersion: string) {
    const ack = await this.emit('space:join', { clientVersion });
    if (ack.error) {
      const m = ack.error.message || ack.error.name || 'unknown error';
      if (/AUTHENTICATION_REQUIRED|UNAUTHENTICATED/i.test(ack.error.name ?? '')) throw new AuthExpired();
      throw new AffineError(/permission|access|not found|denied/i.test(m) ? 'This AFFiNE account has no access to that workspace' : `AFFiNE: ${m}`);
    }
  }

  /** The document, or null when it doesn't exist. */
  async load(docId: string): Promise<Y.Doc | null> {
    const ack = await this.emit('space:load-doc', { docId });
    if (ack.error) {
      if (ack.error.name === 'DOC_NOT_FOUND') return null;
      throw new AffineError(`AFFiNE: ${ack.error.message || ack.error.name}`);
    }
    const doc = new Y.Doc();
    if (ack.data?.missing) Y.applyUpdate(doc, Buffer.from(ack.data.missing, 'base64'));
    return doc;
  }

  async push(docId: string, update: Uint8Array) {
    const ack = await this.emit('space:push-doc-update', { docId, update: Buffer.from(update).toString('base64') });
    if (ack.error) throw new AffineError(`AFFiNE: ${ack.error.message || ack.error.name}`);
  }

  /**
   * Loads a document, lets `fn` change it and sends only those changes. Missing documents start empty.
   * Changes are captured as they happen (not diffed by state vector, which would resend old deletions).
   */
  async change<T>(docId: string, fn: (doc: Y.Doc) => T): Promise<T> {
    const doc = (await this.load(docId)) ?? new Y.Doc();
    const updates: Uint8Array[] = [];
    doc.on('update', (u: Uint8Array, _o: unknown, _d: Y.Doc, tr: Y.Transaction) => { if (tr.local) updates.push(u); });
    try {
      const result = doc.transact(() => fn(doc));
      if (updates.length) await this.push(docId, updates.length === 1 ? updates[0] : Y.mergeUpdates(updates));
      return result;
    } finally {
      doc.destroy();
    }
  }
}

// One connection at a time: background syncs and button presses never write concurrently.
let queue: Promise<unknown> = Promise.resolve();

/** Opens a sync connection to one workspace, runs `fn` and closes it again. */
export function withWorkspace<T>(auth: AffineAuth, workspaceId: string, fn: (s: Session) => Promise<T>): Promise<T> {
  const run = async () => {
    const { version } = await serverInfo(auth.url);
    // Sign-in problems surface while connecting or joining, before anything is written.
    const { socket, s } = await authed(auth, async (cookie) => {
      const socket = await connect(auth.url, cookie);
      const s = new Session(socket, workspaceId);
      try { await s.join(version); } catch (e) { socket.disconnect(); throw e; }
      return { socket, s };
    });
    try {
      return await fn(s);
    } finally {
      socket.disconnect();
    }
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

function connect(url: string, cookie: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(new URL(url).origin, {
      path: '/socket.io/',
      transports: ['websocket'],
      extraHeaders: { Cookie: cookie },
      reconnection: false,
      timeout: TIMEOUT_MS,
    });
    const timer = setTimeout(() => fail(new AffineError('AFFiNE sync connection timed out')), TIMEOUT_MS);
    const fail = (e: Error) => {
      clearTimeout(timer);
      socket.disconnect();
      if (/auth|unauthori[sz]ed|forbidden/i.test(e.message)) return reject(new AuthExpired());
      reject(e instanceof AffineError ? e : new AffineError(`Can't open the AFFiNE sync connection (${e.message})`));
    };
    socket.once('connect', () => { clearTimeout(timer); resolve(socket); });
    socket.once('connect_error', fail);
  });
}

// ---------------------------------------------------------------- workspace metadata
const pagesOf = (root: Y.Doc) => root.getMap('meta').get('pages') as Y.Array<Y.Map<any>> | undefined;

export const workspaceName = (root: Y.Doc) => String(root.getMap('meta').get('name') ?? '') || 'Untitled workspace';

/** The page's entry in the workspace list, or null when missing or in the trash. */
export function pageEntry(root: Y.Doc, docId: string): Y.Map<any> | null {
  for (const p of pagesOf(root)?.toArray() ?? []) {
    if (p instanceof Y.Map && p.get('id') === docId) return p.get('trash') ? null : p;
  }
  return null;
}

function ensureMap(parent: Y.Map<any>, key: string): Y.Map<any> {
  const v = parent.get(key);
  if (v instanceof Y.Map) return v;
  const m = new Y.Map<any>();
  parent.set(key, m);
  return m;
}

/** The id of the workspace tag with this name, created when missing. */
function ensureTag(root: Y.Doc, name: string): string {
  const tags = ensureMap(ensureMap(root.getMap('meta'), 'properties'), 'tags');
  let options = tags.get('options') as Y.Array<any> | undefined;
  if (!(options instanceof Y.Array)) { options = new Y.Array(); tags.set('options', options); }
  for (const o of options.toArray()) {
    const value = o instanceof Y.Map ? o.get('value') : o?.value;
    if (String(value).toLowerCase() === name.toLowerCase()) return o instanceof Y.Map ? o.get('id') : o.id;
  }
  const now = Date.now();
  const tag = new Y.Map<any>();
  tag.set('id', newId());
  tag.set('value', name);
  tag.set('color', 'var(--affine-tag-green)');
  tag.set('createDate', now);
  tag.set('updateDate', now);
  options.push([tag]);
  return tag.get('id');
}

/** Adds a new page to the workspace list, tagged "Bambu". */
function registerPage(root: Y.Doc, docId: string, title: string) {
  const meta = root.getMap('meta');
  let pages = pagesOf(root);
  if (!(pages instanceof Y.Array)) { pages = new Y.Array(); meta.set('pages', pages); }
  const tagId = ensureTag(root, BAMBU_TAG);
  const now = Date.now();
  const entry = new Y.Map<any>();
  entry.set('id', docId);
  entry.set('title', title);
  entry.set('createDate', now);
  entry.set('updatedDate', now);
  const tags = new Y.Array<string>();
  tags.push([tagId]);
  entry.set('tags', tags);
  pages.push([entry]);
}

/** Bumps the page's "last edited" date so it sorts to the top in AFFiNE. */
export async function touchPage(s: Session, docId: string, title?: string) {
  await s.change(s.workspaceId, (root) => {
    const e = pageEntry(root, docId);
    if (!e) return;
    e.set('updatedDate', Date.now());
    if (title && e.get('title') !== title) e.set('title', title);
  });
}

// ---------------------------------------------------------------- blocks
const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
export const newId = () => Array.from(crypto.randomBytes(10), (b) => ID_CHARS[b & 63]).join('');

const VERSION: Record<string, number> = { 'affine:page': 2, 'affine:surface': 5 };

function block(blocks: Y.Map<any>, flavour: string, props: Record<string, unknown> = {}, id = newId()): string {
  const b = new Y.Map<any>();
  b.set('sys:id', id);
  b.set('sys:flavour', flavour);
  b.set('sys:version', VERSION[flavour] ?? 1);
  b.set('sys:children', new Y.Array<string>());
  for (const [k, v] of Object.entries(props)) b.set(k, v);
  blocks.set(id, b);
  return id;
}

const text = (s: string, attrs?: Record<string, unknown>) => {
  const t = new Y.Text();
  if (s) t.insert(0, s, attrs);
  return t;
};

/** Creates blocks (not yet attached to a parent) and returns their ids in order. */
export function createBlocks(blocks: Y.Map<any>, content: WriteBlock[]): string[] {
  return content.map((c) => {
    switch (c.t) {
      case 'h1': case 'h2': case 'h3': case 'quote':
        return block(blocks, 'affine:paragraph', { 'prop:type': c.t, 'prop:text': text(c.text) });
      case 'p':
        return block(blocks, 'affine:paragraph', { 'prop:type': 'text', 'prop:text': text(c.text) });
      case 'li':
        return block(blocks, 'affine:list', { 'prop:type': 'bulleted', 'prop:checked': false, 'prop:collapsed': false, 'prop:text': text(c.text) });
      case 'link':
        // An inline page reference is one space with a reference attribute; AFFiNE shows the page's title.
        // Linked pages also appear nested under this page in the sidebar.
        return block(blocks, 'affine:list', {
          'prop:type': 'bulleted', 'prop:checked': false, 'prop:collapsed': false,
          'prop:text': text(' ', { reference: { type: 'LinkedPage', pageId: c.pageId } }),
        });
      case 'hr':
        return block(blocks, 'affine:divider');
      case 'table': {
        const id = block(blocks, 'affine:table');
        const b = blocks.get(id) as Y.Map<any>;
        const width = Math.max(1, ...c.rows.map((r) => r.length));
        const cols = generateNKeysBetween(null, null, width).map((order) => {
          const colId = newId();
          b.set(`prop:columns.${colId}.columnId`, colId);
          b.set(`prop:columns.${colId}.order`, order);
          return colId;
        });
        const orders = generateNKeysBetween(null, null, c.rows.length);
        c.rows.forEach((row, i) => setRow(b, orders[i], cols, row, i === 0));
        return id;
      }
    }
  });
}

function setRow(table: Y.Map<any>, order: string, cols: string[], cells: string[], header = false) {
  const rowId = newId();
  table.set(`prop:rows.${rowId}.rowId`, rowId);
  table.set(`prop:rows.${rowId}.order`, order);
  cols.forEach((colId, i) => table.set(`prop:cells.${rowId}:${colId}.text`, text(cells[i] ?? '', header ? { bold: true } : undefined)));
  return rowId;
}

const sortedIds = (table: Y.Map<any>, kind: 'rows' | 'columns') => {
  const re = new RegExp(`^prop:${kind}\\.(.+)\\.order$`);
  const list: { id: string; order: string }[] = [];
  for (const [k, v] of table.entries()) {
    const m = re.exec(k);
    if (m) list.push({ id: m[1], order: String(v) });
  }
  return list.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
};

export const hasRow = (table: Y.Map<any>, rowId: string) => table.has(`prop:rows.${rowId}.rowId`);

/** Inserts rows directly below the header row (newest first). Returns the new row ids. */
export function insertRowsAtTop(table: Y.Map<any>, rows: string[][]): string[] {
  const existing = sortedIds(table, 'rows');
  const cols = sortedIds(table, 'columns').map((c) => c.id);
  const after = existing[0]?.order ?? null;
  const before = existing[1]?.order ?? null;
  const orders = generateNKeysBetween(after, before, rows.length);
  return rows.map((r, i) => setRow(table, orders[i], cols, r));
}

export function removeRow(table: Y.Map<any>, rowId: string) {
  for (const k of [...table.keys()]) {
    if (k === `prop:rows.${rowId}.rowId` || k === `prop:rows.${rowId}.order` || k.startsWith(`prop:cells.${rowId}:`)) table.delete(k);
  }
}

export const blocksOf = (doc: Y.Doc) => doc.getMap('blocks') as Y.Map<Y.Map<any>>;
const childrenOf = (b: Y.Map<any>) => b.get('sys:children') as Y.Array<string>;

function findByFlavour(blocks: Y.Map<Y.Map<any>>, flavour: string): Y.Map<any> | null {
  for (const b of blocks.values()) if (b.get('sys:flavour') === flavour) return b;
  return null;
}

/** The note (page body) that holds `blockId`, or the first note. */
export function bodyNote(doc: Y.Doc, near?: string): Y.Map<any> | null {
  const blocks = blocksOf(doc);
  if (near) {
    for (const b of blocks.values()) {
      if (b.get('sys:flavour') === 'affine:note' && childrenOf(b)?.toArray().includes(near)) return b;
    }
  }
  const page = findByFlavour(blocks, 'affine:page');
  for (const id of page ? childrenOf(page).toArray() : []) {
    const b = blocks.get(id);
    if (b?.get('sys:flavour') === 'affine:note') return b;
  }
  return findByFlavour(blocks, 'affine:note');
}

/** Removes a block and everything inside it. */
export function deleteBlock(doc: Y.Doc, id: string) {
  const blocks = blocksOf(doc);
  const b = blocks.get(id);
  if (!b) return;
  for (const child of childrenOf(b)?.toArray() ?? []) deleteBlock(doc, child);
  for (const parent of blocks.values()) {
    const kids = childrenOf(parent);
    const i = kids?.toArray().indexOf(id) ?? -1;
    if (i >= 0) kids.delete(i, 1);
  }
  blocks.delete(id);
}

export const pageTitle = (doc: Y.Doc) => {
  const page = findByFlavour(blocksOf(doc), 'affine:page');
  return page ? String(page.get('prop:title') ?? '') : '';
};

export function setPageTitle(doc: Y.Doc, title: string) {
  const page = findByFlavour(blocksOf(doc), 'affine:page');
  const t = page?.get('prop:title');
  if (t instanceof Y.Text && t.toString() !== title) { t.delete(0, t.length); t.insert(0, title); }
}

/** Creates a new page with a title and content; tagged "Bambu" in the workspace list. Returns its id. */
export async function createPage(s: Session, title: string, content: WriteBlock[], init?: (doc: Y.Doc, contentIds: string[]) => void): Promise<string> {
  const docId = newId();
  await s.change(docId, (doc) => {
    const blocks = blocksOf(doc);
    const pageId = block(blocks, 'affine:page', { 'prop:title': text(title) });
    const surfaceId = block(blocks, 'affine:surface', { 'sys:parent': null });
    const elements = new Y.Map<any>();
    elements.set('type', '$blocksuite:internal:native$');
    elements.set('value', new Y.Map<any>());
    blocks.get(surfaceId)!.set('prop:elements', elements);
    const background = new Y.Map<any>();
    background.set('light', '#ffffff');
    background.set('dark', '#252525');
    const noteId = block(blocks, 'affine:note', {
      'sys:parent': null, 'prop:xywh': '[0,0,800,95]', 'prop:index': 'a0', 'prop:hidden': false,
      'prop:displayMode': 'both', 'prop:background': background,
    });
    childrenOf(blocks.get(pageId)!).push([surfaceId, noteId]);
    const ids = createBlocks(blocks, content);
    childrenOf(blocks.get(noteId)!).push(ids);
    init?.(doc, ids);
  });
  await s.change(s.workspaceId, (root) => registerPage(root, docId, title));
  return docId;
}

export const pageUrl = (auth: Pick<AffineAuth, 'url'>, workspaceId: string, docId: string) =>
  `${auth.url}/workspace/${workspaceId}/${docId}`;

// ---------------------------------------------------------------- reading
const LIST_KINDS = new Set(['bulleted', 'numbered', 'todo', 'toggle']);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'quote']);

function tableRows(b: Y.Map<any>): string[][] {
  const cols = sortedIds(b, 'columns');
  return sortedIds(b, 'rows').map((r) => cols.map((c) => String(b.get(`prop:cells.${r.id}:${c.id}.text`) ?? '')));
}

/** The page body as simple blocks, leaving out the blocks in `skip` (the ones the dashboard writes). */
export function readPage(doc: Y.Doc, skip: Set<string> = new Set(), limit = 400): ReadBlock[] {
  const blocks = blocksOf(doc);
  const out: ReadBlock[] = [];
  const walk = (id: string, depth: number) => {
    if (out.length >= limit || skip.has(id)) return;
    const b = blocks.get(id);
    if (!b) return;
    const flavour = String(b.get('sys:flavour'));
    const t = String(b.get('prop:text') ?? '');
    let descend = true;
    switch (flavour) {
      case 'affine:page':
      case 'affine:note':
        if (flavour === 'affine:note' && b.get('prop:displayMode') === 'edgeless') return; // only on the whiteboard
        break;
      case 'affine:surface':
        return;
      case 'affine:paragraph': {
        const type = String(b.get('prop:type') ?? 'text');
        out.push(HEADINGS.has(type) ? { t: type as 'h1', text: t } : { t: 'p', text: t });
        break;
      }
      case 'affine:list': {
        const kind = String(b.get('prop:type') ?? 'bulleted');
        out.push({ t: 'li', text: t, kind: LIST_KINDS.has(kind) ? kind as 'todo' : 'bulleted', checked: kind === 'todo' ? !!b.get('prop:checked') : undefined, depth });
        childrenOf(b)?.forEach((c) => walk(c, depth + 1));
        descend = false;
        break;
      }
      case 'affine:code':
        out.push({ t: 'code', text: t });
        break;
      case 'affine:divider':
        out.push({ t: 'hr' });
        break;
      case 'affine:table':
        out.push({ t: 'table', rows: tableRows(b) });
        break;
      case 'affine:callout':
        break; // its text sits in child paragraphs
      default:
        out.push({ t: 'other', what: flavour.replace(/^affine:/, '').replace(/^embed-/, '') });
    }
    if (descend) childrenOf(b)?.forEach((c) => walk(c, depth));
  };
  const page = findByFlavour(blocks, 'affine:page');
  if (page) walk(String(page.get('sys:id')), 0);
  return out;
}

// ---------------------------------------------------------------- organize (sidebar folders)
// The sidebar's folders live in a separate document: one top-level map per node
// ({ id, type: 'folder' | 'doc', data: folder name or page id, parentId, index }).
const foldersDoc = (workspaceId: string) => `db$${workspaceId}$folders`;
const NODE_ID_CHARS = '123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';
const POSTFIX_CHARS = '123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const randomString = (n: number, chars: string) => Array.from({ length: n }, () => chars[crypto.randomInt(chars.length)]).join('');

type OrgNode = { id: string; type: string; data: string; parentId: string | null; index: string };

function orgNodes(doc: Y.Doc): OrgNode[] {
  const out: OrgNode[] = [];
  for (const key of doc.share.keys()) {
    const m = doc.getMap(key);
    if (m.size === 0 || m.get('$$DELETED') === true) continue;
    const n = m.toJSON();
    if (typeof n.id === 'string' && typeof n.type === 'string' && typeof n.index === 'string') {
      out.push({ id: n.id, type: n.type, data: String(n.data ?? ''), parentId: n.parentId ?? null, index: n.index });
    }
  }
  return out;
}

/**
 * Sort keys as AFFiNE makes them: a fractional index plus a random postfix, so two clients adding
 * at the same spot don't collide. `first` puts the node above its siblings instead of below.
 */
function orgIndex(nodes: OrgNode[], parentId: string | null, first = false) {
  const siblings = nodes.filter((n) => n.parentId === parentId).map((n) => n.index).sort();
  const sub = (k: string | undefined) => (k == null ? null : k.length > 33 ? k.slice(0, -33) : k);
  const key = first ? generateKeyBetween(null, sub(siblings[0])) : generateKeyBetween(sub(siblings[siblings.length - 1]), null);
  return `${key}0${randomString(32, POSTFIX_CHARS)}`;
}

function addNode(doc: Y.Doc, nodes: OrgNode[], node: Omit<OrgNode, 'id' | 'index'>, first = false) {
  const id = randomString(21, NODE_ID_CHARS);
  const index = orgIndex(nodes, node.parentId, first);
  const m = doc.getMap(id);
  m.set('id', id);
  m.set('type', node.type);
  m.set('data', node.data);
  m.set('parentId', node.parentId);
  m.set('index', index);
  nodes.push({ id, index, ...node });
  return id;
}

export type FolderSpec = { key: string; name: string; parent: string | null };

/**
 * Makes sure the folders exist and returns key → folder id. Folders that still exist are kept as they
 * are, even when renamed or moved; only missing ones are created again.
 */
export async function ensureFolders(s: Session, specs: FolderSpec[], known: Record<string, string>): Promise<Record<string, string>> {
  const ids = { ...known };
  await s.change(foldersDoc(s.workspaceId), (doc) => {
    const nodes = orgNodes(doc);
    const exists = (id?: string) => !!id && nodes.some((n) => n.id === id && n.type === 'folder');
    for (const f of specs) {
      if (exists(ids[f.key])) continue;
      const parentId = f.parent ? ids[f.parent] ?? null : null;
      // A folder with this name in the same place (e.g. after reinstalling the dashboard) is reused.
      const same = nodes.find((n) => n.type === 'folder' && n.data === f.name && n.parentId === parentId);
      ids[f.key] = same?.id ?? addNode(doc, nodes, { type: 'folder', data: f.name, parentId });
    }
  });
  return ids;
}

/** Puts a page in a folder (once; nothing happens when it's already there). */
export async function fileInFolder(s: Session, folderId: string, docId: string, first = false) {
  await s.change(foldersDoc(s.workspaceId), (doc) => {
    const nodes = orgNodes(doc);
    if (nodes.some((n) => n.type === 'doc' && n.data === docId && n.parentId === folderId)) return;
    addNode(doc, nodes, { type: 'doc', data: docId, parentId: folderId }, first);
  });
}

// ---------------------------------------------------------------- workspaces
export async function listWorkspaces(auth: AffineAuth): Promise<{ id: string; name: string }[]> {
  const d = await gql<{ workspaces: { id: string }[] }>(auth, '{ workspaces { id } }');
  const out: { id: string; name: string }[] = [];
  for (const w of d.workspaces ?? []) {
    let name = 'Untitled workspace';
    try {
      name = await withWorkspace(auth, w.id, async (s) => {
        const root = await s.load(w.id);
        return root ? workspaceName(root) : name;
      });
    } catch { /* keep the fallback name */ }
    out.push({ id: w.id, name });
  }
  return out;
}

export { Y };
