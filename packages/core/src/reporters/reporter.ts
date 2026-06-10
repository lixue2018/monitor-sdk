import type { ReporterConfig } from '../types';
import { applyRecordScreenToReport } from '../utils/recordScreenState';
import { sanitizeReportPayload } from '../utils/truncateReportText';

export class Reporter {
  private queue: Record<string, unknown>[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sessionId: string;
  private userId: string;
  /** 暂停自动 flush（仍入队），避免 503 等失败时反复请求 */
  private flushPaused = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private config: Required<Pick<ReporterConfig, 'batchSize' | 'batchInterval' | 'useBeacon'>> &
    ReporterConfig;

  constructor(config: ReporterConfig) {
    this.config = {
      batchSize: 10,
      batchInterval: 3000,
      useBeacon: true,
      pauseOnReportFailure: true,
      ...config,
    };
    this.sessionId = this.generateSessionId();
    this.userId = this.getUserId();

    window.addEventListener('beforeunload', () => this.flush(true));
  }

  private generateSessionId(): string {
    let id = sessionStorage.getItem('__monitor_session_id__');
    if (!id) {
      id = `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
      sessionStorage.setItem('__monitor_session_id__', id);
    }
    return id;
  }

  private getUserId(): string {
    const keys = this.config.userIdStorageKeys ?? ['itCode', '__monitor_user_id__'];
    for (const key of keys) {
      const value = localStorage.getItem(key)?.trim();
      if (value) {
        if (key !== '__monitor_user_id__') {
          localStorage.setItem('__monitor_user_id__', value);
        }
        return value;
      }
    }
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    localStorage.setItem('__monitor_user_id__', id);
    return id;
  }

  private pauseFlush(reason: string, options?: { retryMs?: number }): void {
    this.flushPaused = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.config.debug) {
      console.warn('[MonitorX] 上报通道暂不可用，已保留队列:', reason);
    }
    const retryMs = options?.retryMs;
    if (retryMs != null && retryMs > 0) {
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.flushPaused = false;
        this.flush();
      }, retryMs);
    }
  }

  isPaused(): boolean {
    return this.flushPaused;
  }

  private enrichData(data: Record<string, unknown>): Record<string, unknown> {
    return sanitizeReportPayload({
      ...data,
      app_key: this.config.appKey,
      apikey: this.config.appKey, // 与 fe-monitor-server 字段一致
      session_id: this.sessionId,
      user_id: this.userId,
      userId: this.userId,
      screen_resolution: `${window.screen.width}x${window.screen.height}`,
      language: navigator.language,
      timestamp: data.timestamp ?? Date.now(),
    });
  }

  send(type: string, data: Record<string, unknown>): void {
    if (type === 'recordScreen') {
      void this.sendRecordScreen(data);
      return;
    }

    const reportData = this.enrichData(applyRecordScreenToReport(type, { type, ...data }));

    if (this.config.debug) {
      console.info('[MonitorX]', type, reportData);
    }

    this.queue.push(reportData);

    if (this.queue.length >= this.config.batchSize) {
      this.flush();
    } else {
      this.scheduleFlush();
    }
  }

  /** 录屏立即上报（支持分片；返回是否全部成功） */
  async sendRecordScreen(data: Record<string, unknown>): Promise<boolean> {
    const chunks = data.eventsChunks as string[] | undefined;
    const { eventsChunks: _drop, ...rest } = data;

    if (chunks && chunks.length > 1) {
      if (this.config.debug) {
        console.info('[MonitorX] recordScreen 分片上传', {
          recordScreenId: rest.recordScreenId,
          parts: chunks.length,
        });
      }
      for (let i = 0; i < chunks.length; i += 1) {
        const ok = await this.sendImmediate(
          this.enrichData({
            type: 'recordScreen',
            ...rest,
            events: chunks[i],
            eventsPart: i,
            eventsTotal: chunks.length,
          }),
          { largeBody: true },
        );
        if (!ok) return false;
      }
      if (this.config.debug) {
        console.info('[MonitorX] recordScreen 分片上报成功', rest.recordScreenId);
      }
      return true;
    }

    const reportData = this.enrichData({ type: 'recordScreen', ...rest });
    if (this.config.debug) {
      const events = rest.events;
      const eventsSize = typeof events === 'string' ? events.length : 0;
      console.info('[MonitorX] recordScreen 上传', {
        recordScreenId: rest.recordScreenId,
        eventsEncodedLen: eventsSize,
      });
    }
    return this.sendImmediate(reportData, { largeBody: true });
  }

  /** 单条立即上报（录屏等）；largeBody 时禁用 keepalive（Chrome 限制 body ≤64KB） */
  private async sendImmediate(
    data: Record<string, unknown>,
    options?: { largeBody?: boolean },
  ): Promise<boolean> {
    const body = JSON.stringify([data]);
    const useKeepalive = !options?.largeBody && body.length <= 60_000;

    try {
      const res = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: useKeepalive,
      });
      if (!res.ok) {
        const reason = await this.formatFlushFailure(res);
        if (this.config.debug) {
          console.warn('[MonitorX] recordScreen 上报失败:', reason);
        }
        return false;
      }
      if (this.config.debug) {
        console.info('[MonitorX] recordScreen 上报成功');
      }
      return true;
    } catch (err) {
      if (this.config.debug) {
        const msg = err instanceof Error ? err.message : 'network error';
        console.warn('[MonitorX] recordScreen 上报失败:', msg);
      }
      return false;
    }
  }

  private scheduleFlush(): void {
    if (this.flushPaused || this.timer) return;
    this.timer = setTimeout(() => {
      this.flush();
      this.timer = null;
    }, this.config.batchInterval);
  }

  private async flush(useBeacon = false): Promise<void> {
    if (this.flushPaused || this.queue.length === 0) return;

    const dataToSend = [...this.queue];
    this.queue = [];
    const payload = JSON.stringify(dataToSend);

    if (useBeacon && this.config.useBeacon && navigator.sendBeacon) {
      const blob = new Blob([payload], { type: 'application/json' });
      const ok = navigator.sendBeacon(this.config.endpoint, blob);
      if (!ok && this.config.pauseOnReportFailure !== false) {
        this.queue.unshift(...dataToSend);
        this.pauseFlush('sendBeacon failed', { retryMs: 30_000 });
      }
      return;
    }

    try {
      const res = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: payload.length <= 60_000,
      });

      if (!res.ok) {
        if (this.config.pauseOnReportFailure !== false) {
          this.queue.unshift(...dataToSend);
          const reason = await this.formatFlushFailure(res);
          const retryMs = res.status === 503 || res.status === 502 || res.status === 504 ? 30_000 : 0;
          this.pauseFlush(reason, { retryMs });
        } else if (this.config.debug) {
          console.error('[MonitorX] flush failed', res.status);
        }
        return;
      }

      this.flushPaused = false;
      if (this.retryTimer) {
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
      }
      if (this.queue.length > 0) {
        this.scheduleFlush();
      }
    } catch (err) {
      if (this.config.pauseOnReportFailure !== false) {
        this.queue.unshift(...dataToSend);
        const msg = err instanceof Error ? err.message : 'network error';
        this.pauseFlush(msg, { retryMs: 30_000 });
      } else if (this.config.debug) {
        console.error('[MonitorX] flush failed', err);
      }
    }
  }

  private async formatFlushFailure(res: Response): Promise<string> {
    let detail = '';
    try {
      const body = (await res.json()) as { msg?: string };
      if (body?.msg) detail = `: ${body.msg}`;
    } catch {
      // ignore non-json body
    }
    if (res.status === 503) {
      return `监控服务不可用(503)，多为 MySQL 未连接或配置错误${detail}`;
    }
    return `endpoint HTTP ${res.status}${detail}`;
  }

  setUserId(userId: string): void {
    this.userId = userId;
    localStorage.setItem('__monitor_user_id__', userId);
  }
}
