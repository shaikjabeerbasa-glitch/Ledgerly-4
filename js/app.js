import {
  createDefaultState,
  createDemoState,
  generateId,
  getAccountById,
  getCategoryById,
  getCategoryPath,
  getFilteredTransactions,
  getPaginatedTransactions,
  normalizeState,
  setState,
  state,
  getState
} from './state.js';
import { STORAGE_KEY, importJsonBackup, loadState, exportJsonBackup, exportCsvTransactions, parseCsvText, saveState, readPersistedState, validateStateIntegrity } from './storage.js';
import { bindRouteHandler, getRouteFromHash, setHashRoute } from './routing.js';
import { renderApp, renderCharts } from './render.js';
import {
  isValidDate,
  validateAccountForm,
  validateBudgetForm,
  validateCategoryForm,
  validateCsvRow,
  validateRecurringForm,
  validateTransactionForm
} from './validation.js';

const history = { past: [], future: [] };

function snapshot(source = state) {
  return JSON.stringify({
    accounts: source.accounts,
    categories: source.categories,
    transactions: source.transactions,
    budgets: source.budgets,
    recurring: source.recurring,
    theme: source.theme,
    currency: source.currency
  });
}

let knownSnapshot = '';
function updateHistoryControls() {
  document.getElementById('undo-btn').disabled = !history.past.length;
  document.getElementById('redo-btn').disabled = !history.future.length;
}
function syncExternalChanges() {
  const saved = readPersistedState();
  if (saved && knownSnapshot && snapshot(saved) !== knownSnapshot) {
    setState({ ...saved, ui: state.ui });
    knownSnapshot = snapshot();
    history.past = []; history.future = [];
    updateHistoryControls();
    return true;
  }
  return false;
}
function withWriteLock(action) {
  if (globalThis.navigator?.locks) {
    return navigator.locks.request('ledgerly-state-write', action).catch(error => showToast(error.message || 'Could not complete action.'));
  }
  return action();
}
function persistAndRender(dataChange = false) {
  if (!dataChange) return withWriteLock(() => { syncExternalChanges(); return persistAndRender(true); });
  renderApp(); updateHistoryControls();
  const saved = saveState(state);
  if (saved) knownSnapshot = snapshot();
  const notice = document.getElementById('storage-notice');
  notice.hidden = saved;
  if (!saved) showToast('Could not save. Changes are in memory only; export a JSON backup.');
  return saved;
}
function commitChange(description, mutator) {
  return withWriteLock(() => {
    syncExternalChanges();
    const before = snapshot();
    const ui = structuredClone(state.ui);
    try {
      mutator();
      if (!validateStateIntegrity(state)) throw new Error('This change is no longer valid. Check accounts and categories, then retry.');
    } catch (error) {
      setState({ ...JSON.parse(before), ui });
      renderApp(); showToast(error.message); return;
    }
    if (before === snapshot()) return;
    history.past.push({ before, description });
    if (history.past.length > 20) history.past.shift();
    history.future = [];
    const saved = persistAndRender(true);
    if (saved) showToast(description);
  });
}
function undo() {
  return withWriteLock(() => {
    if (syncExternalChanges()) { renderApp(); showToast('History reset because another tab changed data.'); return; }
    if (!history.past.length) return;
    const last = history.past.pop();
    history.future.push({ before: snapshot() });
    setState({ ...JSON.parse(last.before), ui: state.ui });
    persistAndRender(true);
  });
}
function redo() {
  return withWriteLock(() => {
    if (syncExternalChanges()) { renderApp(); showToast('History reset because another tab changed data.'); return; }
    if (!history.future.length) return;
    const next = history.future.pop();
    history.past.push({ before: snapshot(), description: 'Redo action' });
    setState({ ...JSON.parse(next.before), ui: state.ui });
    persistAndRender(true);
  });
}

function showToast(message) {
  const toastContainer = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 2200);
}

function prepareDefaultFilters() {
  state.ui.filters = {
    startDate: '',
    endDate: '',
    accountId: '',
    categoryId: '',
    type: '',
    minAmount: '',
    maxAmount: '',
    search: ''
  };
  state.ui.sort = [{ key: 'date', direction: 'desc' }];
  state.ui.page = 1;
}


function setRoute(route) {
  state.ui.route = route;
  setHashRoute(route);
  state.ui.route = getRouteFromHash();
  renderApp();
}

function addAccount(values) {
  const errors = validateAccountForm(values);
  if (Object.keys(errors).length) {
    showToast(Object.values(errors)[0]);
    return;
  }

  if (state.accounts.some(a => a.id !== values.accountId && a.name.toLowerCase() === String(values.name).trim().toLowerCase())) return showToast('An account with that name already exists.');
  const normalizedOpeningBalance = Number(values.openingBalance ?? 0);
  const account = {
    id: values.accountId || generateId('account'),
    name: String(values.name).trim(),
    type: values.type,
    openingBalance: Number.isFinite(normalizedOpeningBalance) ? normalizedOpeningBalance : 0,
    color: values.color || '#2563eb'
  };

  commitChange('Account saved', () => {
    if (state.accounts.some(a => a.id !== account.id && a.name.toLowerCase() === account.name.toLowerCase())) throw new Error('An account with that name already exists.');
    if (values.accountId && !state.accounts.some(a => a.id === account.id)) throw new Error('This account was deleted in another tab.');
    const existingIndex = state.accounts.findIndex((item) => item.id === account.id);
    if (existingIndex >= 0) {
      state.accounts[existingIndex] = account;
    } else {
      state.accounts.push(account);
    }
  });

  const form = document.getElementById('account-form');
  form.reset();
  const hiddenField = form.querySelector('input[name="accountId"]');
  if (hiddenField) hiddenField.value = '';
  document.getElementById('account-form-title').textContent = 'Add account';
  renderApp();
}

