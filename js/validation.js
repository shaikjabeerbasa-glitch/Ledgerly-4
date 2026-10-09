import { validMoney } from './money.js';
export function isValidDate(value) {
  return typeof value === 'string' && /^[1-9]\d{3}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export function validateAccountForm(values) {
  const errors = {};
  if (!values.name || !String(values.name).trim()) errors.name = 'Account name is required.';
  if (!values.type) errors.type = 'Account type is required.';
  const openingBalance = Number(values.openingBalance || 0);
  if (!validMoney(values.openingBalance || 0, { signed: true })) errors.openingBalance = 'Opening balance must be a valid number.';
  return errors;
}

function getCategoryDescendants(categoryId, categories) {
  const descendants = new Set();
  const stack = [categoryId];

  while (stack.length) {
    const currentId = stack.pop();
    categories
      .filter((category) => category.parentId === currentId)
      .forEach((category) => {
        if (descendants.has(category.id)) return;
        descendants.add(category.id);
        stack.push(category.id);
      });
  }

  return descendants;
}

export function validateCategoryForm(values, categories = [], currentCategoryId = '') {
  const errors = {};
  if (!values.name || !String(values.name).trim()) errors.name = 'Category name is required.';

  const parentId = values.parentId || '';
  if (parentId && parentId === currentCategoryId) {
    errors.parentId = 'A category cannot be its own parent.';
  }

  if (parentId && currentCategoryId && getCategoryDescendants(currentCategoryId, categories).has(parentId)) {
    errors.parentId = 'A category cannot be assigned to one of its descendants.';
  }

  if (parentId && !categories.some((category) => category.id === parentId)) {
    errors.parentId = 'Selected parent category is invalid.';
  }

  if (parentId && categories.find(c => c.id === parentId)?.parentId) errors.parentId = 'Only one level of category nesting is allowed.';
  if (parentId && categories.some(c => c.parentId === currentCategoryId)) errors.parentId = 'A category with children must remain a root category.';
  return errors;
}

export function validateTransactionForm(values, accounts, categories) {
  const errors = {};
  if (!isValidDate(values.date)) errors.date = 'Enter a valid date.';
  if (!['income', 'expense', 'transfer'].includes(values.type)) errors.type = 'Invalid transaction type.';
  if (!values.accountId) errors.accountId = 'Account is required.';
  const amount = Number(values.amount);
  if (!validMoney(values.amount, { positive: true })) errors.amount = 'Amount must be greater than zero, at most 99,999,999,999.99, and have at most two decimal places.';
  if (values.type === 'transfer' && !values.toAccountId) errors.toAccountId = 'Destination account is required for transfers.';
  if (values.type === 'transfer' && values.accountId === values.toAccountId) errors.toAccountId = 'Source and destination accounts must differ.';
  if (values.type !== 'transfer' && !values.categoryId) errors.categoryId = 'Category is required for non-transfer entries.';
  const accountExists = accounts.some((account) => account.id === values.accountId);
  if (!accountExists) errors.accountId = 'Selected account does not exist.';
  if (values.type === 'transfer' && values.toAccountId) {
    const toExists = accounts.some((account) => account.id === values.toAccountId);
    if (!toExists) errors.toAccountId = 'Destination account is invalid.';
  }
  if (values.categoryId && !categories.some((category) => category.id === values.categoryId)) {
    errors.categoryId = 'Selected category is invalid.';
  }
  return errors;
}

export function validateBudgetForm(values) {
  const errors = {};
  if (!values.categoryId) errors.categoryId = 'Category is required.';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(values.month || '')) errors.month = 'Enter a valid month.';
  if (!validMoney(values.limit)) {
    errors.limit = 'Budget limit must be a non-negative number.';
  }
  return errors;
}

export function validateRecurringForm(values, accounts = [], categories = []) {
  const errors = {};
  const validIntervals = ['daily', 'weekly', 'monthly', 'custom'];
  if (!values.title || !String(values.title).trim()) errors.title = 'Recurring title is required.';
  if (!values.accountId) errors.accountId = 'Account is required.';
  if (!['income', 'expense'].includes(values.type)) errors.type = 'Recurring type must be income or expense.';
  if (!validMoney(values.amount, { positive: true })) errors.amount = 'Amount must be greater than zero, at most 99,999,999,999.99, and have at most two decimal places.';
  if (!isValidDate(values.nextRunDate)) errors.nextRunDate = 'Enter a valid next run date.';
  if (!accounts.some(a => a.id === values.accountId)) errors.accountId = 'Account does not exist.';
  if (values.categoryId && !categories.some(c => c.id === values.categoryId)) errors.categoryId = 'Category does not exist.';
  if (!values.interval || !validIntervals.includes(values.interval)) {
    errors.interval = 'Invalid recurring interval.';
  }
  if (values.interval === 'custom' && (!Number.isSafeInteger(Number(values.customDays)) || Number(values.customDays) < 1 || Number(values.customDays) > 36500)) {
    errors.customDays = 'Custom interval must be at least 1 day.';
  }
  return errors;
}

export function validateCsvRow(row, columnMap, accounts, categories) {
  const get = key => String(row[columnMap[key] || key] || '').trim();
  const accountValue = get('account') || get('accountId');
  const categoryValue = get('category') || get('categoryId');
  const account = accounts.find(a => a.id === accountValue || a.name.toLowerCase() === accountValue.toLowerCase());
  const destination = accounts.find(a => a.id === get('toAccount') || a.name.toLowerCase() === get('toAccount').toLowerCase());
  const category = categories.find(c => c.id === categoryValue || c.name.toLowerCase() === categoryValue.toLowerCase() || getCategoryPathFromCategoryId(c.id, categories).toLowerCase() === categoryValue.toLowerCase());
  return Object.values(validateTransactionForm({
    date: get('date'), amount: get('amount'), type: get('type') || 'expense',
    accountId: account?.id, toAccountId: destination?.id, categoryId: category?.id
  }, accounts, categories));
}

function getCategoryPathFromCategoryId(categoryId, categories) {
  const category = categories.find((item) => item.id === categoryId);
  if (!category) return '';
  if (!category.parentId) return category.name;
  const parent = categories.find((item) => item.id === category.parentId);
  return `${getCategoryPathFromCategoryId(parent?.id || '', categories)}${parent ? ' → ' : ''}${category.name}`.trim();
}
