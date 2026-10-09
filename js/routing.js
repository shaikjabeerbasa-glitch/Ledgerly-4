const ROUTE_KEYS = new Set(['dashboard', 'accounts', 'transactions', 'budgets', 'categories', 'recurring', 'settings']);

export function getRouteFromHash() {
  const hash = window.location.hash || '#/dashboard';
  const normalized = hash.startsWith('#') ? hash.slice(1) : hash;
  const route = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return ROUTE_KEYS.has(route.replace('/', '')) ? route : '/dashboard';
}

export function setHashRoute(route) {
  const normalized = route.startsWith('/') ? route : `/${route}`;
  const fallback = normalized === '/' ? '/dashboard' : normalized;
  window.location.hash = fallback;
}

export function bindRouteHandler(handler) {
  const onHashChange = () => handler(getRouteFromHash());
  window.addEventListener('hashchange', onHashChange);
  onHashChange();
}
