import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "MD_OPS_");
  const target = env.MD_OPS_DEV_API_URL?.trim();
  const proxy = target
    ? {
        "/api": { target, changeOrigin: true },
        "/health": { target, changeOrigin: true },
      }
    : undefined;

  return {
    base: "./",
    plugins: [react()],
    server: { port: 5174, proxy },
  };
});
