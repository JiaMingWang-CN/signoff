import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "VITE_");
  const proxy = {
    "/api": {
      target: env.VITE_API_PROXY_TARGET || "http://127.0.0.1:8000",
      changeOrigin: true,
      xfwd: true,
    },
  };
  const host = env.VITE_HOST || "127.0.0.1";
  const port = Number(env.VITE_PORT || 5173);
  return {
    plugins: [react(), tailwindcss()],
    server: { host, port, strictPort: true, proxy },
    preview: { host, port, strictPort: true, proxy },
  };
});
