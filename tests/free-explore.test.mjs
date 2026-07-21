import test from 'node:test';
import assert from 'node:assert/strict';

import * as runtimeModule from '../src/explorer/runtime.mjs';

const { ExplorerRuntime } = runtimeModule;

test('Spec 028 T049 — report-only direct runtime APIs are removed without aliases', () => {
  for (const exportName of [
    'freeExploreRepository',
    'freeExploreRepositoryV2',
    'freeExploreV2',
  ]) {
    assert.equal(exportName in runtimeModule, false, `${exportName} must not be exported`);
  }
  assert.equal(
    Object.prototype.hasOwnProperty.call(ExplorerRuntime.prototype, 'freeExplore'),
    false,
    'ExplorerRuntime.prototype.freeExplore must be removed',
  );
});
