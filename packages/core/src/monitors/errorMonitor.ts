import type { ErrorReportData } from '../types';
import type { Reporter } from '../reporters/reporter';

export class ErrorMonitor {
  private reporter: Reporter;
  private ignorePatterns: RegExp[];

  constructor(reporter: Reporter, ignorePatterns: RegExp[] = []) {
    this.reporter = reporter;
    this.ignorePatterns = [
      /Script error\.?/,
      /ResizeObserver loop/,
      /Loading chunk \d+ failed/,
      ...ignorePatterns,
    ];
  }

  init(): void {
    window.addEventListener('error', this.handleError.bind(this));
    window.addEventListener('unhandledrejection', this.handlePromiseError.bind(this));
  }

  private handleError(event: ErrorEvent): void {
    if (event.target && event.target !== window) return;

    const message = event.message || 'Unknown error';
    if (this.shouldIgnore(message)) return;

    const reportData: ErrorReportData = {
      type: 'js_error',
      message,
      stack: event.error?.stack,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      timestamp: Date.now(),
      pageUrl: window.location.href,
      userAgent: navigator.userAgent,
    };

    this.reporter.send('js_error', reportData as unknown as Record<string, unknown>);
  }

  private handlePromiseError(event: PromiseRejectionEvent): void {
    const reason = event.reason;
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === 'object' && reason?.message
          ? String(reason.message)
          : String(reason);

    if (this.shouldIgnore(message)) return;

    const reportData: ErrorReportData = {
      type: 'promise_error',
      message,
      stack: reason instanceof Error ? reason.stack : reason?.stack,
      timestamp: Date.now(),
      pageUrl: window.location.href,
      userAgent: navigator.userAgent,
    };

    this.reporter.send('js_error', reportData as unknown as Record<string, unknown>);
  }

  private shouldIgnore(message: string): boolean {
    return this.ignorePatterns.some((pattern) => pattern.test(message));
  }
}
