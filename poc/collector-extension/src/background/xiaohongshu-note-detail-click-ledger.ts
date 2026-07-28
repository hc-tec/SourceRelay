const STORAGE_KEY = 'collector.xiaohongshu.note-detail-click-ledger.v1';
const MAX_ENTRIES = 100;

interface Entry {
  schemaVersion: 1;
  workId: string;
  attempted: boolean;
  phase: 'prepared' | 'intent_recorded' | 'completed';
  updatedAt: string;
}

export async function prepareXiaohongshuNoteDetailClick(workId: string): Promise<void> {
  const entries = await load();
  const existing = entries.find((entry) => entry.workId === workId);
  if (existing?.attempted) throw new Error('xiaohongshu_note_detail_action_already_attempted');
  if (!existing) entries.push({
    schemaVersion: 1,
    workId,
    attempted: false,
    phase: 'prepared',
    updatedAt: new Date().toISOString()
  });
  await save(entries);
}

export async function recordXiaohongshuNoteDetailClickIntent(workId: string): Promise<void> {
  const entries = await load();
  const entry = entries.find((candidate) => candidate.workId === workId);
  if (!entry || entry.attempted) throw new Error('xiaohongshu_note_detail_ledger_out_of_sequence');
  entry.attempted = true;
  entry.phase = 'intent_recorded';
  entry.updatedAt = new Date().toISOString();
  await save(entries);
}

export async function completeXiaohongshuNoteDetailClick(workId: string): Promise<void> {
  const entries = await load();
  const entry = entries.find((candidate) => candidate.workId === workId);
  if (!entry?.attempted) throw new Error('xiaohongshu_note_detail_ledger_missing');
  entry.phase = 'completed';
  entry.updatedAt = new Date().toISOString();
  await save(entries);
}

export async function xiaohongshuNoteDetailClickAttempted(workId: string): Promise<boolean> {
  return (await load()).find((entry) => entry.workId === workId)?.attempted ?? false;
}

async function load(): Promise<Entry[]> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const value = stored[STORAGE_KEY];
  return Array.isArray(value) ? value.filter(isEntry).slice(-MAX_ENTRIES) : [];
}

async function save(entries: Entry[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: entries.slice(-MAX_ENTRIES) });
}

function isEntry(value: unknown): value is Entry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Partial<Entry>;
  return entry.schemaVersion === 1 && typeof entry.workId === 'string' && /^[0-9a-f-]{36}$/i.test(entry.workId) &&
    typeof entry.attempted === 'boolean' &&
    (entry.phase === 'prepared' || entry.phase === 'intent_recorded' || entry.phase === 'completed') &&
    typeof entry.updatedAt === 'string' && Number.isFinite(Date.parse(entry.updatedAt));
}
