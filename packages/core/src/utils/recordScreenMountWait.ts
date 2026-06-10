import type { RecordScreenRouterBridge } from '../types';

export function waitAnimationFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    let left = count;
    const step = () => {
      left -= 1;
      if (left <= 0) resolve();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/** 等待 Vue Router 完成首屏导航（含 async beforeEach / addRoute） */
export async function waitForRouterReady(router?: RecordScreenRouterBridge): Promise<void> {
  if (!router?.isReady) return;
  try {
    await router.isReady();
  } catch {
    // ignore
  }
  await waitAnimationFrames(2);
}

function pickMainContentRoot(root: Element): Element {
  return (
    root.querySelector(
      '.t-layout__content, main, [class*="content"], .router-view, [class*="page"], [class*="container"]',
    )
    ?? root
  );
}

function isPageStillLoading(root: Element): boolean {
  const hasSpinner = Boolean(
    root.querySelector(
      '.t-loading, .el-loading-mask, .el-loading-spinner, [class*="loading"]',
    ),
  );
  const hasTableRows = Boolean(
    root.querySelector('table tbody tr, .t-table tbody tr, .t-table__body tr'),
  );
  if (hasSpinner && !hasTableRows) return true;
  const text = root.textContent ?? '';
  if (hasSpinner && /共\s*0\s*条/.test(text)) return true;
  return false;
}

function isMeaningfulAppRoot(root: Element): boolean {
  if (isPageStillLoading(root)) return false;
  const elCount = root.querySelectorAll('*').length;
  const textLen = root.textContent?.replace(/\s+/g, '').length ?? 0;
  if (elCount >= 12 && textLen >= 16) return true;
  return Boolean(
    root.querySelector('table, .t-table, form, .t-form, .t-layout, .t-menu, img'),
  );
}

/** 等待首屏路由导航完成（含 window.open 新 Tab 的首个页面） */
export async function waitForFirstRouteSettled(
  router?: RecordScreenRouterBridge,
  timeoutMs = 8_000,
): Promise<void> {
  await sleep(500);
  if (!router?.afterEach) return;

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const maxTimer = window.setTimeout(finish, timeoutMs);
    // 首屏路由常早于 afterEach 注册，短等后视为稳定
    const firstPaintTimer = window.setTimeout(() => {
      cleanup?.();
      window.clearTimeout(maxTimer);
      finish();
    }, 1_500);

    const cleanup = router.afterEach(() => {
      window.clearTimeout(firstPaintTimer);
      window.setTimeout(() => {
        cleanup?.();
        window.clearTimeout(maxTimer);
        finish();
      }, 500);
    });
  });
}

/** 等待 #app 内出现可录制的业务 DOM（避免首帧空 router-view） */
export async function waitForMeaningfulDom(
  rootSelector = '#app',
  timeoutMs = 12_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const root = document.querySelector(rootSelector);
    if (root && isMeaningfulAppRoot(root)) return true;
    await waitAnimationFrames(1);
    await sleep(100);
  }
  return false;
}
