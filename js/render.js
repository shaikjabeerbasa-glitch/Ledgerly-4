import { cents, sumMoney } from './money.js';
import {
  getAccountBalance,
  getAccountById,
  getBudgetSpent,
  getCategoryById,
  getCategoryPath,
  getFilteredTransactions,
  getMonthlyTrend,
  getNetWorth,
  getPaginatedTransactions,
  getSortedTransactions,
  state
} from './state.js';
import { getRouteFromHash } from './routing.js';


export function renderApp() {
  const focused = document.activeElement;
  const identity = focused?.id ? { id: focused.id } : focused?.dataset ? { ...focused.dataset } : {};

  state.ui.route = getRouteFromHash();
  document.body.classList.toggle('dark', state.theme === 'dark');
  document.body.setAttribute('data-theme', state.theme || 'light');
  const nav = document.getElementById('top-nav');
  nav.innerHTML = ['dashboard', 'accounts', 'transactions', 'budgets', 'categories', 'recurring', 'settings']
    .map((route) => {
      const label = route.charAt(0).toUpperCase() + route.slice(1);
      const isActive = (state.ui.route || '/dashboard') === `/${route}`;
      return `<a href="#/${route}" class="nav-link ${isActive ? 'active' : ''}" ${isActive ? 'aria-current="page"' : ''} data-route="/${route}">${label}</a>`;
    })
    .join('');

  document.getElementById('theme-toggle').textContent = state.theme === 'dark' ? '☀️' : '🌙';
  syncCurrencySelects();

  document.querySelectorAll('.view').forEach((section) => {
    const route = `/${section.dataset.route}`;
    section.classList.toggle('active', route === (state.ui.route || '/dashboard'));
  });

  renderDashboard();
  renderAccounts();
  renderTransactions();
  renderBudgets();
  renderCategories();
  renderRecurring();
  renderSettings();
  document.querySelectorAll('.sort-btn').forEach(button => {
    const entry = state.ui.sort.find(s => s.key === button.dataset.sort);
    button.closest('th').setAttribute('aria-sort', entry ? entry.direction === 'asc' ? 'ascending' : 'descending' : 'none');
    button.setAttribute('aria-label', `Sort by ${button.textContent}; ${entry ? entry.direction + ', priority ' + (state.ui.sort.indexOf(entry)+1) : 'not sorted'}`);
  });
  const bulk = document.getElementById('bulk-category-select');
  const selected = bulk.value;
  bulk.innerHTML = '<option value="">Select category</option>' + buildCategoryOptions();
  bulk.value = selected;
  state.ui.selectedTransactionIds = state.ui.selectedTransactionIds.filter(id => state.transactions.some(t => t.id === id));
  if (focused && !focused.isConnected) {
    const target = [...document.querySelectorAll('a,button,input,select')].find(node => identity.id ? node.id === identity.id : Object.keys(identity).length && Object.entries(identity).every(([key,value]) => node.dataset[key] === value));
    target?.focus({ preventScroll: true });
  }
}

function renderDashboard() {
  const monthKey = getCurrentMonthKey();
  const stats = document.getElementById('dashboard-stats');
  const monthlyIncome = getMonthlyTotals('income');
  const monthlyExpense = getMonthlyTotals('expense');
  const categorySummary = getCategorySpendSummary(monthKey);
  const topCategory = Object.entries(categorySummary).sort(([, a], [, b]) => b - a)[0];

  stats.innerHTML = `
    <div class="card stat-card" data-dashboard-action="accounts" tabindex="0" role="button" aria-label="Open accounts overview">
      <h3>Net worth</h3>
      <div class="stat-value">${formatMoney(getNetWorth())}</div>
    </div>
    <div class="card stat-card" data-dashboard-action="transactions" data-filter-type="income" tabindex="0" role="button" aria-label="View income transactions">
      <h3>Monthly income</h3>
      <div class="stat-value amount-income">${formatMoney(monthlyIncome)}</div>
    </div>
    <div class="card stat-card" data-dashboard-action="transactions" data-filter-type="expense" tabindex="0" role="button" aria-label="View expense transactions">
      <h3>Monthly expenses</h3>
      <div class="stat-value amount-expense">${formatMoney(monthlyExpense)}</div>
    </div>
    <div class="card stat-card" data-dashboard-action="budgets" tabindex="0" role="button" aria-label="Open budgets overview">
      <h3>Top category</h3>
      <div class="stat-value">${topCategory ? escapeHtml(getCategoryPath(topCategory[0])) : '—'}</div>
      <div class="muted">${topCategory ? formatMoney(topCategory[1]) : 'No expense data yet'}</div>
    </div>
  `;

  renderCategoryChart();
  renderTrendChart();
}

