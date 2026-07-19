import type {
  TranscriptInteractionAction,
  TranscriptInteractionActionResult,
  TranscriptInteractionOutcome,
  TranscriptInteractionResult
} from '../../collector-extension/src/shared/protocol';

export const REQUIRED_TRANSCRIPT_INTERACTION_ACTIONS: readonly TranscriptInteractionAction[] = [
  'reveal_player_controls',
  'open_caption_menu',
  'select_caption_language'
];

export function transcriptAction(
  actionName: TranscriptInteractionAction,
  attempted: boolean,
  outcome: TranscriptInteractionOutcome,
  input: Partial<Pick<
    TranscriptInteractionActionResult,
    'visibleLabels' | 'selectedLabel' | 'postconditionAcknowledged'
  >> = {}
): TranscriptInteractionActionResult {
  return {
    action: actionName,
    attempted,
    outcome,
    visibleLabels: input.visibleLabels ?? [],
    selectedLabel: input.selectedLabel ?? null,
    postconditionAcknowledged: input.postconditionAcknowledged ?? null
  };
}

export function transcriptInteractionResult(
  canonicalUrl: string,
  actions: TranscriptInteractionActionResult[],
  errorCode: string | null,
  failed = false
): TranscriptInteractionResult {
  const completedActions = actions
    .filter((candidate) => candidate.outcome === 'completed')
    .map((candidate) => candidate.action);
  const status = completedActions.length === REQUIRED_TRANSCRIPT_INTERACTION_ACTIONS.length
    ? 'satisfied'
    : completedActions.length > 0
      ? 'partial'
      : 'not_satisfied';
  return {
    schemaVersion: 1,
    canonicalUrl,
    state: failed ? 'failed' : status === 'satisfied' ? 'completed' : 'inconclusive',
    objective: {
      status,
      requiredActions: REQUIRED_TRANSCRIPT_INTERACTION_ACTIONS,
      completedActions
    },
    actions,
    errorCode,
    completedAt: new Date().toISOString()
  };
}

export function stopTranscriptInteraction(
  canonicalUrl: string,
  actions: TranscriptInteractionActionResult[],
  actionName: TranscriptInteractionAction,
  attempted: boolean,
  outcome: TranscriptInteractionOutcome,
  errorCode: string,
  input: Partial<Pick<
    TranscriptInteractionActionResult,
    'visibleLabels' | 'selectedLabel' | 'postconditionAcknowledged'
  >> = {},
  failed = false
): TranscriptInteractionResult {
  actions.push(transcriptAction(actionName, attempted, outcome, input));
  const start = REQUIRED_TRANSCRIPT_INTERACTION_ACTIONS.indexOf(actionName) + 1;
  for (const remaining of REQUIRED_TRANSCRIPT_INTERACTION_ACTIONS.slice(start)) {
    actions.push(transcriptAction(remaining, false, 'prerequisite_unmet'));
  }
  return transcriptInteractionResult(canonicalUrl, actions, errorCode, failed);
}
