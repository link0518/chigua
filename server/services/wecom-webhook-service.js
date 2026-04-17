const WECOM_WEBHOOK_HOST = 'qyapi.weixin.qq.com';
const WECOM_WEBHOOK_PATH = '/cgi-bin/webhook/send';
const DEFAULT_TIMEOUT_MS = 3000;
const CHINA_TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const text = (value) => String(value || '').trim();

const cn = {
  invalidUrl: '\u4f01\u4e1a\u5fae\u4fe1\u673a\u5668\u4eba Webhook \u5730\u5740\u683c\u5f0f\u4e0d\u6b63\u786e',
  noFetch: '\u5f53\u524d\u8fd0\u884c\u73af\u5883\u4e0d\u652f\u6301 fetch',
  wecomCode: '\u4f01\u4e1a\u5fae\u4fe1\u8fd4\u56de\u9519\u8bef\u7801',
  timeout: '\u4f01\u4e1a\u5fae\u4fe1\u673a\u5668\u4eba\u63a8\u9001\u8d85\u65f6',
  failed: '\u4f01\u4e1a\u5fae\u4fe1\u673a\u5668\u4eba\u63a8\u9001\u5931\u8d25',
  exception: '\u4f01\u4e1a\u5fae\u4fe1\u673a\u5668\u4eba\u63a8\u9001\u5f02\u5e38',
  unconfigured: '\u8bf7\u5148\u914d\u7f6e\u4f01\u4e1a\u5fae\u4fe1\u673a\u5668\u4eba Webhook \u5730\u5740',
};

const labels = {
  title: '\u5403\u74dc\u540e\u53f0\u63d0\u9192',
  testTitle: '\u5403\u74dc\u540e\u53f0\u63d0\u9192\u6d4b\u8bd5',
  type: '\u7c7b\u578b',
  time: '\u65f6\u95f4',
  content: '\u5185\u5bb9',
  email: '\u90ae\u7bb1',
  wechat: '\u5fae\u4fe1',
  qq: 'QQ',
  feedbackId: '\u7559\u8a00ID',
  adminEntry: '\u540e\u53f0\u5165\u53e3',
  openAdmin: '\u6253\u5f00\u540e\u53f0',
  newFeedback: '\u65b0\u7559\u8a00',
  hiddenReview: '\u81ea\u52a8\u9690\u85cf\u5f85\u5ba1\u6838',
  wikiPending: '\u74dc\u6761\u5f85\u5ba1\u6838',
  wikiCreate: '\u65b0\u5efa\u74dc\u6761',
  wikiEdit: '\u7f16\u8f91\u74dc\u6761',
  rumorReview: '\u8c23\u8a00\u5ba1\u6838',
  rumorMark: '\u5224\u5b9a\u7591\u4f3c\u8c23\u8a00',
  rumorReject: '\u9a73\u56de\u8c23\u8a00\u4e3e\u62a5',
  rumorClear: '\u53d6\u6d88\u8c23\u8a00\u6807\u8bb0',
  wikiName: '\u74dc\u6761\u540d',
  tags: '\u6807\u7b7e',
  comment: '\u8bc4\u8bba',
  post: '\u5e16\u5b50',
  pendingReports: '\u5f85\u5904\u7406\u4e3e\u62a5\u6570',
  resolvedReports: '\u5904\u7406\u4e3e\u62a5\u6570',
  reviewReason: '\u5ba1\u6838\u8bf4\u660e',
  snippet: '\u5185\u5bb9\u6458\u8981',
  empty: '\u65e0',
  notProvided: '\u672a\u586b\u5199',
};

const truncateText = (value, maxLength = 160) => {
  const normalized = text(value).replace(/\s+/g, ' ');
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
};

const escapeMarkdownText = (value) => text(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/\r?\n/g, ' ');

const formatTime = (timestamp) => {
  const date = new Date(Number(timestamp || Date.now()));
  return CHINA_TIME_FORMATTER.format(Number.isNaN(date.getTime()) ? new Date() : date);
};

const buildAdminLink = (siteUrl) => {
  const baseUrl = text(siteUrl).replace(/\/+$/, '');
  const adminUrl = baseUrl ? `${baseUrl}/tiancai` : '/tiancai';
  return adminUrl.startsWith('http://') || adminUrl.startsWith('https://')
    ? `[${labels.openAdmin}](${adminUrl})`
    : adminUrl;
};

