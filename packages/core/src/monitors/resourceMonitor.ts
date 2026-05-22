import type { ApiErrorData, ResourceErrorData } from '../types';
import type { Reporter } from '../reporters/reporter';

interface MonitorXHR extends XMLHttpRequest {
  _monitorData?: { method: string; url: string; startTime: number };
}

export class ResourceMonitor {
  private reporter: Reporter;

  constructor(reporter: Reporter) {
    this.reporter = reporter;
  }

  init(): void {
    window.addEventListener('error', this.handleResourceError.bind(this), true);
    this.observePerformanceEntries();
    this.hijackXHR();
    this.hijackFetch();
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

    const reportData: ResourceErrorData = {
      type: 'resource_error',
      resourceUrl,
      resourceType,
      errorMessage: `Failed to load ${resourceType}: ${resourceUrl}`,
      timestamp: Date.now(),
      pageUrl: window.location.href,
    };

    this.reporter.send('resource_error', reportData as unknown as Record<string, unknown>);
  }

  private observePerformanceEntries(): void {
    if (!window.PerformanceObserver) return;

    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType !== 'resource') continue;
          const res = entry as PerformanceResourceTiming;
          if (res.transferSize === 0 && res.decodedBodySize === 0 && res.duration > 0) {
            this.reporter.send('resource_error', {
              type: 'resource_error',
              resourceUrl: res.name,
              resourceType: 'other',
              errorMessage: `Resource may have failed: ${res.name}`,
              timestamp: Date.now(),
              pageUrl: window.location.href,
            } as unknown as Record<string, unknown>);
          }
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
      this.addEventListener('loadend', function (this: MonitorXHR) {
        if (!this._monitorData || this.status < 400) return;

        const reportData: ApiErrorData = {
          type: 'api_error',
          url: this._monitorData.url,
          method: this._monitorData.method,
          status: this.status,
          duration: Date.now() - this._monitorData.startTime,
          timestamp: Date.now(),
          pageUrl: window.location.href,
        };
        self.reporter.send('api_error', reportData as unknown as Record<string, unknown>);
      });

      return originalSend.call(this, body);
    };
  }

  private hijackFetch(): void {
    const originalFetch = window.fetch.bind(window);
    const self = this;

    window.fetch = async function (...args: Parameters<typeof fetch>) {
      const startTime = Date.now();
      const input = args[0];
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

      try {
        const response = await originalFetch(...args);
        if (!response.ok) {
          const reportData: ApiErrorData = {
            type: 'api_error',
            url,
            status: response.status,
            duration: Date.now() - startTime,
            timestamp: Date.now(),
            pageUrl: window.location.href,
          };
          self.reporter.send('api_error', reportData as unknown as Record<string, unknown>);
        }
        return response;
      } catch (error) {
        const reportData: ApiErrorData = {
          type: 'api_error',
          url,
          errorMessage: error instanceof Error ? error.message : String(error),
          duration: Date.now() - startTime,
          timestamp: Date.now(),
          pageUrl: window.location.href,
        };
        self.reporter.send('api_error', reportData as unknown as Record<string, unknown>);
        throw error;
      }
    };
  }
}