function deleteAccount(accountId) {
  const account = state.accounts.find((item) => item.id === accountId);
  if (!account) return;

  const connectedTransactions = state.transactions.filter((txn) => txn.accountId === accountId);
  const shouldDelete = connectedTransactions.length === 0 || window.confirm(
    `Delete "${account.name}"? This will remove its linked transaction history and any transfer records tied to this account.`
  );

  if (!shouldDelete) return;

  commitChange('Account deleted', () => {
    state.accounts = state.accounts.filter((item) => item.id !== accountId);
    state.recurring = state.recurring.filter(rule => rule.accountId !== accountId);
    state.transactions = state.transactions.filter((txn) => txn.accountId !== accountId && !(txn.transferGroupId && state.transactions.some((candidate) => candidate.accountId === accountId && candidate.transferGroupId === txn.transferGroupId)));
    state.ui.selectedTransactionIds = state.ui.selectedTransactionIds.filter((id) => state.transactions.some((txn) => txn.id === id));
  });
}

function populateAccountForm(accountId) {
  const account = getAccountById(accountId);
  if (!account) return;
  const form = document.getElementById('account-form');
  form.elements.namedItem('accountId').value = account.id;
  form.elements.namedItem('name').value = account.name;
  form.elements.namedItem('type').value = account.type;
  form.elements.namedItem('openingBalance').value = String(account.openingBalance || 0);
  form.elements.namedItem('color').value = account.color || '#2563eb';
  document.getElementById('account-form-title').textContent = 'Edit account';
}

function addCategory(values) {
  const currentId = values.categoryId || '';
  const errors = validateCategoryForm(values, state.categories, currentId);
  if (Object.keys(errors).length) {
    showToast(Object.values(errors)[0]);
    return;
  }
  if (state.categories.some(c => c.id !== currentId && (c.parentId || '') === (values.parentId || '') && c.name.toLowerCase() === String(values.name).trim().toLowerCase())) return showToast('A category with that name already exists under this parent.');
  const category = {
    id: currentId || generateId('category'),
    name: String(values.name).trim(),
    parentId: values.parentId || null
  };

  commitChange('Category saved', () => {
    if (state.categories.some(c => c.id !== category.id && c.parentId === category.parentId && c.name.toLowerCase() === category.name.toLowerCase())) throw new Error('A category with that name already exists under this parent.');
    if (currentId && !state.categories.some(c => c.id === currentId)) throw new Error('This category was deleted in another tab.');
    const index = state.categories.findIndex((item) => item.id === category.id);
    if (index >= 0) {
      state.categories[index] = category;
    } else {
      state.categories.push(category);
    }
  });

  document.getElementById('category-form').reset();
  document.querySelector('#category-form input[name="categoryId"]').value = '';
  document.getElementById('category-form-title').textContent = 'Add category';
}

function deleteCategory(categoryId) {
  if (!window.confirm('Delete this category and its children, budgets and recurring rules? Historical transactions will become uncategorized.')) return;
  commitChange('Category deleted', () => {
    const children = new Set();
    const visited = new Set();
    const collectChildren = (currentId) => {
      if (visited.has(currentId)) return;
      visited.add(currentId);
      state.categories
        .filter((cat) => cat.parentId === currentId)
        .forEach((child) => {
          children.add(child.id);
          collectChildren(child.id);
        });
    };
    collectChildren(categoryId);

    state.categories = state.categories.filter((cat) => cat.id !== categoryId && !children.has(cat.id));
    state.transactions = state.transactions.map((txn) =>
      txn.categoryId && (txn.categoryId === categoryId || children.has(txn.categoryId))
        ? { ...txn, categoryId: null }
        : txn
    );
    state.budgets = state.budgets.filter((budget) => budget.categoryId !== categoryId && !children.has(budget.categoryId));
    state.recurring = state.recurring.filter(rule => rule.categoryId !== categoryId && !children.has(rule.categoryId));
  });
}

function populateCategoryForm(categoryId) {
  const category = getCategoryById(categoryId);
  if (!category) return;
  const form = document.getElementById('category-form');
  form.elements.namedItem('categoryId').value = category.id;
  form.elements.namedItem('name').value = category.name;
  form.elements.namedItem('parentId').value = category.parentId || '';
  document.getElementById('category-form-title').textContent = 'Edit category';
}

function addBudget(values) {
  const errors = validateBudgetForm(values);
  if (Object.keys(errors).length) {
    showToast(Object.values(errors)[0]);
    return;
  }
  if (state.budgets.some(b => b.id !== values.budgetId && b.categoryId === values.categoryId && b.month === values.month)) return showToast('A budget already exists for this category and month.');
  const budget = {
    id: values.budgetId || generateId('budget'),
    categoryId: values.categoryId,
    month: values.month,
    limit: Number(values.limit)
  };
  commitChange('Budget saved', () => {
    const index = state.budgets.findIndex((item) => item.id === budget.id);
    if (index >= 0) {
      state.budgets[index] = budget;
    } else {
      state.budgets.push(budget);
    }
  });
  document.getElementById('budget-form').reset();
  document.querySelector('#budget-form input[name="budgetId"]').value = '';
  document.getElementById('budget-form-title').textContent = 'Add budget';
}

function deleteBudget(budgetId) {
  commitChange('Budget deleted', () => {
    state.budgets = state.budgets.filter((budget) => budget.id !== budgetId);
  });
}

function populateBudgetForm(budgetId) {
  const budget = state.budgets.find((item) => item.id === budgetId);
  if (!budget) return;
  const form = document.getElementById('budget-form');
  form.elements.namedItem('budgetId').value = budget.id;
  form.elements.namedItem('categoryId').value = budget.categoryId;
  form.elements.namedItem('month').value = budget.month;
  form.elements.namedItem('limit').value = String(budget.limit || 0);
  document.getElementById('budget-form-title').textContent = 'Edit budget';
}

