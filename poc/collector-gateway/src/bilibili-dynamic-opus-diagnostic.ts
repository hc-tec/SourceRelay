import {
  type BilibiliDynamicDomSnapshot,
  type BilibiliDynamicOpusFieldDiagnostic,
  projectBilibiliDynamicFeedResponse
} from './bilibili-dynamic-contract';
import { bilibiliDynamicCardTextEvidenceMatches } from './bilibili-dynamic-response';

const MAXIMUM_CANDIDATE_FIELDS = 64;
const MAXIMUM_SCAN_DEPTH = 5;
const MAXIMUM_ARRAY_ITEMS = 12;

interface TextCandidate {
  path: string;
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

function responseItems(value: unknown): Record<string, unknown>[] | null {
  const root = record(value);
  const data = record(root?.data);
  if (!data || !Array.isArray(data.items) || data.items.length > 50) return null;
  const items = data.items.map(record);
  return items.every((item): item is Record<string, unknown> => item !== null) ? items : null;
}

function safeFieldName(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]{0,80}$/.test(value) &&
    !/(?:cookie|token|session|csrf|password|captcha|verify|email|phone|secret)/i.test(value);
}

function collectStringLeaves(value: unknown, path: string, depth: number, result: TextCandidate[]): void {
  if (result.length >= MAXIMUM_CANDIDATE_FIELDS || depth > MAXIMUM_SCAN_DEPTH) return;
  const text = boundedText(value);
  if (text) {
    result.push({ path, value: text });
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, child] of value.slice(0, MAXIMUM_ARRAY_ITEMS).entries()) {
      collectStringLeaves(child, `${path}[${index}]`, depth + 1, result);
      if (result.length >= MAXIMUM_CANDIDATE_FIELDS) return;
    }
    return;
  }
  const object = record(value);
  if (!object) return;
  for (const key of Object.keys(object).sort()) {
    if (!safeFieldName(key)) continue;
    collectStringLeaves(object[key], `${path}.${key}`, depth + 1, result);
    if (result.length >= MAXIMUM_CANDIDATE_FIELDS) return;
  }
}

function candidateTextFields(item: Record<string, unknown>): TextCandidate[] {
  const modules = record(item.modules);
  const dynamic = record(modules?.module_dynamic);
  if (!dynamic) return [];
  const candidates: TextCandidate[] = [];
  for (const field of ['desc', 'major', 'additional']) {
    if (!(field in dynamic)) continue;
    collectStringLeaves(dynamic[field], `modules.module_dynamic.${field}`, 0, candidates);
    if (candidates.length >= MAXIMUM_CANDIDATE_FIELDS) break;
  }
  return candidates;
}

/**
 * The diagnostic is a narrowly-scoped field-source probe for a failed real
 * Opus card cross-check. It examines only the already captured, exact feed
 * response in memory and persists paths/booleans rather than text or values.
 */
export function bilibiliDynamicOpusFieldDiagnostic(input: {
  responseValue: unknown;
  expectedAccountId: string;
  pageNumber: number;
  dom: BilibiliDynamicDomSnapshot;
}): BilibiliDynamicOpusFieldDiagnostic | null {
  const response = projectBilibiliDynamicFeedResponse(
    input.responseValue,
    input.expectedAccountId,
    input.pageNumber
  );
  const rawItems = responseItems(input.responseValue);
  if (!response || !rawItems || rawItems.length !== response.items.length) return null;
  const exactCardCountAlignment = input.dom.cards.length === response.items.length;
  const cards: BilibiliDynamicOpusFieldDiagnostic['cards'] = [];
  for (const [index, item] of response.items.entries()) {
    const card = input.dom.cards[index];
    const rawItem = rawItems[index];
    if (!card || !rawItem || item.primaryIdentity.kind !== 'opus' || card.kind !== 'opus' || card.reservation) continue;
    const renderedMediaAlts = card.images.map((image) => image.alt).filter(Boolean);
    const candidates = candidateTextFields(rawItem);
    const matchingFieldPaths = candidates
      .filter((candidate) => bilibiliDynamicCardTextEvidenceMatches(card.visibleText, [candidate.value], renderedMediaAlts))
      .map((candidate) => candidate.path);
    cards.push({
      positionOnPage: index + 1,
      responseMajorType: item.majorType,
      domCardKind: card.kind,
      domReservation: false,
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
      exactPrimaryIdentityLinkPresent: card.links.some((link) => link.url === item.primaryIdentity.canonicalUrl),
      matchingStableDynamicIdAttributeNames: card.identityAttributeCandidates
        .filter((candidate) => candidate.value === item.stableDynamicId)
        .map((candidate) => candidate.name)
        .sort((left, right) => left.localeCompare(right, 'en')),
      candidateTextPathCount: candidates.length,
      matchingFieldPaths: [...new Set(matchingFieldPaths)].sort((left, right) => left.localeCompare(right, 'en'))
    });
  }
  return {
    schemaVersion: 1,
    pageNumber: input.pageNumber,
    responseItemCount: response.items.length,
    domCardCount: input.dom.cards.length,
    exactCardCountAlignment,
    cards
  };
}
