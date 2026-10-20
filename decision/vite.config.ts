import { defineConfig } from "vite";
import cesium from "vite-plugin-cesium";
import path from "path";
import fs from "node:fs";
import { competitionAssets, writeCompetitionAssets } from './scripts/competition-assets.mjs';

export default defineConfig(({ mode }) => {
  const base = process.env.VITE_BASE_PATH ?? (mode === "production" ? "/decision/" : "/");

  return {
    base,
    optimizeDeps: { exclude: ["maplibre-gl"] },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
    plugins: [
      {
        name: "shared-competition-shell",
        configureServer(server) {
          const assets = competitionAssets();
          server.middlewares.use((req, _res, next) => {
            const asset = assets[(req.url || '').split('?')[0].replace(/^\/aic\/assets\//, '')];
            if ((req.url || '').startsWith('/aic/assets/') && asset) {
              _res.setHeader('Content-Type', req.url?.includes('.png') ? 'image/png' : 'application/geo+json');
              _res.end(asset); return;
            }
            if (/^\/aic\/(?:index\.html)?(?:\?|$)/.test(req.url || "")) req.url = "/index.html";
            next();
          });
        },
        closeBundle() {
          const output = path.resolve(__dirname, "dist");
          fs.mkdirSync(path.join(output, "aic"), { recursive: true });
          const html = fs.readFileSync(path.join(output, "index.html"), "utf8");
          const competition = html.replace("微境探界 · 可视化决策平台", "微境探界 · AIC 竞赛版")
            .replaceAll('郑州 · 中原区', '某街区').replaceAll('校园周边', '某校园')
            .replace('href="./logo.png"', 'href="../logo.png"')
            .replace('src="./logo.png"', 'src="../logo.png"')
            .replace("<head>", '<head><script>if(new URLSearchParams(location.search).get("embed")==="1")location.replace("./assessment.html"+location.search+location.hash)</script>');
          fs.writeFileSync(path.join(output, "aic/index.html"), competition);
          writeCompetitionAssets(output);
        },
      },
      cesium({
        rebuildCesium: true,
      }),
    ],
    build: {
      target: "esnext",
      sourcemap: false,
      rollupOptions: { input: { main: path.resolve(__dirname, "index.html"), legacy: path.resolve(__dirname, "legacy.html") } },
    },
    server: {
      port: 5173,
      proxy: {
        "/tiles": { target: "https://weather.nogamenolife.cn", changeOrigin: true },
        "/data": { target: "https://weather.nogamenolife.cn/decision", changeOrigin: true },
        "/api/simulation": {
          target: "http://localhost:3000",
          changeOrigin: true,
        },
        "/api/weather": {
          target: process.env.VITE_API_TARGET || "http://localhost:3000",
          changeOrigin: true,
        },
        "/api/tracking": {
          target: "http://localhost:3000",
          changeOrigin: true,
        },
        "/api/detect": {
          target: "http://localhost:5000",
          changeOrigin: true,
        },
        "/result": {
          target: "http://localhost:5000",
          changeOrigin: true,
        },
      },
    },
  };
});
