const STORAGE_KEY = 'collector.xiaohongshu.note-comments-scroll-ledger.v1';
const MAX_ENTRIES = 100;

interface Entry {
  schemaVersion: 1;
  workId: string;
  attemptedCount: 0 | 1 | 2 | 3;
  completedCount: 0 | 1 | 2 | 3;
  updatedAt: string;
}

export async function prepareXiaohongshuNoteCommentsScroll(workId: string): Promise<void> {
  const entries = await load();
  if (entries.some((entry) => entry.workId === workId && entry.attemptedCount > 0)) {
    throw new Error('xiaohongshu_note_comments_action_already_attempted');
  }
  if (!entries.some((entry) => entry.workId === workId)) entries.push({
    schemaVersion: 1, workId, attemptedCount: 0, completedCount: 0, updatedAt: new Date().toISOString()
  });
  await save(entries);
}

export async function recordXiaohongshuNoteCommentsScrollIntent(workId: string, ordinal: 1 | 2 | 3): Promise<void> {
  const entries = await load();
  const entry = entries.find((candidate) => candidate.workId === workId);
  if (!entry || entry.attemptedCount !== ordinal - 1 || entry.completedCount !== ordinal - 1) {
    throw new Error('xiaohongshu_note_comments_ledger_out_of_sequence');
  }
  entry.attemptedCount = ordinal;
  entry.updatedAt = new Date().toISOString();
  await save(entries);
}

export async function completeXiaohongshuNoteCommentsScroll(workId: string, ordinal: 1 | 2 | 3): Promise<void> {
  const entries = await load();
  const entry = entries.find((candidate) => candidate.workId === workId);
  if (!entry || entry.attemptedCount !== ordinal || entry.completedCount !== ordinal - 1) {
    throw new Error('xiaohongshu_note_comments_ledger_missing');
  }
  entry.completedCount = ordinal;
  entry.updatedAt = new Date().toISOString();
  await save(entries);
}

export async function xiaohongshuNoteCommentsScrollCounts(workId: string): Promise<{
  attemptedCount: 0 | 1 | 2 | 3;
  completedCount: 0 | 1 | 2 | 3;
}> {
  const entry = (await load()).find((candidate) => candidate.workId === workId);
  return entry ? { attemptedCount: entry.attemptedCount, completedCount: entry.completedCount }
    : { attemptedCount: 0, completedCount: 0 };
}

async function load(): Promise<Entry[]> {
  const value = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
  return Array.isArray(value) ? value.filter(isEntry).slice(-MAX_ENTRIES) : [];
}
async function save(entries: Entry[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: entries.slice(-MAX_ENTRIES) });
}
function isEntry(value: unknown): value is Entry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Partial<Entry>;
  return entry.schemaVersion === 1 && typeof entry.workId === 'string' && /^[0-9a-f-]{36}$/i.test(entry.workId) &&
    count(entry.attemptedCount) && count(entry.completedCount) && entry.completedCount <= entry.attemptedCount &&
    typeof entry.updatedAt === 'string' && Number.isFinite(Date.parse(entry.updatedAt));
}
function count(value: unknown): value is 0 | 1 | 2 | 3 { return value === 0 || value === 1 || value === 2 || value === 3; }