function addRecurring(values) {
  const errors = validateRecurringForm(values, state.accounts, state.categories);
  if (Object.keys(errors).length) {
    showToast(Object.values(errors)[0]);
    return;
  }
  const rule = {
    id: values.recurringId || generateId('recurring'),
    title: String(values.title).trim(),
    type: values.type,
    amount: Number(values.amount),
    accountId: values.accountId,
    categoryId: values.categoryId || null,
    interval: values.interval,
    customDays: values.interval === 'custom' ? Number(values.customDays || 1) : 1,
    nextRunDate: values.nextRunDate,
    payee: values.payee || '',
    processedDates: state.recurring.find(r => r.id === values.recurringId)?.processedDates || [],
    anchorDay: state.recurring.find(r => r.id === values.recurringId)?.anchorDay || Number(values.nextRunDate.slice(8))
  };

  commitChange('Recurring rule saved', () => {
    const index = state.recurring.findIndex((item) => item.id === rule.id);
    if (index >= 0) {
      state.recurring[index] = rule;
    } else {
      state.recurring.push(rule);
    }
    applyRecurringTransactions(false);
  });
  document.getElementById('recurring-form').reset();
  document.querySelector('#recurring-form input[name="recurringId"]').value = '';
  document.getElementById('recurring-form-title').textContent = 'Add recurring rule';
}

function deleteRecurring(recurringId) {
  commitChange('Recurring rule deleted', () => {
    state.recurring = state.recurring.filter((rule) => rule.id !== recurringId);
  });
}

function populateRecurringForm(recurringId) {
  const rule = state.recurring.find((item) => item.id === recurringId);
  if (!rule) return;
  const form = document.getElementById('recurring-form');
  form.elements.namedItem('recurringId').value = rule.id;
  form.elements.namedItem('title').value = rule.title;
  form.elements.namedItem('type').value = rule.type;
  form.elements.namedItem('amount').value = String(rule.amount || 0);
  form.elements.namedItem('accountId').value = rule.accountId;
  form.elements.namedItem('categoryId').value = rule.categoryId || '';
  form.elements.namedItem('interval').value = rule.interval;
  form.elements.namedItem('customDays').value = String(rule.customDays || 7);
  form.elements.namedItem('nextRunDate').value = rule.nextRunDate;
  form.elements.namedItem('payee').value = rule.payee || '';
  document.getElementById('recurring-form-title').textContent = 'Edit recurring rule';
  const customWrap = document.getElementById('custom-days-wrap');
  customWrap.classList.toggle('hidden', form.elements.namedItem('interval').value !== 'custom');
}

function syncTransactionFormType() {
  const form = document.getElementById('transaction-form');
  const type = form.elements.namedItem('type').value;
  const isTransfer = type === 'transfer';
  document.getElementById('transfer-target-wrap').classList.toggle('hidden', !isTransfer);
  const categoryField = form.elements.namedItem('categoryId');
  if (isTransfer) {
    categoryField.value = '';
    categoryField.disabled = true;
  } else {
    categoryField.disabled = false;
  }
}

function addTransaction(formData) {
  const values = Object.fromEntries(formData.entries());
  values.type = values.type || 'expense';
  const errors = validateTransactionForm(values, state.accounts, state.categories);
  if (Object.keys(errors).length) {
    showToast(Object.values(errors)[0]);
    return;
  }

  commitChange('Transaction saved', () => {
    const transactionId = values.transactionId || generateId('txn');
    const previous = state.transactions.find(t => t.id === transactionId);
    if (previous && previous.type !== values.type) {
      state.transactions = state.transactions.filter(t => previous.transferGroupId ? t.transferGroupId !== previous.transferGroupId : t.id !== previous.id);
    }
    const isEdit = Boolean(values.transactionId);
    if (isEdit && !previous) throw new Error('This transaction was deleted in another tab.');

    if (values.type === 'transfer') {
      const transferGroupId = values.transferGroupId || generateId('transfer');
      const amount = Number(values.amount);
      const sourceAccountId = values.accountId;
      const targetAccountId = values.toAccountId;

      const matched = state.transactions.filter((row) => row.transferGroupId === transferGroupId);
      state.transactions = state.transactions.filter((row) => row.transferGroupId !== transferGroupId);

      const sourceToken = {
        id: isEdit ? matched.find((row) => row.transferSide === 'source')?.id || generateId('txn') : generateId('txn'),
        accountId: sourceAccountId,
        type: 'transfer',
        amount,
        date: values.date,
        categoryId: null,
        payee: values.payee || 'Transfer',
        notes: values.notes || '',
        tags: parseTags(values.tags),
        transferGroupId,
        transferSide: 'source'
      };

      const targetToken = {
        id: isEdit ? matched.find((row) => row.transferSide === 'destination')?.id || generateId('txn') : generateId('txn'),
        accountId: targetAccountId,
        type: 'transfer',
        amount,
        date: values.date,
        categoryId: null,
        payee: values.payee || 'Transfer',
        notes: values.notes || '',
        tags: parseTags(values.tags),
        transferGroupId,
        transferSide: 'destination'
      };

      state.transactions.push(sourceToken, targetToken);
      return;
    }

    const transaction = {
      id: transactionId,
      accountId: values.accountId,
      type: values.type,
      amount: Number(values.amount),
      date: values.date,
      categoryId: values.categoryId || null,
      payee: values.payee || '',
      notes: values.notes || '',
      tags: parseTags(values.tags),
      transferGroupId: null,
      transferSide: null
    };

    const index = state.transactions.findIndex((item) => item.id === transaction.id);
    if (index >= 0) {
      state.transactions[index] = transaction;
    } else {
      state.transactions.push(transaction);
    }
  });

  document.getElementById('transaction-form').reset();
  document.querySelector('#transaction-form input[name="transactionId"]').value = '';
  document.querySelector('#transaction-form input[name="transferGroupId"]').value = '';
  document.getElementById('transaction-form-title').textContent = 'Add transaction';
  syncTransactionFormType();
}

