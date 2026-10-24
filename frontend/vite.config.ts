import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { cp, mkdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

function cesiumAssets(): Plugin {
  const source = fileURLToPath(new URL('./node_modules/cesium/Build/Cesium/', import.meta.url));
  let output = '';
  let copyForBuild = false;
  return {
    name: 'climate-cesium-assets',
    configResolved(config) {
      output = resolve(config.root, config.build.outDir, 'cesium');
      copyForBuild = config.command === 'build' && !process.env.VITEST;
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/cesium/')) return next();
        try {
          const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).slice('/cesium/'.length);
          const target = resolve(source, relative);
          if (!target.startsWith(source.endsWith(sep) ? source : source + sep) || !(await stat(target)).isFile()) { res.statusCode = 404; res.end(); return; }
          const types: Record<string, string> = { '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
          res.setHeader('Content-Type', types[extname(target)] || 'application/octet-stream');
          createReadStream(target).pipe(res);
        } catch { res.statusCode = 404; res.end(); }
      });
    },
    async closeBundle() {
      if (!copyForBuild) return;
      await mkdir(output, { recursive: true });
      await Promise.all(['Workers', 'Assets', 'Widgets', 'ThirdParty'].map((folder) => cp(resolve(source, folder), resolve(output, folder), { recursive: true })));
    },
  };
}

export default defineConfig({
  define: { CESIUM_BASE_URL: JSON.stringify('/cesium') },
  plugins: [react(), cesiumAssets()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // CLIMATE_CHAIN_GATEWAY_URL points the dev server at a second gateway (for example a test
      // chain on another port). Unset, it proxies to the launcher's gateway as before.
      '/api': process.env.CLIMATE_CHAIN_GATEWAY_URL || 'http://127.0.0.1:8080',
    },
  },
});
