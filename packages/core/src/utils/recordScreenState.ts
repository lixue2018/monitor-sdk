/**
 * 录屏状态（对齐 web-see _support）
 * rrweb 持续录制；checkout 每 N 秒滚动缓冲；报错即传当前缓冲（最近 N 秒）。
 */

const DEFAULT_RECORD_TYPES = ['js_error', 'vue_error'];

let typeList = DEFAULT_RECORD_TYPES;
let recordScreenId = '';
let errorBoundRecordScreenId = '';
let hasError = false;
let uploadHandler: (() => void) | null = null;
let pendingUpload = false;

/** 报错后立即尝试上传，未就绪时短间隔重试 */
const FLUSH_DELAYS = [0, 200, 500, 1000, 2000, 4000];

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
  if (!recordScreenId) recordScreenId = newId();
}

export function disableRecordScreenState(): void {
  recordScreenId = '';
  errorBoundRecordScreenId = '';
  hasError = false;
  pendingUpload = false;
  uploadHandler = null;
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

export function applyRecordScreenToReport(
  type: string,
  data: Record<string, unknown>,
): Record<string, unknown> {
  if (type === 'recordScreen') return data;
  if (!typeList.includes(type)) return data;
  markErrorAndScheduleUpload();
  return { ...data, recordScreenId: getUploadRecordScreenId() };
}
