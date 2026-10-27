/* 资源层（§7）：大资源不进代码包 —— 运行时按 URL 加载 + LRU 缓存
 * 立绘来源为仓库 web/assets/pets/<id>.png（由数据机维护的 assets/），
 * 负责 URL、完整性校验与有上限的 Blob 缓存，不操作 DOM/Phaser。
 */

export interface AssetConfig {
  /** 资源根路径，默认指向老 Web 的立绘目录（相对站点根） */
  petArtBase: string;
  /** 缓存容量（张） */
  capacity: number;
}

export const DEFAULT_ASSET_CONFIG: AssetConfig = {
  petArtBase: 'assets/pets',
  // 一屏最多 2 只 + 背包 60 张，留出余量
  capacity: 96
};

export const petArtUrl = (id: number, cfg: AssetConfig = DEFAULT_ASSET_CONFIG): string =>
  `${cfg.petArtBase}/${id}.png`;

/** 构建期生成的资源清单（tools/build-asset-manifest.mjs 产物） */
export interface AssetManifest {
  dataVersion?: string;
  contentHash?: string;
  schema: number;
  kind: 'assets';
  generatedAt: string;
  base: string;
  count: number;
  items: Record<string, { h: string; size: number }>;
}

/** 用内容哈希做缓存键：<base>/<id>.png?v=<hash>（§10） */
export function manifestUrl(
  id: number,
  manifest: AssetManifest | null,
  cfg: AssetConfig = DEFAULT_ASSET_CONFIG
): string {
  // manifest 自带 base（数据机生成时的真实目录），优先于本地默认配置，避免两边漂移
  const base = manifest && manifest.base ? manifest.base : cfg.petArtBase;
  const plain = `${base}/${id}.png`;
  const entry = manifest && manifest.items[String(id)];
  return entry ? `${plain}?v=${entry.h}` : plain;
}

export class LruCache<K, V> {
  private map = new Map<K, V>();
  constructor(private capacity: number, private dispose?: (v: V) => void) {
    if (capacity <= 0) throw new Error('capacity must be > 0');
  }

  get size(): number {
    return this.map.size;
  }

  has(k: K): boolean {
    return this.map.has(k);
  }

  get(k: K): V | undefined {
    if (!this.map.has(k)) return undefined;
    const v = this.map.get(k)!;
    this.map.delete(k);
    this.map.set(k, v);
    return v;
  }

  set(k: K, v: V): void {
    if (this.map.has(k)) {
      const previous = this.map.get(k)!;
      if (previous !== v) this.dispose?.(previous);
      this.map.delete(k);
    }
    this.map.set(k, v);
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value as K;
      this.dispose?.(this.map.get(oldest)!);
      this.map.delete(oldest);
    }
  }

  clear(): void {
    for (const value of this.map.values()) this.dispose?.(value);
    this.map.clear();
  }
}

/** 已加载立绘的 URL 缓存：避免重复请求同一张图（§7 LRU） */
export class PetArtCache {
  private cache: LruCache<number, string>;
  private blobs: LruCache<number, string>;
  private pending = new Map<number, Promise<string>>();
  private generation = 0;
  constructor(cfg: AssetConfig = DEFAULT_ASSET_CONFIG, private manifest: AssetManifest | null = null) {
    this.cache = new LruCache<number, string>(cfg.capacity);
    this.blobs = new LruCache<number, string>(cfg.capacity, (url) => URL.revokeObjectURL(url));
    this.cfg = cfg;
  }
  private cfg: AssetConfig;

  /** 返回该精灵的立绘 URL；首次访问才「占用」一个缓存位 */
  urlFor(id: number): string {
    const hit = this.cache.get(id);
    if (hit) return hit;
    const url = manifestUrl(id, this.manifest, this.cfg);
    this.cache.set(id, url);
    return url;
  }

  get cachedCount(): number {
    return this.cache.size;
  }

  get loadedCount(): number { return this.blobs.size; }

  /** 实际缓存资源；同一 id 的并发请求合并，淘汰时释放 object URL。 */
  load(id: number): Promise<string> {
    if (this.manifest && !this.manifest.items[String(id)]) return Promise.reject(new Error(`暂无立绘：${id}`));
    const hit = this.blobs.get(id);
    if (hit) return Promise.resolve(hit);
    const pending = this.pending.get(id);
    if (pending) return pending;
    const generation = this.generation;
    const task = (async () => {
      const response = await fetch('/' + this.urlFor(id).replace(/^\//, ''));
      if (!response.ok) throw new Error(`立绘加载失败：${id}`);
      const blob = await response.blob();
      const entry = this.manifest?.items[String(id)];
      if (entry) {
        const digest = await crypto.subtle.digest('SHA-1', await blob.arrayBuffer());
        const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
        if (blob.size !== entry.size || hash !== entry.h) throw new Error(`立绘校验失败：${id}`);
      }
      if (generation !== this.generation) throw new Error('立绘缓存已重置');
      const url = URL.createObjectURL(blob);
      this.blobs.set(id, url);
      return url;
    })().finally(() => { if (this.pending.get(id) === task) this.pending.delete(id); });
    this.pending.set(id, task);
    return task;
  }

  reset(): void {
    this.generation++;
    this.cache.clear();
    this.blobs.clear();
    this.pending.clear();
  }
}