const resolveRumorReviewActionLabel = (action) => {
  if (action === 'mark') {
    return labels.rumorMark;
  }
  if (action === 'reject') {
    return labels.rumorReject;
  }
  if (action === 'clear') {
    return labels.rumorClear;
  }
  return labels.rumorReview;
};

const getWebhookKey = (rawUrl) => {
  try {
    return text(new URL(text(rawUrl)).searchParams.get('key'));
  } catch {
    return '';
  }
};

export const isValidWecomWebhookUrl = (value) => {
  const rawUrl = text(value);
  if (!rawUrl) {
    return false;
  }
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'https:'
      && parsed.hostname === WECOM_WEBHOOK_HOST
      && parsed.pathname === WECOM_WEBHOOK_PATH
      && Boolean(text(parsed.searchParams.get('key')));
  } catch {
    return false;
  }
};

export const normalizeWecomWebhookUrl = (value) => {
  const rawUrl = text(value);
  if (!isValidWecomWebhookUrl(rawUrl)) {
    throw new Error(cn.invalidUrl);
  }
  return new URL(rawUrl).toString();
};

export const maskWecomWebhookUrl = (value) => {
  const rawUrl = text(value);
  if (!rawUrl) {
    return '';
  }
  try {
    const parsed = new URL(rawUrl);
    const key = getWebhookKey(rawUrl);
    const maskedKey = key.length <= 8
      ? `${key.slice(0, 2)}***${key.slice(-2)}`
      : `${key.slice(0, 4)}...${key.slice(-4)}`;
    parsed.searchParams.set('key', maskedKey || '***');
    return parsed.toString();
  } catch {
    return rawUrl.length <= 12 ? '***' : `${rawUrl.slice(0, 8)}...${rawUrl.slice(-4)}`;
  }
};

export const sendWecomWebhookMarkdown = async ({
  url,
  content,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) => {
  let normalizedUrl;
  try {
    normalizedUrl = normalizeWecomWebhookUrl(url);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : cn.invalidUrl };
  }

  if (typeof fetchImpl !== 'function') {
    return { ok: false, error: cn.noFetch };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(Number(timeoutMs) || DEFAULT_TIMEOUT_MS, 1));

  try {
    const response = await fetchImpl(normalizedUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'markdown',
        markdown: {
          content: String(content || ''),
        },
      }),
      signal: controller.signal,
    });
    if (!response?.ok) {
      return { ok: false, error: `HTTP ${response?.status || 0}` };
    }

    const data = await response.json().catch(() => null);
    if (data && Number(data.errcode || 0) !== 0) {
      return { ok: false, error: data.errmsg || `${cn.wecomCode} ${data.errcode}` };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error?.name === 'AbortError' ? cn.timeout : error?.message || cn.failed,
    };
  } finally {
    clearTimeout(timer);
  }
};

