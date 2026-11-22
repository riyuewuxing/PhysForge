import { describe, expect, it } from 'vitest';
import {
  WorkspaceVaultStore,
  searchGlobalEntries,
  type GlobalSearchEntry
} from './index.js';

describe('workspace-vault store and search', () => {
  it('merges builtin presets without overwriting user items and roundtrips fflate ZIP archives', async () => {
    const store = new WorkspaceVaultStore();

    const merged = await store.mergeBuiltinAssets([
      {
        id: 'hall-velocity',
        modelId: 'em-bounded-magnetic-field',
        title: '速度选择器直线通过',
        tags: ['复合场', '选择性必修二'],
        textbookRef: '选择性必修二 第1章',
        params: { E: 400, B: 2.0, vx0: 200 }
      },
      {
        id: 'doppler-pass',
        modelId: 'wave-vibration-coupling',
        title: '多普勒波源接近压缩',
        tags: ['多普勒效应', '选择性必修一'],
        params: { vSource: 120 }
      }
    ]);
    expect(merged).toBe(2);

    await store.put({
      id: 'user:scene:1',
      kind: 'scene',
      modelId: 'mech-block-conveyor',
      title: '高考板块传送带变式课堂版',
      tags: ['传送带', '共速划痕'],
      updatedAt: '2026-11-22T12:00:00.000Z',
      source: 'user',
      payload: {
        params: { muBlockGround: 0.25 },
        notes: '课堂重点演示共速后静摩擦锁定'
      }
    });

    const zipBytes = await store.exportZipBytes();
    expect(zipBytes.byteLength).toBeGreaterThan(100);

    // Import into a brand new store instance
    const restoredStore = new WorkspaceVaultStore();
    const restored = await restoredStore.importZipBytes(zipBytes);
    expect(restored).toHaveLength(3);

    const all = await restoredStore.listAll();
    const userItem = all.find((r) => r.id === 'user:scene:1');
    expect(userItem?.payload.notes).toContain('共速');

    // Sync with mock FileSystemAccess handle
    const files: Record<string, string> = {};
    await restoredStore.syncToDirectoryHandle({
      name: 'PhysForgeVault',
      getFileHandle: async (name) => ({
        createWritable: async () => ({
          write: async (data) => {
            files[name] = typeof data === 'string' ? data : '';
          },
          close: async () => {}
        }),
        getFile: async () => ({
          text: async () => files[name] ?? '[]'
        })
      })
    });
    expect(files['physforge-vault-snapshot.json']).toContain('速度选择器直线通过');
  });

  it('ranks Ctrl+K fuzzy search results accurately across models, presets, and vault items', () => {
    const entries: GlobalSearchEntry[] = [
      {
        kind: 'model',
        id: 'model:em',
        modelId: 'em-bounded-magnetic-field',
        title: '有界磁场与复合场动态圆分析',
        subtitle: '选择性必修二',
        keywords: ['洛伦兹力', '动态圆', '速度选择器']
      },
      {
        kind: 'model',
        id: 'model:conveyor',
        modelId: 'mech-block-conveyor',
        title: '板块滑块与倾斜传送带动力学',
        subtitle: '必修一 牛顿运动定律',
        keywords: ['划痕', '生热', '共速']
      },
      {
        kind: 'preset',
        id: 'preset:1',
        modelId: 'em-bounded-magnetic-field',
        presetId: 'magnetic-focus',
        title: '磁聚焦汇交同一点',
        subtitle: '圆心轨迹平移圆法',
        keywords: ['r=R', '磁聚焦']
      }
    ];

    const res = searchGlobalEntries(entries, '磁聚焦');
    expect(res[0]!.entry.id).toBe('preset:1');

    const res2 = searchGlobalEntries(entries, '传送带 划痕');
    expect(res2[0]!.entry.id).toBe('model:conveyor');
  });
});
