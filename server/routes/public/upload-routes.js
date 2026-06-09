const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const toBooleanParam = (value, fallback) => {
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).trim() === 'true';
};

const toUploadNameType = (value) => {
  const normalized = String(value || '').trim();
  return ['default', 'index', 'origin', 'short'].includes(normalized) ? normalized : 'default';
};

const toReturnFormat = (value) => {
  const normalized = String(value || '').trim();
  return ['default', 'full'].includes(normalized) ? normalized : 'default';
};

const appendOptional = (params, key, value) => {
  const normalized = String(value || '').trim();
  if (normalized) {
    params.set(key, normalized);
  }
};

const getExtensionByType = (contentType) => {
  if (contentType === 'image/jpeg') return 'jpg';
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/gif') return 'gif';
  if (contentType === 'image/webp') return 'webp';
  return 'bin';
};

const UPLOAD_USAGE_PERMISSIONS = Object.freeze({
  post: { permission: 'post', message: '账号已被封禁，无法上传图片' },
  comment: { permission: 'comment', message: '账号已被封禁，无法上传图片' },
  chat: { permission: 'chat', message: '账号已被封禁，无法上传图片' },
});

const resolveUploadUsagePermission = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return UPLOAD_USAGE_PERMISSIONS[normalized] || UPLOAD_USAGE_PERMISSIONS.post;
};

export const registerPublicUploadRoutes = (app, deps) => {
  const {
    parseImageBody,
    requireFingerprint,
    checkBanFor,
    enforceRateLimit,
    getRuntimeConfig,
  } = deps;

  const parseUploadBody = (req, res, next) => {
    return parseImageBody(req, res, (error) => {
      if (!error) {
        return next();
      }
      const statusCode = error?.type === 'entity.too.large' || error?.status === 413 ? 413 : 400;
      return res.status(statusCode).json({ error: '图片大小不符合要求' });
    });
  };

  app.post('/api/uploads/image', parseUploadBody, async (req, res) => {
    const fingerprint = requireFingerprint(req, res);
    if (!fingerprint) {
      return;
    }

    const usagePermission = resolveUploadUsagePermission(req.query?.usage);
    if (!checkBanFor(req, res, usagePermission.permission, usagePermission.message, fingerprint)) {
      return;
    }

    if (!enforceRateLimit(req, res, 'upload', fingerprint)) {
      return;
    }

    const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      return res.status(400).json({ error: '仅支持上传图片文件' });
    }

    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!body.length || body.length > MAX_UPLOAD_BYTES) {
      return res.status(400).json({ error: '图片大小不符合要求' });
    }

    const config = getRuntimeConfig();
    const baseUrl = String(config.imgbedBaseUrl || '').trim().replace(/\/$/, '');
    const token = String(config.imgbedToken || '').trim();
    if (!baseUrl || !token) {
      return res.status(503).json({ error: '图片上传服务未配置' });
    }

    const params = new URLSearchParams();
    appendOptional(params, 'uploadChannel', req.query?.uploadChannel || 'telegram');
    appendOptional(params, 'channelName', req.query?.channelName);
    appendOptional(params, 'uploadFolder', req.query?.uploadFolder);
    params.set('serverCompress', String(toBooleanParam(req.query?.serverCompress, true)));
    params.set('autoRetry', String(toBooleanParam(req.query?.autoRetry, true)));
    params.set('uploadNameType', toUploadNameType(req.query?.uploadNameType));
    params.set('returnFormat', toReturnFormat(req.query?.returnFormat));

    const form = new FormData();
    const blob = new Blob([body], { type: contentType });
    form.append('file', blob, `upload.${getExtensionByType(contentType)}`);

    try {
      const response = await fetch(`${baseUrl}/upload?${params.toString()}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: form,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = data?.error || '上传失败';
        return res.status(502).json({ error: message });
      }

      const first = Array.isArray(data) ? data[0] : data?.data?.[0];
      const src = String(first?.src || '');
      if (!src) {
        return res.status(502).json({ error: '上传成功但未返回 src' });
      }

      const url = src.startsWith('http')
        ? src
        : `${baseUrl}${src.startsWith('/') ? '' : '/'}${src}`;

      return res.json({ src, url });
    } catch {
      return res.status(502).json({ error: '图片上传服务暂不可用' });
    }
  });
};
