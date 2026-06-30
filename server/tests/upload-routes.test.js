import assert from 'node:assert/strict';
import test from 'node:test';

import { registerPublicUploadRoutes } from '../routes/public/upload-routes.js';

const originalFetch = globalThis.fetch;

const createResponse = () => {
  const response = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return response;
};

const createApp = () => {
  const routes = new Map();
  return {
    post(path, ...handlers) {
      routes.set(path, handlers);
    },
    async run(path, req) {
      const handlers = routes.get(path);
      assert.ok(handlers, `未注册路由：${path}`);
      const res = createResponse();
      let index = -1;
      const next = async () => {
        index += 1;
        const handler = handlers[index];
        if (!handler) {
          return;
        }
        await handler(req, res, next);
      };
      await next();
      return res;
    },
  };
};

test('图片上传路由拒绝非图片类型', async () => {
  const app = createApp();
  registerPublicUploadRoutes(app, {
    parseImageBody: (req, res, next) => next(),
    requireFingerprint: () => 'fp-1',
    checkBanFor: () => true,
    enforceRateLimit: () => true,
    getRuntimeConfig: () => ({ imgbedBaseUrl: 'https://img.example', imgbedToken: 'token' }),
  });

  const res = await app.run('/api/uploads/image', {
    headers: { 'content-type': 'text/plain' },
    body: Buffer.from('hello'),
    query: {},
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, '仅支持上传图片文件');
});

test('图片上传路由在未配置服务端图床密钥时返回 503', async () => {
  const app = createApp();
  registerPublicUploadRoutes(app, {
    parseImageBody: (req, res, next) => next(),
    requireFingerprint: () => 'fp-1',
    checkBanFor: () => true,
    enforceRateLimit: () => true,
    getRuntimeConfig: () => ({ imgbedBaseUrl: '', imgbedToken: '' }),
  });

  const res = await app.run('/api/uploads/image', {
    headers: { 'content-type': 'image/png' },
    body: Buffer.from([1, 2, 3]),
    query: {},
  });

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, '图片上传服务未配置');
});

test('图片上传路由缺少指纹时提前结束，不调用后续校验', async () => {
  const app = createApp();
  let checkedBan = false;
  let checkedRateLimit = false;
  registerPublicUploadRoutes(app, {
    parseImageBody: (req, res, next) => next(),
    requireFingerprint: () => '',
    checkBanFor: () => {
      checkedBan = true;
      return true;
    },
    enforceRateLimit: () => {
      checkedRateLimit = true;
      return true;
    },
    getRuntimeConfig: () => ({ imgbedBaseUrl: 'https://img.example', imgbedToken: 'token' }),
  });

  const res = await app.run('/api/uploads/image', {
    headers: { 'content-type': 'image/png' },
    body: Buffer.from([1, 2, 3]),
    query: {},
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body, null);
  assert.equal(checkedBan, false);
  assert.equal(checkedRateLimit, false);
});

test('图片上传路由成功转发到服务端图床并返回完整 URL', async () => {
  const app = createApp();
  let requestedUrl = '';
  let requestedAuthorization = '';
  globalThis.fetch = async (url, options) => {
    requestedUrl = String(url);
    requestedAuthorization = String(options?.headers?.Authorization || '');
    assert.ok(options?.body instanceof FormData);
    return new Response(JSON.stringify({ data: [{ src: '/images/a.png' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    registerPublicUploadRoutes(app, {
      parseImageBody: (req, res, next) => next(),
      requireFingerprint: () => 'fp-1',
      checkBanFor: () => true,
      enforceRateLimit: () => true,
      getRuntimeConfig: () => ({ imgbedBaseUrl: 'https://img.example/', imgbedToken: 'server-token' }),
    });

    const res = await app.run('/api/uploads/image', {
      headers: { 'content-type': 'image/png' },
      body: Buffer.from([1, 2, 3]),
      query: { uploadChannel: 'telegram', returnFormat: 'full' },
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { src: '/images/a.png', url: 'https://img.example/images/a.png' });
    assert.equal(requestedAuthorization, 'Bearer server-token');
    assert.ok(requestedUrl.startsWith('https://img.example/upload?'));
    assert.ok(requestedUrl.includes('uploadChannel=telegram'));
    assert.ok(requestedUrl.includes('returnFormat=full'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('图片上传路由按上传用途检查对应封禁权限', async () => {
  const app = createApp();
  const checkedPermissions = [];
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [{ src: '/images/a.png' }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  try {
    registerPublicUploadRoutes(app, {
      parseImageBody: (req, res, next) => next(),
      requireFingerprint: () => 'fp-1',
      checkBanFor: (_req, _res, permission) => {
        checkedPermissions.push(permission);
        return true;
      },
      enforceRateLimit: () => true,
      getRuntimeConfig: () => ({ imgbedBaseUrl: 'https://img.example', imgbedToken: 'token' }),
    });

    const res = await app.run('/api/uploads/image', {
      headers: { 'content-type': 'image/png' },
      body: Buffer.from([1, 2, 3]),
      query: { usage: 'comment' },
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(checkedPermissions, ['comment']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('图片上传路由未知上传用途回退到发帖权限', async () => {
  const app = createApp();
  const checkedPermissions = [];
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [{ src: '/images/a.png' }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  try {
    registerPublicUploadRoutes(app, {
      parseImageBody: (req, res, next) => next(),
      requireFingerprint: () => 'fp-1',
      checkBanFor: (_req, _res, permission) => {
        checkedPermissions.push(permission);
        return true;
      },
      enforceRateLimit: () => true,
      getRuntimeConfig: () => ({ imgbedBaseUrl: 'https://img.example', imgbedToken: 'token' }),
    });

    await app.run('/api/uploads/image', {
      headers: { 'content-type': 'image/png' },
      body: Buffer.from([1, 2, 3]),
      query: { usage: 'unknown' },
    });

    assert.deepEqual(checkedPermissions, ['post']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('图片上传路由把 body 解析错误转换成明确响应', async () => {
  const app = createApp();
  registerPublicUploadRoutes(app, {
    parseImageBody: (req, res, next) => next({ type: 'entity.too.large', status: 413 }),
    requireFingerprint: () => 'fp-1',
    checkBanFor: () => true,
    enforceRateLimit: () => true,
    getRuntimeConfig: () => ({ imgbedBaseUrl: 'https://img.example', imgbedToken: 'token' }),
  });

  const res = await app.run('/api/uploads/image', {
    headers: { 'content-type': 'image/png' },
    body: Buffer.from([1, 2, 3]),
    query: {},
  });

  assert.equal(res.statusCode, 413);
  assert.equal(res.body.error, '图片大小不符合要求');
});

test('图片上传路由不向前端透传上游图床状态码', async () => {
  const app = createApp();
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });

  try {
    registerPublicUploadRoutes(app, {
      parseImageBody: (req, res, next) => next(),
      requireFingerprint: () => 'fp-1',
      checkBanFor: () => true,
      enforceRateLimit: () => true,
      getRuntimeConfig: () => ({ imgbedBaseUrl: 'https://img.example', imgbedToken: 'server-token' }),
    });

    const res = await app.run('/api/uploads/image', {
      headers: { 'content-type': 'image/png' },
      body: Buffer.from([1, 2, 3]),
      query: {},
    });

    assert.equal(res.statusCode, 502);
    assert.equal(res.body.error, 'unauthorized');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
