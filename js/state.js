import { cents, sumMoney } from './money.js';
export const STORAGE_KEY = 'ledgerly-state-v1';

export let state = createDefaultState();

export function createDefaultState() {
  const today = new Date();
  const thisMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  return {
    accounts: [
      { id: 'acc-cash', name: 'Cash', type: 'cash', openingBalance: 1200, color: '#22c55e' },
      { id: 'acc-bank', name: 'Bank', type: 'bank', openingBalance: 3400, color: '#3b82f6' },
      { id: 'acc-card', name: 'Credit Card', type: 'credit', openingBalance: 0, color: '#f59e0b' }
    ],
    categories: [
      { id: 'cat-income', name: 'Income', parentId: null },
      { id: 'cat-housing', name: 'Housing', parentId: null },
      { id: 'cat-food', name: 'Food', parentId: null },
      { id: 'cat-food-groceries', name: 'Groceries', parentId: 'cat-food' },
      { id: 'cat-transport', name: 'Transport', parentId: null },
      { id: 'cat-entertainment', name: 'Entertainment', parentId: null },
      { id: 'cat-salary', name: 'Salary', parentId: 'cat-income' }
    ],
    transactions: [
      {
        id: 'txn-1',
        accountId: 'acc-bank',
        type: 'income',
        amount: 4200,
        date: getCurrentMonthDate(3),
        categoryId: 'cat-salary',
        payee: 'Employer',
        notes: 'Monthly salary',
        tags: ['payroll'],
        transferGroupId: null,
        transferSide: null
      },
      {
        id: 'txn-2',
        accountId: 'acc-bank',
        type: 'expense',
        amount: 620,
        date: getCurrentMonthDate(5),
        categoryId: 'cat-food-groceries',
        payee: 'Fresh Market',
        notes: 'Weekly groceries',
        tags: ['food'],
        transferGroupId: null,
        transferSide: null
      },
      {
        id: 'txn-3',
        accountId: 'acc-card',
        type: 'expense',
        amount: 180,
        date: getCurrentMonthDate(7),
        categoryId: 'cat-entertainment',
        payee: 'Cinema',
        notes: 'Movie night',
        tags: ['fun'],
        transferGroupId: null,
        transferSide: null
      },
      {
        id: 'txn-4',
        accountId: 'acc-bank',
        type: 'transfer',
        amount: 150,
        date: getCurrentMonthDate(10),
        categoryId: null,
        payee: 'Transfer to cash',
        notes: 'Moved cash for spending',
        tags: ['transfer'],
        transferGroupId: 'transfer-1',
        transferSide: 'source'
      },
      {
        id: 'txn-5',
        accountId: 'acc-cash',
        type: 'transfer',
        amount: 150,
        date: getCurrentMonthDate(10),
        categoryId: null,
        payee: 'Transfer from bank',
        notes: 'Moved cash for spending',
        tags: ['transfer'],
        transferGroupId: 'transfer-1',
        transferSide: 'destination'
      }
    ],
    budgets: [
      { id: 'budget-1', categoryId: 'cat-food-groceries', month: thisMonth, limit: 800 },
      { id: 'budget-2', categoryId: 'cat-entertainment', month: thisMonth, limit: 300 }
    ],
    recurring: [],
    theme: 'light',
    currency: 'USD',
    ui: {
      route: '/dashboard',
      filters: {
        startDate: '',
        endDate: '',
        accountId: '',
        categoryId: '',
        type: '',
        minAmount: '',
        maxAmount: '',
        search: ''
      },
      sort: [{ key: 'date', direction: 'desc' }],
      page: 1,
      pageSize: 10,
      selectedTransactionIds: []
    }
  };
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) {
    return tags.map((tag) => String(tag).trim()).filter(Boolean);
  }
  if (typeof tags === 'string') {
    return tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeSortSpec(sortValue) {
  const legacySort = sortValue && typeof sortValue === 'object' && !Array.isArray(sortValue)
    ? [{ key: sortValue.key || 'date', direction: sortValue.direction === 'asc' ? 'asc' : 'desc' }]
    : Array.isArray(sortValue) && sortValue.length
      ? sortValue
          .filter((entry) => entry && typeof entry === 'object')
          .map((entry) => ({
            key: entry.key || 'date',
            direction: entry.direction === 'asc' ? 'asc' : 'desc'
          }))
      : [{ key: 'date', direction: 'desc' }];

  return legacySort.filter((entry) => entry && typeof entry.key === 'string' && ['date', 'amount', 'accountId', 'categoryId', 'type', 'payee'].includes(entry.key));
}

export function normalizeState(raw) {
  const base = createDefaultState();
  const incoming = raw && typeof raw === 'object' ? raw : {};
  const normalized = {
    ...base,
    ...incoming,
    accounts: Array.isArray(incoming.accounts) ? incoming.accounts : base.accounts,
    categories: Array.isArray(incoming.categories) ? incoming.categories : base.categories,
    transactions: Array.isArray(incoming.transactions)
      ? incoming.transactions.filter(txn => txn && typeof txn === 'object').map((txn) => ({
          ...txn,
          tags: normalizeTags(txn.tags),
          categoryId: txn.categoryId || null,
          transferGroupId: txn.transferGroupId || null,
          transferSide: txn.transferSide || null
        }))
      : base.transactions,
    budgets: Array.isArray(incoming.budgets) ? incoming.budgets : base.budgets,
    recurring: Array.isArray(incoming.recurring) ? incoming.recurring : base.recurring,
    currency: incoming.currency === 'INR' ? 'INR' : 'USD',
    theme: incoming.theme === 'dark' ? 'dark' : 'light',
    ui: {
      ...base.ui,
      ...(incoming.ui || {}),
      filters: {
        ...base.ui.filters,
        ...(incoming.ui && incoming.ui.filters ? incoming.ui.filters : {})
      },
      sort: normalizeSortSpec(incoming.ui && incoming.ui.sort ? incoming.ui.sort : base.ui.sort)
    }
  };

  normalized.ui.page = Math.max(1, Math.floor(Number(normalized.ui.page)) || 1);
  normalized.ui.pageSize = [10, 25, 50].includes(Number(normalized.ui.pageSize)) ? Number(normalized.ui.pageSize) : 10;
  normalized.ui.selectedTransactionIds = Array.isArray(normalized.ui.selectedTransactionIds) ? normalized.ui.selectedTransactionIds.filter(id => normalized.transactions.some(t => t.id === id)) : [];
  for (const key of Object.keys(base.ui.filters)) normalized.ui.filters[key] = String(normalized.ui.filters[key] ?? '');
  if (!normalized.ui.sort.length) normalized.ui.sort = base.ui.sort;
  normalized.ui.sort = normalized.ui.sort.slice(0, 3);
  return normalized;
}

export function getState() {
  return state;
}

export function setState(nextState) {
  state = normalizeState(nextState);
  return state;
}

export function replaceState(nextState) {
  state = normalizeState(nextState);
  return state;
}

export function getAccountById(accountId) {
  return state.accounts.find((account) => account.id === accountId) || null;
}

export function getCategoryById(categoryId) {
  return state.categories.find((category) => category.id === categoryId) || null;
}

export function getCategoryPath(categoryId) {
  const category = getCategoryById(categoryId);
  if (!category) return '';
  if (!category.parentId) return category.name;
  const parent = getCategoryById(category.parentId);
  return `${getCategoryPath(parent?.id || '')}${parent ? ' → ' : ''}${category.name}`.trim();
}

export function getAccountBalance(accountId) {
  const account = getAccountById(accountId);
  if (!account) return 0;
  const entries = state.transactions.filter(t => t.accountId === accountId).map(t => t.type === 'expense' || (t.type === 'transfer' && t.transferSide === 'source') ? -t.amount : t.amount);
  return sumMoney([account.openingBalance, ...entries]);
}
export function getNetWorth() { return sumMoney(state.accounts.map(a => getAccountBalance(a.id))); }

export function getCategorySummary(monthIso) {
  const summary = {};
  state.transactions.forEach((txn) => {
    if (!txn.categoryId || txn.type === 'transfer') return;
    const date = new Date(`${txn.date}T00:00:00`);
    const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (month !== monthIso) return;
    if (txn.type === 'expense') {
      summary[txn.categoryId] = sumMoney([summary[txn.categoryId] || 0, txn.amount]);
    }
  });
  return summary;
}

export function getBudgetSpent(categoryId, monthIso) {
  return sumMoney(Object.entries(getCategorySummary(monthIso)).filter(([id]) => id === categoryId || getCategoryById(id)?.parentId === categoryId).map(([,amount]) => amount));
}

export function getMonthlyTrend() {
  const labels = [];
  const income = [];
  const expense = [];
  const now = new Date();

  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthIso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    labels.push(d.toLocaleString('en-US', { month: 'short', year: 'numeric' }));

    const monthSummary = state.transactions.reduce(
      (totals, txn) => {
        const txnDate = new Date(`${txn.date}T00:00:00`);
        const txnMonth = `${txnDate.getFullYear()}-${String(txnDate.getMonth() + 1).padStart(2, '0')}`;
        if (txnMonth !== monthIso) return totals;
        const amount = Number(txn.amount || 0);
        if (txn.type === 'income') totals.income += cents(amount);
        if (txn.type === 'expense') totals.expense += cents(amount);
        return totals;
      },
      { income: 0, expense: 0 }
    );

    income.push(Number((monthSummary.income / 100).toFixed(2)));
    expense.push(Number((monthSummary.expense / 100).toFixed(2)));
  }

  return { labels, income, expense };
}

