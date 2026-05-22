import type { PerformanceData } from '../types';
import type { Reporter } from '../reporters/reporter';

export class PerformanceMonitor {
  private reporter: Reporter;
  private currentMetrics: Partial<PerformanceData> = {};
  private clsValue = 0;
  private reported = false;

  constructor(reporter: Reporter) {
    this.reporter = reporter;
  }

  init(): void {
    this.collectNavigationTiming();
    this.observePaintTiming();
    this.collectWebVitals();

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.collectPaintTiming());
    } else {
      this.collectPaintTiming();
    }

    window.addEventListener('load', () => {
      this.collectNavigationTiming();
      this.collectPaintTiming();
    });

    window.addEventListener('beforeunload', () => this.reportMetrics());
    window.addEventListener('pagehide', () => this.reportMetrics());

    setTimeout(() => this.reportMetrics(), 15000);
  }

  private collectMetrics(): void {
    this.collectNavigationTiming();
    this.collectPaintTiming();
  }

  private collectNavigationTiming(): void {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (nav) {
      this.currentMetrics = {
        ...this.currentMetrics,
        redirectTime: nav.redirectEnd - nav.redirectStart,
        dnsTime: nav.domainLookupEnd - nav.domainLookupStart,
        tcpTime: nav.connectEnd - nav.connectStart,
        ttfb: nav.responseStart - nav.startTime,
        domReady: nav.domContentLoadedEventEnd - nav.startTime,
        loadTime: nav.loadEventEnd - nav.startTime,
      };
      return;
    }

    const timing = performance.timing;
    if (!timing) return;

    this.currentMetrics = {
      ...this.currentMetrics,
      redirectTime: timing.redirectEnd - timing.redirectStart,
      dnsTime: timing.domainLookupEnd - timing.domainLookupStart,
      tcpTime: timing.connectEnd - timing.connectStart,
      ttfb: timing.responseStart - timing.navigationStart,
      domReady: timing.domContentLoadedEventEnd - timing.navigationStart,
      loadTime: timing.loadEventEnd - timing.navigationStart,
    };
  }

  /** 通过 Observer 捕获 FP/FCP（支持 buffered，避免 SDK 初始化晚于首屏绘制） */
  private observePaintTiming(): void {
    if (!window.PerformanceObserver) return;

    try {
      const paintObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name === 'first-paint') this.currentMetrics.fp = entry.startTime;
          if (entry.name === 'first-contentful-paint') {
            this.currentMetrics.fcp = entry.startTime;
          }
        }
      });
      paintObserver.observe({ type: 'paint', buffered: true } as PerformanceObserverInit);
    } catch {
      // 部分环境不支持 paint 类型
    }
  }

  private collectPaintTiming(): void {
    const paintEntries = performance.getEntriesByType('paint');
    for (const entry of paintEntries) {
      if (entry.name === 'first-paint') this.currentMetrics.fp = entry.startTime;
      if (entry.name === 'first-contentful-paint') this.currentMetrics.fcp = entry.startTime;
    }

    const fcpByName = performance.getEntriesByName('first-contentful-paint')[0];
    if (fcpByName && this.currentMetrics.fcp == null) {
      this.currentMetrics.fcp = fcpByName.startTime;
    }
    const fpByName = performance.getEntriesByName('first-paint')[0];
    if (fpByName && this.currentMetrics.fp == null) {
      this.currentMetrics.fp = fpByName.startTime;
    }
  }

  private collectWebVitals(): void {
    if (!window.PerformanceObserver) return;

    try {
      const lcpObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const lastEntry = entries[entries.length - 1];
        if (lastEntry) this.currentMetrics.lcp = lastEntry.startTime;
      });
      lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true } as PerformanceObserverInit);
    } catch {
      // unsupported
    }

    try {
      const fidObserver = new PerformanceObserver((list) => {
        const firstEntry = list.getEntries()[0] as PerformanceEventTiming | undefined;
        if (firstEntry) {
          this.currentMetrics.fid = firstEntry.processingStart - firstEntry.startTime;
          fidObserver.disconnect();
        }
      });
      fidObserver.observe({ type: 'first-input', buffered: true } as PerformanceObserverInit);
    } catch {
      // unsupported
    }

    try {
      let sessionValue = 0;
      const clsObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & { hadRecentInput?: boolean; value?: number })[]) {
          if (!entry.hadRecentInput && entry.value != null) {
            sessionValue += entry.value;
            this.clsValue = Math.max(this.clsValue, sessionValue);
            this.currentMetrics.cls = this.clsValue;
          }
        }
      });
      clsObserver.observe({ type: 'layout-shift', buffered: true } as PerformanceObserverInit);
    } catch {
      // unsupported
    }
  }

  reportMetrics(): void {
    if (this.reported) return;

    this.collectNavigationTiming();
    this.collectPaintTiming();

    const keys = Object.keys(this.currentMetrics).filter((k) => this.currentMetrics[k as keyof PerformanceData] != null);
    if (keys.length === 0) return;

    this.reported = true;
    const payload: PerformanceData = {
      type: 'performance',
      ...this.currentMetrics,
      timestamp: Date.now(),
      pageUrl: window.location.href,
    };
    this.reporter.send('performance', payload as unknown as Record<string, unknown>);
  }

  reportCustomMetric(name: string, value: number): void {
    this.reporter.send('performance', {
      type: 'performance',
      [name]: value,
      timestamp: Date.now(),
      pageUrl: window.location.href,
    });
  }
}
