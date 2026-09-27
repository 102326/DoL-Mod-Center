import { compatibilityNotes as extractCompatibilityNotes, parseRepository, RepoSource } from "./market";

export const WIKI_URL = "https://degreesoflewditycn.miraheze.org/wiki/%E6%A8%A1%E7%BB%84%E5%88%97%E8%A1%A8";
export const WIKI_API = "https://degreesoflewditycn.miraheze.org/w/api.php?action=parse&page=%E6%A8%A1%E7%BB%84%E5%88%97%E8%A1%A8&prop=text%7Crevid&format=json&origin=*";
const CACHE_KEY = "dmc.market.wiki.v1";
const METADATA_VERSION = 1;
const MAX_HTML = 2 * 1024 * 1024;

export interface WikiEntry { id: string; name: string; section: string; repositories: RepoSource[]; author?: string; wikiUpdatedAt?: string; wikiVersion?: string; compatibilityNotes?: string; }
export interface WikiCatalog { schemaVersion: 1; metadataVersion?: number; revision: number; fetchedAt: string; entries: WikiEntry[]; }

export function wikiCacheNeedsRefresh(catalog: WikiCatalog): boolean {
  return catalog.metadataVersion !== METADATA_VERSION;
}

function fail(message: string): never { throw new Error(message); }
function cleanText(value: string, max: number, field: string): string {
  const cleaned = value.replace(/\s+/g, " ").replace(/[\[【](?:Github|GitHub|Discord|下载|主页)[\]】]/gi, "").trim();
  if (!cleaned || cleaned.length > max) fail(`${field}无效`);
  return cleaned;
}
function checkAbort(signal: AbortSignal): void { if (signal.aborted) throw new DOMException("aborted", "AbortError"); }
function textOf(node: Element): string { return (node.textContent || "").replace(/\s+/g, " ").trim(); }
function optionalCell(cells: Element[], index: number, max: number): string | undefined {
  if (index < 0 || !cells[index]) return undefined;
  const value = textOf(cells[index]).replace(/\s+/g, " ").trim();
  if (!value || /^(?:—|-|未知)$/.test(value)) return undefined;
  if (value.length > max) return undefined;
  return value;
}
function dateValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^(\d{4}[/-]\d{1,2}[/-]\d{1,2})/.exec(value);
  return match ? match[1] : value.length <= 80 ? value : undefined;
}
function versionFromDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^(?:\d{4}[/-]\d{1,2}[/-]\d{1,2}\s*[(（]\s*|\s*)(v\d+(?:\.[\da-z]+)+(?:[-+][\w.-]+)?)(?=[\s)）]|$)/i.exec(value);
  return match && match[1].length <= 80 ? match[1] : undefined;
}
function linesOf(cell: Element): string {
  const clone = cell.cloneNode(true) as Element;
  clone.querySelectorAll("br").forEach(node => node.replaceWith("\n"));
  clone.querySelectorAll("p,li,div").forEach(node => node.append("\n"));
  return clone.textContent || "";
}
function linkRepository(href: string): RepoSource | null {
  let url: URL;
  try { url = new URL(href); } catch { return null; }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com" || url.port || url.username || url.password || url.search || url.hash) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2 || parts[0].includes("%") || parts[1].includes("%")) return null;
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, "");
  if (parts.length > 2 && !["tree", "blob", "releases"].includes(parts[2].toLowerCase())) return null;
  if (parts.length > 3 && parts[2].toLowerCase() === "releases" && !["tag", "download", "latest"].includes(parts[3].toLowerCase())) return null;
  if (parts.length > 2 && parts[2].toLowerCase() !== "releases" && parts.length < 4) return null;
  try { return parseRepository(`https://github.com/${owner}/${repo}`); } catch { return null; }
}

