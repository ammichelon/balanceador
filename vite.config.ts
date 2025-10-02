import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "ammichelon/balanceador/",   // <= coloque o NOME do repositório
});
