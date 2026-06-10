/** rrweb EventType */
const RRWEB_META = 4;
const RRWEB_FULL_SNAPSHOT = 2;

function eventType(event: unknown): number | undefined {
  return (event as { type?: number }).type;
}

function eventTimestamp(event: unknown): number | undefined {
  return (event as { timestamp?: number }).timestamp;
}

function countSerializedNodes(node: unknown): number {
  if (!node || typeof node !== 'object') return 0;
  let count = 1;
  const children = (node as { childNodes?: unknown[] }).childNodes;
  if (Array.isArray(children)) {
    for (const child of children) {
      count += countSerializedNodes(child);
    }
  }
  return count;
}

function snapshotNodeCount(event: unknown): number {
  const root = (event as { data?: { node?: unknown } })?.data?.node;
  return countSerializedNodes(root);
}

export function eventTimeSpanMs(events: unknown[]): number {
  const stamps = events
    .map(eventTimestamp)
    .filter((t): t is number => typeof t === 'number');
  if (stamps.length < 2) return 0;
  return Math.max(...stamps) - Math.min(...stamps);
}

export function incrementalEventCount(events: unknown[]): number {
  return events.filter((e) => {
    const t = eventType(e);
    return t !== RRWEB_META && t !== RRWEB_FULL_SNAPSHOT;
  }).length;
}

/**
 * 仅跳过会话开头的空白首帧，保留 checkout 窗口内全部事件（含报错前 ~10s）。
 * 切勿裁到「最后一个快照」，否则第二次报错后只剩报错后的几秒。
 */
export function pickReplayEvents(events: unknown[], minNodes = 5): unknown[] {
  if (events.length <= 2) return events;

  const firstSnapIdx = events.findIndex(
    (e) => eventType(e) === RRWEB_FULL_SNAPSHOT,
  );
  if (firstSnapIdx < 0) return events;

  if (snapshotNodeCount(events[firstSnapIdx]) >= minNodes) {
    return events;
  }

  let firstValidIdx = -1;
  for (let i = firstSnapIdx + 1; i < events.length; i += 1) {
    if (eventType(events[i]) !== RRWEB_FULL_SNAPSHOT) continue;
    if (snapshotNodeCount(events[i]) >= minNodes) {
      firstValidIdx = i;
      break;
    }
  }

  if (firstValidIdx <= 0) return events;

  const meta = events.find((e) => eventType(e) === RRWEB_META);
  const tail = events.slice(firstValidIdx).filter((e) => eventType(e) !== RRWEB_META);
  return meta ? [meta, ...tail] : tail;
}

export function richestSnapshotNodes(events: unknown[]): number {
  let richest = 0;
  for (const event of events) {
    if (eventType(event) !== RRWEB_FULL_SNAPSHOT) continue;
    richest = Math.max(richest, snapshotNodeCount(event));
  }
  return richest;
}

/** 最低可回放条件：有 Meta+快照且非空首帧（避免 raw=1 白屏） */
export function isReplayReady(events: unknown[], minNodes = 5): boolean {
  const hasMeta = events.some((e) => eventType(e) === RRWEB_META);
  const hasSnap = events.some((e) => eventType(e) === RRWEB_FULL_SNAPSHOT);
  return (
    hasMeta &&
    hasSnap &&
    richestSnapshotNodes(events) >= minNodes &&
    events.length >= 3
  );
}
