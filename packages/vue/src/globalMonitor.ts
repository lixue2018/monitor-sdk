import type { MonitorCore } from '@lixue2018/monitorx-core';

let sharedMonitor: MonitorCore | null = null;

export function setSharedMonitor(monitor: MonitorCore): void {
  sharedMonitor = monitor;
}

export function getSharedMonitor(): MonitorCore | null {
  return sharedMonitor;
}
