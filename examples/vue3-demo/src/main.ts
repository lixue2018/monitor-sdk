import { createApp } from 'vue';
import App from './App.vue';
import createMonitor from '@lixue2018/monitorx-vue';

const app = createApp(App);

app.use(
  createMonitor({
    appKey: import.meta.env.VITE_MONITOR_APP_KEY || 'demo_app_key',
    endpoint: import.meta.env.VITE_MONITOR_ENDPOINT || '/monitor-api/reportData',
    debug: import.meta.env.DEV,
    enablePerformance: true,
    enableErrorTracking: true,
    enableResourceTracking: true,
    sampleRate: 1,
    ignoreErrors: [/Script error\.?/, /ResizeObserver loop/],
  }),
);

app.mount('#app');
