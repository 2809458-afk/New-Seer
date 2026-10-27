import { createReadStream, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { oraclePath, oracleWatchFiles, readEffectiveOracle } from './oracle.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export { oraclePath };

// 原始基准文件只读；先合成精灵增量，再转换 UMD 外壳供浏览器加载。
export function oracleModule() {
  const source = readEffectiveOracle();
  const start = "})(typeof self !== 'undefined' ? self : this, function () {";
  if (!source.includes(start) || !source.trimEnd().endsWith('});')) throw new Error('oracle UMD shape changed');
  return 'const legacy = (function () {' + source.split(start)[1].trimEnd().slice(0, -3) + '\n})();\nexport default legacy;';
}

export function runtimePlugin() {
  const serve = (server) => { server.middlewares.use((req, res, next) => {
    const url = new URL(req.url, 'http://localhost');
    const art = /^\/web\/assets\/pets\/(\d+)\.png$/.exec(url.pathname);
    const data = /^\/data\/(pets|combos|types|skills|soulmarks)\.json$/.exec(url.pathname);
    if (!art && !data) return next();
    const file = art ? resolve(root, 'web/assets/pets', art[1] + '.png') : resolve(root, 'data', data[1] + '.json');
    try {
      const stat = statSync(file);
      res.setHeader('Content-Type', art ? 'image/png' : 'application/json; charset=utf-8');
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Cache-Control', 'no-cache');
      if (req.method === 'HEAD') return res.end();
      createReadStream(file).on('error', () => res.destroy()).pipe(res);
    } catch {
      res.statusCode = 404;
      res.end('Resource not found');
    }
  }); };
  return {
    name: 'seer-external-runtime',
    configureServer(server) { serve(server); server.watcher.add(oracleWatchFiles); },
    configurePreviewServer: serve,
    load(id) {
      if (id.replaceAll('\\', '/') === oraclePath.replaceAll('\\', '/')) {
        for (const file of oracleWatchFiles) this.addWatchFile(file);
        return oracleModule();
      }
    },
    handleHotUpdate(ctx) {
      if (oracleWatchFiles.includes(ctx.file)) {
        ctx.server.moduleGraph.invalidateAll();
        ctx.server.ws.send({ type: 'full-reload' });
        return [];
      }
    }
  };
}