export const createWecomWebhookService = ({
  getConfig,
  fetchImpl = globalThis.fetch,
  siteUrl = '',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  logger = console,
} = {}) => {
  const adminLink = buildAdminLink(siteUrl);

  const getCurrentConfig = () => {
    const config = typeof getConfig === 'function' ? getConfig() : {};
    return {
      enabled: Boolean(config?.enabled),
      url: text(config?.url),
    };
  };

  const sendConfiguredMarkdown = async (content, eventName) => {
    try {
      const config = getCurrentConfig();
      if (!config.enabled) {
        return { ok: false, skipped: true, reason: 'disabled' };
      }
      if (!config.url) {
        return { ok: false, skipped: true, reason: 'unconfigured' };
      }
      const result = await sendWecomWebhookMarkdown({
        url: config.url,
        content,
        fetchImpl,
        timeoutMs,
      });
      if (!result.ok) {
        logger?.error?.(cn.failed, {
          event: eventName,
          error: result.error,
          webhook: maskWecomWebhookUrl(config.url),
        });
      }
      return result;
    } catch (error) {
      logger?.error?.(cn.exception, {
        event: eventName,
        error: error?.message || String(error),
      });
      return { ok: false, error: error?.message || cn.exception };
    }
  };

  const notifyFeedbackMessage = (payload = {}) => sendConfiguredMarkdown([
    `**${labels.title}**`,
    `> ${labels.type}\uff1a${labels.newFeedback}`,
    `> ${labels.time}\uff1a${escapeMarkdownText(formatTime(payload.createdAt))}`,
    `> ${labels.content}\uff1a${escapeMarkdownText(truncateText(payload.content)) || labels.empty}`,
    `> ${labels.email}\uff1a${escapeMarkdownText(payload.email) || labels.notProvided}`,
    `> ${labels.wechat}\uff1a${escapeMarkdownText(payload.wechat) || labels.notProvided}`,
    `> ${labels.qq}\uff1a${escapeMarkdownText(payload.qq) || labels.notProvided}`,
    `> ${labels.adminEntry}\uff1a${adminLink}`,
  ].join('\n'), 'feedback');

  const notifyHiddenContent = (payload = {}) => {
    const targetLabel = payload.targetType === 'comment' ? labels.comment : labels.post;
    return sendConfiguredMarkdown([
      `**${labels.title}**`,
      `> ${labels.type}\uff1a${targetLabel}${labels.hiddenReview}`,
      `> ${labels.time}\uff1a${escapeMarkdownText(formatTime(payload.hiddenAt))}`,
      `> ${labels.pendingReports}\uff1a${Number(payload.pendingReportCount || 0)}`,
      `> ${labels.snippet}\uff1a${escapeMarkdownText(truncateText(payload.contentSnippet)) || labels.empty}`,
      `> ${labels.adminEntry}\uff1a${adminLink}`,
    ].join('\n'), 'hidden_content');
  };

  const notifyWikiRevision = (payload = {}) => {
    const actionLabel = payload.actionType === 'edit' ? labels.wikiEdit : labels.wikiCreate;
    const tagsText = Array.isArray(payload.tags) && payload.tags.length
      ? payload.tags.map((item) => `#${text(item)}`).filter(Boolean).join(' ')
      : labels.empty;
    return sendConfiguredMarkdown([
      `**${labels.title}**`,
      `> ${labels.type}\uff1a${labels.wikiPending} / ${actionLabel}`,
      `> ${labels.time}\uff1a${escapeMarkdownText(formatTime(payload.createdAt))}`,
      `> ${labels.wikiName}\uff1a${escapeMarkdownText(payload.name) || labels.empty}`,
      `> ${labels.tags}\uff1a${escapeMarkdownText(tagsText) || labels.empty}`,
      `> ${labels.snippet}\uff1a${escapeMarkdownText(truncateText(payload.narrative)) || labels.empty}`,
      `> ${labels.adminEntry}\uff1a${adminLink}`,
    ].join('\n'), 'wiki_revision');
  };

  const notifyRumorReview = (payload = {}) => {
    const targetLabel = payload.targetType === 'comment' ? labels.comment : labels.post;
    const actionLabel = resolveRumorReviewActionLabel(payload.action);
    const lines = [
      `**${labels.title}**`,
      `> ${labels.type}\uff1a${labels.rumorReview} / ${targetLabel} / ${actionLabel}`,
      `> ${labels.time}\uff1a${escapeMarkdownText(formatTime(payload.reviewedAt))}`,
    ];

    lines.push(`> ${labels.resolvedReports}\uff1a${Number(payload.resolvedCount || 0)}`);
    lines.push(`> ${labels.snippet}\uff1a${escapeMarkdownText(truncateText(payload.contentSnippet)) || labels.empty}`);

    if (text(payload.reason)) {
      lines.push(`> ${labels.reviewReason}\uff1a${escapeMarkdownText(truncateText(payload.reason, 80))}`);
    }

    lines.push(`> ${labels.adminEntry}\uff1a${adminLink}`);
    return sendConfiguredMarkdown(lines.join('\n'), 'rumor_review');
  };

  const sendTestMessage = async ({ url } = {}) => {
    const config = getCurrentConfig();
    const targetUrl = text(url) || config.url;
    if (!targetUrl) {
      return { ok: false, skipped: true, reason: 'unconfigured', error: cn.unconfigured };
    }
    return sendWecomWebhookMarkdown({
      url: targetUrl,
      content: [
        `**${labels.testTitle}**`,
        `> ${labels.time}\uff1a${escapeMarkdownText(formatTime(Date.now()))}`,
        `> ${labels.adminEntry}\uff1a${adminLink}`,
      ].join('\n'),
      fetchImpl,
      timeoutMs,
    });
  };

  return {
    notifyFeedbackMessage,
    notifyHiddenContent,
    notifyWikiRevision,
    notifyRumorReview,
    sendTestMessage,
  };
};