export function parseWikiHtml(html: string): WikiEntry[] {
  if (typeof document === "undefined") fail("当前环境不支持安全解析 Wiki HTML");
  if (typeof html !== "string" || html.length > MAX_HTML) fail("Wiki HTML 过大");
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("script,style,noscript").forEach((node) => node.remove());
  const entries: WikiEntry[] = [];
  let section = "未分类";
  for (const element of Array.from(template.content.querySelectorAll("h2,h3,table"))) {
    if (element.matches("h2,h3")) { section = cleanText(textOf(element), 80, "章节"); continue; }
    const table = element as HTMLTableElement;
    const caption = textOf(table.querySelector("caption") || document.createElement("span"));
    if (/载体|无关/.test(caption)) continue;
    const header = Array.from(table.querySelectorAll("tr")).find((row) => row.querySelector("th"));
    if (!header) continue;
    const headers = Array.from(header.querySelectorAll("th")).map(textOf);
    const nameIndex = headers.findIndex((value) => /模组名称|模组名|名称/.test(value));
    if (nameIndex < 0 || !/模组名称|模组名/.test(headers[nameIndex])) continue;
    const authorIndex = headers.findIndex((value) => /模组作者|作者/.test(value));
    const updatedIndex = headers.findIndex((value) => /最后更新日期|更新日期|更新时间/.test(value));
    const versionIndex = headers.findIndex((value) => /模组版本|当前版本/.test(value));
    const compatibilityIndex = headers.findIndex((value) => /适配版本|游戏版本|兼容版本/.test(value));
    for (const row of Array.from(table.querySelectorAll("tr")).slice(1)) {
      const cells = Array.from(row.querySelectorAll("td"));
      const nameCell = cells[nameIndex];
      if (!nameCell) continue;
      const repositories = Array.from(nameCell.querySelectorAll("a[href]"))
        .map((link) => linkRepository(link.getAttribute("href") || ""))
        .filter((value): value is RepoSource => value !== null)
        .filter((value, index, all) => all.findIndex((other) => other.key === value.key) === index);
      const rawName = textOf(nameCell).replace(/[\[【](?:Github|GitHub|Discord|下载|主页)[\]】]/gi, "").trim();
      if (!rawName || /^(?:https?:\/\/)?github\.com\//i.test(rawName)) continue;
      const name = cleanText(rawName, 160, "模组名称");
      const id = `${section}:${name}:${repositories.map((repo) => repo.key).sort().join(",")}`;
      if (id.length > 320) fail("Wiki 模组条目标识无效");
      const duplicate = entries.some((item) => item.name === name && item.repositories.map((repo) => repo.key).join(",") === repositories.map((repo) => repo.key).join(","));
      if (!duplicate) {
        const entry: WikiEntry = { id, name, section, repositories };
        entry.author = optionalCell(cells, authorIndex, 160);
        const rawDate = optionalCell(cells, updatedIndex, 300);
        entry.wikiUpdatedAt = dateValue(rawDate);
        entry.wikiVersion = optionalCell(cells, versionIndex, 80) || (versionIndex < 0 ? versionFromDate(rawDate) : undefined);
        const explicitCompatibility = optionalCell(cells, compatibilityIndex, 300);
        const descriptions = cells.filter((_cell,index) => /简介|备注/.test(headers[index] || "") || index === updatedIndex);
        entry.compatibilityNotes = explicitCompatibility || extractCompatibilityNotes(descriptions.map(linesOf).join("\n"));
        entries.push(entry);
      }
      if (entries.length > 1000) fail("Wiki 模组条目过多");
    }
  }
  if (!entries.length) fail("Wiki 模组目录结构发生变化，未找到合格条目");
  return entries;
}

function requestSignal(external?: AbortSignal): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (external?.aborted) controller.abort();
  else external?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(), 30_000);
  return { signal: controller.signal, done: () => { clearTimeout(timer); external?.removeEventListener("abort", abort); } };
}

async function readResponse(response: Response, signal: AbortSignal): Promise<string> {
  if (!response.body) fail("当前环境不支持安全读取 Wiki 响应");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_HTML) { await reader.cancel(); fail("Wiki 响应过大，已拒绝"); }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder().decode(bytes);
  } catch (error) { try { await reader.cancel(); } catch {} throw error; }
  finally { reader.releaseLock(); }
}

export async function fetchWikiCatalog(options: { signal?: AbortSignal; fetcher?: typeof fetch } = {}): Promise<WikiCatalog> {
  const req = requestSignal(options.signal);
  try {
    checkAbort(req.signal);
    const response = await (options.fetcher || fetch)(WIKI_API, { credentials: "omit", referrerPolicy: "no-referrer", signal: req.signal });
    if (!response.ok) { if (response.status === 403 || response.status === 429) fail("Wiki 请求受到限制，请稍后重试或使用缓存"); fail(`Wiki 请求失败（HTTP ${response.status}）`); }
    checkAbort(req.signal);
    let data: unknown;
    try { data = JSON.parse(await readResponse(response, req.signal)); } catch (error) { if (error instanceof SyntaxError) fail("Wiki 返回了非 JSON 验证页"); throw error; }
    checkAbort(req.signal);
    if (!data || typeof data !== "object" || !("parse" in data)) fail("Wiki API 返回结构无效");
    const parsed = (data as { parse?: { title?: unknown; revid?: unknown; text?: { "*"?: unknown } } }).parse;
    const revision = parsed?.revid;
    if (!parsed || parsed.title !== "模组列表" || typeof revision !== "number" || !Number.isSafeInteger(revision) || revision <= 0 || typeof parsed.text?.["*"] !== "string") fail("Wiki 模组目录结构发生变化");
    const entries = parseWikiHtml(parsed.text["*"]);
    checkAbort(req.signal);
    return { schemaVersion: 1, metadataVersion: METADATA_VERSION, revision: revision as number, fetchedAt: new Date().toISOString(), entries };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new Error("Wiki 请求已取消或超时");
    if (error instanceof TypeError) throw new Error("Wiki 网络失败，可能是跨域或离线");
    throw error;
  } finally { req.done(); }
}

