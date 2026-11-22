import type { VaultRecord } from './vaultStore.js';

export interface SearchableModelEntry {
  readonly kind: 'model';
  readonly id: string;
  readonly modelId: string;
  readonly title: string;
  readonly subtitle: string;
  readonly keywords: readonly string[];
}

export interface SearchablePresetEntry {
  readonly kind: 'preset';
  readonly id: string;
  readonly modelId: string;
  readonly presetId: string;
  readonly title: string;
  readonly subtitle: string;
  readonly keywords: readonly string[];
}

export interface SearchableVaultEntry {
  readonly kind: 'vault';
  readonly id: string;
  readonly modelId: string;
  readonly record: VaultRecord;
  readonly title: string;
  readonly subtitle: string;
  readonly keywords: readonly string[];
}

export type GlobalSearchEntry =
  | SearchableModelEntry
  | SearchablePresetEntry
  | SearchableVaultEntry;

export interface RankedSearchResult {
  readonly entry: GlobalSearchEntry;
  readonly score: number;
}

function scoreField(text: string, tokens: readonly string[], weight: number): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (!token) continue;
    if (lower === token) {
      score += 10 * weight;
    } else if (lower.startsWith(token)) {
      score += 6 * weight;
    } else if (lower.includes(token)) {
      score += 3 * weight;
    }
  }
  return score;
}

/**
 * 面向 Ctrl+K 命令面板的模糊加权全局索引检索（模型 / 课标标签 / 教材章节 / 预设 / 本地资产）
 */
export function searchGlobalEntries(
  entries: readonly GlobalSearchEntry[],
  query: string,
  limit = 20
): RankedSearchResult[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    return entries.slice(0, limit).map((entry) => ({ entry, score: 1 }));
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const ranked: RankedSearchResult[] = [];

  for (const entry of entries) {
    let score = 0;
    score += scoreField(entry.title, tokens, 4);
    score += scoreField(entry.modelId, tokens, 3);
    score += scoreField(entry.subtitle, tokens, 2);
    for (const kw of entry.keywords) {
      score += scoreField(kw, tokens, 1.5);
    }

    if (score > 0) {
      ranked.push({ entry, score });
    }
  }

  ranked.sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title));
  return ranked.slice(0, limit);
}