function deleteTransaction(transactionId) {
  if (!window.confirm('Delete this transaction? Linked transfer entries are deleted together.')) return;
  const match = state.transactions.find((txn) => txn.id === transactionId);
  if (!match) return;
  commitChange('Transaction deleted', () => {
    if (match.type === 'transfer' && match.transferGroupId) {
      state.transactions = state.transactions.filter((txn) => txn.transferGroupId !== match.transferGroupId);
    } else {
      state.transactions = state.transactions.filter((txn) => txn.id !== transactionId);
    }
    state.ui.selectedTransactionIds = state.ui.selectedTransactionIds.filter((id) => id !== transactionId);
  });
}

function populateTransactionForm(transactionId) {
  const txn = state.transactions.find((item) => item.id === transactionId);
  if (!txn) return;
  const form = document.getElementById('transaction-form');
  form.elements.namedItem('transactionId').value = txn.id;
  form.elements.namedItem('type').value = txn.type;
  form.elements.namedItem('date').value = txn.date;
  form.elements.namedItem('accountId').value = txn.accountId;
  form.elements.namedItem('amount').value = String(txn.amount || 0);
  form.elements.namedItem('categoryId').value = txn.categoryId || '';
  form.elements.namedItem('payee').value = txn.payee || '';
  form.elements.namedItem('notes').value = txn.notes || '';
  form.elements.namedItem('tags').value = (txn.tags || []).join(', ');

  form.elements.namedItem('transferGroupId').value = txn.transferGroupId || '';

  if (txn.type === 'transfer') {
    const pair = state.transactions.find((row) => row.transferGroupId === txn.transferGroupId && row.id !== txn.id);
    const source = txn.transferSide === 'source' ? txn : pair;
    const destination = txn.transferSide === 'destination' ? txn : pair;
    form.elements.namedItem('accountId').value = source?.accountId || '';
    form.elements.namedItem('toAccountId').value = destination?.accountId || '';
  }

  document.getElementById('transaction-form-title').textContent = 'Edit transaction';
  syncTransactionFormType();
}

function applyTransactionFilters(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  state.ui.filters = {
    startDate: formData.get('startDate') || '',
    endDate: formData.get('endDate') || '',
    accountId: formData.get('accountId') || '',
    categoryId: formData.get('categoryId') || '',
    type: formData.get('type') || '',
    minAmount: formData.get('minAmount') || '',
    maxAmount: formData.get('maxAmount') || '',
    search: formData.get('search') || ''
  };
  state.ui.page = 1;
  state.ui.selectedTransactionIds = [];
  persistAndRender();
}

function resetTransactionFilters() {
  prepareDefaultFilters();
  state.ui.selectedTransactionIds = [];
  const form = document.getElementById('transaction-filter-form');
  form.reset();
  persistAndRender();
}

function bulkDeleteSelected() {
  const ids = [...state.ui.selectedTransactionIds];
  if (!ids.length) return showToast('Select transactions to delete.');
  if (!window.confirm(`Delete ${ids.length} selected transactions? Transfer peers are included.`)) return;
  commitChange('Bulk delete completed', () => {
    const deleteIds = new Set(ids);
    const transferGroups = new Set();
    state.transactions.forEach((txn) => {
      if (deleteIds.has(txn.id) && txn.transferGroupId) transferGroups.add(txn.transferGroupId);
    });
    state.transactions = state.transactions.filter((txn) => !deleteIds.has(txn.id) && !(txn.transferGroupId && transferGroups.has(txn.transferGroupId)));
    state.ui.selectedTransactionIds = [];
  });
}

function bulkRecategorize() {
  const categoryId = document.getElementById('bulk-category-select').value;
  if (!categoryId || !state.ui.selectedTransactionIds.length) {
    showToast('Select a category and one or more transactions.');
    return;
  }

  commitChange('Bulk re-categorize applied', () => {
    state.transactions = state.transactions.map((txn) => {
      if (txn.type === 'transfer' || !state.ui.selectedTransactionIds.includes(txn.id)) {
        return txn;
      }
      return { ...txn, categoryId };
    });
    state.ui.selectedTransactionIds = [];
  });
}

function parseTags(value) {
  return String(value || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag, index, all) => tag && all.indexOf(tag) === index);
}

function formatKeyboardDateDigits(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length !== 8) return '';

  let year = digits.slice(0, 4);
  let month = digits.slice(4, 6);
  let day = digits.slice(6, 8);

  if (Number(digits.slice(0, 2)) <= 12 && Number(digits.slice(2, 4)) <= 31) {
    month = digits.slice(0, 2);
    day = digits.slice(2, 4);
    year = digits.slice(4, 8);
  }

  if (!/^[1-9]\d{3}$/.test(year) || Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) {
    return '';
  }

  const iso = `${year}-${String(Number(month)).padStart(2, '0')}-${String(Number(day)).padStart(2, '0')}`;
  return isValidDate(iso) ? iso : '';
}

function normalizeDateInputs() {
  document.querySelectorAll('input[type="date"], input[type="month"]').forEach((input) => {
    input.type = 'text';
    input.setAttribute('inputmode', 'numeric');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('placeholder', input.name === 'month' ? 'YYYY-MM' : 'YYYY-MM-DD');
  });
}

