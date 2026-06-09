import assert from 'node:assert/strict';
import test from 'node:test';

import { buildIdentityMatch } from '../sql-utils.js';

test('buildIdentityMatch 去重并生成单值匹配', () => {
  assert.deepEqual(buildIdentityMatch('fingerprint', ['a', 'a', ' ']), {
    clause: 'fingerprint = ?',
    params: ['a'],
  });
});

test('buildIdentityMatch 生成多值 IN 匹配', () => {
  assert.deepEqual(buildIdentityMatch('fingerprint', ['a', 'b']), {
    clause: 'fingerprint IN (?, ?)',
    params: ['a', 'b'],
  });
});

test('buildIdentityMatch 空值返回恒假条件', () => {
  assert.deepEqual(buildIdentityMatch('fingerprint', ['', null, undefined]), {
    clause: '1 = 0',
    params: [],
  });
});
