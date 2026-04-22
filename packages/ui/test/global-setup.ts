// Warm up the default dev-project before any test runs. The first page.goto('/')
// on a cold server triggers Vite dev compile, query catalog codegen, and the
// sqlite seed — collectively too slow for the default 5s expect timeout in CI.
// Hitting the server once here gets that one-off cost out of the way so every
// individual test has a warm server to assert against.
export default async function globalSetup() {
  const baseURL = 'http://127.0.0.1:3218';
  const deadline = Date.now() + 60_000;

  while (Date.now() < deadline) {
    const response = await fetch(baseURL, {redirect: 'follow'}).catch(() => null);
    if (response?.ok) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const rpcCalls = [
    ['project/status', {}],
    ['schema/get', {}],
    ['catalog', {}],
  ] as const;

  for (const [procedure, input] of rpcCalls) {
    await fetch(`${baseURL}/api/rpc/${procedure}`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({json: input}),
    }).catch(() => null);
  }
}
