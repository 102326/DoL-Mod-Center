export interface RepoSource {
  key: string;
  owner: string;
  repo: string;
  url: string;
  modName?: string;
}

export interface ReleaseAsset {
  id: number;
  name: string;
  size: number;
  url: string;
  digest?: string;
}

export interface RepoRelease {
  id: number;
  name: string;
  tag: string;
  url: string;
  prerelease: boolean;
  publishedAt: string;
  updatedAt?: string;
  compatibilityNotes?: string;
  assets: ReleaseAsset[];
}

// Keep the author's complete short statement, including negative qualifiers.
// These are source notes, never a computed compatibility verdict.
export function compatibilityNotes(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 64_000) return undefined;
  const lines = value.split(/\r?\n|[。；]/).map(line => line
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*>\s+/, "").replace(/[`*_#]/g, "").replace(/^\s*[-+]\s*/, "").trim());
  const notes = lines.filter(line => line.length <= 240 && /\d+\.\d+/.test(line) && (
    /(?:游戏版本|适配版本|兼容版本)\s*[:：]/i.test(line) || /(?:要求|需要)游戏版本/i.test(line) ||
    /(?:适配|兼容|支持|不支持|不兼容).*(?:DoL|Degrees of Lewdity|Lyra|游戏|原版|(?<![\d.])0\.\d)/i.test(line) ||
    /(?:compatible\s+with|supports?|requires?)\s+(?:DoL|Degrees of Lewdity|game)/i.test(line)
  ));
  const result: string[] = [];
  for (const note of notes) { if (result.includes(note)) continue; if (result.join("；").length + note.length + 1 > 300) break; result.push(note); if (result.length === 3) break; }
  return result.join("；") || undefined;
}

export function displayMarketDate(value?: string): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) return "未知";
  return new Date(value).toLocaleString();
}

export const MAX_ASSET_BYTES = 128 * 1024 * 1024;
const STORAGE_KEY = "dmc.market.sources.v1";
const API_ROOT = "https://api.github.com/repos/";
const META_LIMIT = 4 * 1024 * 1024;
const ZIP_RE = /\.zip$/i;

function fail(message: string): never { throw new Error(message); }
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}
function text(value: unknown, field: string, max = 512): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) fail(`GitHub 返回的 ${field} 无效`);
  return value;
}
function integer(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail(`GitHub 返回的 ${field} 无效`);
  return value;
}
function repoUrl(owner: string, repo: string): string { return `https://github.com/${owner}/${repo}`; }
function sameRepoUrl(value: unknown, owner: string, repo: string, suffix: "releases/tag" | "releases/download"): string {
  const url = text(value, "地址", 2048);
  let parsed: URL;
  try { parsed = new URL(url); } catch { fail("GitHub 返回的地址无效"); }
  if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com" || parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash) fail("GitHub 返回的地址不安全");
  const prefix = `/${owner}/${repo}/`;
  if (parsed.pathname.toLowerCase().indexOf(prefix.toLowerCase()) !== 0) fail("GitHub 返回的地址与仓库不匹配");
  const rest = parsed.pathname.slice(prefix.length);
  const expected = suffix === "releases/tag" ? `^${suffix}/[^/]+$` : `^${suffix}/[^/]+/[^/]+$`;
  if (!new RegExp(expected, "i").test(rest)) fail("GitHub 返回的地址格式无效");
  return url;
}

export function parseRepository(input: string): RepoSource {
  if (typeof input !== "string" || !input.trim() || input.trim().length > 512) fail("请输入有效的 GitHub 仓库地址");
  const raw = input.trim();
  let owner: string;
  let repo: string;
  if (/^https?:\/\//i.test(raw)) {
    const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(raw);
    if (!match) fail("只支持公开的 github.com HTTPS 仓库根地址");
    [, owner, repo] = match;
  } else {
    const match = /^([^/]+)\/([^/]+?)(?:\.git)?$/.exec(raw);
    if (!match) fail("请输入 owner/repo 或 GitHub 仓库地址");
    [, owner, repo] = match;
  }
  if (!owner || !repo || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo) || repo === "." || repo === "..") fail("GitHub 仓库名称包含无效字符");
  return { key: `${owner}/${repo}`.toLowerCase(), owner, repo, url: repoUrl(owner, repo) };
}

function defaultStorage(): Storage {
  if (typeof globalThis.localStorage === "undefined") fail("当前环境不支持本地仓库配置存储");
  return globalThis.localStorage;
}

export function loadSources(store?: Pick<Storage, "getItem">): RepoSource[] {
  const raw = (store || defaultStorage()).getItem(STORAGE_KEY);
  if (raw == null || raw === "") return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { fail("自定义仓库配置损坏，无法读取"); }
  if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.repositories)) fail("自定义仓库配置格式无效");
  if (parsed.repositories.length > 30) fail("自定义仓库最多支持 30 个");
  const seen = new Set<string>();
  return parsed.repositories.map((item) => {
    if (!isRecord(item)) fail("自定义仓库配置格式无效");
    const source = parseRepository(text(item.url, "仓库地址"));
    if (typeof item.key !== "string" || item.key !== source.key || seen.has(source.key)) fail("自定义仓库配置包含重复或无效项目");
    seen.add(source.key);
    if (item.modName !== undefined) source.modName = text(item.modName, "模组名称", 160);
    return source;
  });
}

