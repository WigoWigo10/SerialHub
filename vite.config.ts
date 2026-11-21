import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    cors: false,
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  preview: {
    host: "127.0.0.1",
  },
}));
