export type AdminIdentityLike = {
  identityKey?: string | null;
  identityHashes?: string[] | null;
  fingerprint?: string | null;
  fingerprintHash?: string | null;
  sessionId?: string | null;
  ip?: string | null;
};

export type AdminIdentityFieldType = 'identity' | 'fingerprint' | 'ip' | 'session';
export type AdminIdentityBanTargetType = Exclude<AdminIdentityFieldType, 'session'>;

export type AdminIdentityField = {
  type: AdminIdentityFieldType;
  label: string;
  value: string;
};

const normalizeString = (value: unknown) => String(value || '').trim();

export const normalizeAdminIdentityHashes = (...inputs: unknown[]): string[] => {
  const result: string[] = [];
  const seen = new Set<string>();

  const append = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(append);
      return;
    }
    const normalized = normalizeString(value);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    result.push(normalized);
  };

  inputs.forEach(append);
  return result;
};

export const getAdminIdentityKey = (identity?: AdminIdentityLike | null) => (
  normalizeString(identity?.identityKey)
);

export const getAdminFingerprint = (identity?: AdminIdentityLike | null) => (
  normalizeString(identity?.fingerprintHash) || normalizeString(identity?.fingerprint)
);

export const getAdminIdentityPrimaryType = (identity?: AdminIdentityLike | null): AdminIdentityFieldType => {
  if (getAdminIdentityKey(identity)) {
    return 'identity';
  }
  if (getAdminFingerprint(identity)) {
    return 'fingerprint';
  }
  if (normalizeString(identity?.ip)) {
    return 'ip';
  }
  return 'session';
};

export const getAdminIdentityTypeLabel = (type: AdminIdentityFieldType) => {
  switch (type) {
    case 'identity':
      return '新身份';
    case 'fingerprint':
      return '指纹';
    case 'ip':
      return 'IP';
    case 'session':
      return '会话';
    default:
      return '标识';
  }
};

export const getAdminIdentityFields = (
  identity?: AdminIdentityLike | null,
  options: {
    includeIp?: boolean;
    includeSession?: boolean;
  } = {}
): AdminIdentityField[] => {
  const fields: AdminIdentityField[] = [];
  const identityKey = getAdminIdentityKey(identity);
  const fingerprint = getAdminFingerprint(identity);
  const ip = normalizeString(identity?.ip);
  const sessionId = normalizeString(identity?.sessionId);

  if (identityKey) {
    fields.push({ type: 'identity', label: '新身份', value: identityKey });
  }
  if (fingerprint && fingerprint !== identityKey) {
    fields.push({ type: 'fingerprint', label: '指纹', value: fingerprint });
  }
  if (options.includeIp !== false && ip) {
    fields.push({ type: 'ip', label: 'IP', value: ip });
  }
  if (options.includeSession !== false && sessionId) {
    fields.push({ type: 'session', label: '会话', value: sessionId });
  }

  return fields;
};

export const getAdminIdentityPrimary = (identity: AdminIdentityLike) => (
  getAdminIdentityFields(identity)[0]?.value || '-'
);

export const getAdminIdentityAliases = (identity: AdminIdentityLike) => {
  const identityKey = getAdminIdentityKey(identity);
  const fingerprint = getAdminFingerprint(identity);
  return normalizeAdminIdentityHashes(identity.identityHashes).filter((item) => (
    item !== identityKey && item !== fingerprint
  ));
};

export const getAdminIdentityBanTargets = (identity?: AdminIdentityLike | null) => (
  getAdminIdentityFields(identity).filter((field) => field.type !== 'session') as Array<AdminIdentityField & {
    type: AdminIdentityBanTargetType;
  }>
);

export const formatAdminIdentityInline = (identity: AdminIdentityLike) => {
  const fields = getAdminIdentityFields(identity);
  if (!fields.length) {
    return '-';
  }

  const parts = fields.map((field) => `${field.label}: ${field.value}`);
  const aliases = getAdminIdentityAliases(identity);
  if (aliases.length) {
    parts.push(`附加哈希: ${aliases.join(' / ')}`);
  }
  return parts.join(' · ');
};

export const getAdminIdentitySearchValues = (identity: AdminIdentityLike) => (
  normalizeAdminIdentityHashes(
    getAdminIdentityFields(identity).map((field) => field.value),
    identity.identityHashes
  )
);
