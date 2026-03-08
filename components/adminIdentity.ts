export type AdminIdentityLike = {
  identityKey?: string | null;
  identityHashes?: string[] | null;
  fingerprint?: string | null;
  fingerprintHash?: string | null;
  sessionId?: string | null;
  ip?: string | null;
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

export const getAdminIdentityPrimary = (identity: AdminIdentityLike) => (
  normalizeString(identity.identityKey)
  || normalizeString(identity.fingerprintHash)
  || normalizeString(identity.fingerprint)
  || normalizeString(identity.sessionId)
  || normalizeString(identity.ip)
  || '-'
);

export const getAdminIdentityAliases = (identity: AdminIdentityLike) => {
  const primary = getAdminIdentityPrimary(identity);
  return normalizeAdminIdentityHashes(
    identity.identityHashes,
    identity.fingerprintHash,
    identity.fingerprint
  ).filter((item) => item !== primary);
};

export const formatAdminIdentityInline = (identity: AdminIdentityLike) => {
  const primary = getAdminIdentityPrimary(identity);
  const aliases = getAdminIdentityAliases(identity);
  const parts = [`主身份: ${primary}`];
  if (identity.ip) {
    parts.push(`IP: ${identity.ip}`);
  }
  if (identity.sessionId) {
    parts.push(`会话: ${identity.sessionId}`);
  }
  if (aliases.length) {
    parts.push(`关联: ${aliases.join(' / ')}`);
  }
  return parts.join(' · ');
};

export const getAdminIdentitySearchValues = (identity: AdminIdentityLike) => (
  normalizeAdminIdentityHashes(
    identity.identityKey,
    identity.identityHashes,
    identity.fingerprintHash,
    identity.fingerprint,
    identity.sessionId,
    identity.ip
  )
);