function renderAccounts() {
  const list = document.getElementById('account-list');
  list.innerHTML = state.accounts.length
    ? state.accounts
        .map((account) => {
          const balance = getAccountBalance(account.id);
          return `
            <div class="list-item">
              <div class="info">
                <div><span class="account-accent" style="background:${account.color};"></span><strong>${escapeHtml(account.name)}</strong></div>
                <small class="muted">${account.type.toUpperCase()} • ${formatMoney(balance)}</small>
              </div>
              <div class="list-item-actions">
                <button type="button" class="secondary-btn" data-action="edit-account" data-id="${account.id}" aria-label="Edit account ${escapeHtml(account.name)}">Edit</button>
                <button type="button" class="danger-btn" data-action="delete-account" data-id="${account.id}" aria-label="Delete account ${escapeHtml(account.name)}">Delete</button>
              </div>
            </div>
          `;
        })
        .join('')
    : '<div class="empty-state">No accounts yet.</div>';

  list.querySelectorAll('[data-action="edit-account"]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      document.body.dispatchEvent(new CustomEvent('ledgerly-account-action', {
        bubbles: true,
        detail: { action: 'edit-account', id: event.currentTarget.dataset.id }
      }));
    });
  });

  list.querySelectorAll('[data-action="delete-account"]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      document.body.dispatchEvent(new CustomEvent('ledgerly-account-action', {
        bubbles: true,
        detail: { action: 'delete-account', id: event.currentTarget.dataset.id }
      }));
    });
  });

  populateAccountSelects();
}

