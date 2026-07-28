const STORAGE_KEY = 'collector.xiaohongshu.profile-scroll-ledger.v1';
const MAX_ENTRIES = 100;

interface Entry {
  schemaVersion: 1;
  workId: string;
  attemptedCount: 0 | 1 | 2 | 3;
  phase: 'prepared' | 'intent_recorded' | 'completed';
  updatedAt: string;
}

export async function prepareXiaohongshuProfileScroll(workId: string): Promise<void> {
  const entries = await load();
  const existing = entries.find((entry) => entry.workId === workId);
  if (existing?.attemptedCount) throw new Error('xiaohongshu_profile_scroll_action_already_attempted');
  if (!existing) entries.push({
    schemaVersion: 1,
    workId,
    attemptedCount: 0,
    phase: 'prepared',
    updatedAt: new Date().toISOString()
  });
  await save(entries);
}

export async function recordXiaohongshuProfileScrollIntent(
  workId: string,
  attemptedCount: 1 | 2 | 3
): Promise<void> {
  const entries = await load();
  const entry = entries.find((candidate) => candidate.workId === workId);
  if (!entry || entry.attemptedCount !== attemptedCount - 1) {
    throw new Error('xiaohongshu_profile_scroll_ledger_out_of_sequence');
  }
  entry.attemptedCount = attemptedCount;
  entry.phase = 'intent_recorded';
  entry.updatedAt = new Date().toISOString();
  await save(entries);
}

export async function completeXiaohongshuProfileScroll(workId: string): Promise<void> {
  const entries = await load();
  const entry = entries.find((candidate) => candidate.workId === workId);
  if (!entry) throw new Error('xiaohongshu_profile_scroll_ledger_missing');
  entry.phase = 'completed';
  entry.updatedAt = new Date().toISOString();
  await save(entries);
}

export async function xiaohongshuProfileScrollAttemptCount(workId: string): Promise<0 | 1 | 2 | 3> {
  return (await load()).find((entry) => entry.workId === workId)?.attemptedCount ?? 0;
}

async function load(): Promise<Entry[]> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const value = stored[STORAGE_KEY];
  if (!Array.isArray(value)) return [];
  return value.filter(isEntry).slice(-MAX_ENTRIES);
}

async function save(entries: Entry[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: entries.slice(-MAX_ENTRIES) });
}

function isEntry(value: unknown): value is Entry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Partial<Entry>;
  return entry.schemaVersion === 1 && typeof entry.workId === 'string' &&
    /^[0-9a-f-]{36}$/i.test(entry.workId) &&
    (entry.attemptedCount === 0 || entry.attemptedCount === 1 || entry.attemptedCount === 2 ||
      entry.attemptedCount === 3) &&
    (entry.phase === 'prepared' || entry.phase === 'intent_recorded' || entry.phase === 'completed') &&
    typeof entry.updatedAt === 'string' && Number.isFinite(Date.parse(entry.updatedAt));
}
