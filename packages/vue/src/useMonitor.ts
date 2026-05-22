import { getCurrentInstance, inject } from 'vue';
import type { MonitorCore } from '@lixue2018/monitorx-core';
import { getSharedMonitor } from './globalMonitor';

export function useMonitor(): MonitorCore | null {
  const injected = inject<MonitorCore | null>('monitor', null);
  if (injected) return injected;

  const instance = getCurrentInstance();
  const proxy = instance?.proxy as { $monitor?: MonitorCore } | null;
  if (proxy?.$monitor) return proxy.$monitor;

  return getSharedMonitor();
}
