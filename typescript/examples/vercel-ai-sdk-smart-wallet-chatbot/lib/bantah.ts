import * as crypto from "crypto";

export type BantahTarget = "offchain" | "onchain";
export type BantahChallengeMode = "both" | "onchain_only";

export type BantahAvailability = {
  enabled: boolean;
  offchainEnabled: boolean;
  onchainEnabled: boolean;
  missingGlobalVars: string[];
};

export type BantahPublicAvailability = {
  enabled: boolean;
  offchainEnabled: boolean;
  onchainEnabled: boolean;
};

export type BantahCreateChallengeInput = {
  target?: BantahTarget;
  title: string;
  category: string;
  amount: number;
  description?: string;
  dueDate?: string;
  challenged?: string;
  challengedWalletAddress?: string;
  chainId?: number;
  tokenSymbol?: string;
};

export type BantahAcceptChallengeInput = {
  target?: BantahTarget;
  challengeId: number;
  escrowTxHash?: string;
};

export type BantahJoinChallengeInput = {
  target?: BantahTarget;
  challengeId: number;
  stake: "YES" | "NO";
  escrowTxHash?: string;
};

export type BantahChallengeProofInput = {
  target?: BantahTarget;
  challengeId: number;
  proofUri: string;
  proofHash: string;
};

export type BantahChallengeVoteInput = {
  target?: BantahTarget;
  challengeId: number;
  voteChoice: "challenger" | "challenged" | "creator" | "opponent";
  proofHash: string;
  signedVote: string;
};

export type BantahChallengeMessageInput = {
  target?: BantahTarget;
  challengeId: number;
  message: string;
  type?: string;
  evidence?: unknown;
};

export type BantahLeaderboardQuery = {
  target?: BantahTarget;
  limit?: number;
};

type AgentTokenPayload = {
  v: 1;
  sub: string;
  acting_as: string;
  scopes?: string[];
  aud?: string;
  iat: number;
  exp: number;
  nonce?: string;
};

const AGENT_TOKEN_PREFIX = "agt1";
const DEFAULT_AGENT_SERVICE_ID = "service:bantah-ai-agent";
const DEFAULT_OFFCHAIN_AUDIENCE = "bantah-offchain";
const DEFAULT_ONCHAIN_AUDIENCE = "bantah-onchain";
const DEFAULT_TOKEN_TTL_MS = 15 * 60 * 1000;
const DEFAULT_CHALLENGE_MODE: BantahChallengeMode = "onchain_only";
const MAX_AGENT_STRING_LENGTH = 500;
const MAX_AGENT_ARRAY_LENGTH = 25;
const MAX_AGENT_DEPTH = 6;