export function createDemoState() {
  const demo = createDefaultState();
  demo.accounts = [
    { id: 'acc-cash', name: 'Cash', type: 'cash', openingBalance: 1500, color: '#22c55e' },
    { id: 'acc-bank', name: 'Bank', type: 'bank', openingBalance: 4500, color: '#3b82f6' },
    { id: 'acc-card', name: 'Credit Card', type: 'credit', openingBalance: 0, color: '#f59e0b' }
  ];
  demo.categories = [
    { id: 'cat-income', name: 'Income', parentId: null },
    { id: 'cat-salary', name: 'Salary', parentId: 'cat-income' },
    { id: 'cat-housing', name: 'Housing', parentId: null },
    { id: 'cat-food', name: 'Food', parentId: null },
    { id: 'cat-food-groceries', name: 'Groceries', parentId: 'cat-food' },
    { id: 'cat-transport', name: 'Transport', parentId: null },
    { id: 'cat-entertainment', name: 'Entertainment', parentId: null }
  ];
  demo.transactions = [
    { id: generateId('txn'), accountId: 'acc-bank', type: 'income', amount: 4200, date: getCurrentMonthDate(2), categoryId: 'cat-salary', payee: 'Employer', notes: 'Monthly salary', tags: ['payroll'], transferGroupId: null, transferSide: null },
    { id: generateId('txn'), accountId: 'acc-bank', type: 'expense', amount: 620, date: getCurrentMonthDate(6), categoryId: 'cat-food-groceries', payee: 'Fresh Market', notes: 'Weekly groceries', tags: ['food'], transferGroupId: null, transferSide: null },
    { id: generateId('txn'), accountId: 'acc-card', type: 'expense', amount: 180, date: getCurrentMonthDate(8), categoryId: 'cat-entertainment', payee: 'Cinema', notes: 'Movie night', tags: ['fun'], transferGroupId: null, transferSide: null },
    { id: generateId('txn'), accountId: 'acc-bank', type: 'transfer', amount: 150, date: getCurrentMonthDate(12), categoryId: null, payee: 'Transfer to cash', notes: 'Moved cash for spending', tags: ['transfer'], transferGroupId: 'transfer-demo-1', transferSide: 'source' },
    { id: generateId('txn'), accountId: 'acc-cash', type: 'transfer', amount: 150, date: getCurrentMonthDate(12), categoryId: null, payee: 'Transfer from bank', notes: 'Moved cash for spending', tags: ['transfer'], transferGroupId: 'transfer-demo-1', transferSide: 'destination' }
  ];
  demo.budgets = [
    { id: 'budget-demo-1', categoryId: 'cat-food-groceries', month: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`, limit: 800 },
    { id: 'budget-demo-2', categoryId: 'cat-entertainment', month: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`, limit: 300 }
  ];
  demo.recurring = [
    { id: 'rule-demo-1', title: 'Netflix', type: 'expense', amount: 16.99, accountId: 'acc-bank', categoryId: 'cat-entertainment', interval: 'monthly', customDays: 30, nextRunDate: getRelativeDate(15), payee: 'Netflix', processedDates: [], createdAt: new Date().toISOString() }
  ];
  demo.theme = 'light';
  demo.ui = { ...demo.ui, route: '/dashboard', filters: { ...demo.ui.filters }, sort: [{ key: 'date', direction: 'desc' }], page: 1, pageSize: 10, selectedTransactionIds: [] };
  return demo;
}

