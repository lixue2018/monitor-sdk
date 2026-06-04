import { SourceMapConsumer } from 'source-map-js';
import { parseStackFrame } from './parseStackFrame';

export interface ResolvedErrorPosition {
  filename?: string;
  lineno?: number;
  colno?: number;
}

function extractInlineSourceMapPayload(code: string): Record<string, unknown> | null {
  const match = code.match(/\/\/# sourceMappingURL=data:application\/json;base64,(.+)$/m);
  if (!match) return null;
  try {
    return JSON.parse(atob(match[1].trim())) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isLocalDevUrl(filename: string): boolean {
  try {
    const u = new URL(filename, window.location.origin);
    return /^(localhost|127\.0\.0\.1)$/i.test(u.hostname);
  } catch {
    return false;
  }
}

function findFunctionBodyRange(
  lines: string[],
  functionName: string,
): { start: number; end: number } | null {
  const startIdx = lines.findIndex(
    (line) =>
      new RegExp(`\\bfunction\\s+${functionName}\\s*\\(`).test(line)
      || new RegExp(`\\b${functionName}\\s*=\\s*(?:async\\s*)?\\(`).test(line),
  );
  if (startIdx < 0) return null;

  let depth = 0;
  let started = false;
  for (let i = startIdx; i < lines.length; i += 1) {
    for (const ch of lines[i]) {
      if (ch === '{') {
        depth += 1;
        started = true;
      } else if (ch === '}') {
        depth -= 1;
        if (started && depth === 0) return { start: startIdx + 1, end: i + 1 };
      }
    }
  }
  return { start: startIdx + 1, end: Math.min(lines.length, startIdx + 30) };
}

/** 在函数体内按报错属性名定位真实源码行（source map 行号在 Vue SFC 下常偏移） */
function refineInFunctionBody(
  sourceText: string,
  functionName: string,
  message?: string,
): { line: number; column: number } | null {
  const propMatch =
    message?.match(/reading\s+'([^']+)'/i) || message?.match(/reading\s+"([^"]+)"/i);
  const prop = propMatch?.[1];
  if (!prop) return null;

  const lines = sourceText.split(/\r?\n/);
  const fnRange = findFunctionBodyRange(lines, functionName);
  if (!fnRange) return null;

  const dotProp = `.${prop}`;
  for (let n = fnRange.start; n <= fnRange.end; n += 1) {
    const lineText = lines[n - 1] ?? '';
    const idx = lineText.indexOf(dotProp);
    if (idx >= 0) return { line: n, column: idx + 1 };
  }
  return null;
}

function extractVueSource(payload: Record<string, unknown>): string | null {
  const sources = payload.sources as string[] | undefined;
  const sourcesContent = payload.sourcesContent as Array<string | null> | undefined;
  if (!sources?.length || !sourcesContent?.length) return null;
  for (let i = 0; i < sources.length; i += 1) {
    const content = sourcesContent[i];
    if (content && (sources[i].endsWith('.vue') || content.includes('<script'))) {
      return maybeFixUtf8Mojibake(content);
    }
  }
  const fallback = sourcesContent[0];
  return fallback ? maybeFixUtf8Mojibake(fallback) : null;
}

function maybeFixUtf8Mojibake(text: string): string {
  if (/[\u4e00-\u9fff]/.test(text)) return text;
  if (!/[\u00c0-\u00ff]/.test(text)) return text;
  try {
    const bytes = Uint8Array.from([...text], (c) => c.charCodeAt(0) & 0xff);
    const fixed = new TextDecoder('utf-8').decode(bytes);
    if (/[\u4e00-\u9fff]/.test(fixed)) return fixed;
  } catch {
    // ignore
  }
  return text;
}

function parseViteRawModule(moduleText: string): string | null {
  const trimmed = moduleText.trim();
  const prefix = 'export default ';
  if (!trimmed.startsWith(prefix)) return null;
  const literal = trimmed.slice(prefix.length).replace(/;\s*$/, '');
  try {
    return JSON.parse(literal) as string;
  } catch {
    return null;
  }
}

async function fetchRawVueSource(filename: string): Promise<string | null> {
  try {
    const pathname = new URL(filename, window.location.origin).pathname;
    if (!pathname.endsWith('.vue')) return null;
    const res = await fetch(`${pathname}?raw`);
    if (!res.ok) return null;
    return parseViteRawModule(await res.text());
  } catch {
    return null;
  }
}

/** Vite 开发态：将 ErrorEvent 虚拟模块行列还原为 .vue 原始源码行列 */
export async function resolveSourceMappedPosition(
  filename: string,
  lineno: number,
  colno: number,
  stack?: string,
  message?: string,
): Promise<ResolvedErrorPosition | null> {
  if (!filename || !lineno || !isLocalDevUrl(filename)) return null;

  try {
    const moduleUrl = new URL(filename, window.location.origin).href;
    const res = await fetch(moduleUrl);
    if (!res.ok) return null;

    const generatedCode = await res.text();
    const payload = extractInlineSourceMapPayload(generatedCode);
    if (!payload) return null;

    const vueSource =
      (await fetchRawVueSource(filename)) ?? extractVueSource(payload);
    const vueFileUrl = moduleUrl.split('?')[0];
    const frame = parseStackFrame(stack);

    if (vueSource && frame?.functionName) {
      const refined = refineInFunctionBody(vueSource, frame.functionName, message);
      if (refined) {
        return { filename: vueFileUrl, lineno: refined.line, colno: refined.column };
      }
    }

    const consumer = await new SourceMapConsumer(
      payload as ConstructorParameters<typeof SourceMapConsumer>[0],
    );
    try {
      const pos = consumer.originalPositionFor({ line: lineno, column: colno || 0 });
      if (!pos.source || pos.line == null) return null;

      return {
        filename: vueFileUrl,
        lineno: pos.line,
        colno: pos.column ?? colno,
      };
    } finally {
      if (typeof consumer.destroy === 'function') consumer.destroy();
    }
  } catch {
    return null;
  }
}
