import type { RepoRelease } from "./market";
import type { WikiEntry } from "./wiki-source";

export type Compatibility = "supported" | "unknown" | "mismatch";
type Version = number[];

function version(value: string): Version | undefined {
  const match = value.trim().match(/^(\d+(?:\.\d+){1,3})(?:\.([xX*]))?$/);
  if (!match) return undefined;
  const parts=match[1].split(".").map(Number).concat(match[2] ? [-1] : []);
  return parts.length<=4&&parts.every(Number.isSafeInteger)?parts:undefined;
}
function compare(a: Version, b: Version): number {
  for (let i = 0; i < 4; i++) { const av = a[i] ?? 0; const bv = b[i] ?? 0; if (av !== bv) return av < 0 || bv < 0 ? 0 : av - bv; }
  return 0;
}
function matches(value: Version, pattern: Version): boolean {
  for (let i = 0; i < pattern.length; i++) if (pattern[i] >= 0 && (value[i] ?? 0) !== pattern[i]) return false;
  return true;
}

export function compatibilityFor(notes?: string, currentVersion?: string): Compatibility {
  if (!notes || !currentVersion || /计划|预计|可能|未测试|未完成|尚待|未经|待验证|不保证|或|以及|\b(?:or|may|might)\b|not\s+(?:tested|verified)|untested|planned/i.test(notes)) return "unknown";
  const current = version(currentVersion);
  if (!current || current.includes(-1)) return "unknown";
  // Only accept a single, clearly labelled statement. Mixed prose is not a range.
  const clauses = notes.split(/[；;\n]/).map(value => value.trim()).filter(Boolean);
  if (new Set(clauses).size !== 1) return "unknown";
  const expression = notes.match(/(?:游戏(?:最新)?版本|适配(?:版本|本体)?|兼容版本|(?:支持|supports?|requires?|compatible\s+with)\s*(?:DoL|Degrees of Lewdity|game))\s*[:：]?\s*((?:(?:>=|<=|>|<|=)?\s*v?\d+(?:\.(?:\d+|x|\*)){1,3}\s*)+)/i)?.[1];
  if (!expression) return "unknown";
  const tokens = [...expression.matchAll(/(>=|<=|>|<|=)?\s*v?(\d+(?:\.(?:\d+|x|\*)){1,3})/gi)];
  const allVersions = [...notes.matchAll(/(?<![\d.])v?\d+(?:\.(?:\d+|x|\*)){1,3}(?![\w.])/gi)];
  if (!tokens.length || tokens.length !== allVersions.length || tokens.length > 2) return "unknown";
  if (tokens.length > 1 && tokens.some(token => !token[1] || token[1] === "=")) return "unknown";
  const negative = /(?:不|未|尚未)(?:再)?(?:适配|兼容|支持)|不可用|not\s+(?:compatible|supported)|does\s+not\s+support/i.test(notes);
  if(tokens.length===2){
    const lower=tokens.find(token=>token[1]?.startsWith(">")),upper=tokens.find(token=>token[1]?.startsWith("<"));
    if(lower&&upper){const a=version(lower[2]),b=version(upper[2]);if(!a||!b)return "unknown";const cmp=compare(a,b);if(cmp>0||(cmp===0&&(lower[1]===">"||upper[1]==="<")))return "unknown";}
  }
  let result = true;
  for (const token of tokens) {
    const pattern = version(token[2]);
    if (!pattern || (token[1] && token[1] !== "=" && pattern.includes(-1))) return "unknown";
    const cmp = compare(current, pattern);
    const match = token[1] === ">=" ? cmp >= 0 : token[1] === "<=" ? cmp <= 0 : token[1] === ">" ? cmp > 0 : token[1] === "<" ? cmp < 0 : pattern.includes(-1) ? matches(current, pattern) : cmp === 0;
    result = result && match;
  }
  if (negative) return result ? "mismatch" : "unknown";
  return result ? "supported" : "mismatch";
}

export function entryCompatibility(entry: WikiEntry, currentVersion: string | undefined, releases: Record<string, RepoRelease[]>, repoUses: Map<string, number>): Compatibility {
  const keys = entry.repositories.map((repo) => repo.key);
  const unique = keys.length === 1 && (repoUses.get(keys[0]) || 0) === 1;
  const releaseNote = unique ? releases[keys[0]]?.[0]?.compatibilityNotes : undefined;
  return compatibilityFor(releaseNote || entry.compatibilityNotes, currentVersion);
}

function dateValue(value?: string): { timestamp: number; label: string; value: string } {
  if (!value) return { timestamp: 0, label: "日期未知", value: "" };
  const match = value.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!match) return { timestamp: 0, label: "日期未知", value };
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return { timestamp: 0, label: "日期未知", value };
  return { timestamp: date.getTime(), label: value, value };
}

export function entryDate(entry: WikiEntry, releases: Record<string, RepoRelease[]>, repoUses: Map<string, number>) {
  const key = entry.repositories.length === 1 ? entry.repositories[0].key : undefined;
  const release = key && repoUses.get(key) === 1 ? releases[key]?.[0] : undefined;
  if (release?.publishedAt) { const date = dateValue(release.publishedAt); const timestamp = Date.parse(release.publishedAt); if (date.timestamp && Number.isFinite(timestamp)) return {...date, timestamp, label: "发布时间"}; }
  const date = dateValue(entry.wikiUpdatedAt);
  return {...date, label: date.timestamp ? "Wiki 更新" : "日期未知"};
}

export function sortEntries(entries: WikiEntry[], currentVersion: string | undefined, releases: Record<string, RepoRelease[]>) {
  const repoUses = new Map<string, number>();
  for (const entry of entries) for (const repo of entry.repositories) repoUses.set(repo.key, (repoUses.get(repo.key) || 0) + 1);
  const groups: Record<Compatibility, number> = { supported: 0, unknown: 1, mismatch: 2 };
  return entries.map((entry, index) => ({ entry, index, compatibility: entryCompatibility(entry, currentVersion, releases, repoUses), date: entryDate(entry, releases, repoUses) }))
    .sort((a, b) => groups[a.compatibility] - groups[b.compatibility] || b.date.timestamp - a.date.timestamp || a.index - b.index)
    .map((item) => item.entry);
}
