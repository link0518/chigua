import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { registerPublicUploadRoutes } from '../routes/public/upload-routes.js';
import { createSiteSettingsService } from '../site-settings.js';

const originalFetch = globalThis.fetch;

const createPngBody = () => Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]);

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
    body: createPngBody(),
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
    body: createPngBody(),
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
  let requestedRedirect = '';
  globalThis.fetch = async (url, options) => {
    requestedUrl = String(url);
    requestedAuthorization = String(options?.headers?.Authorization || '');
    requestedRedirect = String(options?.redirect || '');
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
      body: createPngBody(),
      query: { uploadChannel: 'telegram', returnFormat: 'full' },
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { src: '/images/a.png', url: 'https://img.example/images/a.png' });
    assert.equal(requestedAuthorization, 'Bearer server-token');
    assert.equal(requestedRedirect, 'error');
    assert.ok(requestedUrl.startsWith('https://img.example/upload?'));
    assert.ok(requestedUrl.includes('uploadChannel=telegram'));
    assert.ok(requestedUrl.includes('returnFormat=full'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('图片上传路由同时检查帖子和评论封禁权限', async () => {
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
      body: createPngBody(),
      query: { usage: 'comment' },
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(checkedPermissions, ['post', 'comment']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('图片上传路由未知上传用途仍检查共享封禁权限', async () => {
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
      body: createPngBody(),
      query: { usage: 'unknown' },
    });

    assert.deepEqual(checkedPermissions, ['post', 'comment']);
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
    body: createPngBody(),
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
      body: createPngBody(),
      query: {},
    });

    assert.equal(res.statusCode, 502);
    assert.equal(res.body.error, 'unauthorized');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('图片上传路由校验 MIME 与真实文件头一致', async () => {
  const app = createApp();
  registerPublicUploadRoutes(app, {
    parseImageBody: (req, res, next) => next(),
    requireFingerprint: () => 'fp-1',
    checkBanFor: () => true,
    enforceRateLimit: () => true,
    getRuntimeConfig: () => ({ imgbedBaseUrl: 'https://img.example', imgbedToken: 'token' }),
  });

  const res = await app.run('/api/uploads/image', {
    headers: { 'content-type': 'image/png' },
    body: Buffer.from('not-a-real-png'),
    query: {},
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, '图片文件格式不正确');
});

test('图片上传路由识别 JPEG、PNG、GIF、WebP 文件头', async () => {
  const cases = [
    { type: 'image/jpeg', body: Buffer.from([0xff, 0xd8, 0xff, 0x00]) },
    { type: 'image/png', body: createPngBody() },
    { type: 'image/gif', body: Buffer.from('GIF89a', 'ascii') },
    {
      type: 'image/webp',
      body: Buffer.from([
        0x52, 0x49, 0x46, 0x46,
        0x00, 0x00, 0x00, 0x00,
        0x57, 0x45, 0x42, 0x50,
      ]),
    },
  ];
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [{ src: '/images/valid' }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  try {
    for (const imageCase of cases) {
      const app = createApp();
      registerPublicUploadRoutes(app, {
        parseImageBody: (req, res, next) => next(),
        requireFingerprint: () => 'fp-signature',
        checkBanFor: () => true,
        enforceRateLimit: () => true,
        getRuntimeConfig: () => ({ imgbedBaseUrl: 'https://img.example', imgbedToken: 'token' }),
      });

      const validRes = await app.run('/api/uploads/image', {
        headers: { 'content-type': imageCase.type },
        body: imageCase.body,
        query: {},
      });
      assert.equal(validRes.statusCode, 200, `${imageCase.type} 应通过真实文件头校验`);

      const invalidRes = await app.run('/api/uploads/image', {
        headers: { 'content-type': imageCase.type },
        body: Buffer.from('invalid-image-header'),
        query: {},
      });
      assert.equal(invalidRes.statusCode, 400, `${imageCase.type} 应拒绝错误文件头`);
      assert.equal(invalidRes.body.error, '图片文件格式不正确');
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('图片上传路由拒绝超过 5MB 的请求体', async () => {
  const app = createApp();
  const oversizedBody = Buffer.alloc(5 * 1024 * 1024 + 1);
  createPngBody().copy(oversizedBody, 0);
  registerPublicUploadRoutes(app, {
    parseImageBody: (req, res, next) => next(),
    requireFingerprint: () => 'fp-oversized',
    checkBanFor: () => true,
    enforceRateLimit: () => true,
    getRuntimeConfig: () => ({ imgbedBaseUrl: 'https://img.example', imgbedToken: 'token' }),
  });

  const res = await app.run('/api/uploads/image', {
    headers: { 'content-type': 'image/png' },
    body: oversizedBody,
    query: {},
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, '图片大小不符合要求');
});

test('Wiki 图片上传检查共享封禁权限并使用统一图片上传限流桶', async () => {
  const app = createApp();
  const checkedPermissions = [];
  const checkedRateLimitActions = [];
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [{ src: '/images/wiki.png' }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  try {
    registerPublicUploadRoutes(app, {
      parseImageBody: (req, res, next) => next(),
      requireFingerprint: () => 'fp-wiki',
      checkBanFor: (_req, _res, permission) => {
        checkedPermissions.push(permission);
        return true;
      },
      enforceRateLimit: (_req, _res, action) => {
        checkedRateLimitActions.push(action);
        return true;
      },
      getRuntimeConfig: () => ({ imgbedBaseUrl: 'https://img.example', imgbedToken: 'token' }),
    });

    const res = await app.run('/api/uploads/image', {
      headers: { 'content-type': 'image/png' },
      body: createPngBody(),
      query: { usage: 'wiki' },
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(checkedPermissions, ['post', 'comment']);
    assert.deepEqual(checkedRateLimitActions, ['upload']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('图片上传代理在发送令牌前拒绝外部 HTTP 图床', async () => {
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error('不应调用上游图床');
  };

  try {
    for (const usage of ['post', 'comment', 'wiki']) {
      const app = createApp();
      registerPublicUploadRoutes(app, {
        parseImageBody: (req, res, next) => next(),
        requireFingerprint: () => `fp-${usage}-https`,
        checkBanFor: () => true,
        enforceRateLimit: () => true,
        getRuntimeConfig: () => ({
          imgbedBaseUrl: 'http://img.example',
          imgbedToken: 'secret-token',
        }),
      });

      const res = await app.run('/api/uploads/image', {
        headers: { 'content-type': 'image/png' },
        body: createPngBody(),
        query: { usage },
      });

      assert.equal(res.statusCode, 503);
      assert.equal(res.body.error, '图片上传服务必须使用 HTTPS（本地回环地址除外）');
    }
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('图片上传代理允许本地回环 HTTP 图床', async () => {
  const loopbackUrls = [
    'http://localhost:8080',
    'http://assets.localhost:8080',
    'http://127.23.45.67:8080',
    'http://[::1]:8080',
  ];
  const requestedUrls = [];
  globalThis.fetch = async (url, options) => {
    requestedUrls.push(String(url));
    assert.equal(options?.redirect, 'error');
    return new Response(JSON.stringify({ data: [{ src: '/images/local.png' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    for (const baseUrl of loopbackUrls) {
      const app = createApp();
      registerPublicUploadRoutes(app, {
        parseImageBody: (req, res, next) => next(),
        requireFingerprint: () => 'fp-loopback',
        checkBanFor: () => true,
        enforceRateLimit: () => true,
        getRuntimeConfig: () => ({ imgbedBaseUrl: baseUrl, imgbedToken: 'local-token' }),
      });

      const res = await app.run('/api/uploads/image', {
        headers: { 'content-type': 'image/png' },
        body: createPngBody(),
        query: { usage: 'wiki' },
      });
      assert.equal(res.statusCode, 200, `${baseUrl} 应允许本地回环 HTTP 上传`);
    }
    assert.equal(requestedUrls.length, loopbackUrls.length);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('客户端切换帖子、评论和 Wiki 用途时仍共用 upload 限流桶', async () => {
  const app = createApp();
  const checkedActions = [];
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [{ src: '/images/common.png' }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  try {
    registerPublicUploadRoutes(app, {
      parseImageBody: (req, res, next) => next(),
      requireFingerprint: () => 'fp-common',
      checkBanFor: () => true,
      enforceRateLimit: (_req, _res, action) => {
        checkedActions.push(action);
        return true;
      },
      getRuntimeConfig: () => ({ imgbedBaseUrl: 'https://img.example', imgbedToken: 'token' }),
    });

    await app.run('/api/uploads/image', {
      headers: { 'content-type': 'image/png' },
      body: createPngBody(),
      query: { usage: 'post' },
    });
    await app.run('/api/uploads/image', {
      headers: { 'content-type': 'image/png' },
      body: createPngBody(),
      query: { usage: 'comment' },
    });
    await app.run('/api/uploads/image', {
      headers: { 'content-type': 'image/png' },
      body: createPngBody(),
      query: { usage: 'wiki' },
    });

    assert.deepEqual(checkedActions, ['upload', 'upload', 'upload']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('旧限流设置会迁移到统一的每分钟 12 张图片上传默认值', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE app_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at INTEGER NOT NULL
    );
  `);
  db.prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)').run(
    'rate_limits',
    JSON.stringify({
      post: { limit: 2, windowMs: 1800000 },
      upload: { limit: 3, windowMs: 30000 },
    }),
    Date.now()
  );

  try {
    const settings = createSiteSettingsService({ db, turnstileSecretKey: '' });
    assert.deepEqual(settings.getRateLimitConfig('upload'), {
      limit: 12,
      windowMs: 60 * 1000,
    });
  } finally {
    db.close();
  }
});
