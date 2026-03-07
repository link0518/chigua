import crypto from 'crypto';
import signature from 'cookie-signature';

const CLIENT_ID_COOKIE_NAME = 'gs_client_id_v2';
const CLIENT_ID_COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
const CLIENT_ID_HASH_NAMESPACE = 'client_id_v2';

const normalizeHashList = (value) => {
  const source = Array.isArray(value) ? value : [value];
  return Array.from(new Set(
    source
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  ));
};

const parseCookieHeader = (request, cookieLib) => {
  const header = String(request?.headers?.cookie || '').trim();
  if (!header) {
    return {};
  }
  try {
    return cookieLib.parse(header);
  } catch {
    return {};
  }
};

export const createIdentityService = ({
  db,
  cookie,
  sessionSecret,
  fingerprintSalt,
  fingerprintHeader,
}) => {
  const upsertIdentityAliasStmt = db.prepare(
    `
      INSERT INTO identity_aliases (
        canonical_hash,
        legacy_fingerprint_hash,
        source,
        first_seen_at,
        last_seen_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(canonical_hash, legacy_fingerprint_hash) DO UPDATE SET
        source = excluded.source,
        last_seen_at = excluded.last_seen_at
    `
  );
  const getAliasRowsByCanonicalStmt = db.prepare(
    `
      SELECT id, legacy_fingerprint_hash, first_seen_at
      FROM identity_aliases
      WHERE canonical_hash = ?
      ORDER BY last_seen_at DESC
    `
  );
  const getCanonicalRowsByLegacyStmt = db.prepare(
    `
      SELECT id, canonical_hash, first_seen_at
      FROM identity_aliases
      WHERE legacy_fingerprint_hash = ?
      ORDER BY last_seen_at DESC
    `
  );

  const readClientIdFromRequest = (request) => {
    const parsedCookies = parseCookieHeader(request, cookie);
    const rawValue = String(parsedCookies?.[CLIENT_ID_COOKIE_NAME] || '').trim();
    if (!rawValue.startsWith('s:')) {
      return '';
    }
    const unsigned = signature.unsign(rawValue.slice(2), sessionSecret);
    return typeof unsigned === 'string' ? unsigned.trim() : '';
  };

  const hashLegacyFingerprint = (value) => {
    const normalized = String(value || '').trim();
    if (!normalized) {
      return '';
    }
    return crypto.createHmac('sha256', fingerprintSalt).update(normalized).digest('hex');
  };

  const hashClientId = (value) => {
    const normalized = String(value || '').trim();
    if (!normalized) {
      return '';
    }
    return crypto.createHmac('sha256', fingerprintSalt)
      .update(`${CLIENT_ID_HASH_NAMESPACE}:${normalized}`)
      .digest('hex');
  };

  const getFingerprintValue = (request) => {
    const headerValue = request?.headers?.[fingerprintHeader];
    if (Array.isArray(headerValue) && headerValue.length) {
      const first = String(headerValue[0] || '').trim();
      if (first) {
        return first;
      }
    }
    if (typeof headerValue === 'string' && headerValue.trim()) {
      return headerValue.trim();
    }
    const bodyValue = request?.body?.fingerprint;
    if (typeof bodyValue === 'string' && bodyValue.trim()) {
      return bodyValue.trim();
    }
    return '';
  };

  const issueClientIdCookie = (response, clientId) => {
    if (!response || typeof response.cookie !== 'function') {
      return;
    }
    response.cookie(CLIENT_ID_COOKIE_NAME, `s:${signature.sign(clientId, sessionSecret)}`, {
      httpOnly: true,
      sameSite: 'lax',
      secure: String(process.env.NODE_ENV || '').trim() === 'production',
      path: '/',
      maxAge: CLIENT_ID_COOKIE_MAX_AGE_MS,
    });
  };

  const upsertIdentityAlias = (canonicalHash, legacyFingerprintHash, source = 'request') => {
    if (!canonicalHash || !legacyFingerprintHash) {
      return;
    }
    const now = Date.now();
    upsertIdentityAliasStmt.run(canonicalHash, legacyFingerprintHash, source, now, now);
  };

  const collectLinkedIdentityHashes = ({ canonicalHash = '', legacyFingerprintHash = '' } = {}) => {
    const canonicalQueue = [];
    const legacyQueue = [];
    const canonicalSet = new Set();
    const legacySet = new Set();

    const enqueueCanonical = (value) => {
      const normalized = String(value || '').trim();
      if (!normalized || canonicalSet.has(normalized)) {
        return;
      }
      canonicalSet.add(normalized);
      canonicalQueue.push(normalized);
    };

    const enqueueLegacy = (value) => {
      const normalized = String(value || '').trim();
      if (!normalized || legacySet.has(normalized)) {
        return;
      }
      legacySet.add(normalized);
      legacyQueue.push(normalized);
    };

    enqueueCanonical(canonicalHash);
    enqueueLegacy(legacyFingerprintHash);

    while (canonicalQueue.length || legacyQueue.length) {
      while (canonicalQueue.length) {
        const currentCanonicalHash = canonicalQueue.shift();
        const rows = getAliasRowsByCanonicalStmt.all(currentCanonicalHash);
        rows.forEach((row) => enqueueLegacy(row.legacy_fingerprint_hash));
      }

      while (legacyQueue.length) {
        const currentLegacyHash = legacyQueue.shift();
        const rows = getCanonicalRowsByLegacyStmt.all(currentLegacyHash);
        rows.forEach((row) => enqueueCanonical(row.canonical_hash));
      }
    }

    return normalizeHashList([
      ...canonicalSet,
      ...legacySet,
    ]);
  };

  const getLookupHashesForCanonicalHash = (canonicalHash, currentLegacyFingerprintHash = '') => {
    const normalizedCanonicalHash = String(canonicalHash || '').trim();
    const normalizedLegacyFingerprintHash = String(currentLegacyFingerprintHash || '').trim();
    if (!normalizedCanonicalHash && !normalizedLegacyFingerprintHash) {
      return [];
    }
    return collectLinkedIdentityHashes({
      canonicalHash: normalizedCanonicalHash,
      legacyFingerprintHash: normalizedLegacyFingerprintHash,
    });
  };

  const getLookupHashesForIdentityHash = (identityHash) => {
    const normalizedIdentityHash = String(identityHash || '').trim();
    if (!normalizedIdentityHash) {
      return [];
    }
    return collectLinkedIdentityHashes({
      canonicalHash: normalizedIdentityHash,
      legacyFingerprintHash: normalizedIdentityHash,
    });
  };

  const getPreferredFingerprintHashForCanonicalHash = (canonicalHash) => {
    const normalizedCanonicalHash = String(canonicalHash || '').trim();
    if (!normalizedCanonicalHash) {
      return '';
    }
    const directLegacyHash = getAliasRowsByCanonicalStmt
      .all(normalizedCanonicalHash)
      .map((row) => String(row.legacy_fingerprint_hash || '').trim())
      .find(Boolean);
    return directLegacyHash || normalizedCanonicalHash;
  };

  const getStableLegacyFingerprintHashForIdentityHashes = (identityHashes) => {
    const pendingCanonical = [];
    const pendingLegacy = [];
    const visitedCanonical = new Set();
    const visitedLegacy = new Set();
    const stableLegacyCandidates = new Map();

    const rememberLegacy = (legacyFingerprintHash, firstSeenAt, aliasId) => {
      const normalizedLegacyFingerprintHash = String(legacyFingerprintHash || '').trim();
      if (!normalizedLegacyFingerprintHash) {
        return;
      }
      const normalizedFirstSeenAt = Number(firstSeenAt);
      const normalizedAliasId = Number(aliasId);
      const nextCandidate = {
        firstSeenAt: Number.isFinite(normalizedFirstSeenAt) ? normalizedFirstSeenAt : Number.MAX_SAFE_INTEGER,
        aliasId: Number.isFinite(normalizedAliasId) ? normalizedAliasId : Number.MAX_SAFE_INTEGER,
      };
      const existingCandidate = stableLegacyCandidates.get(normalizedLegacyFingerprintHash);
      if (
        !existingCandidate
        || nextCandidate.firstSeenAt < existingCandidate.firstSeenAt
        || (
          nextCandidate.firstSeenAt === existingCandidate.firstSeenAt
          && nextCandidate.aliasId < existingCandidate.aliasId
        )
      ) {
        stableLegacyCandidates.set(normalizedLegacyFingerprintHash, nextCandidate);
      }
    };

    const enqueueCanonical = (value) => {
      const normalized = String(value || '').trim();
      if (!normalized || visitedCanonical.has(normalized)) {
        return;
      }
      visitedCanonical.add(normalized);
      pendingCanonical.push(normalized);
    };

    const enqueueLegacy = (value) => {
      const normalized = String(value || '').trim();
      if (!normalized || visitedLegacy.has(normalized)) {
        return;
      }
      visitedLegacy.add(normalized);
      pendingLegacy.push(normalized);
    };

    normalizeHashList(identityHashes).forEach((identityHash) => {
      enqueueCanonical(identityHash);
      enqueueLegacy(identityHash);
    });

    while (pendingCanonical.length || pendingLegacy.length) {
      while (pendingCanonical.length) {
        const canonicalHash = pendingCanonical.shift();
        const rows = getAliasRowsByCanonicalStmt.all(canonicalHash);
        rows.forEach((row) => {
          rememberLegacy(row.legacy_fingerprint_hash, row.first_seen_at, row.id);
          enqueueLegacy(row.legacy_fingerprint_hash);
        });
      }

      while (pendingLegacy.length) {
        const legacyFingerprintHash = pendingLegacy.shift();
        const rows = getCanonicalRowsByLegacyStmt.all(legacyFingerprintHash);
        rows.forEach((row) => {
          rememberLegacy(legacyFingerprintHash, row.first_seen_at, row.id);
          enqueueCanonical(row.canonical_hash);
        });
      }
    }

    return Array.from(stableLegacyCandidates.entries())
      .sort((left, right) => {
        if (left[1].firstSeenAt !== right[1].firstSeenAt) {
          return left[1].firstSeenAt - right[1].firstSeenAt;
        }
        if (left[1].aliasId !== right[1].aliasId) {
          return left[1].aliasId - right[1].aliasId;
        }
        return left[0].localeCompare(right[0]);
      })[0]?.[0] || '';
  };

  const getStableIdentityKeyFromContext = (context) => {
    const stableLegacyFingerprintHash = getStableLegacyFingerprintHashForIdentityHashes(context?.lookupHashes || []);
    return stableLegacyFingerprintHash
      || String(context?.canonicalHash || '').trim()
      || String(context?.legacyFingerprintHash || '').trim()
      || '';
  };

  const resolveRequestIdentity = (request, response, options = {}) => {
    if (request?.identityContext) {
      return request.identityContext;
    }

    const allowIssueCookie = options.allowIssueCookie !== false;
    let clientId = readClientIdFromRequest(request);
    let cookieIssued = false;

    if (!clientId && allowIssueCookie && response) {
      clientId = crypto.randomUUID();
      issueClientIdCookie(response, clientId);
      cookieIssued = true;
    }

    const legacyFingerprintRaw = getFingerprintValue(request);
    const legacyFingerprintHash = hashLegacyFingerprint(legacyFingerprintRaw);
    const canonicalHash = hashClientId(clientId);

    if (canonicalHash && legacyFingerprintHash) {
      upsertIdentityAlias(canonicalHash, legacyFingerprintHash);
    }

    const lookupHashes = canonicalHash
      ? getLookupHashesForCanonicalHash(canonicalHash, legacyFingerprintHash)
      : getLookupHashesForCanonicalHash('', legacyFingerprintHash);

    const context = {
      rawClientId: clientId,
      cookieIssued,
      canonicalHash,
      legacyFingerprintRaw,
      legacyFingerprintHash,
      effectiveHash: canonicalHash || legacyFingerprintHash || '',
      lookupHashes,
      source: canonicalHash ? 'cookie_v2' : legacyFingerprintHash ? 'legacy_fingerprint' : 'none',
    };

    if (request) {
      request.identityContext = context;
    }
    return context;
  };

  const ensureRequestIdentity = (request, response) => resolveRequestIdentity(request, response, { allowIssueCookie: true });

  const requireRequestIdentityHash = (request, response) => {
    const context = resolveRequestIdentity(request, response, { allowIssueCookie: true });
    if (context.effectiveHash) {
      return context.effectiveHash;
    }
    response.status(400).json({ error: '身份标识缺失，请刷新后重试' });
    return null;
  };

  const getOptionalRequestIdentityHash = (request, response) => (
    resolveRequestIdentity(request, response, { allowIssueCookie: true }).effectiveHash || ''
  );

  const getRequestIdentityLookupHashes = (request, response) => (
    resolveRequestIdentity(request, response, { allowIssueCookie: true }).lookupHashes.slice()
  );

  const getRequestStableIdentityKey = (request, response) => (
    getStableIdentityKeyFromContext(resolveRequestIdentity(request, response, { allowIssueCookie: true }))
  );

  const sharesIdentityHashes = (leftHash, rightHash) => {
    const left = String(leftHash || '').trim();
    const right = String(rightHash || '').trim();
    if (!left || !right) {
      return false;
    }
    if (left === right) {
      return true;
    }
    return getLookupHashesForIdentityHash(left).includes(right);
  };

  const resolveSocketIdentity = (request) => {
    const clientId = readClientIdFromRequest(request);
    const canonicalHash = hashClientId(clientId);
    const lookupHashes = getLookupHashesForCanonicalHash(canonicalHash);
    const preferredFingerprintHash = getPreferredFingerprintHashForCanonicalHash(canonicalHash);
    const stableIdentityHash = getStableIdentityKeyFromContext({
      canonicalHash,
      lookupHashes,
    });
    return {
      rawClientId: clientId,
      canonicalHash,
      preferredFingerprintHash,
      stableIdentityHash,
      lookupHashes,
      source: canonicalHash ? 'cookie_v2' : 'none',
    };
  };

  return {
    clientIdCookieName: CLIENT_ID_COOKIE_NAME,
    clientIdCookieMaxAgeMs: CLIENT_ID_COOKIE_MAX_AGE_MS,
    ensureRequestIdentity,
    requireRequestIdentityHash,
    getOptionalRequestIdentityHash,
    getRequestIdentityLookupHashes,
    getRequestStableIdentityKey,
    hashLegacyFingerprint,
    getFingerprintValue,
    upsertIdentityAlias,
    getLookupHashesForCanonicalHash,
    getLookupHashesForIdentityHash,
    getPreferredFingerprintHashForCanonicalHash,
    getStableLegacyFingerprintHashForIdentityHashes,
    sharesIdentityHashes,
    resolveSocketIdentity,
  };
};
