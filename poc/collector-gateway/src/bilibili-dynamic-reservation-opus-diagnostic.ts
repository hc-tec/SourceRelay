import {
  type BilibiliDynamicDomSnapshot,
  type BilibiliDynamicReservationOpusFieldDiagnostic,
  projectBilibiliDynamicFeedResponse
} from './bilibili-dynamic-contract';
import { bilibiliDynamicCardTextEvidenceMatches } from './bilibili-dynamic-response';

type CandidatePath = BilibiliDynamicReservationOpusFieldDiagnostic['cards'][number]['matchingFieldPaths'][number];

interface TextCandidate {
  path: CandidatePath;
  value: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedText(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 20_000 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const normalised = value.replace(/\s+/g, ' ').trim();
  return normalised || null;
}

function atPath(value: Record<string, unknown>, path: readonly string[]): unknown {
  let cursor: unknown = value;
  for (const segment of path) {
    const current = record(cursor);
    if (!current) return undefined;
    cursor = current[segment];
  }
  return cursor;
}

function responseItems(value: unknown): Record<string, unknown>[] | null {
  const root = record(value);
  const data = record(root?.data);
  if (!data || !Array.isArray(data.items) || data.items.length > 50) return null;
  const items = data.items.map(record);
  return items.every((item): item is Record<string, unknown> => item !== null) ? items : null;
}

function candidateTextFields(item: Record<string, unknown>): TextCandidate[] {
  const descriptors: Array<{ path: CandidatePath; segments: readonly string[] }> = [
    { path: 'modules.module_dynamic.desc.text', segments: ['modules', 'module_dynamic', 'desc', 'text'] },
    { path: 'modules.module_dynamic.major.opus.title', segments: ['modules', 'module_dynamic', 'major', 'opus', 'title'] },
    { path: 'modules.module_dynamic.major.opus.desc', segments: ['modules', 'module_dynamic', 'major', 'opus', 'desc'] },
    { path: 'modules.module_dynamic.major.opus.summary.text', segments: ['modules', 'module_dynamic', 'major', 'opus', 'summary', 'text'] },
    { path: 'modules.module_dynamic.additional.reserve.title', segments: ['modules', 'module_dynamic', 'additional', 'reserve', 'title'] },
    { path: 'modules.module_dynamic.additional.reserve.desc1', segments: ['modules', 'module_dynamic', 'additional', 'reserve', 'desc1'] },
    { path: 'modules.module_dynamic.additional.reserve.desc2', segments: ['modules', 'module_dynamic', 'additional', 'reserve', 'desc2'] }
  ];
  return descriptors.flatMap(({ path, segments }) => {
    const value = boundedText(atPath(item, segments));
    return value ? [{ path, value }] : [];
  });
}

/**
 * Correlates the fixed, reviewed response field allowlist with an already
 * captured card. The returned evidence is deliberately value-free so a
 * failed canary can explain a mapping gap without becoming a raw archive.
 */
export function bilibiliDynamicReservationOpusFieldDiagnostic(input: {
  responseValue: unknown;
  expectedAccountId: string;
  dom: BilibiliDynamicDomSnapshot;
}): BilibiliDynamicReservationOpusFieldDiagnostic | null {
  const response = projectBilibiliDynamicFeedResponse(input.responseValue, input.expectedAccountId, 1);
  const rawItems = responseItems(input.responseValue);
  if (!response || !rawItems || rawItems.length !== response.items.length) return null;
  const exactCardCountAlignment = input.dom.cards.length === response.items.length;
  const cards: BilibiliDynamicReservationOpusFieldDiagnostic['cards'] = [];
  for (const [index, item] of response.items.entries()) {
    const card = input.dom.cards[index];
    const rawItem = rawItems[index];
    if (!card || !rawItem || card.kind !== 'opus' || !card.reservation) continue;
    const renderedMediaAlts = card.images.map((image) => image.alt).filter(Boolean);
    const candidates = candidateTextFields(rawItem);
    const matchingFieldPaths = candidates
      .filter((candidate) => bilibiliDynamicCardTextEvidenceMatches(card.visibleText, [candidate.value], renderedMediaAlts))
      .map((candidate) => candidate.path);
    cards.push({
      positionOnPage: index + 1,
      responsePrimaryIdentityKind: item.primaryIdentity.kind,
      responseMajorType: item.majorType,
      domCardKind: card.kind,
      domReservation: true,
      genericVisibleTextMatch: bilibiliDynamicCardTextEvidenceMatches(
        card.visibleText,
        [item.visibleText],
        renderedMediaAlts
      ),
      genericMajorTitleMatch: bilibiliDynamicCardTextEvidenceMatches(
        card.visibleText,
        [item.majorTitle],
        renderedMediaAlts
      ),
      matchingFieldPaths: [...new Set(matchingFieldPaths)]
    });
  }
  return {
    schemaVersion: 1,
    responseItemCount: response.items.length,
    domCardCount: input.dom.cards.length,
    exactCardCountAlignment,
    cards
  };
}
