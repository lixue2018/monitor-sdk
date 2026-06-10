import { ErrorMonitor } from './monitors/errorMonitor';
import { PerformanceMonitor } from './monitors/performanceMonitor';
import { ResourceMonitor } from './monitors/resourceMonitor';
import { RecordScreenMonitor } from './monitors/recordScreenMonitor';
import { WhiteScreenMonitor } from './monitors/whiteScreenMonitor';
import { Reporter } from './reporters/reporter';
import type { MonitorConfig, RecordScreenRouterBridge } from './types';

export class MonitorCore {
  private reporter: Reporter;
  private errorMonitor?: ErrorMonitor;
  private resourceMonitor?: ResourceMonitor;
  private performanceMonitor?: PerformanceMonitor;
  private whiteScreenMonitor?: WhiteScreenMonitor;
  private recordScreenMonitor?: RecordScreenMonitor;
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
      pauseOnReportFailure: config.pauseOnReportFailure,
      userIdStorageKeys: config.userIdStorageKeys,
    });

    if (!this.enabled) return;

    if (config.enableErrorTracking !== false) {
      this.errorMonitor = new ErrorMonitor(this.reporter, config.ignoreErrors);
      this.errorMonitor.init();
    }

    if (config.enableResourceTracking !== false) {
      this.resourceMonitor = new ResourceMonitor(this.reporter, {
        slowApiThreshold: config.slowApiThreshold,
        enableSlowApiTracking: config.enableSlowApiTracking,
        apiTrackUrlPatterns: config.apiTrackUrlPatterns,
      });
      this.resourceMonitor.init();
    }

    if (config.enablePerformance !== false) {
      this.performanceMonitor = new PerformanceMonitor(this.reporter);
      this.performanceMonitor.init();
    }

    if (config.enableWhiteScreen) {
      this.whiteScreenMonitor = new WhiteScreenMonitor(this.reporter, {
        whiteBoxElements: config.whiteBoxElements,
        initialDelay: config.whiteScreenInitialDelay,
        checkInterval: config.whiteScreenCheckInterval,
      });
      this.whiteScreenMonitor.init();
    }

    if (config.enableRecordScreen) {
      const recordSample = config.debug
        ? 1
        : (config.recordScreenSampleRate ?? 0.1);
      const recordSampledIn = Math.random() <= recordSample;
      if (recordSampledIn) {
        this.recordScreenMonitor = new RecordScreenMonitor(this.reporter, {
          recordScreenTime: config.recordScreenTime,
          recordScreenTypeList: config.recordScreenTypeList,
          maskAllInputs: config.recordScreenMaskAllInputs,
          recordCanvas: config.recordScreenCanvas,
          debug: config.debug,
        });
        this.recordScreenMonitor.init();
        console.info('[MonitorX] 录屏已开启', `sampleRate=${recordSample}，mount 后启动 rrweb`);
      } else {
        console.info(
          '[MonitorX] 录屏未命中采样',
          `sampleRate=${recordSample}，刷新页面可重试`,
        );
      }
    } else {
      console.info('[MonitorX] 录屏未开启', 'enableRecordScreen=false');
    }
  }

  /** Vue 根组件 mount 后启动录屏（等路由就绪与业务 DOM 渲染） */
  onAppMounted(router?: RecordScreenRouterBridge): void {
    this.recordScreenMonitor?.startAfterMount('vue-mount', router);
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

  /** 立即执行白屏采样，命中则上报 */
  checkWhiteScreen(): boolean {
    if (!this.enabled || !this.whiteScreenMonitor) return false;
    return this.whiteScreenMonitor.checkNow();
  }

  /** 开发模拟：直接上报一条 whiteScreen */
  reportWhiteScreen(reason?: string): void {
    if (!this.enabled) return;
    if (this.whiteScreenMonitor) {
      this.whiteScreenMonitor.reportManual(reason);
      return;
    }
    this.reporter.send('whiteScreen', {
      type: 'whiteScreen',
      category: 'whiteScreen',
      message: reason || '手动上报白屏',
      timestamp: Date.now(),
      pageUrl: window.location.href,
      userAgent: navigator.userAgent,
    });
  }
}
