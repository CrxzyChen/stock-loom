import {defineConfig} from 'vite';
import vue from '@vitejs/plugin-vue';
import {fileURLToPath} from 'node:url';
export default defineConfig({
  root:fileURLToPath(new URL('./src/renderer',import.meta.url)),
  base:'./', plugins:[vue()],
  server:{port:5173,strictPort:true,host:'127.0.0.1'},
  build:{outDir:fileURLToPath(new URL('../../dist/renderer',import.meta.url)),emptyOutDir:false}
});
