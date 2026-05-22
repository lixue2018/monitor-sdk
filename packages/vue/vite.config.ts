import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'MonitorXVue',
      formats: ['es', 'cjs', 'umd'],
      fileName: (format) => {
        if (format === 'es') return 'index.esm.js';
        if (format === 'cjs') return 'index.cjs.js';
        return 'index.umd.js';
      },
    },
    rollupOptions: {
      external: ['vue', '@lixue2018/monitorx-core'],
      output: {
        globals: {
          vue: 'Vue',
          '@lixue2018/monitorx-core': 'MonitorXCore',
        },
        // 保留外部依赖的导入语句
        preserveModules: false
      },
    },
    sourcemap: true,
    minify: 'esbuild',
  },
  plugins: [dts({ insertTypesEntry: true, rollupTypes: true })],
});
