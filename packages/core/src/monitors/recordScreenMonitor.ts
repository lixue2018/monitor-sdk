import { record } from 'rrweb';
import type { RecordScreenRouterBridge } from '../types';
import type { Reporter } from '../reporters/reporter';
import {
  clearRecordScreenError,
  disableRecordScreenState,
  getRecordScreenId,
  getUploadRecordScreenId,
  initRecordScreenState,
  isRecordScreenFlushFinal,
  MIN_USEFUL_RECORD_SPAN_MS,
  peekRecordScreenError,
  rotateRecordScreenId,
  setRecordScreenUploadHandler,
} from '../utils/recordScreenState';
import { sleep, waitForMeaningfulDom, waitForRouterReady } from '../utils/recordScreenMountWait';
import {
  eventTimeSpanMs,
  incrementalEventCount,
  isReplayReady,
  pickReplayEvents,
  richestSnapshotNodes,
} from '../utils/recordScreenReplayPick';
import { zipRecordScreenEventsChunks } from '../utils/recordScreenZip';

export interface RecordScreenMonitorOptions {
  recordScreenTime?: number;
  recordScreenTypeList?: string[];
  maskAllInputs?: boolean;
  recordCanvas?: boolean;
  debug?: boolean;
}

const DEFAULT_RECORD_TYPE_LIST = ['js_error', 'vue_error', 'api_error'];

function takeSnapshotSafe(): void {
  try {
    record.takeFullSnapshot(false);
  } catch {
    // ignore
  }
}

export class RecordScreenMonitor {
  private reporter: Reporter;
  private recordSeconds: number;
  private typeList: string[];
  private maskAllInputs: boolean;
  private recordCanvas: boolean;
  private debug: boolean;
  private stopRecord: (() => void) | null = null;
  private recorderStarted = false;
  private starting: Promise<void> | null = null;
  private snapshotTimers: ReturnType<typeof setTimeout>[] = [];
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(reporter: Reporter, options: RecordScreenMonitorOptions = {}) {
    this.reporter = reporter;
    this.recordSeconds = options.recordScreenTime ?? 10;
    this.typeList = options.recordScreenTypeList?.length
      ? [...options.recordScreenTypeList]
      : DEFAULT_RECORD_TYPE_LIST;
    this.maskAllInputs = options.maskAllInputs === true;
    this.recordCanvas = options.recordCanvas === true;
    this.debug = options.debug ?? false;
  }

  init(): void {
    initRecordScreenState({ recordScreenTypeList: this.typeList });
    this.fallbackTimer = setTimeout(() => {
      this.startAfterMount('fallback-timeout');
    }, 15_000);
  }

  startAfterMount(reason = 'app-mounted', router?: RecordScreenRouterBridge): void {
    if (this.recorderStarted || this.starting) return;
    this.starting = this.doStartAfterMount(reason, router);
    void this.starting.finally(() => {
      this.starting = null;
    });
  }

  private async doStartAfterMount(
    reason: string,
    router?: RecordScreenRouterBridge,
  ): Promise<void> {
    if (this.recorderStarted) return;

    await waitForRouterReady(router);
    await waitForMeaningfulDom('#app', 10_000);
    await sleep(600);
    if (this.recorderStarted) return;

    if (this.fallbackTimer) {
      clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
    }

    this.startRecorder(reason);

    this.snapshotTimers.push(setTimeout(() => takeSnapshotSafe(), 800));
    this.snapshotTimers.push(setTimeout(() => takeSnapshotSafe(), 2200));
    this.snapshotTimers.push(setTimeout(() => takeSnapshotSafe(), 4000));
  }

