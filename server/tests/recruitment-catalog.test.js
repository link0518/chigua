import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RecruitmentCatalogError,
  recruitmentCatalog,
} from '../recruitment-catalog.js';

test('权威 DPS 目录保留 24 个源记录并将藏剑合并为一个 UI ID', () => {
  assert.equal(recruitmentCatalog.size, 23);
  assert.equal(recruitmentCatalog.sourceRecordCount, 24);
  assert.deepEqual(recruitmentCatalog.requireId('cangjian'), 'cangjian');
  assert.deepEqual(recruitmentCatalog.getById('cangjian'), {
    id: 'cangjian',
    name: '藏剑',
    school: '藏剑',
    damageType: '外',
    sourceIds: ['10144', '10145'],
  });
  assert.equal(recruitmentCatalog.has('10144'), false);
});

test('无效心法不会绕过服务端目录校验', () => {
  assert.throws(
    () => recruitmentCatalog.requireId('not-a-xinfa'),
    (error) => error instanceof RecruitmentCatalogError,
  );
});
