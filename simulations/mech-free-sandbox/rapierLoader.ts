export type RapierModule = typeof import('@dimforge/rapier2d-compat');

let rapierModuleCache: RapierModule | null = null;
let rapierInitPromise: Promise<RapierModule> | null = null;
let rapierLoadError:unknown=null;
export function getRapierLoadError():unknown {return rapierLoadError;}

/**
 * 同步读取已就绪的 Rapier2D 模块；未加载时返回 null 并由调用方触发异步按需加载
 */
export function getLoadedRapier(): RapierModule | null {
  return rapierModuleCache;
}

/**
 * 按需动态懒加载 @dimforge/rapier2d-compat WASM 引擎（严禁顶层静态导入进入主首屏 chunk）
 */
export async function ensureRapierLoaded(): Promise<RapierModule> {
  if (rapierModuleCache) return rapierModuleCache;
  if (!rapierInitPromise) {
    rapierLoadError=null;
    rapierInitPromise = (async () => {
      const mod = await import('@dimforge/rapier2d-compat');
      const rapier = ('default' in mod ? mod.default : mod) as RapierModule;
      await rapier.init();
      rapierModuleCache = rapier;
      return rapier;
    })().catch(error=>{rapierLoadError=error;rapierInitPromise=null;throw error;});
  }
  return rapierInitPromise;
}
