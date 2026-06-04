/** 请求/响应体最大采集长度 */
export const MAX_API_RESPONSE_LEN = 8192;
export const MAX_API_REQUEST_LEN = MAX_API_RESPONSE_LEN;

export function truncateResponse(body: string, maxLen = MAX_API_RESPONSE_LEN): string {
  if (!body) return '';
  if (body.length <= maxLen) return body;
  return `${body.slice(0, maxLen)}\n... [truncated]`;
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
    return truncateResponse(JSON.stringify(body), MAX_API_REQUEST_LEN);
  } catch {
    return truncateResponse(String(body), MAX_API_REQUEST_LEN);
  }
}

/** 从 Axios config 提取请求体 */
export function readAxiosRequestBody(reason: unknown): string {
  if (!reason || typeof reason !== 'object') return '';
  const data = (reason as { config?: { data?: unknown } }).config?.data;
  return formatRequestBody(data);
}

export function readXhrResponseBody(xhr: XMLHttpRequest): string {
  try {
    const rt = xhr.responseType;
    if (rt === '' || rt === 'text') {
      return truncateResponse(xhr.responseText || '');
    }
    if (rt === 'json') {
      const res = xhr.response;
      return truncateResponse(typeof res === 'string' ? res : JSON.stringify(res ?? null));
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

/** 从 Axios 错误对象提取响应体 */
export function readAxiosResponseBody(reason: unknown): string {
  if (!reason || typeof reason !== 'object') return '';
  const res = (reason as { response?: { data?: unknown } }).response;
  if (!res?.data) return '';
  const data = res.data;
  if (typeof data === 'string') return truncateResponse(data);
  try {
    return truncateResponse(JSON.stringify(data));
  } catch {
    return truncateResponse(String(data));
  }
}

export interface ApiErrorInput {
  url?: string;
  method?: string;
  status?: number;
  duration?: number;
  requestBody?: string;
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

  const requestBody = input.requestBody ? truncateResponse(input.requestBody, MAX_API_REQUEST_LEN) : '';

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
    response,
    timestamp: Date.now(),
    pageUrl: input.pageUrl ?? (typeof window !== 'undefined' ? window.location.href : ''),
  };
}
