import type { IncomingHttpHeaders } from "http";

export type BantahUserContext = {
  isAuthenticated: boolean;
  userId: string | null;
  username: string | null;
  walletAddress: string | null;
  source:
    | "trusted-header"
    | "auth-token"
    | "session-cookie"
    | "request-body"
    | "query-param"
    | "env-fallback"
    | "none";
};

type ResolveBantahUserContextOptions = {
  headers: IncomingHttpHeaders;
  queryBantahUserId?: string;
  bodyBantahUserId?: string;
};

type BantahProfileLike = {
  id?: unknown;
  username?: unknown;
  walletAddress?: unknown;
  primaryWalletAddress?: unknown;
  walletAddresses?: unknown;
};

const PROFILE_ROUTES = ["/api/profile", "/api/auth/user"];

function getEnv(name: string): string {
  return String(process.env[name] || "").trim();
}

function getHeaderValue(headers: IncomingHttpHeaders, name: string): string {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return String(value[0] || "").trim();
  }

  return typeof value === "string" ? value.trim() : "";
}

function normalizeWalletAddress(value: unknown): string | null {
  const trimmed = String(value || "").trim();
  return trimmed ? trimmed : null;
}

function extractWalletAddress(profile: BantahProfileLike): string | null {
  const directWallet =
    normalizeWalletAddress(profile.primaryWalletAddress) || normalizeWalletAddress(profile.walletAddress);
  if (directWallet) {
    return directWallet;
  }

  if (Array.isArray(profile.walletAddresses)) {
    for (const candidate of profile.walletAddresses) {
      const normalized = normalizeWalletAddress(candidate);
      if (normalized) {
        return normalized;
      }
    }
  }

  return null;
}

function toContext(
  profile: BantahProfileLike,
  source: BantahUserContext["source"],
): BantahUserContext | null {
  const userId = String(profile.id || "").trim();
  if (!userId) {
    return null;
  }

  return {
    isAuthenticated: true,
    userId,
    username: String(profile.username || "").trim() || null,
    walletAddress: extractWalletAddress(profile),
    source,
  };
}

function getTrustedHeaderContext(headers: IncomingHttpHeaders): BantahUserContext | null {
  const trustedSecret = getEnv("BANTAH_CONTEXT_HEADER_SECRET");
  if (!trustedSecret) {
    return null;
  }

  const providedSecret = getHeaderValue(headers, "x-bantah-context-secret");
  if (!providedSecret || providedSecret !== trustedSecret) {
    return null;
  }

  const userId = getHeaderValue(headers, "x-bantah-user-id");
  if (!userId) {
    return null;
  }

  return {
    isAuthenticated: true,
    userId,
    username: getHeaderValue(headers, "x-bantah-username") || null,
    walletAddress: getHeaderValue(headers, "x-bantah-wallet-address") || null,
    source: "trusted-header",
  };
}

function getForwardedAuthHeaders(headers: IncomingHttpHeaders): Record<string, string> | null {
  const authorization =
    getHeaderValue(headers, "authorization") || getHeaderValue(headers, "x-bantah-auth-token");
  const cookie = getHeaderValue(headers, "cookie");
  const outgoing: Record<string, string> = {
    Accept: "application/json",
  };

  if (authorization) {
    outgoing.Authorization = authorization.startsWith("Bearer ")
      ? authorization
      : `Bearer ${authorization}`;
  }

  if (cookie) {
    outgoing.Cookie = cookie;
  }

  return outgoing.Authorization || outgoing.Cookie ? outgoing : null;
}

function getBantahProfileTargets(): Array<{
  baseUrl: string;
  source: BantahUserContext["source"];
}> {
  const onchain = getEnv("BANTAH_ONCHAIN_BASE_URL").replace(/\/+$/g, "");
  const offchain = getEnv("BANTAH_OFFCHAIN_BASE_URL").replace(/\/+$/g, "");
  const targets: Array<{ baseUrl: string; source: BantahUserContext["source"] }> = [];

  if (onchain) {
    targets.push({ baseUrl: onchain, source: "auth-token" });
  }
  if (offchain) {
    targets.push({ baseUrl: offchain, source: "auth-token" });
  }

  return targets;
}

async function fetchProfileFromBantah(
  baseUrl: string,
  headers: Record<string, string>,
): Promise<BantahProfileLike | null> {
  for (const route of PROFILE_ROUTES) {
    try {
      const response = await fetch(`${baseUrl}${route}`, {
        method: "GET",
        headers,
      });

      if (!response.ok) {
        continue;
      }

      const raw = await response.text();
      if (!raw) {
        continue;
      }

      try {
        const parsed = JSON.parse(raw) as BantahProfileLike;
        if (parsed && typeof parsed === "object") {
          return parsed;
        }
      } catch {
        continue;
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function resolveContextFromBantahAuth(
  headers: IncomingHttpHeaders,
): Promise<BantahUserContext | null> {
  const authHeaders = getForwardedAuthHeaders(headers);
  if (!authHeaders) {
    return null;
  }

  const source = authHeaders.Authorization ? "auth-token" : "session-cookie";
  for (const target of getBantahProfileTargets()) {
    const profile = await fetchProfileFromBantah(target.baseUrl, authHeaders);
    const context = profile ? toContext(profile, source) : null;
    if (context) {
      return context;
    }
  }

  return null;
}

function allowDevelopmentFallback(): boolean {
  const configured = getEnv("BANTAH_ALLOW_DEV_CONTEXT_FALLBACK").toLowerCase();
  if (configured === "false" || configured === "0" || configured === "no") {
    return false;
  }
  if (configured === "true" || configured === "1" || configured === "yes") {
    return true;
  }

  return process.env.NODE_ENV !== "production";
}

function resolveDevelopmentFallback(
  options: Pick<ResolveBantahUserContextOptions, "queryBantahUserId" | "bodyBantahUserId">,
): BantahUserContext {
  const bodyUserId = String(options.bodyBantahUserId || "").trim();
  if (bodyUserId) {
    return {
      isAuthenticated: true,
      userId: bodyUserId,
      username: null,
      walletAddress: null,
      source: "request-body",
    };
  }

  const queryUserId = String(options.queryBantahUserId || "").trim();
  if (queryUserId) {
    return {
      isAuthenticated: true,
      userId: queryUserId,
      username: null,
      walletAddress: null,
      source: "query-param",
    };
  }

  const envUserId = getEnv("BANTAH_ACTING_AS_USER_ID");
  if (envUserId) {
    return {
      isAuthenticated: true,
      userId: envUserId,
      username: null,
      walletAddress: null,
      source: "env-fallback",
    };
  }

  return {
    isAuthenticated: false,
    userId: null,
    username: null,
    walletAddress: null,
    source: "none",
  };
}

export async function resolveBantahUserContext(
  options: ResolveBantahUserContextOptions,
): Promise<BantahUserContext> {
  const trustedHeaderContext = getTrustedHeaderContext(options.headers);
  if (trustedHeaderContext) {
    return trustedHeaderContext;
  }

  const bantahAuthContext = await resolveContextFromBantahAuth(options.headers);
  if (bantahAuthContext) {
    return bantahAuthContext;
  }

  if (allowDevelopmentFallback()) {
    return resolveDevelopmentFallback(options);
  }

  return {
    isAuthenticated: false,
    userId: null,
    username: null,
    walletAddress: null,
    source: "none",
  };
}
