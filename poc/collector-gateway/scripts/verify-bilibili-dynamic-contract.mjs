import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'collector-bilibili-dynamic-'));
const contractBundle = join(temporaryDirectory, 'bilibili-dynamic-contract.mjs');
const responseBundle = join(temporaryDirectory, 'bilibili-dynamic-response.mjs');
const crossCheckBundle = join(temporaryDirectory, 'bilibili-dynamic-cross-check.mjs');
const reservationDiagnosticBundle = join(temporaryDirectory, 'bilibili-dynamic-reservation-opus-diagnostic.mjs');
const artifactBundle = join(temporaryDirectory, 'bilibili-dynamic-artifacts.mjs');

try {
  await Promise.all([
    [new URL('../src/bilibili-dynamic-contract.ts', import.meta.url), contractBundle],
    [new URL('../src/bilibili-dynamic-response.ts', import.meta.url), responseBundle],
    [new URL('../src/bilibili-dynamic-cross-check.ts', import.meta.url), crossCheckBundle],
    [new URL('../src/bilibili-dynamic-reservation-opus-diagnostic.ts', import.meta.url), reservationDiagnosticBundle],
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
  const crossCheck = await import(pathToFileURL(crossCheckBundle).href);
  const reservationDiagnostic = await import(pathToFileURL(reservationDiagnosticBundle).href);
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
  assert.equal(candidate.items[1].reservationTitle, '公开视频预约');
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
  const successfulCrossCheckDiagnostic = crossCheck.bilibiliDynamicCrossCheckDiagnostic(projected.projection);
  assert.deepEqual(successfulCrossCheckDiagnostic.failedChecks, []);
  assert.equal(successfulCrossCheckDiagnostic.cards.length, 4);
  assert.equal(successfulCrossCheckDiagnostic.cards.every((card) => card.checks.cardEvidenceMatch), true);
  assert.equal(response.bilibiliDynamicCardTextEvidenceMatches(
    '互动抽奖​六一快乐',
    ['互动抽奖六一快乐'],
    []
  ), true);
  const reservationOnlyCard = {
    ...projected.projection.items[1],
    card: {
      ...projected.projection.items[1].card,
      visibleText: '公开作者 2天前 公开视频预约 去观看'
    }
  };
  assert.equal(response.bilibiliDynamicCardEvidenceCheck(reservationOnlyCard).textMatch, true);
  assert.equal(response.bilibiliDynamicCardEvidenceCheck({
    ...reservationOnlyCard,
    card: { ...reservationOnlyCard.card, reservation: false }
  }).textMatch, false);
  assert.equal('nextOffset' in projected.projection, false);
  assert.equal(projected.projection.items[0].card.mediaRefs[0].url,
    'https://i0.hdslb.com/bfs/archive/one.jpg');
  assert.equal(projected.projection.items[0].card.links[0].url,
    'https://www.bilibili.com/video/BV1qZSLBYEpa');

  const reservationOpusFieldDiagnostic = reservationDiagnostic.bilibiliDynamicReservationOpusFieldDiagnostic({
    responseValue: rawFeed,
    expectedAccountId: accountId,
    dom: {
      stableAccountId: accountId,
      visibleFilterLabels: ['全部', '视频'],
      activeFilterLabel: '全部',
      cards: domCards,
      risk: { verificationRequired: false, rateLimited: false, sourceUnavailable: false }
    }
  });
  assert.equal(reservationOpusFieldDiagnostic?.cards.length, 1);
  assert.equal(reservationOpusFieldDiagnostic?.cards[0]?.positionOnPage, 2);
  assert.deepEqual(reservationOpusFieldDiagnostic?.cards[0]?.matchingFieldPaths, [
    'modules.module_dynamic.major.opus.summary.text',
    'modules.module_dynamic.additional.reserve.title'
  ]);
  assert.equal(JSON.stringify(reservationOpusFieldDiagnostic).includes('预约图文'), false);

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
    crossCheckDiagnostic: null,
    reservationOpusFieldDiagnostic,
    visualEvidence: null,
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
      acquisition: 'trusted_navigation_plus_dom_response_projection',
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
  assert.equal(artifact.crossCheckDiagnostic, null);
  assert.deepEqual(artifact.reservationOpusFieldDiagnostic, reservationOpusFieldDiagnostic);
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

  const mismatchedItemIndex = successfulCrossCheckDiagnostic.cards.findIndex((card) =>
    card.responseAccessState === 'public' &&
    card.responseForwardedState === 'not_forward' &&
    !card.checks.primaryIdentityCrossCheckable
  );
  assert.notEqual(mismatchedItemIndex, -1);
  const mismatchedItems = projected.projection.items.map((item, index) => index === mismatchedItemIndex
    ? { ...item, card: { ...item.card, visibleText: '无匹配文本', links: [], mediaRefs: [] } }
    : item);
  const mismatchedProjection = {
    ...projected.projection,
    items: mismatchedItems,
    domCrossCheck: {
      ...projected.projection.domCrossCheck,
      cardEvidenceMatches: projected.projection.items.length - 1,
      textMatches: projected.projection.items.length - 1
    }
  };
  const crossCheckDiagnostic = crossCheck.bilibiliDynamicCrossCheckDiagnostic(mismatchedProjection);
  assert.deepEqual(crossCheckDiagnostic.failedChecks, ['card_evidence_mismatch']);
  const mismatchedCard = crossCheckDiagnostic.cards.find((card) => card.positionOnPage === mismatchedItemIndex + 1);
  assert.equal(mismatchedCard?.checks.primaryIdentityCrossCheckable, false);
  assert.equal(mismatchedCard?.checks.textMatch, false);
  assert.equal(mismatchedCard?.checks.cardEvidenceMatch, false);
  assert.equal(mismatchedCard?.checks.authorMatch, true);
  const failedRun = {
    ...run,
    runId: '22222222-2222-4222-8222-222222222222',
    state: 'failed',
    errorCode: 'dynamic_dom_response_cross_check_failed',
    failedResponseEvidence: {
      pathname: '/x/polymer/web-dynamic/v1/feed/space',
      pageNumber: 1,
      responseStatus: 200,
      responseBodyBytes: 2_048,
      responseBodySha256: 'a'.repeat(64),
      queryKeyNames: ['host_mid'],
      schemaPaths: [{ path: '$', type: 'object' }],
      sensitiveFieldPathsOmitted: 0
    },
    crossCheckDiagnostic,
    pages: [],
    coverage: {
      ...run.coverage,
      capturedPages: 0,
      capturedItems: 0,
      uniqueItems: 0,
      forwardedItems: 0,
      restrictedPlaceholderItems: 0,
      dynamicTypes: [],
      majorTypes: [],
      domCardKinds: [],
      terminalReason: 'dom_response_mismatch'
    }
  };
  const failedSummary = await store.record(failedRun);
  const failedArtifact = await store.get(failedSummary.artifactId);
  assert.deepEqual(failedArtifact.crossCheckDiagnostic, crossCheckDiagnostic);
  assert.deepEqual(failedArtifact.manifest.crossCheckDiagnostic?.failedChecks, ['card_evidence_mismatch']);
  assert.equal(failedArtifact.crossCheckDiagnostic?.cards.length, 4);
  assert.equal(failedArtifact.crossCheckDiagnostic?.cards[mismatchedItemIndex]?.checks.textMatch, false);
  assert.deepEqual(failedArtifact.reservationOpusFieldDiagnostic, reservationOpusFieldDiagnostic);
  assert.equal(failedArtifact.pages.length, 0);
  const failedArtifactDirectory = join(stateDirectory, 'bilibili-dynamic', failedSummary.artifactId);
  const failedPersisted = (await Promise.all((await readdir(failedArtifactDirectory)).map((name) =>
    readFile(join(failedArtifactDirectory, name), 'utf8')
  ))).join('\n');
  assert.equal(failedPersisted.includes('公开视频说明'), false);
  assert.equal(failedPersisted.includes('预约图文'), false);
  assert.equal(failedPersisted.includes('stableDynamicId'), false);
  assert.equal(failedPersisted.includes('canonicalUrl'), false);
  assert.equal(failedPersisted.includes('预约图文'), false);
  assert.equal(failedPersisted.includes(dynamicIds[0]), false);

  console.log(JSON.stringify({
    ok: true,
    gate: 'bilibili-dynamic-pure-contract-and-artifact',
    platformRequests: 0,
    responseStableDynamicIdsAndForwardSourceProjected: true,
    domCardsCrossCheckedInResponseOrder: true,
    restrictedPlaceholdersPreservedWithoutUnlocking: true,
    reservationOpusFieldPathsDiagnosedWithoutPersistingValues: true,
    cursorAndQueryValuesOmitted: true,
    manifestAndPageDigestsVerified: true,
    restartReloadVerified: true
  }, null, 2));
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
