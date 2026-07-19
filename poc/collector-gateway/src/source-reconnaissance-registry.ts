import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { BilibiliDetailSourceReconnaissanceRecord } from './source-reconnaissance-contract';

function isPersistedRecord(value: unknown): value is BilibiliDetailSourceReconnaissanceRecord {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<BilibiliDetailSourceReconnaissanceRecord>;
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.recordId === 'string' &&
    typeof candidate.runId === 'string' &&
    typeof candidate.profileId === 'string' &&
    candidate.platform === 'bilibili' &&
    candidate.pageRole === 'video_detail' &&
    candidate.evidenceObjective === 'detail_read' &&
    /^[0-9a-f]{64}$/.test(candidate.targetUrlDigest ?? '') &&
    (candidate.state === 'completed' || candidate.state === 'inconclusive' || candidate.state === 'failed') &&
    Array.isArray(candidate.lifecycle) &&
    Array.isArray(candidate.domObservations) &&
    Array.isArray(candidate.extensionTimeline) &&
    Array.isArray(candidate.networkObservations) &&
    Array.isArray(candidate.routeSummary) &&
    candidate.safeguards?.admissionEligible === false
  );
}

export class SourceReconnaissanceRegistry {
  readonly #registryPath: string;
  #records: BilibiliDetailSourceReconnaissanceRecord[] = [];
  #writeChain: Promise<void> = Promise.resolve();

  private constructor(stateDirectory: string) {
    this.#registryPath = resolve(stateDirectory, 'source-reconnaissance-runs.json');
  }

  static async create(stateDirectory: string): Promise<SourceReconnaissanceRegistry> {
    const registry = new SourceReconnaissanceRegistry(stateDirectory);
    await mkdir(resolve(stateDirectory), { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(registry.#registryPath, 'utf8')) as unknown;
      if (Array.isArray(parsed)) registry.#records = parsed.filter(isPersistedRecord);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return registry;
  }

  list(): BilibiliDetailSourceReconnaissanceRecord[] {
    return this.#records.map((record) => structuredClone(record));
  }

  async record(record: BilibiliDetailSourceReconnaissanceRecord): Promise<BilibiliDetailSourceReconnaissanceRecord> {
    if (!isPersistedRecord(record)) throw new Error('source_reconnaissance_record_invalid');
    const existing = this.#records.find((candidate) => candidate.runId === record.runId);
    if (existing) return structuredClone(existing);
    this.#records.push(structuredClone(record));
    try {
      await this.#save();
    } catch (error) {
      this.#records = this.#records.filter((candidate) => candidate.runId !== record.runId);
      throw error;
    }
    return structuredClone(record);
  }

  async #save(): Promise<void> {
    const write = this.#writeChain.then(async () => {
      const temporaryPath = `${this.#registryPath}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(this.#records, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600
      });
      await rename(temporaryPath, this.#registryPath);
    });
    this.#writeChain = write.catch(() => undefined);
    await write;
  }
}