export function saveSources(sources:RepoSource[], store?: Pick<Storage, "setItem">): void {
  if (!Array.isArray(sources) || sources.length > 30) fail("自定义仓库最多支持 30 个");
  const seen = new Set<string>();
  const repositories = sources.map((item) => {
    const source = parseRepository(item.url || `${item.owner}/${item.repo}`);
    if (seen.has(source.key)) fail("自定义仓库不能重复");
    seen.add(source.key);
    if (item.modName !== undefined) source.modName = text(item.modName, "模组名称", 160);
    return source;
  });
  (store || defaultStorage()).setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 1, repositories }));
}

function requestSignal(external: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", abort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, done: () => { clearTimeout(timer); external?.removeEventListener("abort", abort); } };
}

function checkAbort(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("aborted", "AbortError");
}

async function responseText(response: Response, signal: AbortSignal, limit = META_LIMIT): Promise<string> {
  if (!response.body) fail("当前环境不支持安全读取 GitHub 响应");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      checkAbort(signal);
      const next = await reader.read();
      if (next.done) break;
      received += next.value.byteLength;
      if (received > limit) {
        await reader.cancel();
        fail("GitHub 返回信息过大，已拒绝");
      }
      chunks.push(next.value);
    }
    checkAbort(signal);
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder().decode(bytes);
  } catch (error) { try { await reader.cancel(); } catch {} throw error; }
  finally { reader.releaseLock(); }
}

export async function fetchReleases(source: RepoSource, options: { signal?: AbortSignal; includePrereleases?: boolean; fetcher?: typeof fetch } = {}): Promise<RepoRelease[]> {
  const checked = parseRepository(source.url);
  const fetcher = options.fetcher || fetch;
  const req = requestSignal(options.signal, 30_000);
  try {
    checkAbort(req.signal);
    const response = await fetcher(`${API_ROOT}${checked.owner}/${checked.repo}/releases?per_page=20`, { credentials: "omit", referrerPolicy: "no-referrer", signal: req.signal, headers: { Accept: "application/vnd.github+json" } });
    if (!response.ok) {
      if (response.status === 403 || response.status === 429) fail("GitHub 请求受到限流，请稍后重试或手动下载");
      if (response.status === 404) fail("GitHub 仓库不存在、未公开或没有可见 Release");
      fail(`GitHub 请求失败（HTTP ${response.status}）`);
    }
    const data: unknown = JSON.parse(await responseText(response, req.signal));
    if (!Array.isArray(data) || data.length > 20) fail("GitHub Release 列表格式无效");
    return data.filter((item) => isRecord(item) && item.draft !== true && (options.includePrereleases || item.prerelease !== true)).map((item) => {
      if (!isRecord(item)) fail("GitHub Release 格式无效");
      const assetsRaw = item.assets;
      if (!Array.isArray(assetsRaw) || assetsRaw.length > 100) fail("GitHub Release 附件过多");
      const assets = assetsRaw.flatMap((asset) => {
        if (!isRecord(asset)) return [];
        const name = text(asset.name, "附件名称", 240);
        const url = text(asset.browser_download_url, "附件地址", 2048);
        if (!ZIP_RE.test(name)) return [];
        try { sameRepoUrl(url, checked.owner, checked.repo, "releases/download"); } catch { return []; }
        const size = integer(asset.size, "附件大小");
        if (size === 0 || size > MAX_ASSET_BYTES) return [];
        const result: ReleaseAsset = { id: integer(asset.id, "附件 ID"), name, size, url };
        if (typeof asset.digest === "string") result.digest = text(asset.digest, "附件摘要", 128);
        return [result];
      });
      const tag = text(item.tag_name, "Release 标签", 160);
      return { id: integer(item.id, "Release ID"), name: text(item.name || tag, "Release 名称"), tag, url: sameRepoUrl(item.html_url, checked.owner, checked.repo, "releases/tag"), prerelease: item.prerelease === true, publishedAt: text(item.published_at, "发布时间", 80), updatedAt: typeof item.updated_at === "string" && item.updated_at.length <= 80 ? item.updated_at : undefined, compatibilityNotes: compatibilityNotes(item.body), assets };
    }).sort((a,b)=>(Date.parse(b.publishedAt)||0)-(Date.parse(a.publishedAt)||0));
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new Error("GitHub 请求已取消或超时");
    if (error instanceof TypeError) throw new Error("网络失败，可能是跨域或离线；请稍后重试或手动下载");
    throw error;
  } finally { req.done(); }
}

