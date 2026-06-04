import type { ErrorReportData } from '../types';
import type { Reporter } from '../reporters/reporter';
import {
  buildApiErrorReport,
  readAxiosRequestBody,
  readAxiosResponseBody,
} from '../utils/apiErrorPayload';
import { extractHttpErrorContext, formatHttpErrorMessage } from '../utils/httpErrorContext';
import { resolveSourceMappedPosition } from '../utils/resolveSourceMappedPosition';

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

    void this.reportJsError(event, message);
  }

  /** Vite + Vue SFC 下 event.lineno 是编译模块行号，需 source map 还原为 .vue 原始行号再上报 */
  private async reportJsError(event: ErrorEvent, message: string): Promise<void> {
    let filename = event.filename;
    let lineno = event.lineno;
    let colno = event.colno;

    if (filename && lineno) {
      const mapped = await resolveSourceMappedPosition(
        filename,
        lineno,
        colno,
        event.error?.stack,
        message,
      );
      if (mapped?.lineno != null) {
        filename = mapped.filename ?? filename;
        lineno = mapped.lineno;
        colno = mapped.colno ?? colno;
      }
    }

    const reportData: ErrorReportData = {
      type: 'js_error',
      message,
      stack: event.error?.stack,
      filename,
      lineno,
      colno,
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
        : typeof reason === 'object' && reason !== null && 'message' in reason
          ? String((reason as { message?: unknown }).message)
          : String(reason);

    if (this.shouldIgnore(message)) return;

    const stack =
      reason instanceof Error ? reason.stack : (reason as { stack?: string })?.stack;
    const httpCtx = extractHttpErrorContext(reason);

    // Axios 超时 / 网络异常：按 api_error 上报并带上接口 URL
    if (httpCtx && (httpCtx.isTimeout || httpCtx.isNetworkError)) {
      const displayMessage = formatHttpErrorMessage(message, httpCtx);
      this.reporter.send(
        'api_error',
        buildApiErrorReport({
          message: displayMessage,
          url: httpCtx.url,
          method: httpCtx.method,
          status: httpCtx.status ?? 0,
          category: httpCtx.isTimeout ? 'timeout' : 'network',
          errorMessage: message,
          requestBody: readAxiosRequestBody(reason),
          response: readAxiosResponseBody(reason),
          pageUrl: window.location.href,
        }),
      );
      return;
    }

    // Axios HTTP 错误（4xx/5xx 等，业务未 catch 时）
    if (httpCtx && httpCtx.status != null && httpCtx.status >= 400) {
      this.reporter.send(
        'api_error',
        buildApiErrorReport({
          url: httpCtx.url,
          method: httpCtx.method,
          status: httpCtx.status,
          errorMessage: message,
          requestBody: readAxiosRequestBody(reason),
          response: readAxiosResponseBody(reason),
          pageUrl: window.location.href,
        }),
      );
      return;
    }

    const reportMessage = httpCtx ? formatHttpErrorMessage(message, httpCtx) : message;
    const reportData: ErrorReportData = {
      type: 'promise_error',
      message: reportMessage,
      stack,
      timestamp: Date.now(),
      pageUrl: window.location.href,
      userAgent: navigator.userAgent,
      ...(httpCtx
        ? { url: httpCtx.url, method: httpCtx.method }
        : {}),
    };

    this.reporter.send('promise_error', reportData as unknown as Record<string, unknown>);
  }

  private shouldIgnore(message: string): boolean {
    return this.ignorePatterns.some((pattern) => pattern.test(message));
  }
}
