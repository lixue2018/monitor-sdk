/** 与 monitor-server-java 入库上限对齐，避免 stack/message 过长导致 503 */
export const REPORT_STACK_MAX_LEN = 240;
export const REPORT_MESSAGE_MAX_LEN = 8_000;
export const REPORT_BODY_MAX_LEN = 16_000;

export function truncateReportText(value: unknown, maxLen: number): string | undefined {
  if (value == null) return undefined;
  const s = typeof value === 'string' ? value : String(value);
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen)}\n...[truncated ${s.length - maxLen} chars]`;
}

export function sanitizeReportPayload(data: Record<string, unknown>): Record<string, unknown> {
  const next = { ...data };
  const stack = truncateReportText(next.stack, REPORT_STACK_MAX_LEN);
  const message = truncateReportText(next.message, REPORT_MESSAGE_MAX_LEN);
  if (stack !== undefined) next.stack = stack;
  if (message !== undefined) next.message = message;

  for (const key of ['response', 'responseBody', 'requestBody', 'request', 'errMessage', 'errorMessage']) {
    if (next[key] != null) {
      next[key] = truncateReportText(next[key], REPORT_BODY_MAX_LEN);
    }
  }
  return next;
}
