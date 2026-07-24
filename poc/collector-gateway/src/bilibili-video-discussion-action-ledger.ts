import type {
  BilibiliVideoDiscussionInteractionAction
} from '@intelligence/collector-contracts';
import type { BilibiliVideoDiscussionAction } from './bilibili-video-discussion-contract';

function navigationAction(runId: string): BilibiliVideoDiscussionAction {
  return {
    actionId: `navigate_video_discussion_${runId.replace(/-/g, '_')}`,
    kind: 'navigation',
    attempted: false,
    attemptCount: 0,
    outcome: 'prerequisite_unmet',
    errorCode: null
  };
}

function scrollAction(runId: string, ordinal = 1): BilibiliVideoDiscussionAction {
  return {
    actionId: `scroll_video_discussion_${runId.replace(/-/g, '_')}${ordinal === 1 ? '' : `_${ordinal}`}`,
    kind: 'scroll',
    attempted: false,
    attemptCount: 0,
    outcome: 'prerequisite_unmet',
    errorCode: null
  };
}

function interactionAction(
  runId: string,
  action: BilibiliVideoDiscussionInteractionAction
): BilibiliVideoDiscussionAction {
  return {
    actionId: `${action}_${runId.replace(/-/g, '_')}`,
    kind: action,
    attempted: false,
    attemptCount: 0,
    outcome: 'prerequisite_unmet',
    errorCode: null
  };
}

export interface BilibiliVideoDiscussionActionLedger {
  readonly navigation: BilibiliVideoDiscussionAction;
  readonly firstScroll: BilibiliVideoDiscussionAction;
  readonly requestedInteractionActions: readonly BilibiliVideoDiscussionAction[];
  readonly actions: BilibiliVideoDiscussionAction[];
  appendScroll(action: BilibiliVideoDiscussionAction): void;
  appendRequestedInteractions(): void;
}

/**
 * Keeps the persisted action sequence aligned with the browser's execution
 * phases. Dynamic scrolls are appended while the scroll phase runs; requested
 * interactions are appended exactly once after that phase. This prevents a
 * planned click from appearing before a later scroll in the run artifact.
 */
export function createBilibiliVideoDiscussionActionLedger(
  runId: string,
  requestedActions: readonly BilibiliVideoDiscussionInteractionAction[]
): BilibiliVideoDiscussionActionLedger {
  const navigation = navigationAction(runId);
  const firstScroll = scrollAction(runId, 1);
  const requestedInteractionActions = requestedActions.map((action) => interactionAction(runId, action));
  const actions: BilibiliVideoDiscussionAction[] = [navigation, firstScroll];
  let interactionsAppended = false;

  return {
    navigation,
    firstScroll,
    requestedInteractionActions,
    actions,
    appendScroll(action): void {
      if (interactionsAppended) throw new Error('bilibili_video_discussion_action_phase_closed');
      actions.push(action);
    },
    appendRequestedInteractions(): void {
      if (interactionsAppended) return;
      actions.push(...requestedInteractionActions);
      interactionsAppended = true;
    }
  };
}

export function createBilibiliVideoDiscussionScrollAction(
  runId: string,
  ordinal: number
): BilibiliVideoDiscussionAction {
  return scrollAction(runId, ordinal);
}
