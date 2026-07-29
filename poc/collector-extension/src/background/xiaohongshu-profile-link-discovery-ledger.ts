const STORAGE_KEY = 'collector.xiaohongshu.profile-link-discovery-ledger.v1';

interface Entry {
  workId: string;
  attempted: boolean;
  completed: boolean;
}

export async function recordXiaohongshuProfileLinkDiscoveryIntent(workId: string): Promise<void> {
  const entries = await readEntries();
  const existing = entries.find((entry) => entry.workId === workId);
  if (existing?.attempted) throw new Error('xiaohongshu_profile_link_discovery_already_attempted');
  entries.push({ workId, attempted: true, completed: false });
  await chrome.storage.session.set({ [STORAGE_KEY]: entries.slice(-32) });
}

export async function completeXiaohongshuProfileLinkDiscovery(workId: string): Promise<void> {
  const entries = await readEntries();
  const entry = entries.find((candidate) => candidate.workId === workId);
  if (!entry?.attempted || entry.completed) throw new Error('xiaohongshu_profile_link_discovery_ledger_out_of_sequence');
  entry.completed = true;
  await chrome.storage.session.set({ [STORAGE_KEY]: entries.slice(-32) });
}

export async function xiaohongshuProfileLinkDiscoveryAttempted(workId: string): Promise<boolean> {
  return (await readEntries()).some((entry) => entry.workId === workId && entry.attempted);
}

async function readEntries(): Promise<Entry[]> {
  const stored = await chrome.storage.session.get(STORAGE_KEY);
  const value = stored[STORAGE_KEY];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is Entry => Boolean(entry) && typeof entry === 'object' &&
    typeof (entry as Entry).workId === 'string' && typeof (entry as Entry).attempted === 'boolean' &&
    typeof (entry as Entry).completed === 'boolean');
}
