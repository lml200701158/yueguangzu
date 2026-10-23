// localStorage 胶水层：设置 + 历史快照。数据仅存本机，清除浏览器数据会丢。
// 与 Android 版存储格式不同（JSON vs key=value 文本），互不迁移（无导入导出）。

const KEY_SETTINGS = 'budget_guard_settings';
const KEY_SNAPSHOTS = 'budget_guard_snapshots';

export const MAX_ENTRIES = 200;

export const DEFAULT_SETTINGS = Object.freeze({
  budget: 0,
  periodType: 'CALENDAR_MONTH',
  paydayStart: null,
  paydayEnd: null,
  weekendMultiplier: 1,
});

/** 是否已完成首次配置（budget > 0 视为已配置，同 Settings.isConfigured） */
export function isConfigured(settings) {
  return settings.budget > 0;
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY_SETTINGS);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  localStorage.setItem(KEY_SETTINGS, JSON.stringify(settings));
}

/** 快照列表，新在前，最多 MAX_ENTRIES 条 */
export function loadSnapshots() {
  try {
    const raw = localStorage.getItem(KEY_SNAPSHOTS);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.slice(0, MAX_ENTRIES) : [];
  } catch {
    return [];
  }
}

function saveSnapshots(list) {
  localStorage.setItem(KEY_SNAPSHOTS, JSON.stringify(list.slice(0, MAX_ENTRIES)));
}

/** 追加一次输入（每次提交都记一条，不做同日去重，同 SnapshotStore.append） */
export function appendSnapshot(date, remaining, status) {
  const updated = [{ date, remaining, status }, ...loadSnapshots()].slice(0, MAX_ENTRIES);
  saveSnapshots(updated);
}

export function deleteSnapshotAt(index) {
  const current = loadSnapshots();
  if (index >= 0 && index < current.length) {
    current.splice(index, 1);
    saveSnapshots(current);
  }
}
