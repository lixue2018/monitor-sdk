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

function readAxiosLike(reason: unknown): {
  config?: { url?: string; baseURL?: string; method?: string };
  response?: { status?: number; data?: unknown };
  message?: string;
  code?: string;
  isAxiosError?: boolean;
  cause?: unknown;
} | null {
  if (!reason || typeof reason !== 'object') return null;
  const err = reason as {
    config?: { url?: string; baseURL?: string; method?: string };
    response?: { status?: number; data?: unknown };
    message?: string;
    code?: string;
    isAxiosError?: boolean;
    cause?: unknown;
  };
  if (err.config?.url || err.config?.baseURL || err.isAxiosError || err.response) {
    return err;
  }
  if (err.cause) return readAxiosLike(err.cause);
  return err.message ? err : null;
}

/** 从 Axios 等 HTTP 客户端 rejection 中解析请求地址 */
export function extractHttpErrorContext(reason: unknown): HttpErrorContext | null {
  const err = readAxiosLike(reason);
  if (!err) return null;

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

  let status = err.response?.status ?? 0;
  const data = err.response?.data;
  if (data && typeof data === 'object' && data !== null) {
    const biz = data as { code?: number; status?: number };
    if (typeof biz.code === 'number' && biz.code >= 400) {
      status = biz.code;
    } else if (typeof biz.status === 'number' && biz.status >= 400) {
      status = biz.status;
    }
  }

  const parsed = inferHttpStatusFromMessage(message);
  if (parsed != null && (status < 400 || status === 0)) {
    status = parsed;
  }

  return {
    url,
    method: config.method ? String(config.method).toUpperCase() : undefined,
    status,
    isTimeout,
    isNetworkError,
  };
}

/** 从错误文案推断 HTTP/业务状态码 */
export function inferHttpStatusFromMessage(message: string): number | undefined {
  const m1 = message.match(/status code (\d{3})/i);
  if (m1) return Number(m1[1]);
  const m2 = message.match(/系统接口(\d{3})异常/);
  if (m2) return Number(m2[1]);
  const m3 = message.match(/HTTP\s+(\d{3})/i);
  if (m3) return Number(m3[1]);
  return undefined;
}

/**
 * 业务层 transform 在 HTTP 200 下 throw new Error(msg) 时无 axios 上下文，
 * 但文案明显来自后端接口（如参数校验、500 业务码提示等）。
 */
export function isLikelyBusinessApiError(message: string): boolean {
  if (!message.trim()) return false;
  if (inferHttpStatusFromMessage(message) != null) return true;
  return (
    /请求参数类型不匹配|请求接口错误|后端接口连接异常|系统接口请求超时|Backend int\. conn|Sys\. interface req/i.test(
      message,
    ) ||
    /参数\[.+\]要求类型为|无效的会话|接口.*异常|Internal Server Error|Bad Request|Not Found/i.test(
      message,
    )
  );
}

export function formatHttpErrorMessage(baseMessage: string, ctx: HttpErrorContext): string {
  if (ctx.method) {
    return `${ctx.method} ${ctx.url} — ${baseMessage}`;
  }
  return `${ctx.url} — ${baseMessage}`;
}

export function resolveApiErrorCategory(ctx: HttpErrorContext): string {
  if (ctx.isTimeout) return 'timeout';
  if (ctx.isNetworkError) return 'network';
  if (ctx.status != null && ctx.status >= 400) return String(ctx.status);
  return 'api_error';
}
