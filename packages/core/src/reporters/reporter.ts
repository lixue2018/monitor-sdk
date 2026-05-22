import type { ReporterConfig } from '../types';

export class Reporter {
  private queue: Record<string, unknown>[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sessionId: string;
  private userId: string;
  private config: Required<Pick<ReporterConfig, 'batchSize' | 'batchInterval' | 'useBeacon'>> &
    ReporterConfig;

  constructor(config: ReporterConfig) {
    this.config = {
      batchSize: 10,
      batchInterval: 3000,
      useBeacon: true,
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
    let id = localStorage.getItem('__monitor_user_id__');
    if (!id) {
      id = `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
      localStorage.setItem('__monitor_user_id__', id);
    }
    return id;
  }

  private enrichData(data: Record<string, unknown>): Record<string, unknown> {
    return {
      ...data,
      app_key: this.config.appKey,
      apikey: this.config.appKey, // 与 fe-monitor-server 字段一致
      session_id: this.sessionId,
      user_id: this.userId,
      screen_resolution: `${window.screen.width}x${window.screen.height}`,
      language: navigator.language,
      timestamp: data.timestamp ?? Date.now(),
    };
  }

  send(type: string, data: Record<string, unknown>): void {
    const reportData = this.enrichData({ type, ...data });
    this.queue.push(reportData);

    if (this.config.debug) {
      console.info('[MonitorX]', type, reportData);
    }

    if (this.queue.length >= this.config.batchSize) {
      this.flush();
    } else {
      this.scheduleFlush();
    }
  }

  private scheduleFlush(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.flush();
      this.timer = null;
    }, this.config.batchInterval);
  }

  private async flush(useBeacon = false): Promise<void> {
    if (this.queue.length === 0) return;

    const dataToSend = [...this.queue];
    this.queue = [];
    const payload = JSON.stringify(dataToSend);

    if (useBeacon && this.config.useBeacon && navigator.sendBeacon) {
      const blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon(this.config.endpoint, blob);
      return;
    }

    await fetch(this.config.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch((err) => {
      if (this.config.debug) console.error('[MonitorX] flush failed', err);
    });
  }

  setUserId(userId: string): void {
    this.userId = userId;
    localStorage.setItem('__monitor_user_id__', userId);
  }
}