export interface RepositoryReadme { text: string; url: string; }
export async function fetchReadme(source: RepoSource, options: {signal?: AbortSignal; fetcher?: typeof fetch} = {}): Promise<RepositoryReadme> {
  const checked = parseRepository(source.url), req = requestSignal(options.signal, 30_000);
  try {
    checkAbort(req.signal);
    const response = await (options.fetcher || fetch)(`${API_ROOT}${checked.owner}/${checked.repo}/readme`, {credentials:"omit",referrerPolicy:"no-referrer",signal:req.signal,headers:{Accept:"application/vnd.github+json"}});
    if (response.status === 404) fail("作者仓库没有可读取的 README");
    if (response.status === 403 || response.status === 429) fail("GitHub 请求受到限流，请稍后重新展开详情");
    if (!response.ok) fail(`README 请求失败（HTTP ${response.status}）`);
    const data: unknown = JSON.parse(await responseText(response, req.signal, 1024 * 1024));
    if (!isRecord(data) || data.encoding !== "base64" || typeof data.content !== "string" || typeof data.size !== "number" || !Number.isSafeInteger(data.size) || data.size < 0 || data.size > 256 * 1024) fail("README 格式无效或超过 256 KiB");
    const encoded = data.content.replace(/\s/g, "");
    if (encoded.length > 350_000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) fail("README 编码无效");
    const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
    if (bytes.byteLength !== data.size) fail("README 内容大小不符");
    const url = new URL(text(data.html_url,"README 来源地址",2048));
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com" || url.port || url.username || url.password || url.search || url.hash || !url.pathname.toLowerCase().startsWith(`/${checked.owner}/${checked.repo}/blob/`.toLowerCase())) fail("README 来源地址与仓库不符");
    const content = new TextDecoder("utf-8",{fatal:true}).decode(bytes);
    checkAbort(req.signal);
    return {text:content,url:url.href};
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new Error("README 请求已取消或超时");
    throw error;
  } finally { req.done(); }
}

export async function verifyAssetBytes(asset: ReleaseAsset, bytes: Uint8Array, signal?: AbortSignal): Promise<void> {
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_ASSET_BYTES || bytes.byteLength !== asset.size || !ZIP_RE.test(asset.name)) fail("附件实际大小与 Release 元数据不一致");
  if (signal) checkAbort(signal);
  if (asset.digest !== undefined && !/^sha256:[0-9a-f]{64}$/i.test(asset.digest)) fail("仅支持 sha256:64位十六进制摘要");
  if (asset.digest) {
    if (!globalThis.crypto?.subtle) fail("当前环境不支持 SHA-256 校验");
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer));
    const actual = Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
    if (actual !== asset.digest.slice(7).toLowerCase()) fail("附件 SHA-256 校验失败");
  }
  if (signal) checkAbort(signal);
}

export async function downloadAsset(source: RepoSource, asset: ReleaseAsset, options: { signal?: AbortSignal; onProgress?: (received: number, total: number) => void; fetcher?: typeof fetch } = {}): Promise<Uint8Array> {
  const checked = parseRepository(source.url);
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_ASSET_BYTES || !ZIP_RE.test(asset.name)) fail("附件大小或 ZIP 文件名无效");
  sameRepoUrl(asset.url, checked.owner, checked.repo, "releases/download");
  if (asset.digest !== undefined && !/^sha256:[0-9a-f]{64}$/i.test(asset.digest)) fail("仅支持 sha256:64位十六进制摘要");
  const req = requestSignal(options.signal, 120_000);
  try {
    checkAbort(req.signal);
    const response = await (options.fetcher || fetch)(asset.url, { credentials: "omit", referrerPolicy: "no-referrer", signal: req.signal });
    if (!response.ok) fail(`附件下载失败（HTTP ${response.status}）`);
    const declared = response.headers.get("content-length");
    if (declared && (!/^\d+$/.test(declared) || Number(declared) !== asset.size)) {
      await response.body?.cancel();
      fail("附件大小与 Release 元数据不一致");
    }
    const chunks: Uint8Array[] = [];
    let received = 0;
    if (!response.body) {
      if (declared !== String(asset.size)) fail("当前环境不支持无长度的安全下载");
      fail("当前环境不支持安全读取附件");
    } else {
      const reader = response.body.getReader();
      try {
        while (true) {
          if (req.signal.aborted) throw new DOMException("aborted", "AbortError");
          const next = await reader.read();
          if (next.done) break;
          const chunk = next.value;
          received += chunk.byteLength;
          if (received > MAX_ASSET_BYTES || received > asset.size) {
            await reader.cancel();
            fail("附件实际大小超过限制");
          }
          chunks.push(chunk); options.onProgress?.(received, asset.size);
        }
      } catch (error) { try { await reader.cancel(); } catch {} throw error; }
      finally { reader.releaseLock(); }
      if (req.signal.aborted) throw new DOMException("aborted", "AbortError");
      if (received !== asset.size) {
        await response.body.cancel();
        fail("附件实际大小与 Release 元数据不一致");
      }
    }
    const output = new Uint8Array(received); let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
    await verifyAssetBytes(asset, output, req.signal);
    return output;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      if (req.signal.aborted && !options.signal?.aborted) throw new Error("附件下载超过 120 秒，请重试或从发布页手动下载");
      throw error;
    }
    if (error instanceof TypeError) throw new Error("网络失败，可能是跨域或离线；请稍后重试或手动下载");
    throw error;
  } finally { req.done(); }
}
