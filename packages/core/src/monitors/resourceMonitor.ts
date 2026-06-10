import type { ApiErrorData, ApiSlowData, ResourceErrorData } from '../types';
import type { Reporter } from '../reporters/reporter';
import {
  buildApiErrorReport,
  formatRequestBody,
  readFetchResponseBody,
  readXhrResponseBody,
} from '../utils/apiErrorPayload';
import { createApiUrlMatcher } from '../utils/apiUrlFilter';
import { resolveSlowApiLevel, SLOW_API_LEVEL_LABELS } from '../utils/slowApiLevel';

interface MonitorXHR extends XMLHttpRequest {
  _monitorData?: { method: string; url: string; startTime: number; requestBody?: string };
}

export interface ResourceMonitorOptions {
  /** 慢接口阈值（毫秒），默认 1000 */
  slowApiThreshold?: number;
  enableSlowApiTracking?: boolean;
  /** 仅采集匹配的 HTTP 接口 */
  apiTrackUrlPatterns?: (string | RegExp)[];
}

const DEFAULT_SLOW_THRESHOLD = 1000;

export class ResourceMonitor {
  private reporter: Reporter;
  private slowApiThreshold: number;
  private enableSlowApiTracking: boolean;
  private shouldTrackApiUrl: (url: string) => boolean;

  constructor(reporter: Reporter, options: ResourceMonitorOptions = {}) {
    this.reporter = reporter;
    this.slowApiThreshold = options.slowApiThreshold ?? DEFAULT_SLOW_THRESHOLD;
    this.enableSlowApiTracking = options.enableSlowApiTracking !== false;
    this.shouldTrackApiUrl = createApiUrlMatcher({
      apiTrackUrlPatterns: options.apiTrackUrlPatterns,
    });
  }

  init(): void {
    window.addEventListener('error', this.handleResourceError.bind(this), true);
    this.observePerformanceEntries();
    this.hijackXHR();
    this.hijackFetch();
  }

  private maybeReportSlowApi(payload: {
    url: string;
    method?: string;
    status?: number;
    duration: number;
  }): void {
    if (!this.enableSlowApiTracking) return;
    if (!this.shouldTrackApiUrl(payload.url)) return;
    if (payload.duration < this.slowApiThreshold) return;

    const slowLevel = resolveSlowApiLevel(payload.duration);
    if (!slowLevel) return;

    const slowLevelLabel = SLOW_API_LEVEL_LABELS[slowLevel];
    const reportData: ApiSlowData = {
      type: 'api_slow',
      url: payload.url,
      method: payload.method,
      status: payload.status,
      duration: payload.duration,
      threshold: this.slowApiThreshold,
      slowLevel,
      slowLevelLabel,
      message: `${slowLevelLabel}：${payload.method || 'GET'} ${payload.url}，耗时 ${payload.duration}ms`,
      timestamp: Date.now(),
      pageUrl: window.location.href,
    };
    this.reporter.send('api_slow', reportData as unknown as Record<string, unknown>);
  }

  private maybeReportApiError(data: ApiErrorData): void {
    if (!this.shouldTrackApiUrl(data.url || '')) return;
    this.reporter.send(
      'api_error',
      buildApiErrorReport(data) as unknown as Record<string, unknown>,
    );
  }

  private handleResourceError(event: ErrorEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target || target === (window as unknown as HTMLElement)) return;

    const tagName = target.tagName?.toLowerCase();
    const resourceTags = ['script', 'link', 'img', 'video', 'audio'];
    if (!tagName || !resourceTags.includes(tagName)) return;

    let resourceUrl = '';
    let resourceType: ResourceErrorData['resourceType'] = 'other';

    switch (tagName) {
      case 'script':
        resourceUrl = (target as HTMLScriptElement).src;
        resourceType = 'script';
        break;
      case 'link':
        resourceUrl = (target as HTMLLinkElement).href;
        resourceType = 'link';
        break;
      case 'img':
        resourceUrl = (target as HTMLImageElement).src;
        resourceType = 'img';
        break;
      case 'video':
      case 'audio':
        resourceUrl = (target as HTMLMediaElement).src;
        resourceType = 'media';
        break;
    }

    if (!resourceUrl) return;
    if (/reportData|monitor-api/i.test(resourceUrl)) return;

