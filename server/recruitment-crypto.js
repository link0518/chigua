import crypto from 'node:crypto';

const CRYPTO_VERSION = 1;
const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const KEY_NAMESPACE = 'gossipsketch:recruitment';

const toSecretBuffer = (value) => {
  if (Buffer.isBuffer(value)) {
    if (value.length === 0) {
      throw new TypeError('SESSION_SECRET 不能为空');
    }
    return value;
  }
  const normalized = String(value || '');
  if (!normalized) {
    throw new TypeError('SESSION_SECRET 不能为空');
  }
  return Buffer.from(normalized, 'utf8');
};

const encode = (value) => Buffer.from(value).toString('base64url');

const decode = (value, fieldName) => {
  const normalized = String(value || '');
  if (!normalized) {
    throw new TypeError(`${fieldName} 缺失`);
  }
  try {
    return Buffer.from(normalized, 'base64url');
  } catch {
    throw new TypeError(`${fieldName} 格式无效`);
  }
};

/**
 * 按业务域从 SESSION_SECRET 派生密钥。消息和联系方式永远使用不同域，
 * 即便密文或数据库记录被误复用，也不能跨域解密。
 */
export const deriveRecruitmentKey = (sessionSecret, domain = 'messages') => {
  const normalizedDomain = String(domain || '').trim();
  if (!normalizedDomain || !/^[a-z0-9:_-]+$/i.test(normalizedDomain)) {
    throw new TypeError('加密域无效');
  }
  return crypto
    .createHmac('sha256', toSecretBuffer(sessionSecret))
    .update(`${KEY_NAMESPACE}:${normalizedDomain}:v${CRYPTO_VERSION}`, 'utf8')
    .digest()
    .subarray(0, KEY_LENGTH);
};

export const encryptRecruitmentValue = (value, {
  sessionSecret,
  key,
  domain = 'messages',
} = {}) => {
  const plaintext = Buffer.isBuffer(value)
    ? Buffer.from(value)
    : Buffer.from(String(value ?? ''), 'utf8');
  const encryptionKey = key ? Buffer.from(key) : deriveRecruitmentKey(sessionSecret, domain);
  if (encryptionKey.length !== KEY_LENGTH) {
    throw new TypeError('加密密钥长度无效');
  }
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    ciphertext: encode(ciphertext),
    iv: encode(iv),
    authTag: encode(cipher.getAuthTag()),
    cryptoVersion: CRYPTO_VERSION,
  };
};

export const decryptRecruitmentValue = (payload, {
  sessionSecret,
  key,
  domain = 'messages',
} = {}) => {
  if (Number(payload?.cryptoVersion || payload?.crypto_version || CRYPTO_VERSION) !== CRYPTO_VERSION) {
    throw new TypeError('不支持的加密版本');
  }
  const encryptionKey = key ? Buffer.from(key) : deriveRecruitmentKey(sessionSecret, domain);
  if (encryptionKey.length !== KEY_LENGTH) {
    throw new TypeError('解密密钥长度无效');
  }
  const iv = decode(payload?.iv, 'iv');
  const authTag = decode(payload?.authTag ?? payload?.auth_tag, 'authTag');
  const ciphertext = decode(payload?.ciphertext, 'ciphertext');
  if (iv.length !== IV_LENGTH || authTag.length !== 16) {
    throw new TypeError('加密参数长度无效');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
};

export const createRecruitmentCrypto = ({ sessionSecret } = {}) => {
  // 在构造时校验密钥，避免请求处理中才发现配置错误。
  const messageKey = deriveRecruitmentKey(sessionSecret, 'messages');
  const contactKey = deriveRecruitmentKey(sessionSecret, 'contacts');

  const encryptMessage = (value) => encryptRecruitmentValue(value, { key: messageKey, domain: 'messages' });
  const decryptMessage = (payload) => decryptRecruitmentValue(payload, { key: messageKey, domain: 'messages' }).toString('utf8');
  const encryptContact = (value) => encryptRecruitmentValue(value, { key: contactKey, domain: 'contacts' });
  const decryptContact = (payload) => decryptRecruitmentValue(payload, { key: contactKey, domain: 'contacts' }).toString('utf8');

  return {
    version: CRYPTO_VERSION,
    encryptMessage,
    decryptMessage,
    encryptContact,
    decryptContact,
  };
};

export default createRecruitmentCrypto;
