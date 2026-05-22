import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@lixue2018/monitorx-core': resolve(__dirname, '../../packages/core/src/index.ts'),
      '@lixue2018/monitorx-vue': resolve(__dirname, '../../packages/vue/src/index.ts'),
    },
  },
  server: {
    port: 5180,
  },
});
