import { appendFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { OperationalLogEvent } from '@intelligence/collector-contracts';

const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAXIMUM_BYTES = 32 * 1024 * 1024;

export interface RuntimeJournalEntry extends OperationalLogEvent {
  hostInstanceId: string;
  browserSessionId: string | null;
  controllerGeneration: string | null;
  profileId: string | null;
  pageAlias: string | null;
  targetIdentityDigest: string | null;
  recordVersion: number | null;
  state: string | null;
  reason: string | null;
  actionId: string | null;
}

export class RuntimeJournal {
  readonly #directory: string;
  readonly #path: string;
  #writeTail: Promise<void> = Promise.resolve();

  constructor(directory: string, hostInstanceId: string) {
    this.#directory = resolve(directory);
    this.#path = resolve(this.#directory, `${hostInstanceId}.active.jsonl`);
  }

  async initialise(): Promise<void> {
    await mkdir(this.#directory, { recursive: true });
    await this.#prune();
  }

  append(entry: RuntimeJournalEntry): Promise<void> {
    const line = `${JSON.stringify(entry)}\n`;
    this.#writeTail = this.#writeTail.then(async () => {
      await appendFile(this.#path, line, { encoding: 'utf8', mode: 0o600 });
    });
    return this.#writeTail;
  }

  async flush(): Promise<void> {
    await this.#writeTail;
  }

  async seal(): Promise<void> {
    await this.flush();
    const sealedPath = this.#path.replace(/\.active\.jsonl$/, '.sealed.jsonl');
    const { rename } = await import('node:fs/promises');
    await rename(this.#path, sealedPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
    await this.#prune();
  }

  async #prune(now = Date.now()): Promise<void> {
    const candidates: Array<{ path: string; modifiedAt: number; size: number }> = [];
    for (const name of await readdir(this.#directory).catch(() => [] as string[])) {
      if (!name.endsWith('.sealed.jsonl')) continue;
      const path = resolve(this.#directory, name);
      const metadata = await stat(path).catch(() => null);
      if (!metadata) continue;
      if (now - metadata.mtimeMs > DEFAULT_RETENTION_MS) {
        await rm(path, { force: true });
        continue;
      }
      candidates.push({ path, modifiedAt: metadata.mtimeMs, size: metadata.size });
    }

    candidates.sort((left, right) => left.modifiedAt - right.modifiedAt);
    let total = candidates.reduce((sum, item) => sum + item.size, 0);
    for (const candidate of candidates) {
      if (total <= DEFAULT_MAXIMUM_BYTES) break;
      await rm(candidate.path, { force: true });
      total -= candidate.size;
    }
  }
}
