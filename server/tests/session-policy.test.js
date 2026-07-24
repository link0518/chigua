import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldSkipSessionForRequest } from '../session-policy.js';

test('匿名高频读取跳过 Session，避免轮询触发 SQLite touch', () => {
  const paths = [
    '/api/notifications',
    '/api/recruitment/notifications',
    '/api/recruitment/threads/thread-1/messages',
    '/api/recruitment/threads/thread-1/contact-exchanges',
  ];

  paths.forEach((path) => {
    assert.equal(shouldSkipSessionForRequest({ method: 'GET', path }), true, path);
    assert.equal(shouldSkipSessionForRequest({ method: 'GET', url: `${path}?afterSeq=3` }), true, path);
  });
});

test('写入、后台、心跳与未知接口继续使用 Session', () => {
  const requests = [
    { method: 'POST', path: '/api/recruitment/notifications/read' },
    { method: 'POST', path: '/api/recruitment/threads/thread-1/messages' },
    { method: 'POST', path: '/api/online/heartbeat' },
    { method: 'GET', path: '/api/admin/session' },
    { method: 'GET', path: '/api/recruitment/threads' },
    { method: 'GET', path: '/api/recruitment/threads/thread-1' },
  ];

  requests.forEach((request) => {
    assert.equal(shouldSkipSessionForRequest(request), false, `${request.method} ${request.path}`);
  });
});
