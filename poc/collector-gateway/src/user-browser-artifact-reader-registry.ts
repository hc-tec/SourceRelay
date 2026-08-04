import type { BilibiliAccountProfileArtifactStore } from './bilibili-account-profile-artifacts';
import type { BilibiliAccountVideoInventoryArtifactStore } from './bilibili-account-video-inventory-artifacts';
import type { BilibiliNativeSearchArtifactStore } from './bilibili-native-search-artifacts';
import type { BilibiliVideoDetailArtifactStore } from './bilibili-video-detail-artifacts';
import type { ExtensionWorkNativeSearchBatchArtifactStore } from './extension-work-native-search-batch-artifacts';
import {
  type PassiveDirectCapability,
  ExtensionWorkPassiveArtifactStore
} from './extension-work-passive-artifacts';
import type { XiaohongshuAccountPublicNotesArtifactStore } from './xiaohongshu-account-public-notes-artifacts';
import type { XiaohongshuNotePublicCommentsArtifactStore } from './xiaohongshu-note-public-comments-artifacts';
import type { XiaohongshuNotePublicDetailArtifactStore } from './xiaohongshu-note-public-detail-artifacts';
import type { XiaohongshuPublicNotesArtifactStore } from './xiaohongshu-public-notes-artifacts';
import type { XiaohongshuReplyArtifactStore } from './xiaohongshu-note-public-comment-replies-artifacts';
import type { UserBrowserCollectorServiceRequest } from './user-browser-collector-service-contract';
import type { ZhihuOfficialArtifactStore } from './zhihu-official-artifacts';

export type UserBrowserArtifactCapability = UserBrowserCollectorServiceRequest['capability'];

export interface UserBrowserArtifactReaderContext {
  videoDetailArtifacts: BilibiliVideoDetailArtifactStore;
  nativeSearchArtifacts: BilibiliNativeSearchArtifactStore;
  nativeSearchBatchDirectArtifacts: ExtensionWorkNativeSearchBatchArtifactStore;
  accountProfileArtifacts: BilibiliAccountProfileArtifactStore;
  accountVideoInventoryArtifacts: BilibiliAccountVideoInventoryArtifactStore;
  passiveDirectArtifacts: ExtensionWorkPassiveArtifactStore;
  xiaohongshuPublicNotesArtifacts: XiaohongshuPublicNotesArtifactStore;
  xiaohongshuAccountPublicNotesArtifacts: XiaohongshuAccountPublicNotesArtifactStore;
  xiaohongshuNotePublicDetailArtifacts: XiaohongshuNotePublicDetailArtifactStore;
  xiaohongshuNotePublicCommentsArtifacts: XiaohongshuNotePublicCommentsArtifactStore;
  xiaohongshuReplyArtifacts: XiaohongshuReplyArtifactStore;
  zhihuOfficialArtifacts: ZhihuOfficialArtifactStore;
}

type ArtifactView = unknown;
export interface FoundUserBrowserArtifact {
  capability: UserBrowserArtifactCapability;
  artifactId: string;
  view: Exclude<ArtifactView, null | undefined>;
}
type ArtifactReader = (
  context: UserBrowserArtifactReaderContext,
  artifactId: string
) => Promise<ArtifactView>;

const ARTIFACT_READERS: Readonly<Record<UserBrowserArtifactCapability, ArtifactReader>> = {
  'bilibili.video_detail': (context, artifactId) => context.videoDetailArtifacts.get(artifactId),
  'bilibili.native_search': (context, artifactId) => context.nativeSearchArtifacts.get(artifactId),
  'bilibili.native_search_batch': (context, artifactId) => context.nativeSearchBatchDirectArtifacts.get(artifactId),
  'bilibili.account_profile': (context, artifactId) => context.accountProfileArtifacts.get(artifactId),
  'bilibili.account_inventory': (context, artifactId) => context.accountVideoInventoryArtifacts.get(artifactId),
  'bilibili.dynamic': (context, artifactId) => context.passiveDirectArtifacts.get('bilibili.dynamic', artifactId),
  'bilibili.discussion': (context, artifactId) => context.passiveDirectArtifacts.get('bilibili.discussion', artifactId),
  'bilibili.danmaku': (context, artifactId) => context.passiveDirectArtifacts.get('bilibili.danmaku', artifactId),
  'bilibili.collection_series.overview': (context, artifactId) => context.passiveDirectArtifacts.get('bilibili.collection_series.overview', artifactId),
  'bilibili.collection_series.detail': (context, artifactId) => context.passiveDirectArtifacts.get('bilibili.collection_series.detail', artifactId),
  'xiaohongshu.search.public_notes.v1': (context, artifactId) => context.xiaohongshuPublicNotesArtifacts.get(artifactId),
  'xiaohongshu.account.public_notes.v1': (context, artifactId) => context.xiaohongshuAccountPublicNotesArtifacts.get(artifactId),
  'xiaohongshu.note.public_detail.v1': (context, artifactId) => context.xiaohongshuNotePublicDetailArtifacts.get(artifactId),
  'xiaohongshu.note.public_comments.v1': (context, artifactId) => context.xiaohongshuNotePublicCommentsArtifacts.get(artifactId),
  'xiaohongshu.note.public_comment_replies.v1': (context, artifactId) => context.xiaohongshuReplyArtifacts.get(artifactId),
  'zhihu.search.public_content.v1': (context, artifactId) =>
    readZhihuOfficialArtifact(context, 'zhihu.search.public_content.v1', artifactId),
  'zhihu.hot_list.public_content.v1': (context, artifactId) =>
    readZhihuOfficialArtifact(context, 'zhihu.hot_list.public_content.v1', artifactId),
  'web.search.global.zhihu_provider.v1': (context, artifactId) =>
    readZhihuOfficialArtifact(context, 'web.search.global.zhihu_provider.v1', artifactId)
};

export function listUserBrowserArtifactCapabilities(): UserBrowserArtifactCapability[] {
  return Object.keys(ARTIFACT_READERS) as UserBrowserArtifactCapability[];
}

export function isUserBrowserArtifactCapability(
  value: string
): value is UserBrowserArtifactCapability {
  return Object.prototype.hasOwnProperty.call(ARTIFACT_READERS, value);
}

export async function readUserBrowserArtifact(
  context: UserBrowserArtifactReaderContext,
  capability: UserBrowserArtifactCapability,
  artifactId: string
): Promise<ArtifactView> {
  const reader = ARTIFACT_READERS[capability];
  return await reader(context, artifactId);
}

/** Resolve one globally random Artifact ID without exposing a filesystem path. */
export async function findUserBrowserArtifact(
  context: UserBrowserArtifactReaderContext,
  artifactId: string
): Promise<FoundUserBrowserArtifact | null> {
  let found: FoundUserBrowserArtifact | null = null;
  for (const capability of listUserBrowserArtifactCapabilities()) {
    const view = await ARTIFACT_READERS[capability](context, artifactId);
    if (view === null || view === undefined) continue;
    if (found) throw new Error('collector_service_artifact_identity_collision');
    found = { capability, artifactId, view };
  }
  return found;
}

async function readZhihuOfficialArtifact(
  context: UserBrowserArtifactReaderContext,
  capability: Extract<UserBrowserArtifactCapability, `zhihu.${string}` | `web.${string}`>,
  artifactId: string
): Promise<ArtifactView> {
  const artifact = await context.zhihuOfficialArtifacts.get(artifactId);
  return artifact?.capability === capability ? artifact : null;
}

export type { PassiveDirectCapability };
