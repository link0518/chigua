const normalizeHash = (value) => String(value || '').trim();

const uniqueHashes = (values) => {
  const seen = new Set();
  const result = [];
  const append = (value) => {
    if (Array.isArray(value)) {
      value.forEach(append);
      return;
    }
    const normalized = normalizeHash(value);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    result.push(normalized);
  };
  append(values);
  return result;
};

const collectCandidateValues = (value) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return [
      value.canonicalHash,
      value.legacyFingerprintHash,
      value.effectiveHash,
      ...(Array.isArray(value.lookupHashes) ? value.lookupHashes : []),
    ];
  }
  return Array.isArray(value) ? value : [value];
};

export const resolveBanIdentityCandidates = (value, resolveStoredIdentityHash) => {
  const canonicalHashes = [];
  const legacyFingerprintHashes = [];

  uniqueHashes(collectCandidateValues(value)).forEach((rawHash) => {
    const resolved = typeof resolveStoredIdentityHash === 'function'
      ? resolveStoredIdentityHash(rawHash)
      : null;
    const normalizedRawHash = normalizeHash(rawHash);
    const normalizedIdentityKey = normalizeHash(resolved?.identityKey);

    if (resolved?.type === 'identity' && normalizedIdentityKey) {
      canonicalHashes.push(normalizedIdentityKey);
      if (normalizedRawHash && normalizedRawHash !== normalizedIdentityKey) {
        legacyFingerprintHashes.push(normalizedRawHash);
      }
      return;
    }

    legacyFingerprintHashes.push(normalizedIdentityKey || normalizedRawHash);
  });

  return {
    canonicalHashes: uniqueHashes(canonicalHashes),
    legacyFingerprintHashes: uniqueHashes(legacyFingerprintHashes),
  };
};

export const resolveBanStorageHashes = ({
  value,
  banType,
  fallbackHash = '',
  resolveStoredIdentityHash,
}) => {
  const candidates = resolveBanIdentityCandidates(value, resolveStoredIdentityHash);
  if (banType === 'identity') {
    return candidates.canonicalHashes.length
      ? candidates.canonicalHashes
      : uniqueHashes(fallbackHash);
  }
  return candidates.legacyFingerprintHashes.length
    ? candidates.legacyFingerprintHashes
    : uniqueHashes(fallbackHash);
};
