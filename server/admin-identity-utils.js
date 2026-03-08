const normalizeString = (value) => String(value || '').trim();

export const normalizeIdentityHashes = (...inputs) => {
  const result = [];
  const seen = new Set();

  const append = (value) => {
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

export const buildAdminIdentity = ({
  identityHash = '',
  identityHashes = [],
  fingerprint = '',
  sessionId = '',
  ip = '',
  getLookupHashesForIdentityHash,
  getStableLegacyFingerprintHashForIdentityHashes,
}) => {
  const baseHashes = normalizeIdentityHashes(identityHash, identityHashes, fingerprint);
  const linkedHashes = normalizeIdentityHashes(
    baseHashes.map((hash) => (
      typeof getLookupHashesForIdentityHash === 'function'
        ? getLookupHashesForIdentityHash(hash)
        : [hash]
    ))
  );
  const mergedHashes = normalizeIdentityHashes(baseHashes, linkedHashes);
  const stableIdentityKey = typeof getStableLegacyFingerprintHashForIdentityHashes === 'function'
    ? normalizeString(getStableLegacyFingerprintHashForIdentityHashes(mergedHashes))
    : '';
  const normalizedFingerprint = normalizeString(fingerprint);
  const normalizedSessionId = normalizeString(sessionId);
  const normalizedIp = normalizeString(ip);

  return {
    identityKey: stableIdentityKey || normalizedFingerprint || mergedHashes[0] || null,
    identityHashes: mergedHashes,
    fingerprint: normalizedFingerprint || null,
    sessionId: normalizedSessionId || null,
    ip: normalizedIp || null,
  };
};

export const buildAdminIdentitySearchValues = (identity) => {
  if (!identity) {
    return [];
  }
  return normalizeIdentityHashes(
    identity.identityKey,
    identity.identityHashes,
    identity.fingerprint,
    identity.sessionId,
    identity.ip
  );
};

export const matchesAdminSearch = (keyword, values = []) => {
  const normalizedKeyword = normalizeString(keyword).toLowerCase();
  if (!normalizedKeyword) {
    return true;
  }
  return values.some((value) => normalizeString(value).toLowerCase().includes(normalizedKeyword));
};
