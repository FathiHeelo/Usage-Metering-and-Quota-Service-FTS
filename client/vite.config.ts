import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../dist/public",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/accounts": "http://127.0.0.1:3000",
      "/account": "http://127.0.0.1:3000",
      "/me": "http://127.0.0.1:3000",
      "/plans": "http://127.0.0.1:3000",
      "/users": "http://127.0.0.1:3000",
      "/usage": "http://127.0.0.1:3000",
      "/health": "http://127.0.0.1:3000"
    }
  }
});
