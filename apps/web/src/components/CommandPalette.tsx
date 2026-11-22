import React, { useEffect, useMemo, useState } from 'react';
import { Archive, FolderSync, Plus, Search, Upload, X } from 'lucide-react';
import { simulationPlugins } from '@physforge/simulations/registry';
import type { ParamRecord } from '@physforge/sim-sdk';
import {
  WorkspaceVaultStore,
  searchGlobalEntries,
  type BuiltinPresetAsset,
  type DirectoryHandleLike,
  type GlobalSearchEntry,
  type VaultRecord
} from '@physforge/workspace-vault';

interface RawContentPresetJson {
  modelId: string;
  preset: {
    id: string;
    name: string;
    description?: string;
    params: ParamRecord;
  };
}

const rawBuiltinModules = import.meta.glob<RawContentPresetJson>(
  '../../../../content/presets/*.json',
  { eager: true, import: 'default' }
);

const builtinVaultAssets: BuiltinPresetAsset[] = Object.values(rawBuiltinModules).map((entry) => ({
  id: entry.preset.id,
  modelId: entry.modelId,
  title: entry.preset.name,
  tags: [entry.modelId],
  params: entry.preset.params,
  notes: entry.preset.description
}));

interface CommandPaletteProps {
  readonly currentModelId: string;
  readonly currentModelTitle: string;
  readonly currentParams: ParamRecord;
  readonly onSelectModelPreset: (
    modelId: string,
    presetId?: string,
    overrideParams?: ParamRecord
  ) => void;
  readonly onClose: () => void;
}

