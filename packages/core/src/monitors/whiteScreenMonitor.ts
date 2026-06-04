import type { Reporter } from '../reporters/reporter';

export interface WhiteScreenMonitorOptions {
  /** 视为「空容器」的选择器，命中则计为空白采样点 */
  whiteBoxElements?: string[];
  /** 首次检测延迟（避免首屏加载误判），默认 3000ms */
  initialDelay?: number;
  /** 轮询间隔，默认 1000ms */
  checkInterval?: number;
}

const DEFAULT_WHITE_BOX = ['html', 'body', '#app', '#root'];

export class WhiteScreenMonitor {
  private reporter: Reporter;
  private whiteBoxElements: string[];
  private initialDelay: number;
  private checkInterval: number;
  private loopTimer: ReturnType<typeof setInterval> | null = null;
  private reported = false;

  constructor(reporter: Reporter, options: WhiteScreenMonitorOptions = {}) {
    this.reporter = reporter;
    this.whiteBoxElements = options.whiteBoxElements ?? DEFAULT_WHITE_BOX;
    this.initialDelay = options.initialDelay ?? 3000;
    this.checkInterval = options.checkInterval ?? 1000;
  }

  init(): void {
    const start = () => {
      window.setTimeout(() => {
        this.checkNow();
        this.loopTimer = window.setInterval(() => this.checkNow(), this.checkInterval);
      }, this.initialDelay);
    };

    if (document.readyState === 'complete') {
      start();
    } else {
      window.addEventListener('load', start, { once: true });
    }
  }

  destroy(): void {
    if (this.loopTimer != null) {
      clearInterval(this.loopTimer);
      this.loopTimer = null;
    }
  }

  /** 立即执行一次白屏采样（供模拟页手动触发） */
  checkNow(): boolean {
    const emptyPoints = this.countEmptyPoints();
    if (emptyPoints === 17) {
      this.report(emptyPoints, undefined, true);
      return true;
    }
    return false;
  }

  /** 手动上报白屏（模拟场景） */
  reportManual(reason = '手动触发白屏模拟'): void {
    this.report(17, reason, true);
  }

  private countEmptyPoints(): number {
    const w = window.innerWidth;
    const h = window.innerHeight;
    let emptyPoints = 0;

    for (let i = 1; i <= 9; i++) {
      const xElements = document.elementsFromPoint((w * i) / 10, h / 2);
      const yElements = document.elementsFromPoint(w / 2, (h * i) / 10);
      if (this.isContainer(xElements[0])) emptyPoints += 1;
      if (i !== 5 && this.isContainer(yElements[0])) emptyPoints += 1;
    }

    return emptyPoints;
  }

  private getSelector(element: Element): string {
    if (element.id) return `#${element.id}`;
    if (element.className && typeof element.className === 'string') {
      const cls = element.className
        .split(' ')
        .filter((item) => !!item)
        .join('.');
      if (cls) return `.${cls}`;
    }
    return element.nodeName.toLowerCase();
  }

  private isContainer(element: Element | undefined): boolean {
    if (!element) return true;
    return this.whiteBoxElements.includes(this.getSelector(element));
  }

  private report(emptyPoints: number, reason?: string, force = false): void {
    if (!force && !reason && this.reported) return;
    if (!reason && !force) this.reported = true;

    const message =
      reason ||
      `页面白屏：${emptyPoints}/17 个采样点仅命中容器节点（${this.whiteBoxElements.join(', ')}）`;

    this.reporter.send('whiteScreen', {
      type: 'whiteScreen',
      category: 'whiteScreen',
      message,
      emptyPoints,
      whiteBoxElements: this.whiteBoxElements,
      timestamp: Date.now(),
      pageUrl: window.location.href,
      userAgent: navigator.userAgent,
    });
  }
}
