// 核心公式，与 Android 版 calc/Calc.kt 逐行对齐。
// 修改公式必须同步更新 tests/calc.test.mjs（见 CLAUDE.md 跨模块约定）。
//
// 应剩余   = 预算 × 剩余权重 ÷ 总权重（周末权重 = weekendMultiplier，工作日 = 1）
// 健康度   = 输入剩余 ÷ 应剩余（精确值判定三色，不用显示百分比）
// 日均还能花 = 输入剩余 ÷ 剩余天数（整除）
//
// 日期一律用 ISO 字符串 "YYYY-MM-DD"（LocalDate 语义），epoch-day 整数换算规避时区。

export const PeriodType = Object.freeze({
  PAYDAY: 'PAYDAY',
  CALENDAR_MONTH: 'CALENDAR_MONTH',
});

export const HealthStatus = Object.freeze({
  HEALTHY: 'HEALTHY',
  CAUTION: 'CAUTION',
  WARNING: 'WARNING',
});

// ---------- 日期工具（epoch-day 整数，等价 LocalDate） ----------

export function toEpochDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

export function fromEpochDay(day) {
  const dt = new Date(day * 86400000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/** 本地"今天"（等价 LocalDate.now()），仅在页面加载时取一次 */
export function todayIso() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

/** 0 = 周日 … 6 = 周六 */
function dayOfWeek(iso) {
  return new Date(toEpochDay(iso) * 86400000).getUTCDay();
}

function isWeekend(iso) {
  const w = dayOfWeek(iso);
  return w === 0 || w === 6;
}

function monthStart(iso) {
  return `${iso.slice(0, 7)}-01`;
}

function nextMonthStart(iso) {
  const [y, m] = iso.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

// ---------- 账期 ----------

function makePeriod(start, end) {
  const s = toEpochDay(start);
  const e = toEpochDay(end);
  return {
    start,
    end,
    totalDays: e - s,
    /** 距离账期结束（end）的天数，含今天 */
    remainingDays(today) {
      return e - toEpochDay(today);
    },
  };
}

/** 账期 [start, end)。发薪日制：相邻发薪日；自然月制（或日期缺失兜底）：月初到月初 */
export function periodOf(today, settings) {
  if (
    settings.periodType === PeriodType.PAYDAY &&
    settings.paydayStart != null &&
    settings.paydayEnd != null
  ) {
    return makePeriod(settings.paydayStart, settings.paydayEnd);
  }
  return makePeriod(monthStart(today), nextMonthStart(today));
}

/** 发薪日制下，账期是否已结束（today 已到/过下期发薪日，需更新发薪日） */
export function isStale(today, settings) {
  return (
    settings.periodType === PeriodType.PAYDAY &&
    settings.paydayEnd != null &&
    toEpochDay(today) >= toEpochDay(settings.paydayEnd)
  );
}

/** 应剩余 = 预算 × 剩余权重 ÷ 总权重；周末权重 = multiplier，工作日 = 1 */
function expectedExact(period, today, budget, multiplier) {
  let totalWeight = 0;
  let remainingWeight = 0;
  const s = toEpochDay(period.start);
  const e = toEpochDay(period.end);
  const t = toEpochDay(today);
  for (let d = s; d < e; d++) {
    const w = isWeekend(fromEpochDay(d)) ? multiplier : 1;
    totalWeight += w;
    if (d >= t) remainingWeight += w;
  }
  return totalWeight > 0 ? (budget * remainingWeight) / totalWeight : 0.0;
}

/** 按进度"应剩余"，只依赖今天与设置，无需输入金额 */
export function expectedRemaining(today, settings) {
  const period = periodOf(today, settings);
  return Math.round(
    expectedExact(period, today, settings.budget, settings.weekendMultiplier)
  );
}

export function evaluate(inputRemaining, today, settings) {
  if (inputRemaining < 0) throw new Error(`剩余金额不能为负：${inputRemaining}`);
  const period = periodOf(today, settings);
  const remDays = clamp(period.remainingDays(today), 1, period.totalDays);
  const expected = expectedExact(period, today, settings.budget, settings.weekendMultiplier);
  const ratio = expected > 0 ? inputRemaining / expected : 0.0;
  const status =
    ratio >= 1.0 ? HealthStatus.HEALTHY : ratio >= 0.9 ? HealthStatus.CAUTION : HealthStatus.WARNING;
  return {
    expectedRemaining: Math.round(expected),
    healthPercent: Math.round(ratio * 100),
    dailyAvailable: remDays > 0 ? Math.trunc(inputRemaining / remDays) : 0,
    remainingDays: remDays,
    totalDays: period.totalDays,
    isPayday:
      settings.periodType === PeriodType.PAYDAY &&
      settings.paydayStart != null &&
      today === settings.paydayStart,
    status,
  };
}

/** 千分位格式化金额（同 AppTheme.formatInt） */
export function formatInt(v) {
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
