export interface HttpErrorContext {
  url: string;
  method?: string;
  status?: number;
  isTimeout: boolean;
  isNetworkError: boolean;
}

function resolveRequestUrl(config: { url?: string; baseURL?: string }): string {
  const path = config.url || '';
  if (/^https?:\/\//i.test(path)) return path;
  const base = (config.baseURL || '').replace(/\/+$/, '');
  if (!base) return path;
  if (!path) return base;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/** 从 Axios 等 HTTP 客户端 rejection 中解析请求地址 */
export function extractHttpErrorContext(reason: unknown): HttpErrorContext | null {
  if (!reason || typeof reason !== 'object') return null;

  const err = reason as {
    config?: { url?: string; baseURL?: string; method?: string };
    response?: { status?: number };
    message?: string;
    code?: string;
    isAxiosError?: boolean;
  };

  const config = err.config;
  if (!config?.url && !config?.baseURL) return null;

  const url = resolveRequestUrl(config);
  if (!url) return null;

  const message = String(err.message ?? '');
  const code = String(err.code ?? '');
  const isTimeout = /timeout/i.test(message) || code === 'ECONNABORTED';
  const isNetworkError = message === 'Network Error' || code === 'ERR_NETWORK';
  const hasHttpSignal = err.isAxiosError || err.response != null || isTimeout || isNetworkError;

  if (!hasHttpSignal) return null;

  return {
    url,
    method: config.method ? String(config.method).toUpperCase() : undefined,
    status: err.response?.status ?? 0,
    isTimeout,
    isNetworkError,
  };
}

export function formatHttpErrorMessage(
  baseMessage: string,
  ctx: HttpErrorContext,
): string {
  if (ctx.method) {
    return `${ctx.method} ${ctx.url} — ${baseMessage}`;
  }
  return `${ctx.url} — ${baseMessage}`;
}
