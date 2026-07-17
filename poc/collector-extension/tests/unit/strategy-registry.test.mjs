import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
let registryModulePromise;

async function loadRegistryModule() {
  if (!registryModulePromise) {
    registryModulePromise = build({
      entryPoints: [resolve(root, 'src', 'shared', 'strategy-registry.ts')],
      bundle: true,
      format: 'esm',
      platform: 'neutral',
      target: 'es2022',
      write: false
    }).then(async (result) => {
      const source = result.outputFiles[0].text;
      return import(`data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`);
    });
  }
  return registryModulePromise;
}

test('the compiled registry exposes only the four bounded fixture-verified discovery strategies', async () => {
  const registry = await loadRegistryModule();
  assert.equal(registry.STATIC_PLATFORM_STRATEGIES.length, 4);

  for (const platform of ['bilibili', 'zhihu', 'weibo', 'xiaohongshu']) {
    const strategy = registry.resolveNativeSearchStrategy(platform);
    assert.deepEqual(registry.strategyProvenance(strategy), {
      strategyId: `${platform}.search.breadth.dom.v1`,
      version: '1',
      evidenceObjective: 'breadth_search',
      acquisition: ['native_navigation', 'visible_dom'],
      maturity: 'fixture_verified'
    });
    assert.equal(strategy.surface, 'native_search');
    assert.equal(strategy.bounds.maxRecords, 20);
    assert.equal(strategy.bounds.maxReadOnlyActions, 0);
    assert.equal(strategy.bounds.firstRenderedPageOnly, true);
    assert.equal(strategy.bounds.allowsReadOnlyInteraction, false);
    assert.equal(strategy.bounds.allowsDetailNavigation, false);
    assert.equal(strategy.bounds.allowsCommentNavigation, false);
    assert.deepEqual(strategy.approvedResponseRouteIds, []);
    assert.equal(strategy.validation.liveValidation, 'not_admitted');
  }
});

test('unimplemented research objectives are not silently resolved as native search', async () => {
  const registry = await loadRegistryModule();
  for (const objective of ['detail_read', 'discussion_sample', 'account_context', 'account_archive', 'trend_snapshot']) {
    assert.deepEqual(registry.strategiesFor('bilibili', objective), []);
  }
});

test('the strategy registry is repository-local rather than a runtime plugin loader', async () => {
  const source = await readFile(resolve(root, 'src', 'shared', 'strategy-registry.ts'), 'utf8');
  assert.doesNotMatch(source, /\bimport\s*\(/, 'strategy definitions must not dynamically import code');
  assert.doesNotMatch(source, /\b(?:eval|Function)\s*\(/, 'strategy definitions must not execute dynamic code');
  assert.doesNotMatch(source, /https?:\/\//, 'strategy definitions must not fetch remote strategy code');
});
