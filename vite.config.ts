import { defineConfig } from 'vite';
export default defineConfig({ publicDir: '.generated/content', build: { outDir: 'dist', emptyOutDir: true } });