export function getSortEntries() {
  if (!state.ui || !state.ui.sort) return [{ key: 'date', direction: 'desc' }];
  if (Array.isArray(state.ui.sort)) return normalizeSortSpec(state.ui.sort);
  return normalizeSortSpec({ key: state.ui.sort.key || 'date', direction: state.ui.sort.direction || 'desc' });
}

export function getFilteredTransactions() {
  const filters = state.ui.filters || {};
  return [...state.transactions].filter((txn) => {
    const afterStart = filters.startDate ? new Date(txn.date) >= new Date(filters.startDate) : true;
    const beforeEnd = filters.endDate ? new Date(txn.date) <= new Date(new Date(filters.endDate).getTime() + 86399999) : true;
    const matchesAccount = filters.accountId ? txn.accountId === filters.accountId : true;
    const matchesCategory = filters.categoryId ? txn.categoryId === filters.categoryId : true;
    const matchesType = filters.type ? txn.type === filters.type : true;
    const minAmount = filters.minAmount !== '' && filters.minAmount !== null ? Number(filters.minAmount) : null;
    const maxAmount = filters.maxAmount !== '' && filters.maxAmount !== null ? Number(filters.maxAmount) : null;
    const matchesMin = minAmount !== null ? Number(txn.amount || 0) >= minAmount : true;
    const matchesMax = maxAmount !== null ? Number(txn.amount || 0) <= maxAmount : true;
    const rowTags = Array.isArray(txn.tags) ? txn.tags : typeof txn.tags === 'string' ? txn.tags.split(',') : [];
    const haystack = `${txn.payee || ''} ${txn.notes || ''} ${rowTags.join(' ')}`.toLowerCase();
    const search = (filters.search || '').trim().toLowerCase();
    const matchesSearch = !search || haystack.includes(search);
    return afterStart && beforeEnd && matchesAccount && matchesCategory && matchesType && matchesMin && matchesMax && matchesSearch;
  });
}

