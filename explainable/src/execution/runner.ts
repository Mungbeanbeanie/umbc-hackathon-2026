import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { spawn } from 'child_process';

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  error?: string;
}

const TIMEOUT_MS = 10_000;

type LangConfig =
  | { kind: 'spawn'; cmd: string; args: (file: string) => string[]; ext: string }
  | { kind: 'json' }
  | { kind: 'unsupported'; reason: string };

const LANG_MAP: Record<string, LangConfig> = {
  python:     { kind: 'spawn', cmd: 'python3', args: f => [f], ext: '.py' },
  python3:    { kind: 'spawn', cmd: 'python3', args: f => [f], ext: '.py' },
  javascript: { kind: 'spawn', cmd: 'node',    args: f => [f], ext: '.js' },
  typescript: { kind: 'spawn', cmd: 'npx', args: f => ['ts-node', f], ext: '.ts' },
  java:       { kind: 'unsupported', reason: 'Java: run with `javac <file>.java && java <ClassName>`' },
  json:       { kind: 'json' },
  html:       { kind: 'unsupported', reason: 'HTML: open in a browser or use the VS Code Live Preview extension.' },
};

export async function runCode(code: string, language: string): Promise<RunResult> {
  const config = LANG_MAP[language.toLowerCase()];

  if (!config) {
    return {
      stdout: '',
      stderr: '',
      exitCode: 1,
      error: `Language "${language}" is not supported for execution in Explainable.`,
    };
  }

  if (config.kind === 'unsupported') {
    return { stdout: '', stderr: '', exitCode: 0, error: config.reason };
  }

  if (config.kind === 'json') {
    try {
      const pretty = JSON.stringify(JSON.parse(code), null, 2);
      return { stdout: pretty, stderr: '', exitCode: 0 };
    } catch (e) {
      return {
        stdout: '',
        stderr: e instanceof Error ? e.message : 'Invalid JSON',
        exitCode: 1,
      };
    }
  }

  return spawnProcess(code, config);
}

async function spawnProcess(
  code: string,
  config: Extract<LangConfig, { kind: 'spawn' }>
): Promise<RunResult> {
  const tmpFile = path.join(os.tmpdir(), `explainable_${Date.now()}${config.ext}`);

  try {
    await fs.writeFile(tmpFile, code, 'utf8');
  } catch (e) {
    return {
      stdout: '',
      stderr: '',
      exitCode: 1,
      error: `Could not write temp file: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  return new Promise<RunResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const child = spawn(config.cmd, config.args(tmpFile), {
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        LANG: process.env.LANG ?? '',
      },
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => { child.kill('SIGKILL'); }, 2000);
    }, TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on('close', async (code) => {
      clearTimeout(timer);
      try { await fs.unlink(tmpFile); } catch { /* ignore cleanup errors */ }

      if (timedOut) {
        resolve({
          stdout,
          stderr,
          exitCode: code ?? 1,
          error: `Execution timed out after ${TIMEOUT_MS / 1000}s`,
        });
        return;
      }

      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    child.on('error', async (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      try { await fs.unlink(tmpFile); } catch { /* ignore */ }

      if (err.code === 'ENOENT' && config.cmd === 'python3') {
        resolve(spawnProcess(code, { ...config, cmd: 'python' }));
        return;
      }

      resolve({
        stdout: '',
        stderr: '',
        exitCode: 1,
        error: `Could not start "${config.cmd}": ${err.message}. Is it installed and on your PATH?`,
      });
    });
  });
}
