import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({ root, publicDir: resolve(root, '.generated/content'), build: { outDir: resolve(root, 'dist'), emptyOutDir: true } });
