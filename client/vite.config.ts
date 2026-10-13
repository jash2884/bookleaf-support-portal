import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the SPA and API share an origin through this proxy, so the
// httpOnly session cookie and EventSource (SSE) work exactly as in production,
// where Express serves the built SPA itself.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:4000", changeOrigin: false },
    },
  },
});
