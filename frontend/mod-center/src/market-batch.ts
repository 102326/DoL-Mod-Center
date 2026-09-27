import {downloadAsset,MAX_ASSET_BYTES,type ReleaseAsset,type RepoRelease,type RepoSource} from './market';

export interface MarketSelection {
  source: RepoSource;
  release: RepoRelease;
  asset: ReleaseAsset;
}

export interface MarketBatchProgress {
  index: number;
  count: number;
  received: number;
  total: number;
}

export interface MarketBatchOptions {
  signal?: AbortSignal;
  onProgress?: (index: number, count: number, received: number, total: number) => void;
}

type AssetDownloader = (source: RepoSource, asset: ReleaseAsset, options: {
  signal?: AbortSignal;
  onProgress?: (received: number, total: number) => void;
}) => Promise<Uint8Array>;

const MAX_BATCH_BYTES = 256 * 1024 * 1024;
const ZIP_RE = /\.zip$/i;

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
}

function copySource(source: RepoSource): RepoSource {
  return {...source};
}

function copyRelease(release: RepoRelease, asset: ReleaseAsset): RepoRelease {
  return {...release, assets: [{...asset}]};
}

function copySelection(item: MarketSelection): MarketSelection {
  return {
    source: copySource(item.source),
    release: copyRelease(item.release, item.asset),
    asset: {...item.asset}
  };
}

function validateSelection(item: MarketSelection, seenSources: Set<string>, seenAssets: Set<string>): number {
  if (!item || typeof item !== 'object' || !item.source || !item.release || !item.asset) throw new Error('批量选择包含无效项目');
  const sourceKey = item.source.key;
  if (typeof sourceKey !== 'string' || !sourceKey || seenSources.has(sourceKey)) throw new Error('批量选择不能重复仓库');
  seenSources.add(sourceKey);
  const asset = item.asset;
  const assetUrl = asset.url;
  if (typeof assetUrl !== 'string' || !assetUrl || seenAssets.has(assetUrl)) throw new Error('批量选择不能重复附件');
  seenAssets.add(assetUrl);
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_ASSET_BYTES || !ZIP_RE.test(asset.name || '')) throw new Error('批量选择包含无效 ZIP 附件');
  return asset.size;
}

/** Make an immutable-by-convention snapshot before any asynchronous download starts. */
export function snapshotMarketSelections(selections: MarketSelection[]): MarketSelection[] {
  if (!Array.isArray(selections) || selections.length < 1 || selections.length > 30) throw new Error('批量选择数量必须在 1 到 30 个之间');
  const seenSources = new Set<string>(), seenAssets = new Set<string>();
  let total = 0;
  const snapshot = selections.map(item => {
    total += validateSelection(item, seenSources, seenAssets);
    if (total > MAX_BATCH_BYTES) throw new Error('批量附件总大小超过 256 MiB');
    return copySelection(item);
  });
  return snapshot;
}

export async function downloadMarketBatch(
  selections: MarketSelection[],
  options: MarketBatchOptions = {},
  downloader: AssetDownloader = downloadAsset
): Promise<{inputs: Uint8Array[]; selections: MarketSelection[]}> {
  const snapshot = snapshotMarketSelections(selections);
  const count = snapshot.length;
  const inputs: Uint8Array[] = [];
  let receivedTotal = 0;
  const declaredTotal = snapshot.reduce((sum, item) => sum + item.asset.size, 0);
  for (let index = 0; index < count; index += 1) {
    abortIfNeeded(options.signal);
    const item = snapshot[index];
    let currentReceived = 0;
    const bytes = await downloader(item.source, item.asset, {
      signal: options.signal,
      onProgress: (received, total) => {
        if (!Number.isSafeInteger(received) || received < 0 || received > item.asset.size) throw new Error('下载进度超过附件大小');
        currentReceived = received;
        options.onProgress?.(index, count, receivedTotal + received, declaredTotal);
      }
    });
    abortIfNeeded(options.signal);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== item.asset.size) throw new Error('批量下载结果大小与 Release 元数据不一致');
    receivedTotal += bytes.byteLength;
    if (receivedTotal > MAX_BATCH_BYTES) throw new Error('批量下载实际总大小超过 256 MiB');
    if (currentReceived > bytes.byteLength) throw new Error('下载进度超过实际附件大小');
    inputs.push(new Uint8Array(bytes));
    options.onProgress?.(index, count, receivedTotal, declaredTotal);
  }
  abortIfNeeded(options.signal);
  return {inputs, selections: snapshot};
}
