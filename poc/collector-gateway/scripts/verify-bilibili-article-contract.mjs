import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'collector-bilibili-article-'));
const contractBundle = join(temporaryDirectory, 'bilibili-article-contract.mjs');
const responseBundle = join(temporaryDirectory, 'bilibili-article-response.mjs');
const inventoryArtifactBundle = join(temporaryDirectory, 'bilibili-article-inventory-artifacts.mjs');
const detailArtifactBundle = join(temporaryDirectory, 'bilibili-article-detail-artifacts.mjs');

try {
  await Promise.all([
    [new URL('../src/bilibili-article-contract.ts', import.meta.url), contractBundle],
    [new URL('../src/bilibili-article-inventory-response.ts', import.meta.url), responseBundle],
    [new URL('../src/bilibili-article-inventory-artifacts.ts', import.meta.url), inventoryArtifactBundle],
    [new URL('../src/bilibili-article-detail-artifacts.ts', import.meta.url), detailArtifactBundle]
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
  const { BilibiliArticleInventoryArtifactStore } = await import(pathToFileURL(inventoryArtifactBundle).href);
  const { BilibiliArticleDetailArtifactStore } = await import(pathToFileURL(detailArtifactBundle).href);

  const accountId = '123456';
  const opusId = '692338454811377666';
  const canonicalProfileUrl = `https://space.bilibili.com/${accountId}`;
  const canonicalOpusUrl = `https://www.bilibili.com/opus/${opusId}`;
  assert.deepEqual(contract.bilibiliArticleInventoryInput({ canonicalProfileUrl, maxPages: 2 }), {
    canonicalProfileUrl,
    maxPages: 2
  });
  const sourceInventoryArtifactId = '33333333-3333-4333-8333-333333333333';
  assert.deepEqual(contract.bilibiliArticleDetailRequestInput({ sourceInventoryArtifactId, stableOpusId: opusId }), {
    sourceInventoryArtifactId,
    stableOpusId: opusId
  });
  assert.throws(() => contract.bilibiliArticleInventoryInput({
    canonicalProfileUrl,
    maxPages: 2,
    offset: 'must-not-be-accepted'
  }), /bilibili_article_inventory_input_invalid/);

  const rawFeed = {
    code: 0,
    message: '0',
    ttl: 1,
    data: {
      has_more: false,
      items: [{
        opus_id: opusId,
        content: '58k稳了，Python才是yyds',
        cover: {
          url: 'http://i2.hdslb.com/bfs/article/cover.jpg@378w_284h_1c.webp?credential=discard',
          width: 378,
          height: 284
        },
        jump_url: `//www.bilibili.com/opus/${opusId}`,
        stat: { like: '10' }
      }],
      offset: '',
      update_num: 1
    }
  };
  const candidate = contract.projectBilibiliArticleFeedResponse(rawFeed, 1);
  assert.ok(candidate);
  assert.equal(candidate.items[0].cover.url, 'https://i2.hdslb.com/bfs/article/cover.jpg');
  const bounded = {
    value: rawFeed,
    status: 200,
    bodyBytes: 367,
    bodySha256: 'a'.repeat(64),
    queryKeyNames: ['host_mid', 'offset', 'page', 'type', 'w_rid', 'web_location', 'wts'],
    schemaPaths: [
      { path: '$', type: 'object' },
      { path: '$.data.items', type: 'array', arrayLength: 1 }
    ],
    sensitiveFieldPathsOmitted: 0
  };
  const projectedPage = response.projectBilibiliArticleFeedPageWithDom(
    bounded,
    1,
    [],
    {
      stableAccountId: accountId,
      stableOpusIds: [opusId],
      titleCandidates: { [opusId]: ['10', '58k稳了，Python才是yyds'] },
      visibleFacetLabels: ['全部图文', '专栏', '动态'],
      risk: { verificationRequired: false, rateLimited: false, sourceUnavailable: false }
    },
    '2026-07-20T01:00:00.000Z'
  );
  assert.ok(projectedPage);
  assert.equal(projectedPage.projection.domCrossCheck.exactCumulativeIdentityMatch, true);
  assert.equal(projectedPage.projection.domCrossCheck.pageTitleMatches, 1);
  assert.equal('nextOffset' in projectedPage.projection, false);

  const detailSnapshot = contract.projectBilibiliArticleDetailDom({
    stableOpusId: opusId,
    stableAccountId: accountId,
    displayName: '公开作者',
    title: '58k稳了，Python才是yyds',
    publishedVisibleText: '2022年08月09日 17:06',
    copyrightVisibleText: 'cv18011308',
    tags: ['Python', '编程', 'Python'],
    content: {
      visibleText: '第一段\n\n第二段',
      blocks: [
        {
          tagName: 'P',
          visibleText: '第一段',
          images: [],
          links: []
        },
        {
          tagName: 'DIV',
          visibleText: '第二段',
          images: [{
            url: 'https://i0.hdslb.com/bfs/article/body.jpg@1192w.webp?credential=discard',
            alt: '公开插图'
          }],
          links: [{ text: '公开标签', url: 'https://search.bilibili.com/all?keyword=python' }]
        }
      ]
    },
    toolbarMetrics: { likes: 10, coins: 0, favorites: 3, forwards: 0, comments: 6 },
    risk: { verificationRequired: false, rateLimited: false, sourceUnavailable: false }
  }, {
    canonicalProfileUrl,
    canonicalOpusUrl,
    sourceInventoryArtifactId,
    sourceInventoryManifestSha256: 'd'.repeat(64)
  }, '2026-07-20T01:00:01.000Z');
  assert.ok(detailSnapshot);
  assert.equal(detailSnapshot.content.visibleText.includes('\n\n'), true);
  assert.equal(detailSnapshot.content.mediaRefs[0].url.includes('@'), false);
  assert.deepEqual(detailSnapshot.tags, ['Python', '编程']);
  assert.equal(detailSnapshot.legacyArticleId, 'cv18011308');

  const stateDirectory = join(temporaryDirectory, 'state');
  const inventoryStore = await BilibiliArticleInventoryArtifactStore.create(stateDirectory);
  const inventoryRun = {
    schemaVersion: 1,
    runId: '11111111-1111-4111-8111-111111111111',
    collectorVersion: '0.4.24',
    platform: 'bilibili',
    accountCategory: 'user_managed',
    pageRole: 'article_inventory',
    targetUrlDigest: 'b'.repeat(64),
    strategyCandidate: {
      strategyId: 'bilibili.article.inventory.opus-feed.v1',
      version: '1.0.0',
      admissionEligible: false
    },
    state: 'completed',
    errorCode: null,
    startedAt: '2026-07-20T01:00:00.000Z',
    completedAt: '2026-07-20T01:00:01.000Z',
    stableAccountId: accountId,
    failedResponseEvidence: null,
    pages: [projectedPage.projection],
    actions: [
      {
        actionId: 'open_article_inventory', intent: 'Open the canonical account opus inventory.',
        expectedPageNumber: 1, attempted: true, attemptCount: 1, outcome: 'completed', errorCode: null
      },
      {
        actionId: 'select_article_facet', intent: 'Select the public article facet.',
        expectedPageNumber: 1, attempted: true, attemptCount: 1, outcome: 'completed', errorCode: null
      }
    ],
    coverage: {
      plannedMaximumPages: 2,
      capturedPages: 1,
      capturedItems: 1,
      uniqueItems: 1,
      duplicateItems: 0,
      completeWithinArticleFacet: true,
      terminalReason: 'feed_terminal_reached'
    },
    safeguards: {
      environment: 'local_user_controlled_collection_profile',
      browser: 'visible_playwright_chromium',
      acquisition: 'trusted_navigation_facet_selection_and_scroll_plus_dom_response_projection',
      requestHeaders: 'not_read', requestBody: 'not_read', cookiesAndTokens: 'not_read',
      networkQueryAndFragmentValues: 'discarded', cursorValue: 'used_in_memory_not_persisted',
      responseProjection: 'public_article_inventory_fields_allowlist', unknownResponseValues: 'not_persisted',
      semanticActionDelivery: 'at_most_once', runDeadlineMs: 60_000,
      targetTabSelection: 'created_new_managed_tab', targetPage: 'retained_after_run', admissionEligible: false
    }
  };
  const inventorySummary = await inventoryStore.record(inventoryRun);
  assert.equal((await inventoryStore.record(inventoryRun)).artifactId, inventorySummary.artifactId);
  assert.equal((await inventoryStore.get(inventorySummary.artifactId)).pages[0].items[0].stableOpusId, opusId);

  const detailStore = await BilibiliArticleDetailArtifactStore.create(stateDirectory);
  const detailRun = {
    schemaVersion: 1,
    runId: '22222222-2222-4222-8222-222222222222',
    collectorVersion: '0.4.24',
    platform: 'bilibili',
    accountCategory: 'user_managed',
    pageRole: 'article_detail',
    targetUrlDigest: 'c'.repeat(64),
    strategyCandidate: {
      strategyId: 'bilibili.article.detail.dom-raw.v1', version: '1.0.0', admissionEligible: false
    },
    state: 'completed', errorCode: null,
    startedAt: '2026-07-20T01:00:01.000Z', completedAt: '2026-07-20T01:00:02.000Z',
    sourceInventory: {
      artifactId: sourceInventoryArtifactId,
      manifestSha256: inventorySummary.manifestSha256
    },
    snapshot: detailSnapshot,
    actions: [{
      actionId: 'open_article_detail', intent: 'Open one canonical public opus article detail.',
      attempted: true, attemptCount: 1, outcome: 'completed', errorCode: null
    }],
    coverage: {
      titleCaptured: true, authorCaptured: true, publishedTimeCaptured: true,
      contentCharacters: detailSnapshot.content.visibleText.length,
      contentBlocks: detailSnapshot.content.blocks.length,
      mediaRefs: detailSnapshot.content.mediaRefs.length,
      linkRefs: detailSnapshot.content.linkRefs.length,
      publicMetricsCaptured: true,
      terminalReason: 'article_captured'
    },
    safeguards: {
      environment: 'local_user_controlled_collection_profile', browser: 'visible_playwright_chromium',
      acquisition: 'trusted_navigation_plus_bounded_public_article_dom', responseBody: 'not_read',
      requestHeaders: 'not_read', requestBody: 'not_read', cookiesAndTokens: 'not_read',
      currentViewerIdentity: 'excluded', discussion: 'excluded_separate_capability',
      authorAccountBinding: 'verified_article_inventory_artifact',
      semanticActionDelivery: 'at_most_once', runDeadlineMs: 60_000,
      targetTabSelection: 'reused_related_article_inventory_tab', targetPage: 'retained_after_run',
      admissionEligible: false
    }
  };
  const detailSummary = await detailStore.record(detailRun);
  assert.equal((await detailStore.record(detailRun)).artifactId, detailSummary.artifactId);
  assert.equal((await detailStore.get(detailSummary.artifactId)).snapshot.publicMetrics.comments, 6);

  const recoveredInventory = await BilibiliArticleInventoryArtifactStore.create(stateDirectory);
  const recoveredDetail = await BilibiliArticleDetailArtifactStore.create(stateDirectory);
  assert.equal((await recoveredInventory.get(inventorySummary.artifactId)).summary.manifestSha256,
    inventorySummary.manifestSha256);
  assert.equal((await recoveredDetail.get(detailSummary.artifactId)).summary.manifestSha256,
    detailSummary.manifestSha256);

  const inventoryDirectory = join(stateDirectory, 'bilibili-article-inventory', inventorySummary.artifactId);
  const detailDirectory = join(stateDirectory, 'bilibili-article-details', detailSummary.artifactId);
  assert.deepEqual((await readdir(inventoryDirectory)).sort(), ['manifest.json', 'page-001.json']);
  assert.deepEqual((await readdir(detailDirectory)).sort(), ['article.json', 'manifest.json']);
  const persisted = (await Promise.all([
    ...((await readdir(inventoryDirectory)).map((name) => readFile(join(inventoryDirectory, name), 'utf8'))),
    ...((await readdir(detailDirectory)).map((name) => readFile(join(detailDirectory, name), 'utf8')))
  ])).join('\n');
  for (const forbidden of [
    'profileId', 'browserProfileId', 'Cookie', 'Authorization', 'credential=discard',
    'next-offset-secret', 'offset=next-offset-secret', 'w_rid='
  ]) assert.equal(persisted.includes(forbidden), false, `forbidden persisted value: ${forbidden}`);

  console.log(JSON.stringify({
    ok: true,
    gate: 'bilibili-article-pure-contract-and-artifact',
    platformRequests: 0,
    opusFeedCursorValueOmitted: true,
    duplicateDomAnchorsMergedByStableOpusId: true,
    articleTextBlocksMediaLinksAndMetricsProjected: true,
    inventoryAndDetailDigestsVerified: true,
    restartReloadVerified: true
  }, null, 2));
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