    const reportData: ResourceErrorData = {
      type: 'resource_error',
      category: resourceType,
      resourceUrl,
      resourceType,
      errorMessage: `Failed to load ${resourceType}: ${resourceUrl}`,
      timestamp: Date.now(),
      pageUrl: window.location.href,
    };

    this.reporter.send('resource_error', reportData as unknown as Record<string, unknown>);
  }

  /**
   * 仅在有明确 HTTP 失败状态时上报。不用 transferSize/decodedBodySize 猜测：
   * 二者均为 0 常见于缓存命中、跨域无 Timing-Allow-Origin，并非加载失败。
   */
  private isHttpResourceFailure(res: PerformanceResourceTiming): boolean {
    const status = res.responseStatus;
    return status !== undefined && status > 0 && status >= 400;
  }

  private observePerformanceEntries(): void {
    if (!window.PerformanceObserver) return;

    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType !== 'resource') continue;
          const res = entry as PerformanceResourceTiming;
          if (/reportData|monitor-api/i.test(res.name)) continue;
          if (!this.isHttpResourceFailure(res)) continue;

          this.reporter.send('resource_error', {
            type: 'resource_error',
            category: 'other',
            resourceUrl: res.name,
            resourceType: 'other',
            errorMessage: `Resource HTTP ${res.responseStatus}: ${res.name}`,
            timestamp: Date.now(),
            pageUrl: window.location.href,
          } as unknown as Record<string, unknown>);
        }
      });
      observer.observe({ type: 'resource', buffered: true });
    } catch {
      // 部分浏览器不支持 resource 类型
    }
  }

  private hijackXHR(): void {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    const self = this;

    XMLHttpRequest.prototype.open = function (
      this: MonitorXHR,
      method: string,
      url: string | URL,
      ...args: unknown[]
    ) {
      this._monitorData = {
        method,
        url: url.toString(),
        startTime: Date.now(),
      };
      return originalOpen.apply(this, [method, url, ...args] as Parameters<typeof originalOpen>);
    };

    XMLHttpRequest.prototype.send = function (this: MonitorXHR, body?: Document | XMLHttpRequestBodyInit | null) {
      if (this._monitorData) {
        this._monitorData.requestBody = formatRequestBody(body);
      }

      this.addEventListener('loadend', function (this: MonitorXHR) {
        if (!this._monitorData) return;

        const duration = Date.now() - this._monitorData.startTime;
        const { url, method } = this._monitorData;

        self.maybeReportSlowApi({ url, method, status: this.status, duration });

        if (this.status < 400) return;

        self.maybeReportApiError({
          url,
          method,
          status: this.status,
          duration,
          requestBody: this._monitorData?.requestBody,
          response: readXhrResponseBody(this),
          pageUrl: window.location.href,
        } as ApiErrorData);
      });

      return originalSend.call(this, body);
    };
  }

  private resolveFetchMethod(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): string {
    if (init?.method) return init.method.toUpperCase();
    if (input instanceof Request) return input.method.toUpperCase();
    return 'GET';
  }

  private hijackFetch(): void {
    const originalFetch = window.fetch.bind(window);
    const self = this;

    window.fetch = async function (...args: Parameters<typeof fetch>) {
      const input = args[0];
      const init = args[1];
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

      // 监控自身上报不走劫持，避免 initiator 误导、重复处理与大包延迟
      if (/reportData|monitor-api/i.test(url)) {
        return originalFetch(...args);
      }

      const startTime = Date.now();
      const method = self.resolveFetchMethod(input, init);

      try {
        const response = await originalFetch(...args);
        const duration = Date.now() - startTime;

        self.maybeReportSlowApi({ url, method, status: response.status, duration });

        if (!response.ok) {
          const responseBody = await readFetchResponseBody(response);
          self.maybeReportApiError({
            url,
            method,
            status: response.status,
            duration,
            requestBody: formatRequestBody(init?.body),
            response: responseBody,
            pageUrl: window.location.href,
          } as ApiErrorData);
        }
        return response;
      } catch (error) {
        const duration = Date.now() - startTime;
        self.maybeReportSlowApi({ url, method, duration });

        self.maybeReportApiError({
          url,
          method,
          status: 0,
          requestBody: formatRequestBody(init?.body),
          errorMessage: error instanceof Error ? error.message : String(error),
          duration,
          pageUrl: window.location.href,
        } as ApiErrorData);
        throw error;
      }
    };
  }
}
