import { defineConfig } from "vite";
import cesium from "vite-plugin-cesium";
import path from "path";

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
          target: "http://localhost:3000",
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
