import { setTimeout as delay } from 'node:timers/promises';
import type { BrowserContext } from 'playwright';
import { canonicalBilibiliVideoUrl } from '../../collector-extension/src/shared/bilibili-video-url';
import type {
  TranscriptInteractionAction,
  TranscriptInteractionActionResult,
  TranscriptInteractionResult
} from '../../collector-extension/src/shared/protocol';
import {
  captionOptionLabel,
  captionOptionSelected,
  transcriptPageFailure,
  visibleSubtitlePanel,
  waitForBilibiliTranscriptPage,
  waitForCaptionMenu,
  waitForVisible
} from './bilibili-transcript-page';
import {
  stopTranscriptInteraction,
  transcriptAction,
  transcriptInteractionResult
} from './transcript-interaction-result';

const TARGET_PAGE_WAIT_MS = 15_000;
const PLAYER_WAIT_MS = 10_000;
const CONTROL_REVEAL_WAIT_MS = 2_500;
const MENU_WAIT_MS = 2_500;
const ACTION_TAIL_MS = 3_000;

export async function executeBilibiliTranscriptInteraction(input: {
  context: BrowserContext;
  canonicalUrl: string;
  beforeAction: (actionId: TranscriptInteractionAction) => Promise<void>;
}): Promise<TranscriptInteractionResult> {
  const canonicalUrl = canonicalBilibiliVideoUrl(input.canonicalUrl);
  if (!canonicalUrl) throw new Error('transcript_validation_url_invalid');
  const actions: TranscriptInteractionActionResult[] = [];
  const page = await waitForBilibiliTranscriptPage(input.context, canonicalUrl, TARGET_PAGE_WAIT_MS);
  if (!page) {
    return stopTranscriptInteraction(
      canonicalUrl,
      actions,
      'reveal_player_controls',
      false,
      'page_unavailable',
      'transcript_validation_target_page_not_found',
      {},
      true
    );
  }
  await page.bringToFront().catch(() => undefined);

  let failure = await transcriptPageFailure(page, canonicalUrl);
  if (failure) {
    return stopTranscriptInteraction(
      canonicalUrl, actions, 'reveal_player_controls', false, failure.outcome,
      failure.errorCode, {}, true
    );
  }

  const videoArea = page.locator('.bpx-player-video-area,video').first();
  const control = page.locator('.bpx-player-ctrl-subtitle[aria-label="字幕"],.bpx-player-ctrl-subtitle').first();
  let controlVisible = await control.isVisible().catch(() => false);
  if (controlVisible) {
    actions.push(transcriptAction('reveal_player_controls', false, 'completed', {
      visibleLabels: ['字幕'],
      postconditionAcknowledged: true
    }));
  } else {
    if (!await waitForVisible(videoArea, PLAYER_WAIT_MS)) {
      return stopTranscriptInteraction(
        canonicalUrl, actions, 'reveal_player_controls', false, 'control_missing',
        'transcript_validation_video_area_missing'
      );
    }
    const videoAreaBox = await videoArea.boundingBox();
    if (!videoAreaBox) {
      return stopTranscriptInteraction(
        canonicalUrl, actions, 'reveal_player_controls', false, 'control_missing',
        'transcript_validation_video_area_bounds_missing'
      );
    }
    try {
      await input.beforeAction('reveal_player_controls');
    } catch {
      return stopTranscriptInteraction(
        canonicalUrl, actions, 'reveal_player_controls', false, 'prerequisite_unmet',
        'transcript_validation_action_ledger_failed', {}, true
      );
    }
    try {
      await page.mouse.move(
        videoAreaBox.x + videoAreaBox.width * 0.62,
        videoAreaBox.y + Math.max(1, videoAreaBox.height - 20),
        { steps: 8 }
      );
    } catch {
      return stopTranscriptInteraction(
        canonicalUrl, actions, 'reveal_player_controls', true, 'postcondition_unmet',
        'transcript_validation_control_reveal_input_failed', {}, true
      );
    }
    controlVisible = await waitForVisible(control, CONTROL_REVEAL_WAIT_MS);
    failure = await transcriptPageFailure(page, canonicalUrl);
    if (failure) {
      return stopTranscriptInteraction(
        canonicalUrl, actions, 'reveal_player_controls', true, failure.outcome,
        failure.errorCode, {}, true
      );
    }
    if (!controlVisible) {
      return stopTranscriptInteraction(
        canonicalUrl, actions, 'reveal_player_controls', true, 'postcondition_unmet',
        'transcript_validation_control_reveal_postcondition_unmet'
      );
    }
    actions.push(transcriptAction('reveal_player_controls', true, 'completed', {
      visibleLabels: ['字幕'],
      postconditionAcknowledged: true
    }));
  }

  failure = await transcriptPageFailure(page, canonicalUrl);
  if (failure) {
    return stopTranscriptInteraction(
      canonicalUrl, actions, 'open_caption_menu', false, failure.outcome,
      failure.errorCode, {}, true
    );
  }
  const controlBox = await control.boundingBox();
  if (!controlBox) {
    return stopTranscriptInteraction(
      canonicalUrl, actions, 'open_caption_menu', false, 'control_missing',
      'transcript_validation_caption_control_missing'
    );
  }
  try {
    await input.beforeAction('open_caption_menu');
  } catch {
    return stopTranscriptInteraction(
      canonicalUrl, actions, 'open_caption_menu', false, 'prerequisite_unmet',
      'transcript_validation_action_ledger_failed', {}, true
    );
  }
  try {
    await page.mouse.move(
      controlBox.x + controlBox.width / 2,
      controlBox.y + controlBox.height / 2,
      { steps: 8 }
    );
  } catch {
    return stopTranscriptInteraction(
      canonicalUrl, actions, 'open_caption_menu', true, 'postcondition_unmet',
      'transcript_validation_caption_hover_input_failed', {}, true
    );
  }
  const menu = await waitForCaptionMenu(page, MENU_WAIT_MS);
  failure = await transcriptPageFailure(page, canonicalUrl);
  if (failure) {
    return stopTranscriptInteraction(
      canonicalUrl, actions, 'open_caption_menu', true, failure.outcome,
      failure.errorCode, { visibleLabels: menu.labels }, true
    );
  }
  if (!menu.ready) {
    return stopTranscriptInteraction(
      canonicalUrl, actions, 'open_caption_menu', true, 'postcondition_unmet',
      'transcript_validation_caption_menu_postcondition_unmet',
      { visibleLabels: menu.labels, postconditionAcknowledged: false }
    );
  }
  actions.push(transcriptAction('open_caption_menu', true, 'completed', {
    visibleLabels: menu.labels,
    postconditionAcknowledged: true
  }));

  failure = await transcriptPageFailure(page, canonicalUrl);
  if (failure) {
    return stopTranscriptInteraction(
      canonicalUrl, actions, 'select_caption_language', false, failure.outcome,
      failure.errorCode, { visibleLabels: menu.labels }, true
    );
  }
  const option = page.locator('.bpx-player-ctrl-subtitle-language-item[data-lan="ai-zh"]').first();
  if (!await option.isVisible().catch(() => false)) {
    return stopTranscriptInteraction(
      canonicalUrl, actions, 'select_caption_language', false, 'option_unavailable',
      'transcript_validation_chinese_caption_unavailable',
      { visibleLabels: menu.labels }
    );
  }
  const selectedLabel = captionOptionLabel(await option.innerText().catch(() => ''));
  if (!selectedLabel) {
    return stopTranscriptInteraction(
      canonicalUrl, actions, 'select_caption_language', false, 'option_unavailable',
      'transcript_validation_chinese_caption_label_invalid',
      { visibleLabels: menu.labels }
    );
  }
  if (await captionOptionSelected(option) || await visibleSubtitlePanel(page)) {
    actions.push(transcriptAction('select_caption_language', false, 'completed', {
      visibleLabels: [selectedLabel],
      selectedLabel,
      postconditionAcknowledged: true
    }));
    return transcriptInteractionResult(canonicalUrl, actions, null);
  }
  const optionBox = await option.boundingBox();
  if (!optionBox) {
    return stopTranscriptInteraction(
      canonicalUrl, actions, 'select_caption_language', false, 'option_unavailable',
      'transcript_validation_chinese_caption_bounds_missing',
      { visibleLabels: menu.labels, selectedLabel }
    );
  }
  try {
    await input.beforeAction('select_caption_language');
  } catch {
    return stopTranscriptInteraction(
      canonicalUrl, actions, 'select_caption_language', false, 'prerequisite_unmet',
      'transcript_validation_action_ledger_failed',
      { visibleLabels: menu.labels, selectedLabel },
      true
    );
  }
  try {
    await page.mouse.click(
      optionBox.x + optionBox.width / 2,
      optionBox.y + optionBox.height / 2,
      { button: 'left', clickCount: 1, delay: 80 }
    );
  } catch {
    return stopTranscriptInteraction(
      canonicalUrl, actions, 'select_caption_language', true, 'postcondition_unmet',
      'transcript_validation_chinese_caption_click_failed',
      { visibleLabels: menu.labels, selectedLabel },
      true
    );
  }
  await delay(ACTION_TAIL_MS);
  failure = await transcriptPageFailure(page, canonicalUrl);
  if (failure) {
    return stopTranscriptInteraction(
      canonicalUrl, actions, 'select_caption_language', true, failure.outcome,
      failure.errorCode, { visibleLabels: menu.labels, selectedLabel }, true
    );
  }
  const acknowledged = await captionOptionSelected(option) || await visibleSubtitlePanel(page);
  actions.push(transcriptAction(
    'select_caption_language',
    true,
    acknowledged ? 'completed' : 'postcondition_unmet',
    {
      visibleLabels: [selectedLabel],
      selectedLabel,
      postconditionAcknowledged: acknowledged
    }
  ));
  return transcriptInteractionResult(
    canonicalUrl,
    actions,
    acknowledged ? null : 'transcript_validation_chinese_caption_postcondition_unmet'
  );
}
