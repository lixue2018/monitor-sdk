/** 请求/响应体最大采集长度 */
export const MAX_API_RESPONSE_LEN = 8192;
export const MAX_API_REQUEST_LEN = MAX_API_RESPONSE_LEN;

/** 常见业务成功码（HTTP 200 时 body.code 等于其中之一视为成功） */
export const BIZ_SUCCESS_CODES = new Set([0, 200]);

export function isBusinessFailureCode(code: number | null | undefined): boolean {
  return typeof code === 'number' && Number.isFinite(code) && !BIZ_SUCCESS_CODES.has(code);
}

/** 从 JSON 响应体解析业务 code 字段 */
export function parseBusinessCodeFromResponseBody(body: string): number | null {
  if (!body?.trim()) return null;
  try {
    const data = JSON.parse(body) as { code?: unknown; status?: unknown };
    if (typeof data.code === 'number' && Number.isFinite(data.code)) return data.code;
    if (typeof data.status === 'number' && Number.isFinite(data.status)) return data.status;
  } catch {
    // 非 JSON 响应忽略
  }
  return null;
}

/** 结合 HTTP 状态与响应体业务码，判断是否需要上报 api_error */
export function resolveApiFailureFromHttp(
  httpStatus: number,
  responseBody: string,
): { shouldReport: boolean; status: number } {
  if (httpStatus >= 400) {
    return { shouldReport: true, status: httpStatus };
  }
  if (httpStatus >= 200 && httpStatus < 300) {
    const bizCode = parseBusinessCodeFromResponseBody(responseBody);
    if (isBusinessFailureCode(bizCode)) {
      return { shouldReport: true, status: bizCode as number };
    }
  }
  return { shouldReport: false, status: httpStatus };
}

/** 业务 axios transform throw Error 时附带的接口上下文 */
export interface MonitorApiContext {
  url?: string;
  baseURL?: string;
  method?: string;
  status?: number;
  params?: unknown;
  data?: unknown;
  response?: unknown;
}

export const MONITOR_API_CONTEXT_KEY = '__monitorApiContext';

export function truncateResponse(body: string, maxLen = MAX_API_RESPONSE_LEN): string {
  if (!body) return '';
  if (body.length <= maxLen) return body;
  return `${body.slice(0, maxLen)}\n... [truncated]`;
}

/** 业务层在 throw 前挂载，供 ErrorMonitor 采集请求/响应 */
export function attachMonitorApiContext(error: Error, ctx: MonitorApiContext): Error {
  (error as Error & { [key: string]: unknown })[MONITOR_API_CONTEXT_KEY] = ctx;
  return error;
}

export function readMonitorApiContext(reason: unknown): MonitorApiContext | null {
  if (!reason || typeof reason !== 'object') return null;
  const ctx = (reason as Record<string, unknown>)[MONITOR_API_CONTEXT_KEY];
  if (!ctx || typeof ctx !== 'object') return null;
  return ctx as MonitorApiContext;
}

function resolveAxiosUrl(config: { url?: string; baseURL?: string }): string {
  const path = config.url || '';
  if (/^https?:\/\//i.test(path)) return path;
  const base = (config.baseURL || '').replace(/\/+$/, '');
  if (!base) return path;
  if (!path) return base;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export function resolveMonitorApiContextUrl(ctx: MonitorApiContext | null): string {
  if (!ctx) return '';
  if (ctx.url && /^https?:\/\//i.test(ctx.url)) return ctx.url;
  return resolveAxiosUrl({ url: ctx.url, baseURL: ctx.baseURL });
}

function resolveContextUrl(ctx: MonitorApiContext | null): string {
  return resolveMonitorApiContextUrl(ctx);
}

/** 序列化 XHR/Fetch/Axios 请求体 */
export function formatRequestBody(body: unknown): string {
  if (body == null || body === '') return '';
  if (typeof body === 'string') return truncateResponse(body, MAX_API_REQUEST_LEN);
  if (typeof Document !== 'undefined' && body instanceof Document) {
    return '[Document body, not captured]';
  }
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    const parts: string[] = [];
    body.forEach((value, key) => {
      parts.push(`${key}=${String(value)}`);
    });
    return truncateResponse(parts.join('&') || '[FormData]', MAX_API_REQUEST_LEN);
  }
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
    return truncateResponse(body.toString(), MAX_API_REQUEST_LEN);
  }
  if (body instanceof ArrayBuffer) {
    return `[ArrayBuffer ${body.byteLength} bytes, not captured]`;
  }
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    return `[Blob ${body.size} bytes, not captured]`;
  }
  try {
    return truncateResponse(JSON.stringify(body, null, 2), MAX_API_REQUEST_LEN);
  } catch {
    return truncateResponse(String(body), MAX_API_REQUEST_LEN);
  }
}

function readAxiosConfig(reason: unknown): {
  url?: string;
  baseURL?: string;
  method?: string;
  params?: unknown;
  data?: unknown;
} | null {
  if (!reason || typeof reason !== 'object') return null;
  const err = reason as { config?: { url?: string; baseURL?: string; method?: string; params?: unknown; data?: unknown }; cause?: unknown };
  if (err.config?.url || err.config?.baseURL) return err.config;
  if (err.cause) return readAxiosConfig(err.cause);
  return null;
}

