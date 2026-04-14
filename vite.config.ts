import { defineConfig } from "vite";
import cesium from "vite-plugin-cesium";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  plugins: [
    // Cesium 插件：自动处理 Worker 文件路径与静态资源
    cesium(),
  ],
  build: {
    target: "esnext",
  },
  server: {
    port: 3000,
    open: true,
  },
});
