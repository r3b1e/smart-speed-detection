import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Same-origin dev proxy keeps the refresh cookie, frame images and Socket.IO
// free of CORS / Cross-Origin-Resource-Policy problems in development.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    environmentOptions: { jsdom: { url: "http://localhost:3000" } },
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:4000", changeOrigin: false },
      "/socket.io": { target: "http://localhost:4000", ws: true, changeOrigin: false },
    },
  },
  preview: {
    port: 4173,
  },
});
