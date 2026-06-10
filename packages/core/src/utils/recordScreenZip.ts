import { Base64 } from 'js-base64';
import pako from 'pako';

/** 单包上限（约 2MB base64）；超出则分片上传 */
export const MAX_SINGLE_ENCODED_LEN = 2_000_000;
/** 分片每包目标上限 */
const MAX_PART_ENCODED_LEN = 1_200_000;
/** 硬上限：单包压缩后最大约 6MB */
const MAX_HARD_ENCODED_LEN = 6_000_000;

const RRWEB_FULL_SNAPSHOT = 2;

function encodePayload(dataJson: string): string {
  const str = Base64.encode(dataJson);
  const binaryString = pako.gzip(str);
  const arr = Array.from(binaryString);
  let s = '';
  arr.forEach((item: number) => {
    s += String.fromCharCode(item);
  });
  return Base64.btoa(s);
}

function findFullSnapshotIndex(events: unknown[]): number {
  return events.findIndex((e) => (e as { type?: number }).type === RRWEB_FULL_SNAPSHOT);
}

/** 裁剪时保留 Meta + FullSnapshot，只删中间增量帧 */
function trimEventsPreservingSnapshot(events: unknown[]): unknown[] {
  if (events.length <= 5) return events;

  const snapIdx = findFullSnapshotIndex(events);
  if (snapIdx < 0) {
    return events.slice(Math.ceil(events.length * 0.1));
  }

  const head = events.slice(0, snapIdx + 1);
  const tail = events.slice(snapIdx + 1);
  if (tail.length <= 3) return events;

  const remove = Math.max(1, Math.ceil(tail.length * 0.12));
  return [...head, ...tail.slice(remove)];
}

function tryEncodeEvents(events: unknown[]): string {
  let working = [...events];
  while (working.length > 0) {
    const encoded = encodePayload(JSON.stringify(working));
    if (encoded.length <= MAX_HARD_ENCODED_LEN) return encoded;
    if (working.length <= 3) return encoded;
    working = trimEventsPreservingSnapshot(working);
  }
  return '';
}

/** 压缩 rrweb events；过大时优先删早期增量帧，保留 FullSnapshot */
export function zipRecordScreenEvents(data: unknown): string {
  if (!data) return '';
  const events = Array.isArray(data) ? [...data] : [data];
  if (events.length === 0) return '';
  return tryEncodeEvents(events);
}

/**
 * 超单包上限时分片（每片独立压缩，admin 按 eventsPart 合并）。
 * 首片含 Meta+FullSnapshot，后续片为增量帧。
 */
export function zipRecordScreenEventsChunks(data: unknown): string[] {
  if (!data) return [];
  const events = Array.isArray(data) ? [...data] : [data];
  if (events.length === 0) return [];

  const single = tryEncodeEvents(events);
  if (single && single.length <= MAX_SINGLE_ENCODED_LEN) return [single];

  const snapIdx = findFullSnapshotIndex(events);
  const head = snapIdx >= 0 ? events.slice(0, snapIdx + 1) : events.slice(0, 1);
  const body = snapIdx >= 0 ? events.slice(snapIdx + 1) : events.slice(1);

  if (body.length === 0) return single ? [single] : [];

  const estimatedParts = Math.max(2, Math.ceil(single.length / MAX_PART_ENCODED_LEN));
  const bodyPartSize = Math.max(15, Math.ceil(body.length / estimatedParts));
  const chunks: string[] = [];

  for (let i = 0; i < body.length; i += bodyPartSize) {
    const bodySlice = body.slice(i, i + bodyPartSize);
    const partEvents = i === 0 ? [...head, ...bodySlice] : bodySlice;
    const encoded = tryEncodeEvents(partEvents);
    if (encoded) chunks.push(encoded);
  }

  if (chunks.length === 0 && single) return [single];
  return chunks;
}
