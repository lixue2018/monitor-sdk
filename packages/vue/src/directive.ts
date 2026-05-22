import type { Directive } from 'vue';
import type { MonitorCore } from '@lixue2018/monitorx-core';
import { getSharedMonitor } from './globalMonitor';

function resolveMonitor(el: HTMLElement, instance: unknown): MonitorCore | null {
  const vm = instance as { $monitor?: MonitorCore; proxy?: { $monitor?: MonitorCore } } | null;
  return vm?.$monitor ?? vm?.proxy?.$monitor ?? getSharedMonitor();
}

export const vMonitor: Directive<HTMLElement, string | Record<string, unknown>> = {
  mounted(el, binding) {
    const eventName = (binding.arg as string) || 'click';
    const handler = () => {
      const monitor = resolveMonitor(el, binding.instance);
      if (!monitor) return;

      monitor.reportEvent({
        type: 'user_action',
        event: eventName,
        target: binding.value,
        timestamp: Date.now(),
        pageUrl: window.location.href,
      });
    };
    el.addEventListener(eventName, handler);
    (el as HTMLElement & { __monitorHandler__?: EventListener }).__monitorHandler__ = handler;
  },
  unmounted(el, binding) {
    const eventName = (binding.arg as string) || 'click';
    const handler = (el as HTMLElement & { __monitorHandler__?: EventListener }).__monitorHandler__;
    if (handler) el.removeEventListener(eventName, handler);
  },
};
