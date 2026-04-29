export function contentTypeForUiAssetPath(assetPath: string): string {
  if (assetPath.endsWith('.js') || assetPath.endsWith('.mjs')) {
    return 'text/javascript; charset=utf-8';
  }
  if (assetPath.endsWith('.css')) {
    return 'text/css; charset=utf-8';
  }
  if (assetPath.endsWith('.html')) {
    return 'text/html; charset=utf-8';
  }
  if (assetPath.endsWith('.json')) {
    return 'application/json; charset=utf-8';
  }
  if (assetPath.endsWith('.svg')) {
    return 'image/svg+xml';
  }
  if (assetPath.endsWith('.png')) {
    return 'image/png';
  }
  if (assetPath.endsWith('.ico')) {
    return 'image/x-icon';
  }
  if (assetPath.endsWith('.wasm')) {
    return 'application/wasm';
  }
  return 'application/octet-stream';
}