function validateCatalog(value: unknown): WikiCatalog {
  if (!value || typeof value !== "object") fail("Wiki 缓存格式无效");
  const catalog = value as Partial<WikiCatalog>;
  const revision = catalog.revision;
  if (catalog.metadataVersion !== undefined && (!Number.isSafeInteger(catalog.metadataVersion) || catalog.metadataVersion < 1)) fail("Wiki 缓存元数据版本无效");
  if (catalog.schemaVersion !== 1 || typeof revision !== "number" || !Number.isSafeInteger(revision) || revision <= 0 || typeof catalog.fetchedAt !== "string" || Number.isNaN(Date.parse(catalog.fetchedAt)) || !Array.isArray(catalog.entries) || catalog.entries.length === 0 || catalog.entries.length > 1000) fail("Wiki 缓存格式无效");
  const ids = new Set<string>();
  const entries = catalog.entries.map((entry) => {
    if (!entry || typeof entry !== "object" || typeof entry.name !== "string" || !entry.name || entry.name.length > 160 || typeof entry.section !== "string" || !entry.section || entry.section.length > 80 || !Array.isArray(entry.repositories) || entry.repositories.length > 16 || typeof entry.id !== "string" || entry.id.length > 320) fail("Wiki 缓存条目无效");
    const repositories = entry.repositories.map((repo) => parseRepository(repo.url));
    const id = `${entry.section}:${entry.name}:${repositories.map((repo) => repo.key).sort().join(",")}`;
    if (ids.has(id) || entry.id !== id) fail("Wiki 缓存条目标识无效");
    ids.add(id);
    const optional = (key: "author" | "wikiUpdatedAt" | "wikiVersion" | "compatibilityNotes", max: number) => {
      const value = entry[key];
      if (value === undefined) return undefined;
      if (typeof value !== "string" || !value || value.length > max) fail("Wiki 缓存元数据字段无效");
      return value;
    };
    return { id, name: entry.name, section: entry.section, repositories, author: optional("author", 160), wikiUpdatedAt: optional("wikiUpdatedAt", 80), wikiVersion: optional("wikiVersion", 80), compatibilityNotes: optional("compatibilityNotes", 300) };
  });
  return { schemaVersion: 1, metadataVersion: catalog.metadataVersion, revision: revision as number, fetchedAt: catalog.fetchedAt, entries };
}

export function loadWikiCache(store?: Pick<Storage, "getItem">): WikiCatalog | null {
  const raw = (store || globalThis.localStorage).getItem(CACHE_KEY);
  if (raw == null || raw === "") return null;
  if (new TextEncoder().encode(raw).byteLength > MAX_HTML) fail("Wiki 缓存过大，无法读取");
  try { return validateCatalog(JSON.parse(raw)); } catch (error) { if (error instanceof SyntaxError) fail("Wiki 缓存损坏，无法读取"); throw error; }
}

export function saveWikiCache(catalog: WikiCatalog, store?: Pick<Storage, "setItem">): void {
  const valid = validateCatalog(catalog);
  const repositories = valid.entries.map((entry) => ({ id: entry.id, name: entry.name, section: entry.section, repositories: entry.repositories, ...(entry.author === undefined ? {} : { author: entry.author }), ...(entry.wikiUpdatedAt === undefined ? {} : { wikiUpdatedAt: entry.wikiUpdatedAt }), ...(entry.wikiVersion === undefined ? {} : { wikiVersion: entry.wikiVersion }), ...(entry.compatibilityNotes === undefined ? {} : { compatibilityNotes: entry.compatibilityNotes }) }));
  (store || globalThis.localStorage).setItem(CACHE_KEY, JSON.stringify({ schemaVersion: 1, metadataVersion: valid.metadataVersion, revision: valid.revision, fetchedAt: valid.fetchedAt, entries: repositories }));
}