function handleKeyboardDateInput(event) {
  const target = event.target;
  const isInputElement = target && typeof target === 'object' && 'value' in target && (typeof HTMLInputElement === 'undefined' ? target.tagName === 'INPUT' : target instanceof HTMLInputElement);
  if (!isInputElement) return;
  if (!['date', 'nextRunDate', 'startDate', 'endDate', 'month'].includes(target.name)) return;

  const digits = target.value.replace(/\D/g, '');
  if (target.name === 'month') {
    if (/^\d{6}$/.test(digits)) {
      const year = digits.slice(0, 4);
      const month = digits.slice(4, 6);
      const iso = `${year}-${month}`;
      if (/^\d{4}-(0[1-9]|1[0-2])$/.test(iso)) target.value = iso;
    }
    return;
  }

  if (/^\d{8}$/.test(digits)) {
    const iso = formatKeyboardDateDigits(digits);
    if (iso) target.value = iso;
  }
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addInterval(dateValue, interval, customDays = 1, anchorDay = Number(dateValue.slice(8))) {
  const date = new Date(`${dateValue}T00:00:00`);
  if (interval === 'daily') date.setDate(date.getDate() + 1);
  if (interval === 'weekly') date.setDate(date.getDate() + 7);
  if (interval === 'monthly') {
    date.setDate(1); date.setMonth(date.getMonth() + 1);
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    date.setDate(Math.min(anchorDay, lastDay));
  }
  if (interval === 'custom') date.setDate(date.getDate() + Number(customDays || 1));
  return date;
}

function applyRecurringTransactions(render = true) {
  if (!Array.isArray(state.recurring) || !state.recurring.length) return;

  const validIntervals = new Set(['daily', 'weekly', 'monthly', 'custom']);
  let changed = false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  state.recurring.forEach((rule) => {
    if (!rule || !state.accounts.some(a => a.id === rule.accountId) || !validIntervals.has(rule.interval)) return;
    rule.anchorDay ||= Number(rule.nextRunDate.slice(8));

    const seenDates = new Set([...(rule.processedDates || []), ...state.transactions.filter(t => t.recurringRuleId === rule.id).map(t => t.date)]);
    const initialDate = rule.nextRunDate || formatLocalDate(new Date());
    let currentDate = new Date(`${initialDate}T00:00:00`);
    currentDate.setHours(0, 0, 0, 0);

    let iterations = 0;
    while (currentDate <= today && iterations++ < 10000) {
      const iso = formatLocalDate(currentDate);
      if (!seenDates.has(iso)) {
        state.transactions.push({
          id: generateId('txn'),
          accountId: rule.accountId,
          type: rule.type,
          amount: Number(rule.amount || 0),
          date: iso,
          categoryId: rule.categoryId || null,
          payee: rule.payee || rule.title,
          notes: `Recurring: ${rule.title}`,
          tags: ['recurring'],
          recurringRuleId: rule.id,
          transferGroupId: null,
          transferSide: null
        });
        seenDates.add(iso);
        changed = true;
      }
      currentDate = addInterval(iso, rule.interval, rule.customDays || 1, rule.anchorDay);
    }

    const finalDates = Array.from(seenDates).sort();
    const lastProcessed = finalDates[finalDates.length - 1];
    if (lastProcessed) {
      const nextRun = addInterval(lastProcessed, rule.interval, rule.customDays || 1, rule.anchorDay);
      rule.nextRunDate = formatLocalDate(nextRun);
    } else {
      rule.nextRunDate = formatLocalDate(currentDate);
    }
    rule.processedDates = finalDates;
  });

  if (changed && render) {
    persistAndRender(true);
  }
}

function closeCsvModal(restoreFocus = true) {
  const modal = document.getElementById('mapping-modal');
  const wasOpen = !modal.classList.contains('hidden');
  modal.classList.add('hidden'); modal.setAttribute('aria-hidden', 'true');
  document.querySelector('.app-shell').inert = false;
  if (wasOpen && restoreFocus) document.getElementById('open-csv-import').focus();
}

function attachGlobalListeners() {
  document.querySelector('.skip-link').onclick = event => { event.preventDefault(); document.getElementById('main-content').focus(); };
  document.getElementById('open-json-import').onclick = () => document.getElementById('import-json-input').click();
  document.getElementById('open-csv-import').onclick = () => document.getElementById('import-csv-input').click();
  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    const themeToggleHandler = () => {
      syncExternalChanges();
      const nextTheme = state.theme === 'dark' ? 'light' : 'dark';
      commitChange('Theme updated', () => { state.theme = nextTheme; });
      document.body.classList.toggle('dark', nextTheme === 'dark');
      document.body.setAttribute('data-theme', nextTheme);
      themeToggle.textContent = nextTheme === 'dark' ? '☀️' : '🌙';
      renderApp();
    };
    themeToggle.onclick = themeToggleHandler;
  }

  ['header-currency-select', 'settings-currency-select'].forEach((id) => {
    const select = document.getElementById(id);
    if (!select) return;
    select.value = state.currency || 'USD';
    select.onchange = (event) => {
      syncExternalChanges();
      const nextCurrency = event.currentTarget.value === 'INR' ? 'INR' : 'USD';
      if (state.currency === nextCurrency) return;
      commitChange('Currency updated', () => { state.currency = nextCurrency; });
    };
  });

  document.addEventListener('keydown', event => {
    const modal = document.getElementById('mapping-modal');
    if (modal.classList.contains('hidden')) return;
    if (event.key === 'Escape') document.getElementById('close-mapping-modal').click();
    if (event.key === 'Tab') {
      const fields = [...modal.querySelectorAll('select, button')];
      const first = fields[0], last = fields.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  document.getElementById('undo-btn').addEventListener('click', undo);
  document.getElementById('redo-btn').addEventListener('click', redo);

  document.body.addEventListener('click', (event) => {
    const dashboardCard = event.target.closest('[data-dashboard-action]');
    if (dashboardCard) {
      const route = `/${dashboardCard.dataset.dashboardAction}`;
      state.ui.route = route;
      setHashRoute(route);
      if (dashboardCard.dataset.filterType) {
        state.ui.filters.type = dashboardCard.dataset.filterType;
      }
      renderApp();
      return;
    }

    const navLink = event.target.closest('a[data-route]');
    if (navLink) {
      const route = navLink.dataset.route;
      event.preventDefault();
      state.ui.route = route;
      setHashRoute(route);
      renderApp();
      return;
    }

    const actionTarget = event.target.closest('[data-action]');
    if (!actionTarget) return;

    const { action, id, page } = actionTarget.dataset;
    event.preventDefault();
    event.stopPropagation();

    if (action === 'edit-account') {
      populateAccountForm(id);
      return;
    }
    if (action === 'delete-account') {
      deleteAccount(id);
      return;
    }
    if (action === 'edit-category') populateCategoryForm(id);
    if (action === 'delete-category') deleteCategory(id);
    if (action === 'edit-budget') populateBudgetForm(id);
    if (action === 'delete-budget') deleteBudget(id);
    if (action === 'edit-recurring') populateRecurringForm(id);
    if (action === 'delete-recurring') deleteRecurring(id);
    if (action === 'edit-transaction') populateTransactionForm(id);
    if (action === 'delete-transaction') deleteTransaction(id);
    if (action === 'goto-page') {
      state.ui.page = Number(page);
      persistAndRender();
    }
  });

  document.body.addEventListener('ledgerly-account-action', (event) => {
    const { action, id } = event.detail || {};
    if (!action) return;
    if (action === 'edit-account') {
      populateAccountForm(id);
      return;
    }
    if (action === 'delete-account') {
      deleteAccount(id);
    }
  });

  document.getElementById('account-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const values = Object.fromEntries(formData.entries());
    addAccount(values);
  });

  document.getElementById('cancel-account-edit').addEventListener('click', () => {
    document.getElementById('account-form').reset();
    document.querySelector('#account-form input[name="accountId"]').value = '';
    document.getElementById('account-form-title').textContent = 'Add account';
  });

  document.getElementById('category-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    addCategory(values);
  });

  document.getElementById('cancel-category-edit').addEventListener('click', () => {
    document.getElementById('category-form').reset();
    document.querySelector('#category-form input[name="categoryId"]').value = '';
    document.getElementById('category-form-title').textContent = 'Add category';
  });

  document.getElementById('budget-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    addBudget(values);
  });

  document.getElementById('cancel-budget-edit').addEventListener('click', () => {
    document.getElementById('budget-form').reset();
    document.querySelector('#budget-form input[name="budgetId"]').value = '';
    document.getElementById('budget-form-title').textContent = 'Add budget';
  });

  document.getElementById('recurring-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    addRecurring(values);
  });

  document.getElementById('cancel-recurring-edit').addEventListener('click', () => {
    document.getElementById('recurring-form').reset();
    document.querySelector('#recurring-form input[name="recurringId"]').value = '';
    document.getElementById('recurring-form-title').textContent = 'Add recurring rule';
    document.getElementById('custom-days-wrap').classList.add('hidden');
  });

  document.getElementById('transaction-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const existingId = formData.get('transactionId');
    const currentTxn = existingId ? state.transactions.find((txn) => txn.id === existingId) : null;
    const transferGroupId = currentTxn?.transferGroupId || formData.get('transferGroupId') || generateId('transfer');
    if (formData.get('type') === 'transfer') {
      formData.set('transferGroupId', transferGroupId);
    }
    addTransaction(formData);
  });

  document.getElementById('cancel-transaction-edit').addEventListener('click', () => {
    document.getElementById('transaction-form').reset();
    document.querySelector('#transaction-form input[name="transactionId"]').value = '';
  document.querySelector('#transaction-form input[name="transferGroupId"]').value = '';
    document.getElementById('transaction-form-title').textContent = 'Add transaction';
    syncTransactionFormType();
  });

  document.getElementById('transaction-form').querySelector('select[name="type"]').addEventListener('change', syncTransactionFormType);
  document.getElementById('recurring-form').querySelector('select[name="interval"]').addEventListener('change', (event) => {
    const customWrap = document.getElementById('custom-days-wrap');
    customWrap.classList.toggle('hidden', event.currentTarget.value !== 'custom');
  });

  document.getElementById('transaction-filter-form').addEventListener('submit', applyTransactionFilters);
  document.getElementById('reset-filters-btn').addEventListener('click', resetTransactionFilters);

  document.getElementById('page-size-select').addEventListener('change', (event) => {
    state.ui.pageSize = Number(event.currentTarget.value || 10);
    state.ui.page = 1;
    persistAndRender();
  });

  document.getElementById('select-all-transactions').addEventListener('change', (event) => {
    const { pageRows } = getPaginatedTransactions();
    const ids = pageRows.map((txn) => txn.id);
    state.ui.selectedTransactionIds = event.currentTarget.checked
      ? Array.from(new Set([...state.ui.selectedTransactionIds, ...ids]))
      : state.ui.selectedTransactionIds.filter((id) => !ids.includes(id));
    persistAndRender();
  });

  document.body.addEventListener('change', (event) => {
    const selector = event.target.closest('.transaction-selector');
    if (!selector) return;
    const id = selector.dataset.transactionId;
    const selected = new Set(state.ui.selectedTransactionIds);
    if (selector.checked) selected.add(id);
    else selected.delete(id);
    state.ui.selectedTransactionIds = Array.from(selected);
    persistAndRender();
  });

  document.body.addEventListener('click', (event) => {
    const sortButton = event.target.closest('.sort-btn');
    if (!sortButton) return;
    const key = sortButton.dataset.sort;
    const currentSort = Array.isArray(state.ui.sort) ? state.ui.sort : [{ key: state.ui.sort?.key || 'date', direction: state.ui.sort?.direction || 'desc' }];
    const existingIndex = currentSort.findIndex((entry) => entry.key === key);
    if (existingIndex >= 0) {
      const nextDirection = currentSort[existingIndex].direction === 'asc' ? 'desc' : 'asc';
      currentSort[existingIndex] = { key, direction: nextDirection };
      currentSort.unshift(currentSort.splice(existingIndex, 1)[0]);
    } else {
      currentSort.unshift({ key, direction: 'desc' });
    }
    state.ui.sort = currentSort.slice(0, 3);
    persistAndRender();
  });

  document.getElementById('bulk-delete-btn').addEventListener('click', bulkDeleteSelected);
  document.getElementById('bulk-recategorize-btn').addEventListener('click', bulkRecategorize);

  document.getElementById('export-json-btn').addEventListener('click', () => {
    exportJsonBackup();
    showToast('JSON backup downloaded.');
  });

  document.getElementById('import-json-input').addEventListener('change', (event) => {
    const [file] = event.target.files;
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { showToast('Import file exceeds the 10 MB limit.'); event.target.value = ''; return; }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const nextState = importJsonBackup(reader.result);
        commitChange('JSON backup imported', () => {
          setState(nextState);
          applyRecurringTransactions(false);
        });
      } catch (error) {
        showToast(error.message || 'The JSON file could not be imported.');
      } finally {
        event.target.value = '';
      }
    };
    reader.readAsText(file);
  });

  document.getElementById('export-csv-btn').addEventListener('click', () => {
    const rows = state.transactions.filter(t => t.type !== 'transfer' || t.transferSide === 'source').map((txn) => {
      const peerAccount = txn.transferGroupId
        ? state.transactions.find((candidate) => candidate.transferGroupId === txn.transferGroupId && candidate.id !== txn.id)?.accountId || ''
        : '';
      return {
        date: txn.date,
        type: txn.type,
        account: getAccountById(txn.accountId)?.name || '',
        accountId: txn.accountId || '',
        category: txn.categoryId ? getCategoryPath(txn.categoryId) : '',
        categoryId: txn.categoryId || '',
        toAccount: peerAccount ? getAccountById(peerAccount)?.name || '' : '',
        payee: txn.payee || '',
        amount: txn.amount,
        notes: txn.notes || '',
        tags: (txn.tags || []).join('; ')
      };
    });
    const csvText = exportCsvTransactions(rows);
    const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = 'ledgerly-transactions.csv';
    link.click();
    URL.revokeObjectURL(href);
    showToast('CSV export downloaded.');
  });

  document.getElementById('import-csv-input').addEventListener('change', (event) => {
    const [file] = event.target.files;
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { showToast('Import file exceeds the 10 MB limit.'); event.target.value = ''; return; }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || '');
        const rows = parseCsvText(text);
        if (!rows.length) {
          showToast('The CSV file is empty.');
          return;
        }

        const headers = Object.keys(rows[0]);
        const mappingFields = ['date', 'type', 'account', 'accountId', 'category', 'categoryId', 'toAccount', 'amount', 'payee', 'notes', 'tags'];
        const mappingHtml = mappingFields
          .map((field) => {
            const options = headers.map((header) => `<option value="${escapeMarkup(header)}">${escapeMarkup(header)}</option>`).join('');
            return `
              <label>
                ${field.toUpperCase()}
                <select name="csv-${field}">
                  <option value="">Auto map</option>
                  ${options}
                </select>
              </label>
            `;
          })
          .join('');
        document.getElementById('csv-mapping-fields').innerHTML = mappingHtml;
        document.getElementById('mapping-modal').classList.remove('hidden');
        document.getElementById('mapping-modal').setAttribute('aria-hidden', 'false');
        document.querySelector('.app-shell').inert = true;
        document.getElementById('csv-mapping-form').dataset.pendingRows = JSON.stringify(rows);
        document.getElementById('csv-errors').textContent = '';
        document.querySelector('#mapping-modal select').focus();
      } catch (error) {
        showToast('Unable to read the CSV file.');
      } finally {
        event.target.value = '';
      }
    };
    reader.readAsText(file);
  });

  document.getElementById('close-mapping-modal').addEventListener('click', () => {
    closeCsvModal();
    document.getElementById('mapping-modal').setAttribute('aria-hidden', 'true');
    document.querySelector('.app-shell').inert = false;
    document.getElementById('open-csv-import').focus();
  });

  document.getElementById('csv-mapping-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const rows = JSON.parse(event.currentTarget.dataset.pendingRows || '[]');
    const mapping = {};
    const formData = new FormData(event.currentTarget);
    for (const [key, value] of formData.entries()) {
      if (String(value).trim()) mapping[key.replace('csv-', '')] = String(value);
    }

    const errors = [];
    const imported = [];
    rows.forEach((row, index) => {
      const rowErrors = validateCsvRow(row, mapping, state.accounts, state.categories);
      if (rowErrors.length) {
        errors.push(`Row ${index + 2}: ${rowErrors.join(', ')}`);
        return;
      }

      const amountValue = Number(row[mapping.amount] || row.amount || 0);
      const typeValue = String(row[mapping.type] || row.type || 'expense').trim().toLowerCase();
      const normalizedType = ['income', 'expense', 'transfer'].includes(typeValue) ? typeValue : 'expense';
      const accountName = String(row[mapping.account] || row.account || row[mapping.accountId] || row.accountId || '').trim();
      const account = state.accounts.find((item) => item.name.toLowerCase() === accountName.toLowerCase()) || state.accounts.find((item) => item.id === String(row[mapping.accountId] || row.accountId || '').trim());
      const categoryValue = String(row[mapping.category] || row.category || row[mapping.categoryId] || row.categoryId || '').trim();
      const category = state.categories.find((item) => {
        if (item.id === categoryValue) return true;
        return item.name.toLowerCase() === categoryValue.toLowerCase() || getCategoryPath(item.id).toLowerCase() === categoryValue.toLowerCase();
      });
      const transferGroupId = generateId('transfer');

      if (normalizedType === 'transfer') {
        const destinationName = String(row[mapping.toAccount] || row.toAccount || '').trim();
        const destinationAccount = state.accounts.find((item) => item.name.toLowerCase() === destinationName.toLowerCase() || item.id === destinationName);
        const sourceTxn = {
          id: generateId('txn'),
          accountId: account ? account.id : state.accounts[0]?.id,
          type: 'transfer',
          amount: amountValue,
          date: row[mapping.date] || row.date,
          categoryId: null,
          payee: row[mapping.payee] || row.payee || 'Transfer',
          notes: row[mapping.notes] || row.notes || '',
          tags: String(row[mapping.tags] || row.tags || '').split(';').map((tag) => tag.trim()).filter(Boolean),
          transferGroupId,
          transferSide: 'source'
        };
        const destinationTxn = {
          id: generateId('txn'),
          accountId: destinationAccount ? destinationAccount.id : state.accounts[1]?.id,
          type: 'transfer',
          amount: amountValue,
          date: row[mapping.date] || row.date,
          categoryId: null,
          payee: row[mapping.payee] || row.payee || 'Transfer',
          notes: row[mapping.notes] || row.notes || '',
          tags: String(row[mapping.tags] || row.tags || '').split(';').map((tag) => tag.trim()).filter(Boolean),
          transferGroupId,
          transferSide: 'destination'
        };
        imported.push(sourceTxn, destinationTxn);
        return;
      }

      imported.push({
        id: generateId('txn'),
        accountId: account ? account.id : state.accounts[0]?.id,
        type: normalizedType,
        amount: amountValue,
        date: row[mapping.date] || row.date,
        categoryId: category ? category.id : null,
        payee: row[mapping.payee] || row.payee || '',
        notes: row[mapping.notes] || row.notes || '',
        tags: String(row[mapping.tags] || row.tags || '').split(';').map((tag) => tag.trim()).filter(Boolean),
        transferGroupId: null,
        transferSide: null
      });
    });

    if (errors.length) {
      document.getElementById('csv-errors').textContent = errors.join('\n');
      return;
    }

    if (imported.length) {
      commitChange('CSV rows imported', () => {
        state.transactions.push(...imported);
      });
      document.getElementById('mapping-modal').classList.add('hidden');
      document.getElementById('mapping-modal').setAttribute('aria-hidden', 'true');
    document.querySelector('.app-shell').inert = false;
    }
  });

  document.getElementById('seed-data-btn').addEventListener('click', () => {
    commitChange('Demo data loaded', () => {
      setState(createDemoState());
    });
  });

  document.getElementById('clear-storage-btn').addEventListener('click', () => {
    commitChange('Saved data cleared', () => {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (error) {
        // Ignore browser storage access issues.
      }
      setState(createDefaultState());
    });
  });

  document.getElementById('reset-data-btn').addEventListener('click', () => {
    if (!window.confirm('Reset all data? You can undo this action or restore a JSON backup.')) return;
    commitChange('All data reset', () => {
      setState({
        accounts: [],
        categories: [],
        transactions: [],
        budgets: [],
        recurring: [],
        theme: state.theme,
        currency: state.currency,
        ui: {
          route: '/dashboard',
          filters: { startDate: '', endDate: '', accountId: '', categoryId: '', type: '', minAmount: '', maxAmount: '', search: '' },
          sort: [{ key: 'date', direction: 'desc' }],
          page: 1,
          pageSize: 10,
          selectedTransactionIds: []
        }
      });
    });
  });

  document.addEventListener('input', (event) => {
    const target = event.target;
    const isInputElement = target && typeof target === 'object' && 'value' in target && (typeof HTMLInputElement === 'undefined' ? target.tagName === 'INPUT' : target instanceof HTMLInputElement);
    if (isInputElement && ['date', 'nextRunDate', 'startDate', 'endDate', 'month'].includes(target.name)) {
      handleKeyboardDateInput(event);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.target.matches('input, textarea, select, [contenteditable]')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
      event.preventDefault();
      undo();
    }
    if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey))) {
      event.preventDefault();
      redo();
    }
  });

  document.body.addEventListener('keydown', (event) => {
    const dashboardCard = event.target.closest('[data-dashboard-action]');
    if (!dashboardCard) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      dashboardCard.click();
    }
  });
}

function initialize() {
  normalizeDateInputs();
  const stored = loadState();
  setState(stored);
  applyRecurringTransactions(false);
  const saved = saveState(state);
  knownSnapshot = snapshot(readPersistedState() || state);
  document.getElementById('storage-notice').hidden = saved;
  bindRouteHandler((route) => {
    closeCsvModal(false);
    state.ui.route = route;
    renderApp(); updateHistoryControls();
    const heading = document.querySelector('.view.active h2');
    heading?.focus({ preventScroll: true });
  });
  attachGlobalListeners();
  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(renderCharts, 150); });
  renderApp(); updateHistoryControls();
  saveState(state);
  window.addEventListener('storage', event => {
    if (event.key === STORAGE_KEY && syncExternalChanges()) { renderApp(); showToast('Updated from another tab. Undo history reset.'); }
  });
}

function escapeMarkup(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

withWriteLock(initialize);
