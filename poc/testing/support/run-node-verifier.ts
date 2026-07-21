import { spawn } from 'node:child_process';

export interface NodeVerifierResult {
  report: Record<string, unknown>;
  stdout: string;
  stderr: string;
}

export async function runNodeVerifier(input: Readonly<{
  scriptPath: string;
  cwd: string;
  timeoutMs: number;
}>): Promise<NodeVerifierResult> {
  const child = spawn(process.execPath, [input.scriptPath], {
    cwd: input.cwd,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => { stdout += chunk; });
  child.stderr.on('data', (chunk: string) => { stderr += chunk; });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void terminateTestProcess(child.pid);
  }, input.timeoutMs);

  const outcome = await new Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>((resolveOutcome, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolveOutcome({ code, signal }));
  }).finally(() => clearTimeout(timer));

  if (timedOut) {
    throw new Error(`real_local_verifier_timed_out:${input.scriptPath}:${tail(stderr || stdout)}`);
  }
  if (outcome.code !== 0) {
    throw new Error(`real_local_verifier_failed:${input.scriptPath}:exit=${outcome.code}:signal=${outcome.signal}:${tail(stderr || stdout)}`);
  }

  let report: unknown;
  try {
    report = JSON.parse(stdout.trim());
  } catch {
    throw new Error(`real_local_verifier_report_invalid:${input.scriptPath}:${tail(stdout)}`);
  }
  if (!report || typeof report !== 'object' || (report as { ok?: unknown }).ok !== true) {
    throw new Error(`real_local_verifier_report_rejected:${input.scriptPath}`);
  }
  return { report: report as Record<string, unknown>, stdout, stderr };
}

async function terminateTestProcess(processId: number | undefined): Promise<void> {
  if (!processId) return;
  if (process.platform !== 'win32') {
    process.kill(processId, 'SIGTERM');
    return;
  }
  await new Promise<void>((resolve) => {
    const killer = spawn('taskkill', ['/pid', String(processId), '/t', '/f'], {
      windowsHide: true,
      stdio: 'ignore'
    });
    killer.once('error', () => resolve());
    killer.once('exit', () => resolve());
  });
}

function tail(value: string): string {
  return value.slice(-1_000).replace(/\s+/g, ' ').trim();
}
