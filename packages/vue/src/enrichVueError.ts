import { parseStackFrame } from '@lixue2018/monitorx-core';

/** 为 vue_error 补全 filename / lineno / colno，供 monitor-admin 展示行列 */
export function enrichVueErrorReport(
  err: Error,
  info: string,
): Record<string, unknown> {
  const frame = parseStackFrame(err.stack);

  return {
    type: 'vue_error',
    message: err.message,
    stack: err.stack,
    info,
    ...(frame?.filename ? { filename: frame.filename } : {}),
    ...(frame?.lineno != null ? { lineno: frame.lineno } : {}),
    ...(frame?.colno != null ? { colno: frame.colno } : {}),
  };
}
