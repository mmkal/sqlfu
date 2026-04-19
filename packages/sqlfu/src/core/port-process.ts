import childProcess from 'node:child_process';

export interface ListeningProcess {
  pid: number;
  command?: string;
}

export class PortInUseError extends Error {
  port: number;
  processes: readonly ListeningProcess[];

  constructor(port: number, processes: readonly ListeningProcess[]) {
    super(formatPortInUseMessage(port, processes));
    this.name = 'PortInUseError';
    this.port = port;
    this.processes = processes;
  }
}

export async function getListeningProcesses(port: number): Promise<readonly ListeningProcess[]> {
  const output = await runLsof(['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpc']);
  const processes: ListeningProcess[] = [];
  let current: Partial<ListeningProcess> = {};

  for (const line of output.split('\n')) {
    if (!line) {
      continue;
    }

    if (line.startsWith('p')) {
      if (current.pid) {
        processes.push({
          pid: current.pid,
          command: current.command,
        });
      }
      current = {pid: Number(line.slice(1))};
      continue;
    }

    if (line.startsWith('c')) {
      current.command = line.slice(1);
    }
  }

  if (current.pid) {
    processes.push({
      pid: current.pid,
      command: current.command,
    });
  }

  return processes;
}

export async function stopProcessesListeningOnPort(port: number): Promise<readonly ListeningProcess[]> {
  const processes = await getListeningProcesses(port);

  for (const listener of processes) {
    process.kill(listener.pid, 'SIGTERM');
  }

  if (processes.length > 0) {
    await waitForPortToClear(port);
  }

  return processes;
}

export function formatPortInUseMessage(port: number, processes: readonly ListeningProcess[]): string {
  const listenerSummary =
    processes.length > 0
      ? ` Listener${processes.length === 1 ? '' : 's'}: ${processes.map(formatProcessLabel).join(', ')}.`
      : '';

  return `Port ${port} is already in use.${listenerSummary} Run 'sqlfu kill' to stop the existing local server, or 'sqlfu serve --port <port>' to use a different port.`;
}

function formatProcessLabel(process: ListeningProcess) {
  return process.command ? `${process.command} (${process.pid})` : String(process.pid);
}

async function waitForPortToClear(port: number) {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    if ((await getListeningProcesses(port)).length === 0) {
      return;
    }
    await sleep(50);
  }

  throw new Error(`Timed out waiting for port ${port} to clear after sending SIGTERM.`);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function runLsof(args: readonly string[]) {
  try {
    return await new Promise<string>((resolve, reject) => {
      childProcess.execFile('lsof', args, (error, stdout) => {
        if (error) {
          if ('code' in error && error.code === 1) {
            resolve('');
            return;
          }
          reject(error);
          return;
        }

        resolve(stdout);
      });
    });
  } catch (error) {
    throw new Error(`Failed to inspect local ports with lsof: ${String(error)}`);
  }
}
