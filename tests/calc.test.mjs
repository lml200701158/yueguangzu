// 公式单测：用例移植自 Android 版 CalcTest / PeriodTest / WeekendWeightTest。
// 运行：node web/tests/calc.test.mjs
import assert from 'node:assert/strict';
import {
  PeriodType,
  HealthStatus,
  periodOf,
  isStale,
  expectedRemaining,
  evaluate,
  toEpochDay,
  fromEpochDay,
  formatInt,
} from '../js/calc.js';

// 用户示例：预算 2600，发薪日制，本期 10-08 → 下期 11-05
const userSettings = () => ({
  budget: 2600,
  periodType: PeriodType.PAYDAY,
  paydayStart: '2026-10-08',
  paydayEnd: '2026-11-05',
  weekendMultiplier: 1,
});

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log('calc.test.mjs');

// ---------- 日期工具 ----------
test('epoch-day 换算无时区漂移', () => {
  assert.equal(toEpochDay('2026-10-08'), toEpochDay('2026-10-07') + 1);
  assert.equal(fromEpochDay(toEpochDay('2026-10-08')), '2026-10-08');
  assert.equal(fromEpochDay(toEpochDay('2028-02-29')), '2028-02-29'); // 闰年
});

// ---------- 应剩余 / 日均（CalcTest） ----------
test('应剩余按进度线性计算', () => {
  // 账期 10.8 → 11.5 共 28 天；10.20 距发薪 16 天；2600×16/28 = 1485.71 → 1486
  const r = evaluate(0, '2026-10-20', userSettings());
  assert.equal(r.remainingDays, 16);
  assert.equal(r.totalDays, 28);
  assert.equal(r.expectedRemaining, 1486);
});

test('无需输入即可算按进度应剩', () => {
  assert.equal(expectedRemaining('2026-10-20', userSettings()), 1486);
  assert.equal(expectedRemaining('2026-10-08', userSettings()), 2600);
});

test('发薪日应剩余就是全额', () => {
  assert.equal(evaluate(2600, '2026-10-08', userSettings()).expectedRemaining, 2600);
});

test('日均还能花整除', () => {
  assert.equal(evaluate(1600, '2026-10-20', userSettings()).dailyAvailable, 100);
});

test('零元输入日均为零', () => {
  const r = evaluate(0, '2026-10-20', userSettings());
  assert.equal(r.dailyAvailable, 0);
  assert.equal(r.status, HealthStatus.WARNING);
});

// ---------- 三色阈值（精确比值判定） ----------

test('恰好百分之百判健康', () => {
  assert.equal(evaluate(2600, '2026-10-08', userSettings()).status, HealthStatus.HEALTHY);
});

test('显示百分之百但实际不足判注意', () => {
  const r = evaluate(2599, '2026-10-08', userSettings());
  assert.equal(r.healthPercent, 100);
  assert.equal(r.status, HealthStatus.CAUTION);
});

test('恰好百分之九十判注意', () => {
  const r = evaluate(2340, '2026-10-08', userSettings());
  assert.equal(r.healthPercent, 90);
  assert.equal(r.status, HealthStatus.CAUTION);
});

test('不足百分之九十判预警', () => {
  const r = evaluate(2339, '2026-10-08', userSettings());
  assert.equal(r.healthPercent, 90);
  assert.equal(r.status, HealthStatus.WARNING);
});

test('富余输入判健康', () => {
  const r = evaluate(3000, '2026-10-20', userSettings());
  assert.equal(r.status, HealthStatus.HEALTHY);
  assert.ok(r.healthPercent > 100);
});

// ---------- 发薪日标记 ----------

test('发薪日标记', () => {
  assert.equal(evaluate(2600, '2026-10-08', userSettings()).isPayday, true);
  assert.equal(evaluate(2600, '2026-10-09', userSettings()).isPayday, false);
});

test('自然月制无发薪日标记', () => {
  const s = { ...userSettings(), periodType: PeriodType.CALENDAR_MONTH };
  assert.equal(evaluate(2600, '2026-10-01', s).isPayday, false);
});