function toBase64Url(input: Buffer | string): string {
  const raw = Buffer.isBuffer(input)
    ? input.toString("base64")
    : Buffer.from(input).toString("base64");

  return raw.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function normalizeScopes(scopes?: string[]): string[] {
  return Array.from(
    new Set(
      (scopes || [])
        .map(scope => String(scope || "").trim())
        .filter(Boolean),
    ),
  );
}

function getEnv(name: string): string {
  return String(process.env[name] || "").trim();
}

function getOffchainBaseUrl(): string {
  return getEnv("BANTAH_OFFCHAIN_BASE_URL").replace(/\/+$/g, "");
}

function getOnchainBaseUrl(): string {
  return getEnv("BANTAH_ONCHAIN_BASE_URL").replace(/\/+$/g, "");
}

function getAgentTokenSecret(): string {
  return getEnv("BANTAH_AGENT_TOKEN_SECRET");
}

function getActingAsUserId(overrideUserId?: string): string {
  return String(overrideUserId || "").trim() || getEnv("BANTAH_ACTING_AS_USER_ID");
}

function getAgentServiceId(): string {
  return getEnv("BANTAH_AGENT_SERVICE_ID") || DEFAULT_AGENT_SERVICE_ID;
}

function getAudience(target: BantahTarget): string {
  if (target === "onchain") {
    return getEnv("BANTAH_ONCHAIN_AUDIENCE") || DEFAULT_ONCHAIN_AUDIENCE;
  }

  return getEnv("BANTAH_OFFCHAIN_AUDIENCE") || DEFAULT_OFFCHAIN_AUDIENCE;
}

function getTokenTtlMs(): number {
  const raw = Number.parseInt(getEnv("BANTAH_AGENT_TOKEN_TTL_MS"), 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TOKEN_TTL_MS;
}

function getBaseUrl(target: BantahTarget): string {
  const baseUrl = target === "onchain" ? getOnchainBaseUrl() : getOffchainBaseUrl();

  if (!baseUrl) {
    throw new Error(`Bantah ${target} base URL is not configured.`);
  }

  return baseUrl;
}

export function getBantahChallengeMode(): BantahChallengeMode {
  const raw = getEnv("BANTAH_CHALLENGE_MODE").toLowerCase();
  return raw === "both" ? "both" : DEFAULT_CHALLENGE_MODE;
}

function resolveTarget(
  requestedTarget?: BantahTarget,
  options: { preferOnchain?: boolean } = {},
): BantahTarget {
  if (requestedTarget) {
    return requestedTarget;
  }

  const offchainConfigured = Boolean(getOffchainBaseUrl());
  const onchainConfigured = Boolean(getOnchainBaseUrl());

  if (options.preferOnchain && onchainConfigured) {
    return "onchain";
  }

  if (offchainConfigured) {
    return "offchain";
  }

  if (onchainConfigured) {
    return "onchain";
  }

  return "offchain";
}

function resolveChallengeTarget(
  requestedTarget?: BantahTarget,
  options: { preferOnchain?: boolean } = {},
): BantahTarget {
  const challengeMode = getBantahChallengeMode();

  if (challengeMode === "onchain_only") {
    if (requestedTarget === "offchain") {
      throw new Error(
        "Offchain Bantah challenge flows are disabled in this build. Use the onchain flow from Bant-A-Bro for now.",
      );
    }

    return "onchain";
  }

  return resolveTarget(requestedTarget, options);
}

function signPayload(payloadEncoded: string, secret: string): string {
  const signature = crypto.createHmac("sha256", secret).update(payloadEncoded).digest();
  return toBase64Url(signature);
}

function sanitizeForAgent(value: unknown, depth = 0): unknown {
  if (value == null) {
    return value;
  }

  if (depth > MAX_AGENT_DEPTH) {
    return "[omitted]";
  }

  if (typeof value === "string") {
    if (value.startsWith("data:")) {
      return "[omitted data uri]";
    }

    return value.length > MAX_AGENT_STRING_LENGTH
      ? `${value.slice(0, MAX_AGENT_STRING_LENGTH)}…`
      : value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, MAX_AGENT_ARRAY_LENGTH).map(item => sanitizeForAgent(item, depth + 1));
  }

  if (typeof value === "object") {
    const sanitizedEntries = Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => {
      if (
        typeof entryValue === "string" &&
        entryValue.startsWith("data:") &&
        /image|avatar|photo/i.test(key)
      ) {
        return [key, null];
      }

      return [key, sanitizeForAgent(entryValue, depth + 1)];
    });

    return Object.fromEntries(sanitizedEntries);
  }

  return value;
}

function createDelegatedAgentToken(
  target: BantahTarget,
  scopes?: string[],
  actingAsUserIdOverride?: string,
): string {
  const secret = getAgentTokenSecret();
  const actingAsUserId = getActingAsUserId(actingAsUserIdOverride);

  if (!secret || !actingAsUserId) {
    throw new Error(
      "Bantah delegated auth is not configured. Set BANTAH_AGENT_TOKEN_SECRET and provide a Bantah acting user id.",
    );
  }

  const ttlMs = getTokenTtlMs();
  const nowMs = Date.now();
  const payload: AgentTokenPayload = {
    v: 1,
    sub: getAgentServiceId(),
    acting_as: actingAsUserId,
    scopes: normalizeScopes(scopes),
    aud: getAudience(target),
    iat: Math.floor(nowMs / 1000),
    exp: Math.floor((nowMs + ttlMs) / 1000),
    nonce: crypto.randomBytes(12).toString("hex"),
  };

  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = signPayload(encodedPayload, secret);
  return `${AGENT_TOKEN_PREFIX}.${encodedPayload}.${signature}`;
}

