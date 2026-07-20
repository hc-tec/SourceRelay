import { digestUrl, touchRecord, transitionRecord, type ManagedPageRecord } from './page-record.js';

export interface PageLedgerEvent {
  eventType: string;
  profileId: string;
  record: ManagedPageRecord;
  reason: string | null;
  actionId: string | null;
}

export function attachManagedPageEvents(
  profileId: string,
  record: ManagedPageRecord,
  emit: (event: PageLedgerEvent) => void
): void {
  const notify = (eventType: string, reason: string | null) => emit({
    eventType,
    profileId,
    record,
    reason,
    actionId: null
  });
  record.page.on('close', () => {
    record.activeLease = null;
    transitionRecord(record, 'closed', null);
    notify('page_closed', null);
  });
  record.page.on('crash', () => {
    record.activeLease = null;
    transitionRecord(record, 'quarantined', 'renderer_crashed');
    notify('renderer_crashed', 'renderer_crashed');
  });
  record.page.on('framenavigated', (frame) => {
    if (frame !== record.page.mainFrame()) return;
    record.documentGeneration += 1;
    if (record.state === 'idle_reusable' || record.state === 'idle_stale' || record.state === 'reclaim_pending') {
      const actual = digestUrl(record.page.url());
      if (actual !== record.expectedIdentity.targetUrlDigest) {
        transitionRecord(record, 'quarantined', 'unexpected_navigation');
      } else {
        transitionRecord(record, 'idle_stale', null);
      }
    } else {
      touchRecord(record);
    }
    notify('main_frame_navigated', record.quarantineReason);
  });
}
