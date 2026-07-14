import {
  buildApiErrorReport,
  readApiErrorParts,
  readMonitorApiContext,
} from './apiErrorPayload';
import {
  extractHttpErrorContext,
  formatHttpErrorMessage,
  inferHttpStatusFromMessage,
  isLikelyBusinessApiError,
  resolveApiErrorCategory,
} from './httpErrorContext';

function reasonMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === 'object' && reason !== null && 'message' in reason) {
    return String((reason as { message?: unknown }).message);
  }
  return String(reason);
}

/** 从 Axios / 业务挂载上下文解析并组装 api_error；非接口错误返回 null */
export function buildApiErrorFromReason(reason: unknown): Record<string, unknown> | null {
  const message = reasonMessage(reason);
  const ctxMeta = readMonitorApiContext(reason);
  const httpCtx = extractHttpErrorContext(reason);
  const businessApiError = !httpCtx && isLikelyBusinessApiError(message);
  const monitorCtxApiError =
    !httpCtx && !businessApiError && !!ctxMeta && !!(ctxMeta.url || ctxMeta.baseURL);

  if (!httpCtx && !businessApiError && !monitorCtxApiError) return null;

  const status =
    httpCtx?.status && httpCtx.status >= 400
      ? httpCtx.status
      : inferHttpStatusFromMessage(message) ?? httpCtx?.status ?? 500;
  const displayMessage = httpCtx ? formatHttpErrorMessage(message, httpCtx) : message;
  const ctxForCategory = httpCtx ?? {
    url: '',
    isTimeout: /timeout/i.test(message),
    isNetworkError:
      message === 'Network Error' || /后端接口连接异常|Backend int\. conn/i.test(message),
    status,
  };

  const apiParts = readApiErrorParts(reason);

  return buildApiErrorReport({
    message: displayMessage,
    url: httpCtx?.url || apiParts.url || ctxMeta?.url,
    method: httpCtx?.method || apiParts.method || ctxMeta?.method,
    status:
      ctxMeta?.status != null && ctxMeta.status !== 200 && ctxMeta.status !== 0
        ? ctxMeta.status
        : status,
    category: resolveApiErrorCategory(ctxForCategory),
    errorMessage: message,
    requestBody: apiParts.requestBody,
    response: apiParts.response,
    pageUrl: typeof window !== 'undefined' ? window.location.href : '',
  });
}
