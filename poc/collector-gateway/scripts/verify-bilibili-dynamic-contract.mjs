import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'collector-bilibili-dynamic-'));
const contractBundle = join(temporaryDirectory, 'bilibili-dynamic-contract.mjs');
const responseBundle = join(temporaryDirectory, 'bilibili-dynamic-response.mjs');
const artifactBundle = join(temporaryDirectory, 'bilibili-dynamic-artifacts.mjs');

try {
  await Promise.all([
    [new URL('../src/bilibili-dynamic-contract.ts', import.meta.url), contractBundle],
    [new URL('../src/bilibili-dynamic-response.ts', import.meta.url), responseBundle],
    [new URL('../src/bilibili-dynamic-artifacts.ts', import.meta.url), artifactBundle]
  ].map(([entry, outfile]) => build({
    entryPoints: [fileURLToPath(entry)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'silent'
  })));
  const contract = await import(pathToFileURL(contractBundle).href);
  const response = await import(pathToFileURL(responseBundle).href);
  const { BilibiliDynamicArtifactStore } = await import(pathToFileURL(artifactBundle).href);

  const accountId = '123456';
  const canonicalProfileUrl = `https://space.bilibili.com/${accountId}`;
  assert.deepEqual(contract.bilibiliDynamicInput({ canonicalProfileUrl, maxPages: 2 }), {
    canonicalProfileUrl,
    maxPages: 2
  });
  assert.equal(contract.bilibiliDynamicUrl(canonicalProfileUrl), `${canonicalProfileUrl}/dynamic`);
  assert.throws(() => contract.bilibiliDynamicInput({
    canonicalProfileUrl,
    maxPages: 2,
    offset: 'must-not-be-accepted'
  }), /bilibili_dynamic_input_invalid/);
  assert.equal(
    contract.safeBilibiliDynamicLink('https://www.bilibili.com/video/BV1qZSLBYEpa/?credential=discard'),
    'https://www.bilibili.com/video/BV1qZSLBYEpa'
  );

  const dynamicIds = [
    '100000000000000001',
    '100000000000000002',
    '100000000000000003',
    '100000000000000004'
  ];
  const author = (publishedVisibleText, timestamp) => ({
    mid: Number(accountId),
    name: '公开作者',
    pub_action: '投稿了动态',
    pub_time: publishedVisibleText,
    pub_ts: timestamp
  });
  const stat = (base) => ({
    comment: { count: base },
    forward: { count: base + 1 },
    like: { count: base + 2 }
  });
  const rawFeed = {
    code: 0,
    data: {
      has_more: true,
      offset: 'next-offset-secret',
      items: [
        {
          id_str: dynamicIds[0],
          type: 'DYNAMIC_TYPE_AV',
          visible: true,
          modules: {
            module_author: author('3天前 · 投稿了视频', 1_753_000_001),
            module_dynamic: {
              desc: { text: '公开视频说明' },
              major: {
                type: 'MAJOR_TYPE_ARCHIVE',
                archive: { bvid: 'BV1qZSLBYEpa', title: '公开视频标题' }
              }
            },
            module_stat: stat(1)
          }
        },
        {
          id_str: dynamicIds[1],
          type: 'DYNAMIC_TYPE_DRAW',
          visible: true,
          basic: { jump_url: `//t.bilibili.com/${dynamicIds[1]}?credential=discard` },
          modules: {
            module_author: author('2天前', 1_753_000_002),
            module_dynamic: {
              major: { type: 'MAJOR_TYPE_OPUS', opus: { summary: { text: '预约图文[捂眼]说明' } } },
              additional: { reserve: { title: '公开视频预约' } }
            },
            module_stat: stat(2)
          }
        },
        {
          id_str: dynamicIds[2],
          type: 'DYNAMIC_TYPE_DRAW',
          visible: false,
          modules: {
            module_author: author('1天前', 1_753_000_003),
            module_dynamic: {
              major: {
                type: 'MAJOR_TYPE_BLOCKED',
                blocked: { message: '充电专属动态', hint_message: '加入后解锁' }
              }
            },
            module_stat: stat(3)
          }
        },
        {
          id_str: dynamicIds[3],
          type: 'DYNAMIC_TYPE_FORWARD',
          visible: true,
          modules: {
            module_author: author('今天', 1_753_000_004),
            module_dynamic: { desc: { text: '转发时写下的公开说明' }, major: null },
            module_stat: stat(4)
          },
          orig: {
            id_str: '100000000000000099',
            type: 'DYNAMIC_TYPE_AV',
            modules: {
              module_author: { mid: 999, name: '原作者' },
              module_dynamic: {
                desc: { text: '原动态说明' },
                major: {
                  type: 'MAJOR_TYPE_ARCHIVE',
                  archive: { bvid: 'BV1xA411c7mD', title: '原视频标题' }
                }
              }
            }
          }
        }
      ]
    }
  };
  const candidate = contract.projectBilibiliDynamicFeedResponse(rawFeed, accountId, 1);
  assert.ok(candidate);
  assert.equal(candidate.items.length, 4);
  assert.equal(candidate.items[0].primaryIdentity.stableId, 'BV1qZSLBYEpa');
  assert.equal(candidate.items[1].primaryIdentity.kind, 'dynamic');
  assert.equal(candidate.items[2].accessState, 'restricted_placeholder');
  assert.equal(candidate.items[3].forwardedSource.primaryIdentity.stableId, 'BV1xA411c7mD');

  const domCards = [
    {
      position: 1,
      outerAuthor: '公开作者',
      publishedVisibleText: '3天前 · 投稿了视频',
      visibleText: '公开作者 3天前 · 投稿了视频 公共视频说明 公开视频标题',
      links: [{
        text: '公开视频标题',
        url: 'https://www.bilibili.com/video/BV1qZSLBYEpa/?tracking=discard'
      }],
      images: [{ alt: '公开封面', url: 'https://i0.hdslb.com/bfs/archive/one.jpg@472w.webp?credential=discard' }],
      kind: 'video', blockedPlaceholder: false, reservation: false, forwarded: false
    },
    {
      position: 2,
      outerAuthor: '公开作者',
      publishedVisibleText: '2天前',
      visibleText: '公开作者 2天前 预约图文​说明 公开视频预约 去观看',
      links: [],
      images: [{ alt: '[捂眼]', url: 'https://i0.hdslb.com/bfs/emote/public.png' }],
      kind: 'opus', blockedPlaceholder: false, reservation: true, forwarded: false
    },
    {
      position: 3,
      outerAuthor: '公开作者',
      publishedVisibleText: '1天前',
      visibleText: '公开作者 1天前 充电专属动态 加入后解锁',
      links: [], images: [],
      kind: 'blocked', blockedPlaceholder: true, reservation: false, forwarded: false
    },
    {
      position: 4,
      outerAuthor: '公开作者',
      publishedVisibleText: '今天',
      visibleText: '公开作者 今天 转发时写下的公开说明 原作者 原动态说明 原视频标题',
      links: [{ text: '原视频标题', url: 'https://www.bilibili.com/video/BV1xA411c7mD/' }],
      images: [],
      kind: 'video', blockedPlaceholder: false, reservation: false, forwarded: true
    }
  ];
  const bounded = {
    value: rawFeed,
    status: 200,
    bodyBytes: 2_048,
    bodySha256: 'a'.repeat(64),
    queryKeyNames: ['features', 'host_mid', 'offset', 'w_rid', 'wts'],
    schemaPaths: [
      { path: '$', type: 'object' },
      { path: '$.data.items', type: 'array', arrayLength: 4 }
    ],
    sensitiveFieldPathsOmitted: 0
  };
  const projected = response.projectBilibiliDynamicPageWithDom(
    bounded,
    accountId,
    1,
    [],
    {
      stableAccountId: accountId,
      visibleFilterLabels: ['全部', '视频'],
      activeFilterLabel: '全部',
      cards: domCards,
      risk: { verificationRequired: false, rateLimited: false, sourceUnavailable: false }
    },
    '2026-07-20T02:00:00.000Z'
  );
  assert.ok(projected);
  assert.equal(projected.projection.domCrossCheck.exactCumulativeCardCount, true);
  assert.equal(projected.projection.domCrossCheck.cardEvidenceMatches, 4);
  assert.equal(projected.projection.domCrossCheck.authorMatches, 4);
  assert.equal(projected.projection.domCrossCheck.accessStateMatches, 4);
  assert.equal(projected.projection.domCrossCheck.forwardedStateMatches, 4);
  assert.equal(response.bilibiliDynamicCardTextEvidenceMatches(
    '互动抽奖​六一快乐',
    ['互动抽奖六一快乐'],
    []
  ), true);
  assert.equal('nextOffset' in projected.projection, false);
  assert.equal(projected.projection.items[0].card.mediaRefs[0].url,
    'https://i0.hdslb.com/bfs/archive/one.jpg');
  assert.equal(projected.projection.items[0].card.links[0].url,
    'https://www.bilibili.com/video/BV1qZSLBYEpa');

  const run = {
    schemaVersion: 1,
    runId: '11111111-1111-4111-8111-111111111111',
    collectorVersion: '0.4.24',
    platform: 'bilibili',
    accountCategory: 'user_managed',
    pageRole: 'dynamic_inventory',
    targetUrlDigest: 'b'.repeat(64),
    strategyCandidate: {
      strategyId: 'bilibili.dynamic.account-feed.response-dom.v1',
      version: '1.0.0',
      admissionEligible: false
    },
    state: 'partial',
    errorCode: null,
    startedAt: '2026-07-20T02:00:00.000Z',
    completedAt: '2026-07-20T02:00:01.000Z',
    stableAccountId: accountId,
    failedResponseEvidence: null,
    pages: [projected.projection],
    actions: [{
      actionId: 'open_dynamic_inventory',
      intent: 'Open the canonical account dynamic feed in the public all-items filter.',
      expectedPageNumber: 1,
      attempted: true,
      attemptCount: 1,
      outcome: 'completed',
      errorCode: null
    }],
    coverage: {
      plannedMaximumPages: 1,
      capturedPages: 1,
      capturedItems: 4,
      uniqueItems: 4,
      duplicateItems: 0,
      forwardedItems: 1,
      restrictedPlaceholderItems: 1,
      dynamicTypes: [
        { type: 'DYNAMIC_TYPE_AV', count: 1 },
        { type: 'DYNAMIC_TYPE_DRAW', count: 2 },
        { type: 'DYNAMIC_TYPE_FORWARD', count: 1 }
      ],
      majorTypes: [
        { type: 'MAJOR_TYPE_ARCHIVE', count: 1 },
        { type: 'MAJOR_TYPE_BLOCKED', count: 1 },
        { type: 'MAJOR_TYPE_OPUS', count: 1 },
        { type: 'none', count: 1 }
      ],
      domCardKinds: [
        { kind: 'blocked', count: 1 },
        { kind: 'opus', count: 1 },
        { kind: 'video', count: 2 }
      ],
      completeWithinAccountFeed: false,
      terminalReason: 'budget_exhausted'
    },
    safeguards: {
      environment: 'local_user_controlled_collection_profile',
      browser: 'visible_playwright_chromium',
      acquisition: 'trusted_navigation_and_scroll_plus_dom_response_projection',
      requestHeaders: 'not_read', requestBody: 'not_read', cookiesAndTokens: 'not_read',
      networkQueryAndFragmentValues: 'discarded', cursorValue: 'used_in_memory_not_persisted',
      responseProjection: 'public_dynamic_identity_author_text_relation_and_metrics_allowlist',
      cardProjection: 'bounded_visible_text_links_and_public_media',
      restrictedContent: 'public_visible_placeholders_only_no_unlock_attempts',
      discussion: 'excluded_separate_capability', unknownResponseValues: 'not_persisted',
      semanticActionDelivery: 'at_most_once', runDeadlineMs: 60_000,
      targetTabSelection: 'created_new_managed_tab', targetPage: 'retained_after_run',
      admissionEligible: false
    }
  };
  const stateDirectory = join(temporaryDirectory, 'state');
  const store = await BilibiliDynamicArtifactStore.create(stateDirectory);
  const summary = await store.record(run);
  assert.equal((await store.record(run)).artifactId, summary.artifactId);
  const artifact = await store.get(summary.artifactId);
  assert.equal(artifact.pages[0].items.length, 4);
  assert.equal(artifact.pages[0].items[2].accessState, 'restricted_placeholder');
  assert.equal(artifact.failedResponseEvidence, null);
  const recovered = await BilibiliDynamicArtifactStore.create(stateDirectory);
  assert.equal((await recovered.get(summary.artifactId)).summary.manifestSha256, summary.manifestSha256);

  const artifactDirectory = join(stateDirectory, 'bilibili-dynamic', summary.artifactId);
  assert.deepEqual((await readdir(artifactDirectory)).sort(), ['manifest.json', 'page-001.json']);
  const persisted = (await Promise.all((await readdir(artifactDirectory)).map((name) =>
    readFile(join(artifactDirectory, name), 'utf8')
  ))).join('\n');
  for (const forbidden of [
    'profileId', 'browserProfileId', 'Cookie', 'Authorization', 'credential=discard',
    'next-offset-secret', 'offset=next-offset-secret', 'w_rid=', 'tracking=discard'
  ]) assert.equal(persisted.includes(forbidden), false, `forbidden persisted value: ${forbidden}`);

  console.log(JSON.stringify({
    ok: true,
    gate: 'bilibili-dynamic-pure-contract-and-artifact',
    platformRequests: 0,
    responseStableDynamicIdsAndForwardSourceProjected: true,
    domCardsCrossCheckedInResponseOrder: true,
    restrictedPlaceholdersPreservedWithoutUnlocking: true,
    cursorAndQueryValuesOmitted: true,
    manifestAndPageDigestsVerified: true,
    restartReloadVerified: true
  }, null, 2));
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
