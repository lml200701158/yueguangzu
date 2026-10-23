// 视图路由与交互。四视图：引导 / 今日 / 设置 / 历史，文案与 Android 版对齐。
import {
  PeriodType,
  periodOf,
  isStale,
  expectedRemaining,
  evaluate,
  todayIso,
  formatInt,
} from './calc.js';
import {
  isConfigured,
  loadSettings,
  saveSettings,
  loadSnapshots,
  appendSnapshot,
  deleteSnapshotAt,
} from './store.js';

// 固定"今天"为页面加载日期，跨午夜不跳变（同 Android 进程内语义）
const TODAY = todayIso();

const STATUS_STYLES = {
  HEALTHY: { emoji: '🟢', text: '🟢 健康', hint: '比进度宽裕，放心花', key: 'healthy' },
  CAUTION: { emoji: '🟡', text: '🟡 注意', hint: '略微超前，悠着点', key: 'caution' },
  WARNING: { emoji: '🔴', text: '🔴 预警', hint: '花超进度了，接下来收紧', key: 'warning' },
};

const state = {
  view: 'today', // today | settings | history
  settings: loadSettings(),
  input: '',
  submitted: null, // number：已提交的剩余金额
  snapshots: [],
  deleteIndex: null,
  form: null, // 设置/引导表单草稿
};

const app = document.getElementById('app');

// ---------- 工具 ----------

/** "2026-10-08" → "10.8"（同 DateTimeFormatter "M.d"） */
function fmtMD(iso) {
  const [, m, d] = iso.split('-');
  return `${Number(m)}.${Number(d)}`;
}

function newForm(settings) {
  return {
    budgetText: settings.budget > 0 ? String(settings.budget) : '',
    periodType: settings.periodType,
    paydayStart: settings.paydayStart,
    paydayEnd: settings.paydayEnd,
    weekendMultiplier: settings.weekendMultiplier,
  };
}

function formValid(form) {
  const budget = Number(form.budgetText);
  if (!/^\d{1,6}$/.test(form.budgetText) || budget <= 0) return false;
  if (form.periodType === PeriodType.PAYDAY) {
    if (!form.paydayStart || !form.paydayEnd) return false;
    if (!(form.paydayStart < form.paydayEnd)) return false;
  }
  return true;
}

