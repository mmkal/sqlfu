const defaultHostedApiOrigin = 'http://localhost:56081';

export function resolveApiRpcUrl() {
  const apiOrigin = readApiOrigin();
  return new URL('/api/rpc', apiOrigin || window.location.origin).toString();
}

export function resolveApiOrigin() {
  return readApiOrigin() || window.location.origin;
}

function readApiOrigin() {
  const params = new URLSearchParams(window.location.search);
  const searchValue = params.get('apiOrigin');
  if (searchValue) {
    return searchValue;
  }

  const globalValue =
    globalThis.window && 'SQLFU_API_ORIGIN' in globalThis.window
      ? String((globalThis.window as Window & {SQLFU_API_ORIGIN?: string}).SQLFU_API_ORIGIN || '')
      : '';
  if (globalValue) {
    return globalValue;
  }

  if (window.location.hostname === 'local.sqlfu.dev') {
    return defaultHostedApiOrigin;
  }

  return import.meta.env.VITE_SQLFU_API_ORIGIN || '';
}
