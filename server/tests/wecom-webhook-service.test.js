import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createWecomWebhookService,
  isValidWecomWebhookUrl,
  maskWecomWebhookUrl,
  normalizeWecomWebhookUrl,
  sendWecomWebhookMarkdown,
} from '../services/wecom-webhook-service.js';

const VALID_URL = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

test('企业微信 webhook 地址校验与脱敏', () => {
  assert.equal(isValidWecomWebhookUrl(VALID_URL), true);
  assert.equal(isValidWecomWebhookUrl('https://example.com/cgi-bin/webhook/send?key=aaaaaaaa'), false);
  assert.equal(isValidWecomWebhookUrl('http://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=aaaaaaaa'), false);
  assert.throws(() => normalizeWecomWebhookUrl('https://example.com/bad'));

  const masked = maskWecomWebhookUrl(VALID_URL);
  assert.match(masked, /^https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=aaaa/);
  assert.ok(!masked.includes('eeeeeeeeeeee'));
});

test('未启用或未配置时不会发送企业微信 webhook', async () => {
  let calls = 0;
  const service = createWecomWebhookService({
    getConfig: () => ({ enabled: false, url: VALID_URL }),
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, json: async () => ({ errcode: 0 }) };
    },
  });

  const disabled = await service.notifyFeedbackMessage({ feedbackId: 'f1', content: 'hello' });
  assert.equal(disabled.skipped, true);
  assert.equal(disabled.reason, 'disabled');
  assert.equal(calls, 0);

  const unconfiguredService = createWecomWebhookService({
    getConfig: () => ({ enabled: true, url: '' }),
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, json: async () => ({ errcode: 0 }) };
    },
  });
  const unconfigured = await unconfiguredService.notifyHiddenContent({ targetType: 'post', targetId: 'p1' });
  assert.equal(unconfigured.skipped, true);
  assert.equal(unconfigured.reason, 'unconfigured');
  assert.equal(calls, 0);
});

test('成功发送 markdown payload 到企业微信 webhook', async () => {
  const requests = [];
  const result = await sendWecomWebhookMarkdown({
    url: VALID_URL,
    content: '测试内容',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, status: 200, json: async () => ({ errcode: 0, errmsg: 'ok' }) };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    msgtype: 'markdown',
    markdown: { content: '测试内容' },
  });
});

test('HTTP 或企业微信业务错误只返回失败结果，不抛出异常', async () => {
  const httpResult = await sendWecomWebhookMarkdown({
    url: VALID_URL,
    content: 'hello',
    fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }),
  });
  assert.equal(httpResult.ok, false);
  assert.match(httpResult.error, /HTTP 500/);

  const wecomResult = await sendWecomWebhookMarkdown({
    url: VALID_URL,
    content: 'hello',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ errcode: 93000, errmsg: 'rate limited' }) }),
  });
  assert.equal(wecomResult.ok, false);
  assert.equal(wecomResult.error, 'rate limited');
});

test('企业微信 webhook 超时会返回失败结果', async () => {
  const result = await sendWecomWebhookMarkdown({
    url: VALID_URL,
    content: 'hello',
    timeoutMs: 1,
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }),
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /超时/);
});
test('企业微信推送内容不包含留言ID、所属帖子和内容ID', async () => {
  const bodies = [];
  const service = createWecomWebhookService({
    getConfig: () => ({ enabled: true, url: VALID_URL }),
    fetchImpl: async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      return { ok: true, status: 200, json: async () => ({ errcode: 0 }) };
    },
  });

  await service.notifyFeedbackMessage({
    feedbackId: 'feedback-secret-id',
    content: '留言内容',
    email: 'dev@example.com',
  });
  await service.notifyHiddenContent({
    targetType: 'post',
    targetId: 'hidden-secret-id',
    postId: 'post-secret-id',
    pendingReportCount: 10,
    contentSnippet: '待审内容摘要',
  });
  await service.notifyRumorReview({
    targetType: 'comment',
    targetId: 'rumor-secret-id',
    postId: 'rumor-post-secret-id',
    action: 'mark',
    resolvedCount: 2,
    contentSnippet: '谣言审核摘要',
    reason: '管理员判定',
  });

  const sentText = bodies.map((body) => body.markdown.content).join('\n');
  assert.ok(!sentText.includes('留言ID'));
  assert.ok(!sentText.includes('所属帖子'));
  assert.ok(!sentText.includes('内容ID'));
  assert.ok(!sentText.includes('feedback-secret-id'));
  assert.ok(!sentText.includes('hidden-secret-id'));
  assert.ok(!sentText.includes('post-secret-id'));
  assert.ok(!sentText.includes('rumor-secret-id'));
  assert.ok(!sentText.includes('rumor-post-secret-id'));
});

test('企业微信瓜条待审提醒包含类型、名称、标签和摘要', async () => {
  const bodies = [];
  const service = createWecomWebhookService({
    getConfig: () => ({ enabled: true, url: VALID_URL }),
    fetchImpl: async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      return { ok: true, status: 200, json: async () => ({ errcode: 0 }) };
    },
    siteUrl: 'https://example.com',
  });

  const result = await service.notifyWikiRevision({
    actionType: 'edit',
    name: '叶英',
    tags: ['藏剑山庄', '庄主'],
    narrative: '心剑一成，万剑臣服。',
    createdAt: Date.UTC(2024, 0, 1, 0, 0, 0),
  });

  assert.equal(result.ok, true);
  assert.equal(bodies.length, 1);
  const sentText = bodies[0].markdown.content;
  assert.match(sentText, /瓜条待审核/);
  assert.match(sentText, /编辑瓜条/);
  assert.match(sentText, /瓜条名：叶英/);
  assert.match(sentText, /#藏剑山庄 #庄主/);
  assert.match(sentText, /内容摘要：心剑一成/);
  assert.match(sentText, /\[打开后台\]\(https:\/\/example\.com\/tiancai\)/);
});