  private startRecorder(reason: string): void {
    if (this.recorderStarted) return;
    this.recorderStarted = true;

    const reporter = this.reporter;
    const checkoutMs = this.recordSeconds * 1000;
    let events: unknown[] = [];
    let uploading = false;
    const uploadedIds = new Set<string>();

    const finishUploadSuccess = (boundId: string) => {
      uploadedIds.add(boundId);
      events = [];
      rotateRecordScreenId();
      clearRecordScreenError();
      console.info('[MonitorX] recordScreen 已上报', boundId, '（录屏器继续运行，滚动下一窗口）');
    };

    /** 跳过录屏上传（错误已单独上报）；清理状态避免重复重试 */
    const skipRecordScreenUpload = (boundId: string, reason: string) => {
      uploadedIds.add(boundId);
      events = [];
      clearRecordScreenError();
      rotateRecordScreenId();
      console.info('[MonitorX] 跳过录屏上报', reason, boundId);
    };

    const uploadEvents = (boundId: string, trigger: string) => {
      if (uploading) return;
      if (!peekRecordScreenError()) return;
      if (!boundId || uploadedIds.has(boundId)) return;

      if (!isReplayReady(events)) {
        console.info(
          '[MonitorX] recordScreen 缓冲未就绪',
          trigger,
          `raw=${events.length}`,
          `span=${eventTimeSpanMs(events)}ms`,
          `nodes=${richestSnapshotNodes(events)}`,
        );
        if (isRecordScreenFlushFinal()) {
          skipRecordScreenUpload(boundId, '录屏未就绪/未加载出来');
          return;
        }
        takeSnapshotSafe();
        return;
      }

      const replayable = pickReplayEvents(events);
      const spanMs = eventTimeSpanMs(replayable);
      if (spanMs < MIN_USEFUL_RECORD_SPAN_MS) {
        if (!isRecordScreenFlushFinal()) {
          console.info(
            '[MonitorX] recordScreen 时长不足',
            trigger,
            `${spanMs}ms < ${MIN_USEFUL_RECORD_SPAN_MS}ms，继续等待`,
          );
          takeSnapshotSafe();
          return;
        }
        skipRecordScreenUpload(boundId, `录屏过短(${spanMs}ms)`);
        return;
      }

      const chunks = zipRecordScreenEventsChunks(replayable);
      if (chunks.length === 0) {
        console.warn('[MonitorX] recordScreen 压缩失败', trigger);
        if (isRecordScreenFlushFinal()) {
          skipRecordScreenUpload(boundId, '录屏压缩失败');
        }
        return;
      }

      uploading = true;
      const payload = chunks.length === 1 ? { events: chunks[0] } : { eventsChunks: chunks };

      console.info(
        '[MonitorX] recordScreen 上传',
        trigger,
        boundId,
        `raw=${events.length}`,
        `replay=${replayable.length}`,
        `incr=${incrementalEventCount(replayable)}`,
        `span=${spanMs}ms`,
        `nodes=${richestSnapshotNodes(replayable)}`,
      );

      void reporter
        .sendRecordScreen({
          recordScreenId: boundId,
          ...payload,
          status: 'ok',
          timestamp: Date.now(),
          pageUrl: window.location.href,
          userAgent: navigator.userAgent,
        })
        .then((ok) => {
          uploading = false;
          if (!ok) {
            console.warn('[MonitorX] recordScreen 上报失败', boundId);
            return;
          }
          finishUploadSuccess(boundId);
        });
    };

    const tryUploadOnError = () => {
      uploadEvents(getUploadRecordScreenId(), 'error');
    };

    try {
      setRecordScreenUploadHandler(tryUploadOnError);

      this.stopRecord = record({
        emit(event, isCheckout) {
          if (isCheckout) {
            // 每 recordSeconds 滚动：无错误则丢弃旧缓冲；有错误则兜底上传（对齐 web-see）
            if (peekRecordScreenError()) {
              const boundId = getUploadRecordScreenId();
              if (!uploadedIds.has(boundId)) {
                rotateRecordScreenId();
                uploadEvents(boundId, 'checkout');
              }
              if (peekRecordScreenError()) {
                events = [];
                clearRecordScreenError();
              }
            } else {
              events = [];
              rotateRecordScreenId();
            }
          }
          events.push(event);
        },
        recordCanvas: this.recordCanvas,
        checkoutEveryNms: checkoutMs,
        inlineStylesheet: true,
        inlineImages: false,
        collectFonts: true,
        maskAllInputs: this.maskAllInputs,
        maskInputOptions: { password: true },
      }) ?? null;

      console.info(
        '[MonitorX] 录屏 rrweb 已启动（持续滚动',
        `${this.recordSeconds}s，报错即传当前缓冲）`,
        `reason=${reason}`,
        `recordScreenId=${getRecordScreenId()}`,
      );
    } catch (err) {
      setRecordScreenUploadHandler(null);
      disableRecordScreenState();
      console.warn('[MonitorX] recordScreen 启动失败:', err);
    }
  }

  destroy(): void {
    if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
    this.snapshotTimers.forEach((t) => clearTimeout(t));
    this.snapshotTimers = [];
    setRecordScreenUploadHandler(null);
    disableRecordScreenState();
    if (this.stopRecord) {
      try {
        this.stopRecord();
      } catch {
        // ignore
      }
      this.stopRecord = null;
    }
    this.recorderStarted = false;
  }
}
