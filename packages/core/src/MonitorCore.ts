import { ErrorMonitor } from './monitors/errorMonitor';
import { PerformanceMonitor } from './monitors/performanceMonitor';
import { ResourceMonitor } from './monitors/resourceMonitor';
import { Reporter } from './reporters/reporter';
import type { MonitorConfig } from './types';

export class MonitorCore {
  private reporter: Reporter;
  private errorMonitor?: ErrorMonitor;
  private resourceMonitor?: ResourceMonitor;
  private performanceMonitor?: PerformanceMonitor;
  private enabled: boolean;

  constructor(config: MonitorConfig) {
    const sampleRate = config.sampleRate ?? 1;
    this.enabled = Math.random() <= sampleRate;

    this.reporter = new Reporter({
      endpoint: config.endpoint,
      appKey: config.appKey,
      batchSize: config.batchSize,
      batchInterval: config.batchInterval,
      useBeacon: config.useBeacon,
      debug: config.debug,
    });

    if (!this.enabled) return;

    if (config.enableErrorTracking !== false) {
      this.errorMonitor = new ErrorMonitor(this.reporter, config.ignoreErrors);
      this.errorMonitor.init();
    }

    if (config.enableResourceTracking !== false) {
      this.resourceMonitor = new ResourceMonitor(this.reporter);
      this.resourceMonitor.init();
    }

    if (config.enablePerformance !== false) {
      this.performanceMonitor = new PerformanceMonitor(this.reporter);
      this.performanceMonitor.init();
    }
  }

  reportError(data: Record<string, unknown>): void {
    if (!this.enabled) return;
    this.reporter.send('js_error', {
      timestamp: Date.now(),
      pageUrl: window.location.href,
      userAgent: navigator.userAgent,
      ...data,
    });
  }

  reportEvent(data: Record<string, unknown>): void {
    if (!this.enabled) return;
    this.reporter.send('custom_event', {
      timestamp: Date.now(),
      pageUrl: window.location.href,
      ...data,
    });
  }

  reportPerformance(data: Record<string, unknown>): void {
    if (!this.enabled) return;
    if (this.performanceMonitor && typeof data === 'object') {
      const { name, value } = data as { name?: string; value?: number };
      if (name != null && value != null) {
        this.performanceMonitor.reportCustomMetric(name, value);
        return;
      }
    }
    this.reporter.send('performance', {
      timestamp: Date.now(),
      pageUrl: window.location.href,
      ...data,
    });
  }

  reportPageView(data: Record<string, unknown> = {}): void {
    if (!this.enabled) return;
    this.reporter.send('page_view', {
      timestamp: Date.now(),
      pageUrl: window.location.href,
      ...data,
    });
  }

  setUserId(userId: string): void {
    if (!this.enabled) return;
    this.reporter.setUserId(userId);
  }
}
