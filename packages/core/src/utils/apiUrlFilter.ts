/** 永不采集的 URL（监控上报自身） */
const DEFAULT_EXCLUDE: RegExp[] = [
  /reportData/i,
  /monitor-api/i,
];

export interface ApiUrlFilterOptions {
  /**
   * 仅采集匹配的接口（如 ['/dev-api']）。
   * 未配置时：采集除 DEFAULT_EXCLUDE 外的所有接口。
   */
  apiTrackUrlPatterns?: (string | RegExp)[];
}

export function createApiUrlMatcher(options: ApiUrlFilterOptions = {}): (url: string) => boolean {
  const allowlist = options.apiTrackUrlPatterns;

  return (url: string) => {
    if (!url) return false;
    const u = String(url);

    if (DEFAULT_EXCLUDE.some((p) => p.test(u))) {
      return false;
    }

    if (allowlist && allowlist.length > 0) {
      return allowlist.some((p) => (typeof p === 'string' ? u.includes(p) : p.test(u)));
    }

    return true;
  };
}
