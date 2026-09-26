import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  root: "web",
  plugins: [react()],
  // Only dist/web is emptied; dist/cli.js and the native app live beside it.
  build: { outDir: "../dist/web", emptyOutDir: true },
  server: { host: "127.0.0.1" },
});
