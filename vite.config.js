import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Funciona tanto en local como en GitHub Pages, aunque cambies el nombre del repo.
  base: "./",
});
