import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The backend runs on :8000. We proxy /api and /media so the frontend can use
// same-origin relative URLs in dev.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/media": "http://127.0.0.1:8000",
    },
  },
});