function renderTransactions() {
  populateTransactionFilterSelects();

  const tableBody = document.getElementById('transaction-table-body');
  const { pageRows, totalPages, filteredCount } = getPaginatedTransactions();
  const pageSizeSelect = document.getElementById('page-size-select');
  pageSizeSelect.value = String(state.ui.pageSize || 10);

  if (!pageRows.length) {
    tableBody.innerHTML = '<tr><td colspan="9" class="empty-state">No transactions match the current filters.</td></tr>';
  } else {
    tableBody.innerHTML = pageRows
      .map((txn) => {
        const accountName = getAccountById(txn.accountId)?.name || 'Unknown';
        const categoryName = txn.categoryId ? getCategoryPath(txn.categoryId) : '—';
        const isSelected = state.ui.selectedTransactionIds.includes(txn.id);
        const amountClass = txn.type === 'income' ? 'amount-income' : txn.type === 'expense' ? 'amount-expense' : 'amount-transfer';
        return `
          <tr data-transaction-id="${txn.id}">
            <td><input type="checkbox" class="transaction-selector" aria-label="Select transaction ${escapeHtml(txn.payee || txn.date)}" data-transaction-id="${txn.id}" ${isSelected ? 'checked' : ''} /></td>
            <td>${formatDate(txn.date)}</td>
            <td><span class="status-pill">${txn.type}</span></td>
            <td>${escapeHtml(accountName)}</td>
            <td>${escapeHtml(categoryName)}</td>
            <td>${escapeHtml(txn.payee || '—')}</td>
            <td class="${amountClass}">${txn.type === 'expense' ? '-' : txn.type === 'transfer' ? '↔ ' : '+'}${formatMoney(txn.amount)}</td>
            <td>${renderTags(txn.tags || [])}</td>
            <td>
              <div class="list-item-actions">
                <button type="button" class="secondary-btn" aria-label="Edit transaction ${escapeHtml(txn.payee || txn.date)}" data-action="edit-transaction" data-id="${txn.id}">Edit</button>
                <button type="button" class="danger-btn" aria-label="Delete transaction ${escapeHtml(txn.payee || txn.date)}" data-action="delete-transaction" data-id="${txn.id}">Delete</button>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');
  }

  const pagination = document.getElementById('transaction-pagination');
  pagination.innerHTML = Array.from({ length: totalPages }, (_, index) => {
    const pageNumber = index + 1;
    const isActive = Number(state.ui.page || 1) === pageNumber;
    return `<button type="button" class="page-btn ${isActive ? 'active' : ''}" data-action="goto-page" data-page="${pageNumber}">${pageNumber}</button>`;
  }).join('');

  document.getElementById('select-all-transactions').checked = pageRows.length > 0 && pageRows.every((row) => state.ui.selectedTransactionIds.includes(row.id));
  document.getElementById('select-all-transactions').indeterminate = !document.getElementById('select-all-transactions').checked && state.ui.selectedTransactionIds.length > 0;

  if (filteredCount === 0) {
    document.getElementById('select-all-transactions').checked = false;
    document.getElementById('select-all-transactions').indeterminate = false;
  }
}

function renderBudgets() {
  const list = document.getElementById('budget-list');
  const monthKey = getCurrentMonthKey();
  list.innerHTML = state.budgets.length
    ? state.budgets
        .map((budget) => {
          const spent = getBudgetSpent(budget.categoryId, budget.month || monthKey);
          const percent = budget.limit > 0 ? Math.round(cents(spent) / cents(budget.limit) * 10000) / 100 : spent > 0 ? 100 : 0;
          const fillClass = spent > budget.limit ? 'danger' : percent >= 80 ? 'warning' : 'success';
          return `
            <div class="list-item" style="display:block;">
              <div class="info">
                <strong>${escapeHtml(getCategoryPath(budget.categoryId))}</strong>
                <small class="muted">${budget.month || monthKey} • ${formatMoney(spent)} / ${formatMoney(budget.limit)}</small>
              </div>
              <div class="progress-bar" role="progressbar" aria-label="Budget used" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100, Math.round(percent))}"><div class="progress-fill ${fillClass}" style="width:${Math.min(percent, 100)}%"></div></div>
              <div class="list-item-actions" style="margin-top:0.6rem;">
                <button type="button" class="secondary-btn" aria-label="Edit budget ${escapeHtml(getCategoryPath(budget.categoryId))}" data-action="edit-budget" data-id="${budget.id}">Edit</button>
                <button type="button" class="danger-btn" aria-label="Delete budget ${escapeHtml(getCategoryPath(budget.categoryId))}" data-action="delete-budget" data-id="${budget.id}">Delete</button>
              </div>
            </div>
          `;
        })
        .join('')
    : '<div class="empty-state">No budgets created yet.</div>';

  const budgetCategorySelect = document.querySelector('#budget-form select[name="categoryId"]');
  if (budgetCategorySelect) {
    const currentValue = budgetCategorySelect.value || '';
    budgetCategorySelect.innerHTML = '<option value="">Select category</option>' + buildCategoryOptions();
    if (currentValue) budgetCategorySelect.value = currentValue;
  }
}

function renderCategories() {
  const tree = document.getElementById('category-tree');
  const rootCategories = state.categories.filter((cat) => !cat.parentId);
  tree.innerHTML = rootCategories.length
    ? rootCategories.map((category) => renderCategoryBranch(category, 0)).join('')
    : '<div class="empty-state">No categories yet.</div>';

  const categoryParentSelect = document.querySelector('#category-form select[name="parentId"]');
  if (categoryParentSelect) {
    const currentValue = categoryParentSelect.value || '';
    categoryParentSelect.innerHTML = '<option value="">None</option>' + state.categories.filter(c => !c.parentId).map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    if (currentValue) categoryParentSelect.value = currentValue;
  }
}

function renderCategoryBranch(category, depth) {
  const childCategories = state.categories.filter((item) => item.parentId === category.id);
  return `
    <div>
      <div class="category-node ${depth > 0 ? 'category-indent' : ''}">
        <span>${' '.repeat(depth * 2)}${escapeHtml(category.name)}</span>
        <div class="list-item-actions">
          <button type="button" class="secondary-btn" aria-label="Edit category ${escapeHtml(category.name)}" data-action="edit-category" data-id="${category.id}">Edit</button>
          <button type="button" class="danger-btn" aria-label="Delete category ${escapeHtml(category.name)}" data-action="delete-category" data-id="${category.id}">Delete</button>
        </div>
      </div>
      ${childCategories.map((child) => renderCategoryBranch(child, depth + 1)).join('')}
    </div>
  `;
}

function renderRecurring() {
  const list = document.getElementById('recurring-list');
  list.innerHTML = state.recurring.length
    ? state.recurring
        .map((rule) => `
          <div class="list-item" style="display:block;">
            <div class="info">
              <strong>${escapeHtml(rule.title)}</strong>
              <small class="muted">${escapeHtml(rule.type)} • ${escapeHtml(rule.interval)} • ${formatMoney(rule.amount)}</small>
            </div>
            <div class="muted">Next: ${formatDate(rule.nextRunDate)}</div>
            <div class="list-item-actions" style="margin-top:0.6rem;">
              <button type="button" class="secondary-btn" aria-label="Edit recurring ${escapeHtml(rule.title)}" data-action="edit-recurring" data-id="${rule.id}">Edit</button>
              <button type="button" class="danger-btn" aria-label="Delete recurring ${escapeHtml(rule.title)}" data-action="delete-recurring" data-id="${rule.id}">Delete</button>
            </div>
          </div>
        `)
        .join('')
    : '<div class="empty-state">No recurring rules yet.</div>';

  const accountSelect = document.querySelector('#recurring-form select[name="accountId"]');
  if (accountSelect) {
    const currentValue = accountSelect.value || '';
    accountSelect.innerHTML = '<option value="">Select account</option>' + state.accounts.map((account) => `<option value="${account.id}">${escapeHtml(account.name)}</option>`).join('');
    if (currentValue) accountSelect.value = currentValue;
  }

  const categorySelect = document.querySelector('#recurring-form select[name="categoryId"]');
  if (categorySelect) {
    const currentValue = categorySelect.value || '';
    categorySelect.innerHTML = '<option value="">None</option>' + buildCategoryOptions();
    if (currentValue) categorySelect.value = currentValue;
  }
}

function renderSettings() {
  // No dynamic content required.
}

function populateAccountSelects() {
  const accountSelects = document.querySelectorAll('select[name="accountId"], select[name="toAccountId"]');
  accountSelects.forEach((select) => {
    const currentValue = select.value || '';
    const isToAccount = select.name === 'toAccountId';
    select.innerHTML = `${isToAccount ? '<option value="">Select destination</option>' : '<option value="">Select account</option>'}${state.accounts.map((account) => `<option value="${account.id}">${escapeHtml(account.name)}</option>`).join('')}`;
    if (currentValue) select.value = currentValue;
  });

  const transactionCategorySelect = document.querySelector('#transaction-form select[name="categoryId"]');
  if (transactionCategorySelect) {
    const currentValue = transactionCategorySelect.value || '';
    transactionCategorySelect.innerHTML = '<option value="">Select category</option>' + buildCategoryOptions();
    if (currentValue) transactionCategorySelect.value = currentValue;
  }
}

function populateTransactionFilterSelects() {
  const accountFilter = document.querySelector('#transaction-filter-form select[name="accountId"]');
  if (accountFilter) {
    const currentValue = accountFilter.value || '';
    accountFilter.innerHTML = '<option value="">All</option>' + state.accounts.map((account) => `<option value="${account.id}">${escapeHtml(account.name)}</option>`).join('');
    if (currentValue) accountFilter.value = currentValue;
  }

  const categoryFilter = document.querySelector('#transaction-filter-form select[name="categoryId"]');
  if (categoryFilter) {
    const currentValue = categoryFilter.value || '';
    categoryFilter.innerHTML = '<option value="">All</option>' + buildCategoryOptions();
    if (currentValue) categoryFilter.value = currentValue;
  }

  const formFilter = document.getElementById('transaction-filter-form');
  if (formFilter) {
    Object.entries(state.ui.filters).forEach(([key, value]) => {
      const field = formFilter.elements.namedItem(key);
      if (!field) return;
      field.value = value ?? '';
    });
  }
}

function chartSurface(id) {
  const canvas = document.getElementById(id);
  const width = Math.max(300, canvas.parentElement.clientWidth - 32);
  canvas.width = width; canvas.height = 240;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, 240);
  ctx.font = '12px system-ui';
  return { canvas, ctx, width, ink: state.theme === 'dark' ? '#e2e8f0' : '#334155' };
}
function chartDescription(canvas, entries) {
  let legend = document.getElementById(canvas.id + '-legend');
  if (!legend) { legend = document.createElement('div'); legend.id = canvas.id + '-legend'; canvas.after(legend); }
  legend.className = 'chart-legend';
  legend.innerHTML = entries.map(([label, value, color]) => `<span><i style="background:${color}"></i>${escapeHtml(label)}: ${formatMoney(value)}</span>`).join('') || '<span>No expense data yet.</span>';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', entries.map(([label, value]) => `${label}: ${formatMoney(value)}`).join('; ') || 'No expense data');
}
function renderCategoryChart() {
  const {canvas, ctx, width} = chartSurface('categoryChart');
  const data = Object.entries(getCategorySpendSummary(getCurrentMonthKey()));
  const colors = ['#2563eb','#16a34a','#f59e0b','#8b5cf6','#ef4444','#14b8a6','#f97316'];
  const total = data.reduce((sum, [,n]) => sum + n, 0); let start = -Math.PI / 2;
  data.forEach(([id, amount], i) => {
    const end = start + amount / total * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(width/2, 120); ctx.arc(width/2,120,100,start,end); ctx.closePath();
    ctx.fillStyle = colors[i % colors.length]; ctx.fill(); start = end;
  });
  chartDescription(canvas, data.map(([id,n],i) => [getCategoryPath(id),n,colors[i%colors.length]]));
}
function renderTrendChart() {
  const {canvas, ctx, width, ink} = chartSurface('trendChart');
  const trend = getMonthlyTrend(); const max = Math.max(1, ...trend.income, ...trend.expense);
  const left = 55, right = width-10, top = 15, bottom = 210;
  ctx.fillStyle = ink; ctx.strokeStyle = ink;
  for (let i=0; i<=4; i++) { const y=bottom-i*(bottom-top)/4;
    ctx.fillText(String(Math.round(max*i/4)), 0,y+4);
    ctx.globalAlpha=.15; ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();ctx.globalAlpha=1;
  }
  [['income','#16a34a'],['expense','#ef4444']].forEach(([key,color]) => {
    ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();
    trend[key].forEach((n,i) => {const x=left+i*(right-left)/11,y=bottom-n/max*(bottom-top); if (!i) ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.stroke();
  });
  ctx.fillStyle=ink;ctx.font='10px system-ui';
  trend.labels.forEach((label,i) => ctx.fillText(label.split(' ')[0],left+i*(right-left)/11-10,230));
  chartDescription(canvas, trend.labels.flatMap((label,i) => [[`${label} income`,trend.income[i],'#16a34a'],[`${label} expense`,trend.expense[i],'#ef4444']]));
}

function getCategorySpendSummary(monthKey) {
  const summary = {};
  state.transactions.forEach((txn) => {
    if (!txn.categoryId || txn.type !== 'expense') return;
    const date = new Date(`${txn.date}T00:00:00`);
    const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (month !== monthKey) return;
    summary[txn.categoryId] = sumMoney([summary[txn.categoryId] || 0, txn.amount]);
  });
  return summary;
}

function getMonthlyTotals(type) {
  const monthKey = getCurrentMonthKey();
  return state.transactions.reduce((sum, txn) => {
    if (txn.type !== type) return sum;
    const date = new Date(`${txn.date}T00:00:00`);
    const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (month !== monthKey) return sum;
    return sum + cents(txn.amount);
  }, 0) / 100;
}

function buildCategoryOptions(includeEmptyOption = false) {
  const list = [];
  const addOption = (items, depth = 0) => {
    items.forEach((category) => {
      list.push(`<option value="${category.id}">${' '.repeat(depth * 2)}${escapeHtml(category.name)}</option>`);
      const children = state.categories.filter((item) => item.parentId === category.id);
      if (children.length) addOption(children, depth + 1);
    });
  };

  const roots = state.categories.filter((category) => !category.parentId);
  addOption(roots);
  return list.join('');
}

function renderTags(tags) {
  const normalizedTags = Array.isArray(tags)
    ? tags
    : typeof tags === 'string'
      ? tags.split(',').map((tag) => tag.trim()).filter(Boolean)
      : [];
  if (!normalizedTags.length) return '—';
  return `<div class="tag-badges">${normalizedTags.map((tag) => `<span class="tag-badge">${escapeHtml(tag)}</span>`).join('')}</div>`;
}

function syncCurrencySelects() {
  const value = state.currency || 'USD';
  const headerSelect = document.getElementById('header-currency-select');
  const settingsSelect = document.getElementById('settings-currency-select');
  if (headerSelect) headerSelect.value = value;
  if (settingsSelect) settingsSelect.value = value;
}

function formatMoney(value) {
  const amount = Number(value || 0);
  const locale = state.currency === 'INR' ? 'en-IN' : 'en-US';
  const currency = state.currency || 'USD';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2
  }).format(amount);
}

function formatDate(dateString) {
  if (!dateString) return '—';
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '—';
  const locale = state.currency === 'INR' ? 'en-IN' : 'en-US';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }).format(date);
}

function getCurrentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function renderCharts() { renderCategoryChart(); renderTrendChart(); }
