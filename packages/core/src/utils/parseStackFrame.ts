export interface ParsedStackFrame {
  filename?: string;
  lineno?: number;
  colno?: number;
  functionName?: string;
}

const FRAME_RE =
  /^\s*at\s+(?:async\s+)?(?:([\w$.<>[\]]+)\s+)?\(?(.+?):(\d+):(\d+)\)?\s*$/;

function isAppSource(filename: string): boolean {
  if (!filename || filename === '<anonymous>') return false;
  if (/node_modules|chrome-extension:|webpack-internal:/i.test(filename)) return false;
  return true;
}

/**
 * 从 Error.stack 解析首个业务源码帧（用于 vue_error 等无 lineno 的场景）。
 */
export function parseStackFrame(stack?: string): ParsedStackFrame | null {
  if (!stack) return null;

  for (const line of stack.split('\n')) {
    const m = line.match(FRAME_RE);
    if (!m) continue;

    const filename = m[2].trim();
    if (!isAppSource(filename)) continue;

    return {
      functionName: m[1] || undefined,
      filename,
      lineno: Number(m[3]),
      colno: Number(m[4]),
    };
  }

  return null;
}
