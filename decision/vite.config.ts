import { defineConfig } from "vite";
import cesium from "vite-plugin-cesium";
import path from "path";
import fs from "node:fs";
import serveStatic from 'serve-static';
import { competitionAssets, writeCompetitionAssets } from './scripts/competition-assets.mjs';
import { competitionHome, competitionJournal, competitionHomeMedia, writeCompetitionHome } from './scripts/competition-home.mjs';
import { writeBuildManifest } from './scripts/build-manifest.mjs';

export default defineConfig(({ mode }) => {
  const base = process.env.VITE_BASE_PATH ?? (mode === "production" ? "/decision/" : "/");
  const workspaceMedia = ['d-intervention.png', 'd-context.png'];

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
          if(!process.env.VITE_BLOG_TARGET&&fs.existsSync(path.resolve(__dirname,'../../../author-homepage/dist/project/index.html'))){
            server.middlewares.use('/author',serveStatic(path.resolve(__dirname,'../../../author-homepage/dist')));
          }
          server.middlewares.use((req, _res, next) => {
            const pathname=(req.url||'').split('?')[0];
            if(pathname.startsWith(`${base}assets/workspace-media/`)){
              const name=pathname.slice(`${base}assets/workspace-media/`.length);
              if(workspaceMedia.includes(name)){
                _res.setHeader('Content-Type','image/png');
                _res.end(fs.readFileSync(path.resolve(__dirname,'public/aic/assets',name)));return;
              }
            }
            if(pathname.startsWith('/decision/ui-fonts/'))req.url=req.url?.replace('/decision/ui-fonts/','/ui-fonts/');
            if(pathname==='/home.html'){
              _res.setHeader('Content-Type','text/html; charset=utf-8');
              _res.end(fs.readFileSync(path.resolve(__dirname,'../api/templates/home.html'),'utf8').replaceAll('href="/decision/"','href="/#screen"'));return;
            }
            if(pathname==='/author-preview.html'){
              _res.setHeader('Content-Type','text/html; charset=utf-8');
              _res.end(fs.readFileSync(path.resolve(__dirname,'../api/templates/author.html'),'utf8'));return;
            }
            if(['/monitor','/sensors','/logs'].includes(pathname)){
              const name=pathname.slice(1);
              const html=fs.readFileSync(path.resolve(__dirname,'../api/templates',name+'.html'),'utf8');
              _res.setHeader('Content-Type','text/html; charset=utf-8');
              _res.end(html.replace('AMAP_KEY_PLACEHOLDER',process.env.AMAP_JS_KEY||''));return;
            }
            if(pathname==='/console.css'){
              _res.setHeader('Content-Type','text/css; charset=utf-8');
              _res.end(fs.readFileSync(path.resolve(__dirname,'../api/static/console.css'),'utf8'));return;
            }
            if(pathname?.startsWith('/home-assets/')){
              const name=pathname.slice('/home-assets/'.length);
              if(['author.css','design.css','scene.js','scene.json','mobile-devices.js','mobile-devices.css','campus-scene.webp','campus-lcz.webp','field-observation.webp','data-platform.webp','d-context.webp','d-intervention.webp'].includes(name)){
                _res.setHeader('Content-Type',name.endsWith('.css')?'text/css; charset=utf-8':name.endsWith('.js')?'text/javascript; charset=utf-8':name.endsWith('.json')?'application/json':'image/webp');
                _res.end(fs.readFileSync(path.resolve(__dirname,'../api/static/home',name)));return;
              }
            }
            if(pathname==='/aic/home.html'||pathname==='/aic/journal.html'){_res.setHeader('Content-Type','text/html; charset=utf-8');_res.end(pathname.endsWith('journal.html')?competitionJournal():competitionHome());return;}
            if(pathname?.startsWith('/aic/assets/')&&competitionHomeMedia.includes(pathname.slice('/aic/assets/'.length))){
              const name=pathname.slice('/aic/assets/'.length);
              _res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript; charset=utf-8':name.endsWith('.json')?'application/json':name.endsWith('.webp')?'image/webp':'image/png');
              _res.end(fs.readFileSync(path.resolve(__dirname,'public/aic/assets',name)));return;
            }
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
          const output = path.resolve(__dirname, process.env.VITE_OUTPUT_DIR || "dist");
          // Workspace previews must remain available when competition routes are blocked.
          const mediaDirectory = path.join(output, 'assets/workspace-media');fs.mkdirSync(mediaDirectory,{recursive:true});
          for(const name of workspaceMedia)fs.copyFileSync(path.resolve(__dirname,'public/aic/assets',name),path.join(mediaDirectory,name));
          const selfCheck = path.join(output, 'self-check');fs.mkdirSync(selfCheck,{recursive:true});
          for(const name of ['assessment.html','app.js','style.css','embedded.css','design.css'])fs.copyFileSync(path.join(output,'aic',name),path.join(selfCheck,name));
          fs.mkdirSync(path.join(output, "aic"), { recursive: true });
          const html = fs.readFileSync(path.join(output, "index.html"), "utf8");
          const competition = html.replace("微境探界 · 可视化决策平台", "微境探界 · AIC 竞赛版")
            .replaceAll('郑州 · 中原区', '某街区').replaceAll('校园周边', '某校园')
            .replace('href="./logo.png"', 'href="../logo.png"')
            .replace('src="./logo.png"', 'src="../logo.png"')
            .replace("<head>", '<head><script>if(new URLSearchParams(location.search).get("embed")==="1")location.replace("./assessment.html"+location.search+location.hash);else if(!location.hash)location.replace("./home.html")</script>');
          fs.writeFileSync(path.join(output, "aic/index.html"), competition);
          writeCompetitionAssets(output);
          writeCompetitionHome(output);
        },
      },
      cesium({
        rebuildCesium: true,
      }),
      {
        name: 'release-build-manifest',
        closeBundle: {
          order: 'post',
          sequential: true,
          handler() {
            writeBuildManifest(path.resolve(__dirname, process.env.VITE_OUTPUT_DIR || 'dist'), { base });
          },
        },
      },
    ],
    build: {
      outDir: process.env.VITE_OUTPUT_DIR || 'dist',
      target: "esnext",
      sourcemap: false,
      rollupOptions: { input: { main: path.resolve(__dirname, "index.html"), legacy: path.resolve(__dirname, "legacy.html") } },
    },
    server: {
      port: 5173,
      watch: { ignored: ["**/output/**", "**/.playwright-cli/**"] },
      proxy: {
        "/author": { target: process.env.VITE_BLOG_TARGET || "http://127.0.0.1:4321", changeOrigin: true },
        "/tiles": { target: "https://weather.nogamenolife.cn", changeOrigin: true },
        "/data": { target: "https://weather.nogamenolife.cn/decision", changeOrigin: true,
          bypass(req) { if (['/data/campus-streets.geojson','/data/campus-lcz-simulation.geojson','/data/neighborhood-buildings.geojson','/data/neighborhood-streets.geojson','/data/neighborhood-landcover.geojson'].includes(req.url?.split('?')[0] || '')) return req.url; },
        },
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
        "/api": { target: "https://weather.nogamenolife.cn", changeOrigin: true },
      },
    },
  };
});
