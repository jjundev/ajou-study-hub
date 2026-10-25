import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  root,
  publicDir: resolve(root, '.generated/content'),
  // These are atomic build/report outputs, never development source inputs.
  // Watching them holds Windows directory handles during staged renames.
  server: { watch: { ignored: ['**/.generated/bootstrap-tests/**', '**/.reports/**'] } },
  build: { outDir: resolve(root, 'dist'), emptyOutDir: true },
});
