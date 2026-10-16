import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiTarget = process.env.API_PROXY_TARGET ?? "http://127.0.0.1:3000";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../dist/public",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/accounts": apiTarget,
      "/account": apiTarget,
      "/me": apiTarget,
      "/plans": apiTarget,
      "/users": apiTarget,
      "/usage": apiTarget,
      "/health": apiTarget
    }
  }
});
