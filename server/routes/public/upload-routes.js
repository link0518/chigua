const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const NORMALIZED_IMAGE_TYPES = Object.freeze({
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/x-png': 'image/png',
});

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

const hasBytesAt = (buffer, offset, bytes) => (
  buffer.length >= offset + bytes.length
  && bytes.every((value, index) => buffer[offset + index] === value)
);

const hasValidImageSignature = (buffer, contentType) => {
  if (contentType === 'image/jpeg') {
    return hasBytesAt(buffer, 0, [0xff, 0xd8, 0xff]);
  }
  if (contentType === 'image/png') {
    return hasBytesAt(buffer, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  if (contentType === 'image/gif') {
    return hasBytesAt(buffer, 0, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61])
      || hasBytesAt(buffer, 0, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  }
  if (contentType === 'image/webp') {
    return hasBytesAt(buffer, 0, [0x52, 0x49, 0x46, 0x46])
      && hasBytesAt(buffer, 8, [0x57, 0x45, 0x42, 0x50]);
  }
  return false;
};

const normalizeImageContentType = (value) => {
  const contentType = String(value || '').split(';')[0].trim().toLowerCase();
  return NORMALIZED_IMAGE_TYPES[contentType] || contentType;
};

const UPLOAD_USAGE_PERMISSIONS = Object.freeze({
  post: {
    permission: 'post',
    message: '账号已被封禁，无法上传图片',
  },
  comment: {
    permission: 'comment',
    message: '账号已被封禁，无法上传图片',
  },
  wiki: {
    permission: 'post',
    message: '账号已被封禁，无法上传图片',
  },
});

const resolveUploadUsagePermission = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return UPLOAD_USAGE_PERMISSIONS[normalized] || UPLOAD_USAGE_PERMISSIONS.post;
};

const isLoopbackHostname = (hostname) => {
  const normalized = String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) {
    return true;
  }
  if (normalized === '::1' || normalized === '[::1]') {
    return true;
  }
  const ipv4Parts = normalized.split('.');
  return ipv4Parts.length === 4
    && ipv4Parts[0] === '127'
    && ipv4Parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
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
    // 图片 URL 可被跨业务复用，不能只检查客户端声明的单一用途；任一内容操作封禁都应阻止共享上传。
    for (const permission of ['post', 'comment']) {
      if (!checkBanFor(req, res, permission, usagePermission.message, fingerprint)) {
        return;
      }
    }

    // 上传用途由客户端声明，不能用它选择限流桶，否则可通过切换 usage 绕过总额度。
    if (!enforceRateLimit(req, res, 'upload', fingerprint)) {
      return;
    }

    const contentType = normalizeImageContentType(req.headers['content-type']);
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      return res.status(400).json({ error: '仅支持上传图片文件' });
    }

    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!body.length || body.length > MAX_UPLOAD_BYTES) {
      return res.status(400).json({ error: '图片大小不符合要求' });
    }
    if (!hasValidImageSignature(body, contentType)) {
      return res.status(400).json({ error: '图片文件格式不正确' });
    }

    const config = getRuntimeConfig();
    const baseUrl = String(config.imgbedBaseUrl || '').trim().replace(/\/$/, '');
    const token = String(config.imgbedToken || '').trim();
    if (!baseUrl || !token) {
      return res.status(503).json({ error: '图片上传服务未配置' });
    }
    let parsedBaseUrl;
    try {
      parsedBaseUrl = new URL(baseUrl);
    } catch {
      return res.status(503).json({ error: '图片上传服务地址无效' });
    }
    if (
      !['http:', 'https:'].includes(parsedBaseUrl.protocol)
      || parsedBaseUrl.username
      || parsedBaseUrl.password
    ) {
      return res.status(503).json({ error: '图片上传服务地址无效' });
    }
    if (parsedBaseUrl.protocol === 'http:' && !isLoopbackHostname(parsedBaseUrl.hostname)) {
      return res.status(503).json({ error: '图片上传服务必须使用 HTTPS（本地回环地址除外）' });
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
        redirect: 'error',
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
