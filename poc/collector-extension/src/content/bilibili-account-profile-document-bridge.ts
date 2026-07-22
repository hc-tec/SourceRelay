import { BILIBILI_ACCOUNT_PROFILE_DOCUMENT_READY_MESSAGE } from '../shared/bilibili-account-profile-document-bridge';

// The document bridge never reads profile values. The background worker later
// requests one fixed and bounded isolated-world DOM projection for this exact
// Chrome document identity.
void chrome.runtime.sendMessage({ type: BILIBILI_ACCOUNT_PROFILE_DOCUMENT_READY_MESSAGE }).catch(() => undefined);