const sharedVaultStore = new WorkspaceVaultStore();

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  currentModelId,
  currentModelTitle,
  currentParams,
  onSelectModelPreset,
  onClose
}) => {
  const [query, setQuery] = useState('');
  const [vaultRecords, setVaultRecords] = useState<VaultRecord[]>([]);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const refreshVault = async () => {
    await sharedVaultStore.mergeBuiltinAssets(builtinVaultAssets);
    const list = await sharedVaultStore.listAll();
    setVaultRecords(list);
  };

  useEffect(() => {
    void refreshVault();
  }, []);

  const searchEntries: GlobalSearchEntry[] = useMemo(() => {
    const list: GlobalSearchEntry[] = [];
    for (const p of simulationPlugins) {
      list.push({
        kind: 'model',
        id: `model:${p.meta.id}`,
        modelId: p.meta.id,
        title: p.meta.title,
        subtitle: `${p.meta.textbookRef} · ${p.meta.difficulty}`,
        keywords: [...p.meta.curriculumTags, p.meta.id]
      });
      for (const preset of p.presets) {
        list.push({
          kind: 'preset',
          id: `preset:${p.meta.id}:${preset.id}`,
          modelId: p.meta.id,
          presetId: preset.id,
          title: `${preset.name}（${p.meta.title}）`,
          subtitle: preset.description,
          keywords: [p.meta.textbookRef, preset.id]
        });
      }
    }
    for (const rec of vaultRecords) {
      list.push({
        kind: 'vault',
        id: `vault:${rec.id}`,
        modelId: rec.modelId,
        record: rec,
        title: rec.title,
        subtitle: `${rec.source === 'builtin' ? '仓库内置 JSON' : '个人 Vault 收藏'} · ${rec.modelId}`,
        keywords: [...rec.tags, rec.payload.notes ?? '']
      });
    }
    return list;
  }, [vaultRecords]);

  const ranked = useMemo(() => searchGlobalEntries(searchEntries, query, 24), [searchEntries, query]);

  const handleSaveCurrent = async () => {
    const id = `user:${currentModelId}:${Date.now()}`;
    await sharedVaultStore.put({
      id,
      kind: 'scene',
      modelId: currentModelId,
      title: `${currentModelTitle} · 课堂快照`,
      tags: [currentModelId, '自定义场景'],
      updatedAt: new Date().toISOString(),
      source: 'user',
      payload: {
        params: { ...currentParams },
        notes: '从 Ctrl+K 面板快速保存的物理实验参数'
      }
    });
    await refreshVault();
    setStatusMsg('已保存当前参数场景至本地 Vault（IndexedDB）');
  };

  const handleExportZip = async () => {
    const bytes = await sharedVaultStore.exportZipBytes();
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const blob = new Blob([copy], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'physforge-vault-backup.zip';
    a.click();
    URL.revokeObjectURL(url);
    setStatusMsg(`已打包导出 ${(bytes.byteLength / 1024).toFixed(1)} KB ZIP 资产包`);
  };

  const handleImportZip = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buf = new Uint8Array(await file.arrayBuffer());
    const imported = await sharedVaultStore.importZipBytes(buf);
    await refreshVault();
    setStatusMsg(`已从 ZIP 恢复 ${imported.length} 条 Vault 记录`);
  };

  const handleSyncDirectory = async () => {
    const picker = (window as unknown as { showDirectoryPicker?: () => Promise<DirectoryHandleLike> })
      .showDirectoryPicker;
    if (!picker) {
      setStatusMsg('当前浏览器上下文不支持 File System Access API，已使用 IndexedDB 与 ZIP 导出。');
      return;
    }
    const dir = await picker();
    const count = await sharedVaultStore.syncToDirectoryHandle(dir);
    setStatusMsg(`已同步 ${count} 条记录至本地文件夹 "${dir.name}"`);
  };

  return (
    <div
      data-testid="command-palette-modal"
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 bg-slate-950/70 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[78vh]"
        style={{
          borderColor: 'var(--pf-border)',
          backgroundColor: 'var(--pf-surface)',
          color: 'var(--pf-text)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--pf-border)' }}>
          <Search className="w-4 h-4 text-sky-400 shrink-0" />
          <input
            type="text"
            autoFocus
            data-testid="command-palette-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索模型、人教版章节、课标标签、磁聚焦预设或本地 Vault..."
            className="flex-1 bg-transparent outline-none text-sm"
          />
          <button type="button" onClick={onClose} className="p-1 rounded cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Vault 工具栏 */}
        <div
          className="flex flex-wrap items-center gap-2 px-4 py-2 border-b text-xs"
          style={{ borderColor: 'var(--pf-border)', backgroundColor: 'var(--pf-surface-elevated)' }}
        >
          <button
            type="button"
            data-testid="btn-vault-save"
            onClick={handleSaveCurrent}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-500 text-slate-950 font-bold cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>收藏当前场景</span>
          </button>
          <button
            type="button"
            data-testid="btn-vault-export-zip"
            onClick={handleExportZip}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border cursor-pointer"
            style={{ borderColor: 'var(--pf-border)' }}
          >
            <Archive className="w-3.5 h-3.5" />
            <span>导出 ZIP 备份</span>
          </button>
          <label
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border cursor-pointer"
            style={{ borderColor: 'var(--pf-border)' }}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>导入 ZIP</span>
            <input type="file" accept=".zip" className="hidden" onChange={handleImportZip} />
          </label>
          <button
            type="button"
            onClick={handleSyncDirectory}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border cursor-pointer"
            style={{ borderColor: 'var(--pf-border)' }}
          >
            <FolderSync className="w-3.5 h-3.5" />
            <span>目录同步</span>
          </button>
          {statusMsg && <span className="text-emerald-300 font-semibold ml-auto">{statusMsg}</span>}
        </div>

        <div className="overflow-y-auto divide-y" style={{ borderColor: 'var(--pf-border)' }}>
          {ranked.map(({ entry }) => (
            <button
              key={entry.id}
              type="button"
              data-testid={`palette-item-${entry.id}`}
              onClick={() => {
                if (entry.kind === 'model') {
                  onSelectModelPreset(entry.modelId);
                } else if (entry.kind === 'preset') {
                  onSelectModelPreset(entry.modelId, entry.presetId);
                } else {
                  onSelectModelPreset(
                    entry.modelId,
                    undefined,
                    entry.record.payload.params ?? entry.record.payload.scene?.params
                  );
                }
                onClose();
              }}
              className="w-full text-left px-4 py-2.5 hover:bg-sky-500/10 transition flex items-center justify-between gap-3 cursor-pointer"
            >
              <div className="min-w-0">
                <div className="font-semibold text-sm truncate">{entry.title}</div>
                <div className="text-xs truncate" style={{ color: 'var(--pf-text-muted)' }}>
                  {entry.subtitle}
                </div>
              </div>
              <span className="shrink-0 text-[11px] uppercase px-2 py-0.5 rounded bg-slate-800 text-sky-300">
                {entry.kind}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
