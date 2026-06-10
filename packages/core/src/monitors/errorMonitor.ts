import type { ErrorReportData } from '../types';
import type { Reporter } from '../reporters/reporter';
import {
  buildApiErrorReport,
  readApiErrorParts,
  readMonitorApiContext,
} from '../utils/apiErrorPayload';
import {
  extractHttpErrorContext,
  formatHttpErrorMessage,
  inferHttpStatusFromMessage,
  isLikelyBusinessApiError,
  resolveApiErrorCategory,
} from '../utils/httpErrorContext';
import { freezeRecordScreenForError } from '../utils/recordScreenState';
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
    // 同步锁定录屏 ID，避免 await source map 期间 checkout 轮换 ID
    freezeRecordScreenForError();

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

    let stack =
      reason instanceof Error ? reason.stack : (reason as { stack?: string })?.stack;
    if (stack && stack.trim() === message.trim()) {
      stack = undefined;
    }
    const httpCtx = extractHttpErrorContext(reason);
    const businessApiError = !httpCtx && isLikelyBusinessApiError(message);

    // 凡 HTTP/Axios/业务接口 rejection 均归 api_error（含 4xx/5xx、超时、网络异常、业务 throw Error）
    if (httpCtx || businessApiError) {
      const status =
        httpCtx?.status && httpCtx.status >= 400
          ? httpCtx.status
          : inferHttpStatusFromMessage(message) ?? httpCtx?.status ?? 500;
      const displayMessage = httpCtx ? formatHttpErrorMessage(message, httpCtx) : message;
      const ctxForCategory = httpCtx ?? {
        url: '',
        isTimeout: /timeout/i.test(message),
        isNetworkError: message === 'Network Error' || /后端接口连接异常|Backend int\. conn/i.test(message),
        status,
      };

      const apiParts = readApiErrorParts(reason);
      const ctxMeta = readMonitorApiContext(reason);

      this.reporter.send(
        'api_error',
        buildApiErrorReport({
          message: displayMessage,
          url: httpCtx?.url || apiParts.url || ctxMeta?.url,
          method: httpCtx?.method || apiParts.method || ctxMeta?.method,
          status: ctxMeta?.status && ctxMeta.status >= 400 ? ctxMeta.status : status,
          category: resolveApiErrorCategory(ctxForCategory),
          errorMessage: message,
          requestBody: apiParts.requestBody,
          response: apiParts.response,
          pageUrl: window.location.href,
        }),
      );
      return;
    }

    const reportData: ErrorReportData = {
      type: 'promise_error',
      message,
      stack,
      timestamp: Date.now(),
      pageUrl: window.location.href,
      userAgent: navigator.userAgent,
    };

    this.reporter.send('promise_error', reportData as unknown as Record<string, unknown>);
  }

  private shouldIgnore(message: string): boolean {
    return this.ignorePatterns.some((pattern) => pattern.test(message));
  }
}
