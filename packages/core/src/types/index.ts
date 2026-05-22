export interface ReporterConfig {
  endpoint: string;
  appKey: string;
  batchSize?: number;
  batchInterval?: number;
  useBeacon?: boolean;
  debug?: boolean;
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
  sampleRate?: number;
  ignoreErrors?: RegExp[];
}

export interface ErrorReportData {
  type: 'js_error' | 'promise_error' | 'vue_error';
  message: string;
  stack?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  info?: string;
  timestamp: number;
  pageUrl: string;
  userAgent: string;
}

export interface ResourceErrorData {
  type: 'resource_error';
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
  errorMessage?: string;
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