async function bantahFetch<T>(
  target: BantahTarget,
  routePath: string,
  options: {
    method?: string;
    body?: Record<string, unknown> | undefined;
    scopes?: string[];
    actingAsUserId?: string;
  } = {},
): Promise<T> {
  const baseUrl = getBaseUrl(target);
  const token = createDelegatedAgentToken(target, options.scopes, options.actingAsUserId);
  const response = await fetch(`${baseUrl}${routePath}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const raw = await response.text();
  const parsed = raw ? tryParseJson(raw) : null;

  if (!response.ok) {
    const message =
      getErrorMessage(parsed) ||
      response.statusText ||
      `Bantah ${target} request failed with status ${response.status}`;

    throw new Error(message);
  }

  return sanitizeForAgent(parsed ?? raw) as T;
}

async function bantahPublicFetch<T>(
  target: BantahTarget,
  routePath: string,
): Promise<T> {
  const baseUrl = getBaseUrl(target);
  const response = await fetch(`${baseUrl}${routePath}`, {
    method: "GET",
  });

  const raw = await response.text();
  const parsed = raw ? tryParseJson(raw) : null;

  if (!response.ok) {
    const message =
      getErrorMessage(parsed) ||
      response.statusText ||
      `Bantah ${target} public request failed with status ${response.status}`;

    throw new Error(message);
  }

  return sanitizeForAgent(parsed ?? raw) as T;
}

function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function getErrorMessage(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (value && typeof value === "object") {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }

    const error = (value as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) {
      return error.trim();
    }
  }

  return null;
}

function clampLeaderboardLimit(limit?: number): number | undefined {
  if (!Number.isFinite(limit)) {
    return undefined;
  }

  const normalized = Math.trunc(Number(limit));
  if (normalized <= 0) {
    return undefined;
  }

  return Math.min(normalized, 100);
}

function trimLeaderboardResult(result: unknown, limit?: number): unknown {
  const normalizedLimit = clampLeaderboardLimit(limit);
  if (!normalizedLimit) {
    return result;
  }

  if (Array.isArray(result)) {
    return result.slice(0, normalizedLimit);
  }

  return result;
}

export function getBantahAvailability(actingAsUserIdOverride?: string): BantahAvailability {
  const missingGlobalVars = [
    ["BANTAH_AGENT_TOKEN_SECRET", getAgentTokenSecret()],
    ["BANTAH_ACTING_AS_USER_ID", getActingAsUserId(actingAsUserIdOverride)],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  const offchainEnabled = Boolean(getOffchainBaseUrl());
  const onchainEnabled = Boolean(getOnchainBaseUrl());

  return {
    enabled:
      missingGlobalVars.length === 0 &&
      (getBantahChallengeMode() === "onchain_only" ? onchainEnabled : offchainEnabled || onchainEnabled),
    offchainEnabled,
    onchainEnabled,
    missingGlobalVars,
  };
}

export function getBantahPublicAvailability(): BantahPublicAvailability {
  const offchainEnabled = Boolean(getOffchainBaseUrl());
  const onchainEnabled = Boolean(getOnchainBaseUrl());
  const challengeMode = getBantahChallengeMode();

  return {
    enabled: challengeMode === "onchain_only" ? onchainEnabled : offchainEnabled || onchainEnabled,
    offchainEnabled,
    onchainEnabled,
  };
}

export async function listPublicBantahChallenges(options: {
  target?: BantahTarget;
  feed?: string;
} = {}): Promise<unknown> {
  const target = resolveChallengeTarget(options.target);
  const query = options.feed ? `?feed=${encodeURIComponent(options.feed)}` : "?feed=all";

  return bantahPublicFetch(target, `/api/challenges${query}`);
}

export async function getPublicBantahChallenge(options: {
  target?: BantahTarget;
  challengeId: number;
}): Promise<unknown> {
  const target = resolveChallengeTarget(options.target);

  return bantahPublicFetch(target, `/api/challenges/${options.challengeId}`);
}

export async function getPublicBantahLeaderboard(
  options: BantahLeaderboardQuery = {},
): Promise<unknown> {
  const target = resolveTarget(options.target, {
    preferOnchain: getBantahChallengeMode() === "onchain_only",
  });
  const leaderboard = await bantahPublicFetch(target, "/api/leaderboard");

  return trimLeaderboardResult(leaderboard, options.limit);
}

export async function getPublicBantahTopUser(
  options: Pick<BantahLeaderboardQuery, "target"> = {},
): Promise<unknown> {
  const leaderboard = await getPublicBantahLeaderboard({
    target: options.target,
    limit: 1,
  });

  if (Array.isArray(leaderboard)) {
    return leaderboard[0] ?? null;
  }

  return leaderboard;
}

export async function listBantahChallenges(options: {
  target?: BantahTarget;
  feed?: string;
  actingAsUserId?: string;
} = {}): Promise<unknown> {
  const target = resolveChallengeTarget(options.target);
  const query = options.feed ? `?feed=${encodeURIComponent(options.feed)}` : "";

  return bantahFetch(target, `/api/challenges${query}`, {
    scopes: ["challenges:read"],
    actingAsUserId: options.actingAsUserId,
  });
}

export async function getBantahChallenge(options: {
  target?: BantahTarget;
  challengeId: number;
  actingAsUserId?: string;
}): Promise<unknown> {
  const target = resolveChallengeTarget(options.target);

  return bantahFetch(target, `/api/challenges/${options.challengeId}`, {
    scopes: ["challenges:read"],
    actingAsUserId: options.actingAsUserId,
  });
}

export async function getBantahLeaderboard(
  options: BantahLeaderboardQuery & { actingAsUserId?: string } = {},
): Promise<unknown> {
  return getPublicBantahLeaderboard(options);
}

export async function getBantahTopUser(
  options: Pick<BantahLeaderboardQuery, "target"> & { actingAsUserId?: string } = {},
): Promise<unknown> {
  return getPublicBantahTopUser(options);
}

export async function createBantahChallenge(
  input: BantahCreateChallengeInput & { actingAsUserId?: string },
): Promise<unknown> {
  const target = resolveChallengeTarget(input.target, {
    preferOnchain: Boolean(input.chainId || input.tokenSymbol || input.challengedWalletAddress),
  });

  return bantahFetch(target, "/api/challenges", {
    method: "POST",
    scopes: ["challenges:write"],
    body: {
      title: input.title,
      category: input.category,
      amount: input.amount,
      description: input.description,
      dueDate: input.dueDate,
      challenged: input.challenged,
      challengedWalletAddress: input.challengedWalletAddress,
      chainId: input.chainId,
      tokenSymbol: input.tokenSymbol,
    },
    actingAsUserId: input.actingAsUserId,
  });
}

export async function acceptBantahChallenge(
  input: BantahAcceptChallengeInput & { actingAsUserId?: string },
): Promise<unknown> {
  const target = resolveChallengeTarget(input.target, {
    preferOnchain: Boolean(input.escrowTxHash),
  });

  return bantahFetch(target, `/api/challenges/${input.challengeId}/accept`, {
    method: "POST",
    scopes: ["challenges:write"],
    body: input.escrowTxHash ? { escrowTxHash: input.escrowTxHash } : {},
    actingAsUserId: input.actingAsUserId,
  });
}

export async function joinBantahChallenge(
  input: BantahJoinChallengeInput & { actingAsUserId?: string },
): Promise<unknown> {
  const target = resolveChallengeTarget(input.target, {
    preferOnchain: Boolean(input.escrowTxHash),
  });

  return bantahFetch(target, `/api/challenges/${input.challengeId}/join`, {
    method: "POST",
    scopes: ["challenges:write"],
    body: {
      stake: input.stake,
      ...(input.escrowTxHash ? { escrowTxHash: input.escrowTxHash } : {}),
    },
    actingAsUserId: input.actingAsUserId,
  });
}

export async function getBantahChallengeMessages(options: {
  target?: BantahTarget;
  challengeId: number;
  actingAsUserId?: string;
}): Promise<unknown> {
  const target = resolveChallengeTarget(options.target);

  return bantahFetch(target, `/api/challenges/${options.challengeId}/messages`, {
    scopes: ["challenges:read"],
    actingAsUserId: options.actingAsUserId,
  });
}

export async function postBantahChallengeMessage(
  input: BantahChallengeMessageInput & { actingAsUserId?: string },
): Promise<unknown> {
  const target = resolveChallengeTarget(input.target);

  return bantahFetch(target, `/api/challenges/${input.challengeId}/messages`, {
    method: "POST",
    scopes: ["messages:write"],
    body: {
      message: input.message,
      type: input.type || "text",
      evidence: input.evidence ?? null,
    },
    actingAsUserId: input.actingAsUserId,
  });
}

export async function getBantahChallengeProofs(options: {
  target?: BantahTarget;
  challengeId: number;
  actingAsUserId?: string;
}): Promise<unknown> {
  const target = resolveChallengeTarget(options.target);

  return bantahFetch(target, `/api/challenges/${options.challengeId}/proofs`, {
    scopes: ["challenges:read"],
    actingAsUserId: options.actingAsUserId,
  });
}

export async function submitBantahChallengeProof(
  input: BantahChallengeProofInput & { actingAsUserId?: string },
): Promise<unknown> {
  const target = resolveChallengeTarget(input.target);

  return bantahFetch(target, `/api/challenges/${input.challengeId}/proofs`, {
    method: "POST",
    scopes: ["challenges:write"],
    body: {
      proofUri: input.proofUri,
      proofHash: input.proofHash,
    },
    actingAsUserId: input.actingAsUserId,
  });
}

export async function voteOnBantahChallenge(
  input: BantahChallengeVoteInput & { actingAsUserId?: string },
): Promise<unknown> {
  const target = resolveChallengeTarget(input.target);

  return bantahFetch(target, `/api/challenges/${input.challengeId}/vote`, {
    method: "POST",
    scopes: ["challenges:write"],
    body: {
      voteChoice: input.voteChoice,
      proofHash: input.proofHash,
      signedVote: input.signedVote,
    },
    actingAsUserId: input.actingAsUserId,
  });
}

export async function getBantahOnchainWalletBalance(actingAsUserId?: string): Promise<unknown> {
  return bantahFetch("onchain", "/api/wallet/balance", {
    scopes: ["wallet:read"],
    actingAsUserId,
  });
}
