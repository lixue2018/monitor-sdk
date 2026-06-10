import {
  MonitorCore,
  type MonitorConfig,
  type RecordScreenRouterBridge,
} from '@lixue2018/monitorx-core';
import type { App, Plugin } from 'vue';
import { enrichVueErrorReport } from './enrichVueError';
import { getSharedMonitor, setSharedMonitor } from './globalMonitor';
import { vMonitor } from './directive';

export { useMonitor } from './useMonitor';
export { vMonitor } from './directive';
export { MonitorCore } from '@lixue2018/monitorx-core';
export type { MonitorConfig } from '@lixue2018/monitorx-core';

type Vue2Constructor = {
  prototype: Record<string, unknown>;
  config: { errorHandler?: (err: Error, vm: unknown, info: string) => void };
  directive: (name: string, dir: unknown) => void;
  version?: string;
};

function isVue3App(target: App | Vue2Constructor): target is App {
  return typeof (target as App).provide === 'function';
}

function createVuePlugin(monitor: MonitorCore): Plugin {
  return {
    install(appOrVue: App | Vue2Constructor) {
      setSharedMonitor(monitor);

      if (isVue3App(appOrVue)) {
        const app = appOrVue;
        app.config.globalProperties.$monitor = monitor;
        app.provide('monitor', monitor);

        const originalMount = app.mount.bind(app);
        app.mount = (container) => {
          const instance = originalMount(container);
          const router = app.config.globalProperties.$router as
            | RecordScreenRouterBridge
            | undefined;
          void monitor.onAppMounted(router);
          return instance;
        };

        const originalErrorHandler = app.config.errorHandler;
        app.config.errorHandler = (err: unknown, vm: unknown, info: string) => {
          const error = err instanceof Error ? err : new Error(String(err));
          monitor.reportError(enrichVueErrorReport(error, info));
          if (originalErrorHandler) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (originalErrorHandler as (err: unknown, vm: unknown, info: string) => void)(err, vm, info);
          }
        };

        app.directive('monitor', vMonitor);
        return;
      }

      const Vue = appOrVue;
      Vue.prototype.$monitor = monitor;

      const originalErrorHandler = Vue.config.errorHandler;
      Vue.config.errorHandler = (err: Error, vm: unknown, info: string) => {
        monitor.reportError(enrichVueErrorReport(err, info));
        if (originalErrorHandler) originalErrorHandler(err, vm, info);
      };

      Vue.directive('monitor', {
        bind(el: HTMLElement, binding: { arg?: string; value?: unknown }) {
          const eventName = binding.arg || 'click';
          el.addEventListener(eventName, () => {
            monitor.reportEvent({
              type: 'user_action',
              event: eventName,
              target: binding.value,
              timestamp: Date.now(),
              pageUrl: window.location.href,
            });
          });
        },
      });
    },
  };
}

export default function createMonitor(config: MonitorConfig): Plugin & { monitor: MonitorCore } {
  const monitor = new MonitorCore(config);
  const plugin = createVuePlugin(monitor) as Plugin & { monitor: MonitorCore };
  plugin.monitor = monitor;
  return plugin;
}

export function getMonitorInstance(): MonitorCore | null {
  return getSharedMonitor();
}
