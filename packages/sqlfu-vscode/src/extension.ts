import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import * as vscode from 'vscode';

/**
 * One command today: `sqlfu: Open UI`.
 *
 * Resolves the `sqlfu` CLI from the nearest workspace folder, spawns
 * `sqlfu serve --port <free>`, waits for the server to announce itself,
 * then opens the URL in a VS Code webview panel.
 *
 * When the extension deactivates, the server is killed.
 *
 * Ambitions not yet built:
 *   - CodeLens over `.sql` files ("run against dev DB").
 *   - LSP-backed completion from `definitions.sql`.
 *   - Teach SQLTools/vscode-sqlite where the dev DB lives via workspace settings.
 */
export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand('sqlfu.openUi', async () => {
    try {
      await openUi(context);
    } catch (error) {
      vscode.window.showErrorMessage(`sqlfu: ${String(error)}`);
    }
  });
  context.subscriptions.push(disposable);
}

export function deactivate(): void {
  // child processes are disposed via context.subscriptions
}

async function openUi(context: vscode.ExtensionContext): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    throw new Error('no workspace folder open. open a folder with a sqlfu.config.ts.');
  }

  const projectRoot = folder.uri.fsPath;
  const hasConfig = ['sqlfu.config.ts', 'sqlfu.config.mjs', 'sqlfu.config.js', 'sqlfu.config.cjs'].some((name) =>
    fs.existsSync(path.join(projectRoot, name)),
  );
  if (!hasConfig) {
    throw new Error(
      `no sqlfu.config.* found in ${projectRoot}. run \`sqlfu init\` in a terminal first, or open a workspace that has one.`,
    );
  }

  const cli = resolveCli(projectRoot);
  if (!cli) {
    throw new Error(
      'could not find the `sqlfu` CLI. install sqlfu in this workspace (`pnpm add -D sqlfu`) or globally, then re-run.',
    );
  }

  const port = await findFreePort();
  const output = vscode.window.createOutputChannel('sqlfu');
  context.subscriptions.push(output);
  output.appendLine(`[sqlfu-vscode] starting \`${cli.command} ${cli.args.concat(['serve', '--port', String(port)]).join(' ')}\``);

  const child = childProcess.spawn(cli.command, [...cli.args, 'serve', '--port', String(port)], {
    cwd: projectRoot,
    env: process.env,
  });
  context.subscriptions.push({
    dispose: () => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    },
  });

  child.stdout?.on('data', (chunk: Buffer) => output.append(chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => output.append(chunk.toString()));
  child.on('exit', (code) => output.appendLine(`[sqlfu-vscode] sqlfu serve exited with code ${code}`));

  const url = `http://127.0.0.1:${port}`;
  await waitForServer(url, 15_000);

  const panel = vscode.window.createWebviewPanel('sqlfu.ui', 'sqlfu', vscode.ViewColumn.Active, {
    enableScripts: true,
    retainContextWhenHidden: true,
  });
  panel.webview.html = renderWebview(url);
  panel.onDidDispose(() => {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  });
}

interface ResolvedCli {
  command: string;
  args: string[];
}

function resolveCli(projectRoot: string): ResolvedCli | null {
  // 1. Workspace-local bin installed by pnpm/npm/yarn.
  const localBin = path.join(projectRoot, 'node_modules', '.bin', 'sqlfu');
  if (fs.existsSync(localBin)) {
    return {command: localBin, args: []};
  }

  // 2. pnpm exec / npx fallback. We don't try to detect the package manager —
  // pnpm is the sqlfu default; npx is universal. Users with something
  // exotic can install sqlfu as a global bin.
  const localPackageSqlfu = path.join(projectRoot, 'node_modules', 'sqlfu', 'dist', 'cli.js');
  if (fs.existsSync(localPackageSqlfu)) {
    return {command: process.execPath, args: [localPackageSqlfu]};
  }

  // 3. Global bin on PATH.
  return {command: 'sqlfu', args: []};
}

async function findFreePort(): Promise<number> {
  const net = await import('node:net');
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        const {port} = address;
        server.close(() => resolve(port));
      } else {
        reject(new Error('failed to acquire a free port'));
      }
    });
  });
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {
      /* retry */
    }
    await sleep(200);
  }
  throw new Error(`timed out waiting for sqlfu server at ${url}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function renderWebview(url: string): string {
  // VS Code webviews block loading most http:// content via CSP. We keep
  // the webview as a thin shim that tells the user the UI is live, plus
  // an "open in browser" button. Embedding the whole UI requires CSP
  // gymnastics that aren't MVP-worthy — the external browser experience
  // is fine and mirrors what users already have with `sqlfu serve`.
  return `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>sqlfu</title></head>
  <body style="font-family: system-ui; padding: 2rem;">
    <h1>sqlfu is running</h1>
    <p>Dev UI live at <a href="${url}">${url}</a>.</p>
    <p>Open it in your browser — the webview sandbox blocks embedding a local http server directly.</p>
  </body>
</html>`;
}