export function getSortedTransactions(rows) {
  const sortEntries = getSortEntries();
  const sortedRows = [...rows];

  sortedRows.sort((a, b) => {
    for (const { key, direction } of sortEntries) {
      const multiplier = direction === 'asc' ? 1 : -1;
      let aVal = a[key];
      let bVal = b[key];

      if (key === 'amount') {
        aVal = Number(a.amount || 0);
        bVal = Number(b.amount || 0);
      }
      if (key === 'date') {
        aVal = new Date(a.date || 0).getTime();
        bVal = new Date(b.date || 0).getTime();
      }
      if (key === 'accountId') {
        aVal = getAccountById(a.accountId)?.name || '';
        bVal = getAccountById(b.accountId)?.name || '';
      }
      if (key === 'categoryId') {
        aVal = getCategoryPath(a.categoryId) || '';
        bVal = getCategoryPath(b.categoryId) || '';
      }

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        const comparison = aVal.localeCompare(bVal);
        if (comparison !== 0) return comparison * multiplier;
        continue;
      }

      const numericComparison = Number(aVal || 0) - Number(bVal || 0);
      if (numericComparison !== 0) return numericComparison * multiplier;
    }

    return 0;
  });

  return sortedRows;
}

export function getPaginatedTransactions() {
  const filteredRows = getSortedTransactions(getFilteredTransactions());
  const page = Math.max(1, Math.floor(Number(state.ui.page)) || 1);
  const pageSize = Math.max(1, Math.min(100, Math.floor(Number(state.ui.pageSize)) || 10));
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const boundedPage = Math.min(page, totalPages);
  if (state.ui.page !== boundedPage) {
    state.ui.page = boundedPage;
  }
  const startIndex = (boundedPage - 1) * pageSize;
  const pageRows = filteredRows.slice(startIndex, startIndex + pageSize);
  return { pageRows, totalPages, filteredCount: filteredRows.length };
}

export function generateId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

function getRelativeDate(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function getCurrentMonthDate(dayOfMonth) {
  const now = new Date();
  const safeDay = Math.min(Math.max(dayOfMonth, 1), 28);
  const date = new Date(now.getFullYear(), now.getMonth(), safeDay);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
