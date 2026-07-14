/**
 * 录屏状态（对齐 web-see _support）
 * rrweb 持续录制；checkout 每 N 秒滚动缓冲；报错即传当前缓冲（最近 N 秒）。
 * 缓冲未就绪或时长 &lt;1s 时跳过录屏上传，错误本身仍正常上报。
 */

const DEFAULT_RECORD_TYPES = ['js_error', 'vue_error', 'api_error'];

/** 可回放录屏最短时长（毫秒）；更短则跳过录屏上传 */
export const MIN_USEFUL_RECORD_SPAN_MS = 1000;

/** 报错后等待录屏就绪的最长时间（与 FLUSH_DELAYS 末档对齐） */
export const RECORD_SCREEN_FLUSH_FINAL_MS = 4000;

/** 报错后立即尝试上传，未就绪时短间隔重试 */
const FLUSH_DELAYS = [0, 200, 500, 1000, 2000, RECORD_SCREEN_FLUSH_FINAL_MS];

let typeList = DEFAULT_RECORD_TYPES;
let recordScreenId = '';
let errorBoundRecordScreenId = '';
let hasError = false;
let uploadHandler: (() => void) | null = null;
let pendingUpload = false;
/** 是否已开启录屏能力（init 后 true） */
let recordScreenActive = false;
/** 首次标记错误的时间，用于判断是否已到最终重试 */
let errorMarkedAt = 0;

function newId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

export function initRecordScreenState(options?: {
  recordScreenTypeList?: string[];
}): void {
  typeList = options?.recordScreenTypeList?.length
    ? [...options.recordScreenTypeList]
    : DEFAULT_RECORD_TYPES;
  recordScreenActive = true;
  if (!recordScreenId) recordScreenId = newId();
}

export function disableRecordScreenState(): void {
  recordScreenId = '';
  errorBoundRecordScreenId = '';
  hasError = false;
  pendingUpload = false;
  uploadHandler = null;
  recordScreenActive = false;
  errorMarkedAt = 0;
}

export function getRecordScreenId(): string {
  if (!recordScreenId) recordScreenId = newId();
  return recordScreenId;
}

/** 错误上报绑定的录屏 ID */
export function getUploadRecordScreenId(): string {
  return errorBoundRecordScreenId || recordScreenId;
}

export function rotateRecordScreenId(): string {
  recordScreenId = newId();
  return recordScreenId;
}

export function peekRecordScreenError(): boolean {
  return hasError;
}

export function clearRecordScreenError(): void {
  hasError = false;
  pendingUpload = false;
  errorBoundRecordScreenId = '';
  errorMarkedAt = 0;
}

function scheduleUploadRetries(): void {
  if (!uploadHandler) {
    pendingUpload = true;
    return;
  }
  pendingUpload = false;
  FLUSH_DELAYS.forEach((ms) => {
    setTimeout(() => uploadHandler?.(), ms);
  });
}

function markErrorAndScheduleUpload(): void {
  hasError = true;
  if (!errorBoundRecordScreenId) {
    errorBoundRecordScreenId = getRecordScreenId();
    errorMarkedAt = Date.now();
  }
  scheduleUploadRetries();
}

export function freezeRecordScreenForError(): string | null {
  markErrorAndScheduleUpload();
  return getUploadRecordScreenId();
}

export function setRecordScreenUploadHandler(handler: (() => void) | null): void {
  uploadHandler = handler;
  if (handler && pendingUpload) {
    scheduleUploadRetries();
  }
}

/** 是否已到报错后最后一次录屏重试窗口 */
export function isRecordScreenFlushFinal(): boolean {
  if (!errorMarkedAt) return false;
  return Date.now() - errorMarkedAt >= RECORD_SCREEN_FLUSH_FINAL_MS - 50;
}

export function applyRecordScreenToReport(
  type: string,
  data: Record<string, unknown>,
): Record<string, unknown> {
  if (type === 'recordScreen') return data;
  if (!typeList.includes(type)) return data;
  if (!recordScreenActive) return data;
  markErrorAndScheduleUpload();
  return { ...data, recordScreenId: getUploadRecordScreenId() };
}
