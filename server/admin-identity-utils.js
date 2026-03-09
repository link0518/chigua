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
  resolveStoredIdentityHash,
  getLookupHashesForIdentityHash,
  getStableLegacyFingerprintHashForIdentityHashes,
}) => {
  const normalizedFingerprint = normalizeString(fingerprint);
  const normalizedIdentityHash = normalizeString(identityHash);
  const normalizedSessionId = normalizeString(sessionId);
  const normalizedIp = normalizeString(ip);
  const baseIdentityHash = normalizedIdentityHash || normalizedFingerprint || '';
  const resolvedIdentity = typeof resolveStoredIdentityHash === 'function'
    ? resolveStoredIdentityHash(baseIdentityHash)
    : null;
  const resolvedHashes = resolvedIdentity?.identityHashes?.length
    ? resolvedIdentity.identityHashes
    : (typeof getLookupHashesForIdentityHash === 'function' && baseIdentityHash
      ? getLookupHashesForIdentityHash(baseIdentityHash)
      : []);
  const mergedHashes = normalizeIdentityHashes(resolvedHashes, identityHashes, normalizedIdentityHash, normalizedFingerprint);
  const resolvedFingerprint = normalizeString(
    resolvedIdentity?.legacyFingerprintHash
    || (typeof getStableLegacyFingerprintHashForIdentityHashes === 'function'
      ? getStableLegacyFingerprintHashForIdentityHashes(mergedHashes)
      : '')
    || (resolvedIdentity?.type === 'fingerprint' ? resolvedIdentity.identityKey : '')
    || normalizedFingerprint
  );
  const stableIdentityKey = normalizeString(resolvedIdentity?.identityKey || mergedHashes[0] || baseIdentityHash);
  const identityType = normalizeString(
    resolvedIdentity?.type
    || (stableIdentityKey
      ? (resolvedFingerprint && stableIdentityKey === resolvedFingerprint ? 'fingerprint' : 'identity')
      : '')
  );

  return {
    identityKey: stableIdentityKey || resolvedFingerprint || null,
    identityHashes: mergedHashes,
    fingerprint: resolvedFingerprint || normalizedFingerprint || null,
    sessionId: normalizedSessionId || null,
    ip: normalizedIp || null,
    identityType: identityType || null,
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
