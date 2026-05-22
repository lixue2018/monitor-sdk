import type { MonitorCore } from '@lixue2018/monitorx-core';

declare module 'vue' {
  interface ComponentCustomProperties {
    $monitor: MonitorCore;
  }
}