test('自然月制应剩余', () => {
  const s = { ...userSettings(), periodType: PeriodType.CALENDAR_MONTH };
  // 10 月 31 天；10.20 剩 12 天；2600×12/31 = 1006.45 → 1006
  assert.equal(expectedRemaining('2026-10-20', s), 1006);
});

// ---------- 账期（PeriodTest） ----------

test('发薪日制：直接用填的两个日期', () => {
  const p = periodOf('2026-10-20', userSettings());
  assert.equal(p.start, '2026-10-08');
  assert.equal(p.end, '2026-11-05');
  assert.equal(p.totalDays, 28);
});

test('发薪日制：日期缺失时兜底自然月', () => {
  const p = periodOf('2026-10-20', {
    budget: 2600,
    periodType: PeriodType.PAYDAY,
    paydayStart: null,
    paydayEnd: null,
    weekendMultiplier: 1,
  });
  assert.equal(p.start, '2026-10-01');
  assert.equal(p.end, '2026-11-01');
});

test('自然月制：月初到月初', () => {
  const p = periodOf('2026-10-20', {
    budget: 2600,
    periodType: PeriodType.CALENDAR_MONTH,
    paydayStart: null,
    paydayEnd: null,
    weekendMultiplier: 1,
  });
  assert.equal(p.start, '2026-10-01');
  assert.equal(p.end, '2026-11-01');
  assert.equal(p.totalDays, 31);
  assert.equal(p.remainingDays('2026-10-20'), 12);
});

test('自然月制：二月闰年', () => {
  const p = periodOf('2028-02-10', {
    budget: 2600,
    periodType: PeriodType.CALENDAR_MONTH,
    paydayStart: null,
    paydayEnd: null,
    weekendMultiplier: 1,
  });
  assert.equal(p.totalDays, 29);
});

// ---------- 账期过期检测 ----------

test('发薪日制到期前不过期', () => {
  assert.equal(isStale('2026-10-20', userSettings()), false);
  assert.equal(isStale('2026-11-04', userSettings()), false); // 账期最后一天
});

test('发薪日制到期日及之后过期', () => {
  assert.equal(isStale('2026-11-05', userSettings()), true); // 等于下期发薪日
  assert.equal(isStale('2026-11-06', userSettings()), true);
});

test('自然月制永不过期', () => {
  const s = { ...userSettings(), periodType: PeriodType.CALENDAR_MONTH };
  assert.equal(isStale('2026-12-31', s), false);
});

// ---------- 周末权重（WeekendWeightTest） ----------
// 一周账期：2026-10-05(周一) → 2026-10-12(周一)，预算 1300
// 工作日 5 天（权重 1），周末 2 天（权重 multiplier），总权重 = 5 + 2×multiplier

const weekSettings = (mult) => ({
  budget: 1300,
  periodType: PeriodType.PAYDAY,
  paydayStart: '2026-10-05',
  paydayEnd: '2026-10-12',
  weekendMultiplier: mult,
});

test('账期第一天应剩全额', () => {
  assert.equal(expectedRemaining('2026-10-05', weekSettings(4)), 1300);
});

test('默认一倍等价匀速', () => {
  // 10-06 剩余 6 天 / 共 7 天 → 1300×6/7 = 1114
  assert.equal(expectedRemaining('2026-10-06', weekSettings(1)), 1114);
});

test('周末四倍时工作日应剩更多', () => {
  // 10-06(周二) 剩余权重 = 1+1+1+1+4+4 = 12，总 13 → 1300×12/13 = 1200
  assert.equal(expectedRemaining('2026-10-06', weekSettings(4)), 1200);
});

test('周末四倍时周末应剩下降更快', () => {
  // 10-11(周日) 剩余权重 = 4，总 13 → 1300×4/13 = 400
  assert.equal(expectedRemaining('2026-10-11', weekSettings(4)), 400);
});

// ---------- 输入校验 / 显示格式 ----------

test('负数输入拒绝', () => {
  assert.throws(() => evaluate(-1, '2026-10-20', userSettings()));
});

test('千分位格式化', () => {
  assert.equal(formatInt(1486), '1,486');
  assert.equal(formatInt(2600), '2,600');
  assert.equal(formatInt(999), '999');
  assert.equal(formatInt(0), '0');
});

console.log(`\n全部通过：${passed} 个用例`);
