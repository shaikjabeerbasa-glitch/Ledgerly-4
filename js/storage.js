import { validMoney } from './money.js';
import { isValidDate } from './validation.js';
import { STORAGE_KEY as STORAGE_KEY_CONSTANT, normalizeState, state as currentState, createDefaultState } from './state.js';

export const STORAGE_KEY = STORAGE_KEY_CONSTANT;

function initialState() {
  const result = createDefaultState();
  try { result.theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch {}
  return normalizeState(result);
}
export function readPersistedState() {
  try { const raw = localStorage.getItem(STORAGE_KEY); const data = raw && JSON.parse(raw); return validateStateIntegrity(data) ? normalizeState(data) : null; } catch { return null; }
}
function hostileKeys(value) {
  if (!value || typeof value !== 'object') return false;
  return Object.keys(value).some(k => ['__proto__', 'constructor', 'prototype'].includes(k) || hostileKeys(value[k]));
}
export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return initialState();
    }

    const parsed = JSON.parse(raw);
    if (!validateStateIntegrity(parsed)) {
      try { localStorage.setItem(`${STORAGE_KEY}-corrupt-backup`, raw); } catch {}
      throw new Error('Saved data failed validation. A recovery copy was retained.');
    }
    const repaired = normalizeState(parsed);

    const hasCorruptedLegacyData = !validateStateIntegrity(repaired);
    if (hasCorruptedLegacyData) {
      const freshState = normalizeState(createDefaultState());
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(freshState));
      } catch (error) {
        // Ignore storage write errors in restricted browser environments.
      }
      return freshState;
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(repaired));
    } catch (error) {
      // Ignore storage write errors in restricted browser environments.
    }
    return repaired;
  } catch (error) {
    console.warn('Could not load stored state, using defaults.', error);
    try { const original = localStorage.getItem(STORAGE_KEY); if (original) localStorage.setItem(`${STORAGE_KEY}-corrupt-backup`, original); } catch {}
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (removeError) {
      // Ignore cleanup failures.
    }
    return initialState();
  }
}