function formToSettings(form) {
  const payday = form.periodType === PeriodType.PAYDAY;
  return {
    budget: Number(form.budgetText),
    periodType: form.periodType,
    paydayStart: payday ? form.paydayStart : null,
    paydayEnd: payday ? form.paydayEnd : null,
    weekendMultiplier: form.weekendMultiplier,
  };
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// ---------- 渲染 ----------

function render() {
  if (!isConfigured(state.settings)) {
    if (!state.form) state.form = newForm(state.settings);
    app.innerHTML = viewOnboarding();
    wireForm();
    return;
  }
  if (state.view === 'settings') {
    if (!state.form) state.form = newForm(state.settings);
    app.innerHTML = viewSettings();
    wireForm();
    return;
  }
  if (state.view === 'history') {
    state.snapshots = loadSnapshots();
    app.innerHTML = viewHistory();
    wireHistory();
    return;
  }
  app.innerHTML = viewToday();
  wireToday();
}

// ---------- 引导 / 设置（共用表单） ----------

function formFields(form) {
  const paydaySection =
    form.periodType === PeriodType.PAYDAY
      ? `
      <div class="section-label">本期发薪日</div>
      <input type="date" id="paydayStart" value="${form.paydayStart ?? ''}">
      <div class="section-label">下期发薪日</div>
      <input type="date" id="paydayEnd" value="${form.paydayEnd ?? ''}">`
      : '';
  return `
    <div class="section-label">月预算（元）</div>
    <input type="text" id="budget" inputmode="numeric" maxlength="6" placeholder="如 3000" value="${esc(form.budgetText)}">

    <div class="section-label">账期方式</div>
    <div class="option-row">
      <div class="option ${form.periodType === PeriodType.CALENDAR_MONTH ? 'selected' : ''}" data-period="CALENDAR_MONTH">
        <div class="opt-title">自然月制</div>
        <div class="opt-desc">每月1号起</div>
      </div>
      <div class="option ${form.periodType === PeriodType.PAYDAY ? 'selected' : ''}" data-period="PAYDAY">
        <div class="opt-title">发薪日制</div>
        <div class="opt-desc">发薪日→发薪日</div>
      </div>
    </div>

    ${paydaySection}

    <div class="section-label">周末消费力度</div>
    <input type="range" id="weekendMult" min="1" max="10" step="1" value="${form.weekendMultiplier}">
    <p class="mult-value" id="multValue">${form.weekendMultiplier} 倍于工作日</p>
    <p class="hint">周末比工作日多花的倍数 · 1 = 每天一样</p>`;
}

function viewOnboarding() {
  return `
  <div class="page">
    <p class="title">欢迎使用「月光族」</p>
    <p class="subtitle muted">先设置预算和账期，之后可在设置里随时改</p>
    ${formFields(state.form)}
    <button class="btn" id="submitBtn" ${formValid(state.form) ? '' : 'disabled'}>开 始 使 用</button>
    <div style="height:24px"></div>
  </div>`;
}

function viewSettings() {
  return `
  <div class="top-bar">
    <button class="back-btn" data-action="back" aria-label="返回">
      <svg width="12" height="20" viewBox="0 0 12 20" fill="none"><path d="M10 2L2 10l8 8" stroke="#757575" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <h1>设置</h1>
  </div>
  <div class="page">
    ${formFields(state.form)}
    <button class="btn" id="submitBtn" ${formValid(state.form) ? '' : 'disabled'}>保 存</button>
    <div style="height:24px"></div>
  </div>`;
}

function wireForm() {
  const form = state.form;
  const submitBtn = document.getElementById('submitBtn');
  const budget = document.getElementById('budget');

  budget.addEventListener('input', () => {
    const v = budget.value.replace(/\D/g, '').slice(0, 6);
    budget.value = v;
    form.budgetText = v;
    submitBtn.disabled = !formValid(form);
  });

  document.querySelectorAll('[data-period]').forEach((el) => {
    el.addEventListener('click', () => {
      form.periodType = el.dataset.period;
      render();
    });
  });

  const start = document.getElementById('paydayStart');
  const end = document.getElementById('paydayEnd');
  if (start) {
    start.addEventListener('change', () => {
      form.paydayStart = start.value || null;
      submitBtn.disabled = !formValid(form);
    });
    end.addEventListener('change', () => {
      form.paydayEnd = end.value || null;
      submitBtn.disabled = !formValid(form);
    });
  }

  const mult = document.getElementById('weekendMult');
  mult.addEventListener('input', () => {
    form.weekendMultiplier = Number(mult.value);
    document.getElementById('multValue').textContent = `${form.weekendMultiplier} 倍于工作日`;
  });

  submitBtn.addEventListener('click', () => {
    if (!formValid(form)) return;
    state.settings = formToSettings(form);
    saveSettings(state.settings);
    state.form = null;
    state.view = 'today';
    state.input = '';
    state.submitted = null;
    render();
  });
}

// ---------- 今日 ----------

function viewToday() {
  const { settings } = state;
  const period = periodOf(TODAY, settings);
  const remDays = Math.min(Math.max(period.remainingDays(TODAY), 1), period.totalDays);
  const stale = isStale(TODAY, settings);

  let head;
  if (stale) {
    head = `
      <p class="title warning">账期已结束</p>
      <p class="subtitle muted">请到设置更新发薪日</p>
      <p class="subtitle">本期账期 ${fmtMD(period.start)} → ${fmtMD(period.end)}</p>`;
  } else if (settings.periodType === PeriodType.PAYDAY) {
    head = `
      <p class="title">${TODAY === period.start ? '今天发薪 · 新账期开始' : `距发薪 ${remDays} 天`}</p>
      <p class="subtitle">账期 ${fmtMD(period.start)} → ${fmtMD(period.end)} · 预算 ¥${formatInt(settings.budget)}</p>`;
  } else {
    head = `
      <p class="title">本月还剩 ${remDays} 天</p>
      <p class="subtitle">自然月 · 预算 ¥${formatInt(settings.budget)}</p>`;
  }

  let body;
  if (stale) {
    body = `
      <div class="card warning">
        <div class="warn-title">⚠️ 账期已结束</div>
        <div class="warn-body">右上角「设置」里更新本期 / 下期发薪日后即可继续</div>
      </div>`;
  } else {
    const result = state.submitted != null ? evaluate(state.submitted, TODAY, settings) : null;
    body = `
      <div class="card primary">
        <div class="card-label">按进度应剩</div>
        <div class="card-amount">¥${formatInt(expectedRemaining(TODAY, settings))}</div>
      </div>
      <div style="height:32px"></div>
      <p class="section-label" style="text-align:center;font-size:16px">现在还剩多少？</p>
      <div style="height:12px"></div>
      <input type="text" id="amountInput" inputmode="numeric" maxlength="6" placeholder="金额（元）" value="${esc(state.input)}">
      <div style="height:16px"></div>
      <button class="btn" id="lookBtn" style="margin-top:0" ${state.input.trim() ? '' : 'disabled'}>查 看</button>
      ${result ? resultCard(result) : ''}`;
  }

  return `
  <div class="top-bar">
    <div class="actions">
      <button class="btn-text" data-action="history">历史</button>
      <button class="btn-text" data-action="settings">设置</button>
    </div>
  </div>
  <div class="page">
    ${head}
    ${body}
    <div style="height:24px"></div>
  </div>`;
}

function resultCard(r) {
  const s = STATUS_STYLES[r.status];
  return `
    <div class="card ${s.key}">
      <div class="card-status ${s.key}">${s.text} · 健康度 ${r.healthPercent}%</div>
      <div class="card-hint ${s.key}">${s.hint}</div>
      <div class="stat-row">
        <span class="label">日均还能花</span>
        <span class="value">¥${formatInt(r.dailyAvailable)}</span>
      </div>
    </div>`;
}

function wireToday() {
  document.querySelector('[data-action="settings"]').addEventListener('click', () => {
    state.form = newForm(state.settings);
    state.view = 'settings';
    render();
  });
  document.querySelector('[data-action="history"]').addEventListener('click', () => {
    state.view = 'history';
    render();
  });

  const input = document.getElementById('amountInput');
  if (!input) return;
  const lookBtn = document.getElementById('lookBtn');
  input.addEventListener('input', () => {
    const v = input.value.replace(/\D/g, '').slice(0, 6);
    input.value = v;
    state.input = v;
    lookBtn.disabled = !v.trim();
  });
  lookBtn.addEventListener('click', () => {
    const amount = Number(state.input.trim());
    if (!Number.isFinite(amount)) return;
    const r = evaluate(amount, TODAY, state.settings);
    state.submitted = amount;
    appendSnapshot(TODAY, amount, r.status);
    input.blur();
    render();
  });
}

// ---------- 历史 ----------

function viewHistory() {
  const rows = state.snapshots
    .map(
      (s, i) => `
      <div class="history-row">
        <span class="date">${fmtMD(s.date)}</span>
        <span class="amount">¥${formatInt(s.remaining)}</span>
        <span class="emoji">${s.status ? STATUS_STYLES[s.status]?.emoji ?? '' : ''}</span>
        <button class="delete-btn" data-delete="${i}" aria-label="删除">×</button>
      </div>`
    )
    .join('');

  const list = state.snapshots.length
    ? rows
    : `<p class="empty">还没有记录
查看一次健康度后就会出现在这里</p>`;

  const modal =
    state.deleteIndex != null
      ? `
      <div class="modal-mask" id="modalMask">
        <div class="modal">
          <h3>删除这条记录？</h3>
          <p>删除后不可恢复</p>
          <div class="modal-actions">
            <button class="btn-text" data-action="cancel-delete">取消</button>
            <button class="btn-danger-text" data-action="confirm-delete">删除</button>
          </div>
        </div>
      </div>`
      : '';

  return `
  <div class="top-bar">
    <button class="back-btn" data-action="back" aria-label="返回">
      <svg width="12" height="20" viewBox="0 0 12 20" fill="none"><path d="M10 2L2 10l8 8" stroke="#757575" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <h1>历史</h1>
  </div>
  <div class="page">${list}</div>
  ${modal}`;
}

function wireHistory() {
  document.querySelector('[data-action="back"]').addEventListener('click', () => {
    state.view = 'today';
    render();
  });
  document.querySelectorAll('[data-delete]').forEach((el) => {
    el.addEventListener('click', () => {
      state.deleteIndex = Number(el.dataset.delete);
      render();
    });
  });
  const cancel = document.querySelector('[data-action="cancel-delete"]');
  if (cancel) {
    cancel.addEventListener('click', () => {
      state.deleteIndex = null;
      render();
    });
  }
  const confirm = document.querySelector('[data-action="confirm-delete"]');
  if (confirm) {
    confirm.addEventListener('click', () => {
      deleteSnapshotAt(state.deleteIndex);
      state.deleteIndex = null;
      render();
    });
  }
}

// 设置页返回
app.addEventListener('click', (e) => {
  const back = e.target.closest('[data-action="back"]');
  if (back && state.view === 'settings') {
    state.form = null;
    state.view = 'today';
    render();
  }
});

render();

// Service Worker：离线可用
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
