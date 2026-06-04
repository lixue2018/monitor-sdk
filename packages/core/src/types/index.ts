export interface ReporterConfig {
  endpoint: string;
  appKey: string;
  batchSize?: number;
  batchInterval?: number;
  useBeacon?: boolean;
  debug?: boolean;
  pauseOnReportFailure?: boolean;
  /** 按顺序从 localStorage 读取用户标识（如 csl-new-front 的 itCode） */
  userIdStorageKeys?: string[];
}

export interface MonitorConfig {
  endpoint: string;
  appKey: string;
  batchSize?: number;
  batchInterval?: number;
  useBeacon?: boolean;
  debug?: boolean;
  enableErrorTracking?: boolean;
  enableResourceTracking?: boolean;
  enablePerformance?: boolean;
  /** 监控接口响应超过该阈值（毫秒）时上报 api_slow，默认 1000 */
  slowApiThreshold?: number;
  /** 为 false 时不采集慢接口 */
  enableSlowApiTracking?: boolean;
  /**
   * 仅采集匹配的 HTTP 接口（如 ['/dev-api']）。
   * 未配置时采集除监控上报地址外的请求。
   */
  apiTrackUrlPatterns?: (string | RegExp)[];
  /** 上报地址连续失败（如 5xx）后暂停上报，避免死循环 */
  pauseOnReportFailure?: boolean;
  sampleRate?: number;
  ignoreErrors?: RegExp[];
  /** 按顺序从 localStorage 读取用户标识（默认含 itCode，供 csl-new-front 等） */
  userIdStorageKeys?: string[];
  /** 是否开启白屏检测（17 点采样） */
  enableWhiteScreen?: boolean;
  /** 白屏检测：视为空容器的节点选择器 */
  whiteBoxElements?: string[];
  /** 白屏检测首次延迟（ms） */
  whiteScreenInitialDelay?: number;
  /** 白屏检测轮询间隔（ms） */
  whiteScreenCheckInterval?: number;
}

export interface ErrorReportData {
  type: 'js_error' | 'promise_error' | 'vue_error';
  message: string;
  stack?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  info?: string;
  /** HTTP 客户端 rejection 时的请求地址 */
  url?: string;
  method?: string;
  timestamp: number;
  pageUrl: string;
  userAgent: string;
}

export interface ResourceErrorData {
  type: 'resource_error';
  /** 与 resourceType 一致，写入库表 category 字段 */
  category?: string;
  resourceUrl: string;
  resourceType: 'script' | 'link' | 'img' | 'font' | 'media' | 'other';
  errorMessage: string;
  timestamp: number;
  pageUrl: string;
}

export interface ApiErrorData {
  type: 'api_error';
  url?: string;
  method?: string;
  status?: number;
  duration?: number;
  /** 请求体（截断后） */
  requestBody?: string;
  /** 响应体（截断后） */
  response?: string;
  category?: string;
  errorMessage?: string;
  message?: string;
  timestamp: number;
  pageUrl: string;
}

export interface ApiSlowData {
  type: 'api_slow';
  url: string;
  method?: string;
  status?: number;
  duration: number;
  threshold: number;
  /** mild | moderate | slow | critical */
  slowLevel: string;
  slowLevelLabel: string;
  message?: string;
  timestamp: number;
  pageUrl: string;
}

export interface PerformanceData {
  type?: 'performance';
  fp?: number;
  fcp?: number;
  lcp?: number;
  fid?: number;
  cls?: number;
  ttfb?: number;
  domReady?: number;
  loadTime?: number;
  redirectTime?: number;
  dnsTime?: number;
  tcpTime?: number;
  timestamp: number;
  pageUrl: string;
  [key: string]: string | number | undefined;
}

export type ReportPayload = Record<string, unknown>;
