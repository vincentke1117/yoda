import { spawn, type ChildProcess } from 'node:child_process';
import { get } from 'node:http';
import net from 'node:net';
import { backendProcessRegistry } from '@main/core/backend-processes/backend-process-registry';
import { resolveCommandPath } from '@main/core/dependencies/probe';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { buildTerminalEnv } from '@main/core/pty/pty-env';
import { log } from '@main/lib/logger';

const PREVIEW_START_TIMEOUT_MS = 20_000;
const PREVIEW_PROBE_INTERVAL_MS = 150;
const PREVIEW_PROBE_TIMEOUT_MS = 500;
const MAX_START_OUTPUT_CHARS = 8_000;

export type AppPreviewMeta = {
  label: string;
  projectId: string;
  projectName: string;
};

type PreviewSession = {
  child: ChildProcess;
  projectPath: string;
  url: string;
  output: string;
  meta?: AppPreviewMeta;
  startupError?: Error;
};

export class AiLabAppPreviewService {
  private readonly sessions = new Map<string, PreviewSession>();
  private readonly starts = new Map<string, Promise<string>>();

  async start(appId: string, projectPath: string, meta?: AppPreviewMeta): Promise<string> {
    const current = this.sessions.get(appId);
    if (current && current.projectPath === projectPath && isRunning(current.child)) {
      return current.url;
    }
    if (current) this.stop(appId);

    const pending = this.starts.get(appId);
    if (pending) return pending;

    const start = this.startProcess(appId, projectPath, meta).finally(() => {
      this.starts.delete(appId);
    });
    this.starts.set(appId, start);
    return start;
  }

  stop(appId: string): void {
    const session = this.sessions.get(appId);
    if (!session) return;
    this.sessions.delete(appId);
    backendProcessRegistry.unregister(`app-preview:${appId}`);
    if (isRunning(session.child)) session.child.kill('SIGTERM');
  }

  dispose(): void {
    for (const appId of this.sessions.keys()) this.stop(appId);
  }

  private async startProcess(
    appId: string,
    projectPath: string,
    meta?: AppPreviewMeta
  ): Promise<string> {
    const context = new LocalExecutionContext();
    const pnpmPath = await resolveCommandPath('pnpm', context);
    context.dispose();
    if (!pnpmPath) {
      throw new Error('pnpm is required to start this App preview.');
    }

    const port = await reserveLoopbackPort();
    const url = `http://127.0.0.1:${port}/`;
    const child = spawn(
      pnpmPath,
      ['run', 'dev', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
      {
        cwd: projectPath,
        env: {
          ...buildTerminalEnv(),
          BROWSER: 'none',
          NO_COLOR: '1',
        },
        shell: process.platform === 'win32',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    const session: PreviewSession = { child, projectPath, url, output: '', meta };
    this.sessions.set(appId, session);
    backendProcessRegistry.register(`app-preview:${appId}`, {
      id: appId,
      kind: 'app-preview',
      label: meta?.label ?? appId,
      projectId: meta?.projectId ?? null,
      projectName: meta?.projectName ?? null,
      url,
      pid: child.pid ?? null,
      detachable: false,
    });

    const appendOutput = (chunk: Buffer | string) => {
      session.output = `${session.output}${chunk.toString()}`.slice(-MAX_START_OUTPUT_CHARS);
    };
    child.stdout?.on('data', appendOutput);
    child.stderr?.on('data', appendOutput);
    child.once('error', (error) => {
      session.startupError = error;
      appendOutput(error.message);
    });
    child.once('exit', (code, signal) => {
      if (this.sessions.get(appId) === session) {
        this.sessions.delete(appId);
        backendProcessRegistry.unregister(`app-preview:${appId}`);
      }
      log.info('[ai-lab] App preview stopped', { appId, code, signal });
    });

    try {
      await waitUntilReachable(session);
      log.info('[ai-lab] App preview ready', { appId, projectPath, url });
      return url;
    } catch (error) {
      this.stop(appId);
      throw error;
    }
  }
}

async function reserveLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not reserve a local preview port.'));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

async function waitUntilReachable(session: PreviewSession): Promise<void> {
  const deadline = Date.now() + PREVIEW_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (session.startupError) {
      throw new Error(`The App preview process could not start.${formatOutput(session.output)}`);
    }
    if (!isRunning(session.child)) {
      throw new Error(
        `The App preview process exited before it was ready.${formatOutput(session.output)}`
      );
    }
    if (await isHttpReachable(session.url)) return;
    await delay(PREVIEW_PROBE_INTERVAL_MS);
  }
  throw new Error(`The App preview did not start in time.${formatOutput(session.output)}`);
}

function isHttpReachable(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const request = get(url, (response) => {
      response.resume();
      resolve(true);
    });
    request.setTimeout(PREVIEW_PROBE_TIMEOUT_MS, () => {
      request.destroy();
      resolve(false);
    });
    request.once('error', () => resolve(false));
  });
}

function isRunning(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null && !child.killed;
}

function formatOutput(output: string): string {
  const detail = output.trim();
  return detail ? `\n\n${detail}` : '';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const aiLabAppPreviewService = new AiLabAppPreviewService();
