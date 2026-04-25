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
    cesium(),
  ],
  build: {
    target: "esnext",
  },
  server: {
    port: 5173,
    proxy: {
      "/api/simulation": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/api/weather": {
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
});
