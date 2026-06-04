/** 慢接口分级（与 admin / server 口径一致） */
export const SLOW_API_LEVEL = {
  MILD: 'mild',
  MODERATE: 'moderate',
  SLOW: 'slow',
  CRITICAL: 'critical',
} as const;

export type SlowApiLevel = (typeof SLOW_API_LEVEL)[keyof typeof SLOW_API_LEVEL];

export const SLOW_API_LEVEL_LABELS: Record<SlowApiLevel, string> = {
  mild: '偏慢 (1s-3s)',
  moderate: '较慢 (3s-5s)',
  slow: '慢 (5s-10s)',
  critical: '严重慢 (>10s)',
};

/** 根据耗时（ms）解析等级，<1s 返回 null */
export function resolveSlowApiLevel(duration: number): SlowApiLevel | null {
  const d = Number(duration);
  if (!Number.isFinite(d) || d < 1000) return null;
  if (d < 3000) return SLOW_API_LEVEL.MILD;
  if (d < 5000) return SLOW_API_LEVEL.MODERATE;
  if (d <= 10000) return SLOW_API_LEVEL.SLOW;
  return SLOW_API_LEVEL.CRITICAL;
}