export function validateStateIntegrity(data) {
  try {
    if (!data || hostileKeys(data) || !['accounts', 'categories', 'transactions', 'budgets', 'recurring'].every(k => Array.isArray(data[k]))) return false;
    const ids = items => items.every(x => x && typeof x.id === 'string' && /^[a-zA-Z0-9_-]+$/.test(x.id)) && new Set(items.map(x => x.id)).size === items.length;
    if (!['accounts','categories','transactions','budgets','recurring'].every(k => ids(data[k]))) return false;
    const accounts = new Set(data.accounts.map(a => a.id)), categories = new Set(data.categories.map(c => c.id));
    if (data.accounts.some(a => typeof a.name !== 'string' || !a.name.trim() || !['cash','bank','credit','investment','loan','other'].includes(a.type) || (typeof a.openingBalance !== 'number' || !validMoney(a.openingBalance, { signed: true })) || !/^#[0-9a-f]{6}$/i.test(a.color))) return false;
    if (data.categories.some(c => typeof c.name !== 'string' || !c.name.trim() || (c.parentId && (!categories.has(c.parentId) || c.parentId === c.id || data.categories.find(p => p.id === c.parentId).parentId)))) return false;
    const groups = new Map();
    for (const t of data.transactions) {
      if (!accounts.has(t.accountId) || !['income','expense','transfer'].includes(t.type) || (typeof t.amount !== 'number' || !validMoney(t.amount, { positive: true })) || !isValidDate(t.date) || (t.categoryId && !categories.has(t.categoryId))) return false;
      if (['payee','notes'].some(key => t[key] !== undefined && typeof t[key] !== 'string') || (t.tags !== undefined && typeof t.tags !== 'string' && (!Array.isArray(t.tags) || t.tags.some(tag => typeof tag !== 'string')))) return false;
      if (t.type === 'transfer') {
        if (!t.transferGroupId || !['source','destination'].includes(t.transferSide) || t.categoryId) return false;
        groups.set(t.transferGroupId, [...(groups.get(t.transferGroupId) || []), t]);
      } else if (t.transferGroupId || t.transferSide) return false;
    }
    for (const pair of groups.values()) {
      if (pair.length !== 2 || pair[0].transferSide === pair[1].transferSide || pair[0].accountId === pair[1].accountId || pair[0].amount !== pair[1].amount || pair[0].date !== pair[1].date) return false;
    }
    const budgetKeys = new Set();
    for (const b of data.budgets) {
      const key = b.categoryId + ':' + b.month;
      if (!categories.has(b.categoryId) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(b.month) || (typeof b.limit !== 'number' || !validMoney(b.limit)) || budgetKeys.has(key)) return false;
      budgetKeys.add(key);
    }
    for (const r of data.recurring) {
      if (typeof r.title !== 'string' || !r.title.trim() || (r.payee !== undefined && typeof r.payee !== 'string')) return false;
      if (!accounts.has(r.accountId) || (r.categoryId && !categories.has(r.categoryId)) || !['income','expense'].includes(r.type) || (typeof r.amount !== 'number' || !validMoney(r.amount, { positive: true })) || !isValidDate(r.nextRunDate) || !['daily','weekly','monthly','custom'].includes(r.interval) || (r.interval === 'custom' && (!Number.isSafeInteger(r.customDays) || r.customDays < 1 || r.customDays > 36500)) || (r.anchorDay !== undefined && (!Number.isInteger(r.anchorDay) || r.anchorDay < 1 || r.anchorDay > 31)) || !Array.isArray(r.processedDates) || r.processedDates.some(d => !isValidDate(d))) return false;
    }
    return true;
  } catch { return false; }
}

export function saveState(nextState) {
  try {
    const normalized = normalizeState(nextState ?? createDefaultState());
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return true;
  } catch (error) {
    console.warn('Could not save state', error);
    return false;
  }
}

export function exportJsonBackup() {
  const json = JSON.stringify(currentState, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = 'ledgerly-backup.json';
  link.click();
  URL.revokeObjectURL(href);
}

export function importJsonBackup(fileText) {
  try {
    if (String(fileText).length > 10 * 1024 * 1024) throw new Error('Backup exceeds 10 MB.');
    const parsed = JSON.parse(fileText);
    if (!validateStateIntegrity(parsed)) {
      throw new Error('The JSON backup does not contain a valid Ledgerly state.');
    }
    return normalizeState(parsed);
  } catch (error) {
    throw new Error('The JSON backup is invalid or unreadable.');
  }
}

export function exportCsvTransactions(rows) {
  const headers = ['date', 'type', 'account', 'accountId', 'category', 'categoryId', 'toAccount', 'payee', 'amount', 'notes', 'tags'];
  const csvRows = [headers.join(',')];
  rows.forEach((txn) => {
    const normalizedTags = Array.isArray(txn.tags)
      ? txn.tags
      : typeof txn.tags === 'string'
        ? txn.tags.split(',').map((tag) => tag.trim()).filter(Boolean)
        : [];
    const row = [
      txn.date || '',
      txn.type || '',
      txn.account || txn.accountName || '',
      txn.accountId || '',
      txn.category || txn.categoryName || '',
      txn.categoryId || '',
      txn.toAccount || '',
      txn.payee || '',
      txn.amount || '',
      txn.notes || '',
      normalizedTags.join('; ')
    ].map((value) => `"${String(value).replace(/"/g, '""')}"`);
    csvRows.push(row.join(','));
  });
  return csvRows.join('\n');
}

export function parseCsvText(text) {
  const records = []; let row = [], value = '', quoted = false;
  text = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i+1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (c === ',' && !quoted) { row.push(value); value = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i+1] === '\n') i++;
      row.push(value); if (row.some(v => v.trim())) records.push(row); row = []; value = '';
    } else value += c;
  }
  if (quoted) throw new Error('Unclosed CSV quotation.');
  row.push(value); if (row.some(v => v.trim())) records.push(row);
  if (!records.length) return [];
  const headers = records.shift().map(v => v.trim());
  if (headers.some(h => !h) || new Set(headers).size !== headers.length) throw new Error('CSV headers must be unique and nonempty.');
  return records.map((values, index) => {
    if (values.length !== headers.length) throw new Error(`Row ${index+2}: column count differs from header.`);
    return Object.fromEntries(headers.map((h, i) => [h, values[i].trim()]));
  });
}