/** 采集请求参数：GET query / POST body / 完整 URL */
export function readAxiosRequestParams(reason: unknown): string {
  const config = readAxiosConfig(reason);
  const ctx = readMonitorApiContext(reason);

  const payload: Record<string, unknown> = {};
  const url = config ? resolveAxiosUrl(config) : resolveContextUrl(ctx);
  if (url) payload.url = url;

  const params = config?.params ?? ctx?.params;
  const data = config?.data ?? ctx?.data;
  if (params != null && params !== '' && !(typeof params === 'object' && Object.keys(params as object).length === 0)) {
    payload.params = params;
  }
  if (data != null && data !== '') {
    payload.body = data;
  }

  if (Object.keys(payload).length === 0) return '';
  if (Object.keys(payload).length === 1 && payload.url) {
    return formatRequestBody({ url: payload.url });
  }
  return formatRequestBody(payload);
}

/** @deprecated 使用 readAxiosRequestParams */
export function readAxiosRequestBody(reason: unknown): string {
  return readAxiosRequestParams(reason);
}

export function readXhrResponseBody(xhr: XMLHttpRequest): string {
  try {
    const rt = xhr.responseType;
    if (rt === '' || rt === 'text') {
      return truncateResponse(xhr.responseText || '');
    }
    if (rt === 'json') {
      const res = xhr.response;
      return truncateResponse(typeof res === 'string' ? res : JSON.stringify(res ?? null, null, 2));
    }
    if (rt === 'document') {
      return truncateResponse(xhr.responseXML?.documentElement?.outerHTML || '');
    }
    if (rt === 'arraybuffer' || rt === 'blob') {
      return `[${rt} response, not captured]`;
    }
    return truncateResponse(String(xhr.response ?? ''));
  } catch {
    return '';
  }
}

export async function readFetchResponseBody(response: Response): Promise<string> {
  try {
    const clone = response.clone();
    const contentType = (clone.headers.get('content-type') || '').toLowerCase();
    if (
      contentType.includes('json') ||
      contentType.includes('text') ||
      contentType.includes('xml') ||
      contentType.includes('javascript') ||
      !contentType
    ) {
      return truncateResponse(await clone.text());
    }
    const len = clone.headers.get('content-length');
    return `[${contentType || 'binary'}${len ? `, ${len} bytes` : ''}]`;
  } catch {
    return '';
  }
}

/** 从 Axios 错误或业务挂载上下文提取响应体 */
export function readAxiosResponseBody(reason: unknown): string {
  if (!reason || typeof reason !== 'object') return '';
  const err = reason as { response?: { data?: unknown }; cause?: unknown };
  const resData = err.response?.data;
  if (resData != null && resData !== '') {
    if (typeof resData === 'string') return truncateResponse(resData);
    try {
      return truncateResponse(JSON.stringify(resData, null, 2));
    } catch {
      return truncateResponse(String(resData));
    }
  }
  if (err.cause) {
    const nested = readAxiosResponseBody(err.cause);
    if (nested) return nested;
  }
  const ctx = readMonitorApiContext(reason);
  if (ctx?.response != null && ctx.response !== '') {
    return formatRequestBody(ctx.response);
  }
  return '';
}

export function readApiErrorParts(reason: unknown): {
  requestBody: string;
  response: string;
  url?: string;
  method?: string;
} {
  const ctx = readMonitorApiContext(reason);
  const config = readAxiosConfig(reason);
  return {
    requestBody: readAxiosRequestParams(reason),
    response: readAxiosResponseBody(reason),
    url: config ? resolveAxiosUrl(config) : resolveContextUrl(ctx) || undefined,
    method: (config?.method ?? ctx?.method)?.toUpperCase(),
  };
}

export interface ApiErrorInput {
  url?: string;
  method?: string;
  status?: number;
  duration?: number;
  requestBody?: string;
  requestParams?: string;
  response?: string;
  errorMessage?: string;
  message?: string;
  category?: string;
  pageUrl?: string;
}

/** 组装 api_error 上报字段（含 URL / Method / status / response） */
export function buildApiErrorReport(input: ApiErrorInput): Record<string, unknown> {
  const method = (input.method || 'GET').toUpperCase();
  const url = input.url || '';
  const status = input.status;
  const statusStr = status != null && status > 0 ? String(status) : '';
  const response = input.response ? truncateResponse(input.response) : '';
  const errMsg = input.errorMessage || input.message || '';
  let message = errMsg;
  if (!message) {
    message = statusStr
      ? `${method} ${url} — HTTP ${statusStr}`
      : `${method} ${url} — 请求失败`;
  }

  const requestPayload = input.requestBody || input.requestParams || '';
  const requestBody = requestPayload ? truncateResponse(requestPayload, MAX_API_REQUEST_LEN) : '';

  return {
    type: 'api_error',
    url,
    method,
    status,
    duration: input.duration,
    category: input.category || statusStr || 'api_error',
    message,
    errorMessage: errMsg || message,
    requestBody,
    requestParams: requestBody,
    response,
    timestamp: Date.now(),
    pageUrl: input.pageUrl ?? (typeof window !== 'undefined' ? window.location.href : ''),
  };
}
