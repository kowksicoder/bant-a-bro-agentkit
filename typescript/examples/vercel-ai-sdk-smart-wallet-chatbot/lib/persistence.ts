import * as fs from "fs";
import * as path from "path";
import { DatabaseSync } from "node:sqlite";

type JsonRecord = Record<string, unknown>;

export type StoredWalletData = {
  smartAccountName?: string;
  smartWalletAddress: string;
  ownerAddress: string;
};

export type SocialChannel = "twitter" | "telegram" | "discord";

export type SocialIdentityLink = {
  channel: SocialChannel;
  externalUserId: string;
  externalUsername?: string | null;
  bantahUserId: string;
  bantahUsername?: string | null;
  walletAddress?: string | null;
  metadata?: JsonRecord | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentAuditEvent = {
  channel: string;
  eventType: string;
  bantahUserId?: string | null;
  externalUserId?: string | null;
  externalUsername?: string | null;
  status?: string | null;
  detail?: string | null;
  metadata?: JsonRecord | null;
};

let database: DatabaseSync | null = null;

function getEnv(name: string): string {
  return String(process.env[name] || "").trim();
}

function resolveDatabasePath(): string {
  const configuredPath = getEnv("BANTABRO_DB_PATH");
  if (!configuredPath) {
    if (getEnv("VERCEL") === "1") {
      return path.resolve("/tmp", "bantabro.sqlite");
    }
    return path.resolve(process.cwd(), "data", "bantabro.sqlite");
  }

  if (path.isAbsolute(configuredPath)) {
    return configuredPath;
  }

  return path.resolve(process.cwd(), configuredPath);
}

function getDatabase(): DatabaseSync {
  if (database) {
    return database;
  }

  const databasePath = resolveDatabasePath();
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });

  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_state (
      state_key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS twitter_processed_mentions (
      tweet_id TEXT PRIMARY KEY,
      author_id TEXT,
      author_username TEXT,
      reply_tweet_id TEXT,
      status TEXT NOT NULL,
      processed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS social_identity_links (
      channel TEXT NOT NULL,
      external_user_id TEXT NOT NULL,
      external_username TEXT,
      external_username_normalized TEXT,
      bantah_user_id TEXT NOT NULL,
      bantah_username TEXT,
      wallet_address TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (channel, external_user_id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_social_identity_links_username
      ON social_identity_links(channel, external_username_normalized)
      WHERE external_username_normalized IS NOT NULL;

    CREATE TABLE IF NOT EXISTS agent_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT NOT NULL,
      event_type TEXT NOT NULL,
      bantah_user_id TEXT,
      external_user_id TEXT,
      external_username TEXT,
      status TEXT,
      detail TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    );
  `);

  database = db;
  return db;
}

function parseJson<T>(value: string | null | undefined): T | null {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeUsername(username?: string | null): string | null {
  const trimmed = String(username || "").trim().replace(/^@+/, "");
  return trimmed ? trimmed.toLowerCase() : null;
}

export function getPersistencePath(): string {
  return resolveDatabasePath();
}

export function getStoredSmartWallet(networkId: string): StoredWalletData | null {
  const db = getDatabase();
  const row = db
    .prepare("SELECT value_json FROM app_state WHERE state_key = ?")
    .get(`smart_wallet:${networkId}`) as { value_json?: string } | undefined;

  return parseJson<StoredWalletData>(row?.value_json);
}

export function saveStoredSmartWallet(networkId: string, value: StoredWalletData): void {
  const db = getDatabase();
  db.prepare(`
      INSERT INTO app_state (state_key, value_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(state_key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `).run(`smart_wallet:${networkId}`, JSON.stringify(value), nowIso());
}

export function hasProcessedTwitterMention(tweetId: string): boolean {
  const db = getDatabase();
  const row = db
    .prepare("SELECT tweet_id FROM twitter_processed_mentions WHERE tweet_id = ?")
    .get(String(tweetId || "").trim()) as { tweet_id?: string } | undefined;

  return Boolean(row?.tweet_id);
}

export function markTwitterMentionProcessed(input: {
  tweetId: string;
  authorId?: string | null;
  authorUsername?: string | null;
  replyTweetId?: string | null;
  status?: string;
}): void {
  const db = getDatabase();
  db.prepare(`
      INSERT INTO twitter_processed_mentions (
        tweet_id,
        author_id,
        author_username,
        reply_tweet_id,
        status,
        processed_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(tweet_id) DO UPDATE SET
        author_id = excluded.author_id,
        author_username = excluded.author_username,
        reply_tweet_id = excluded.reply_tweet_id,
        status = excluded.status,
        processed_at = excluded.processed_at
    `).run(
    String(input.tweetId || "").trim(),
    String(input.authorId || "").trim() || null,
    String(input.authorUsername || "").trim() || null,
    String(input.replyTweetId || "").trim() || null,
    String(input.status || "processed").trim(),
    nowIso(),
  );
}

export function upsertSocialIdentityLink(input: {
  channel: SocialChannel;
  externalUserId: string;
  externalUsername?: string | null;
  bantahUserId: string;
  bantahUsername?: string | null;
  walletAddress?: string | null;
  metadata?: JsonRecord | null;
}): SocialIdentityLink {
  const db = getDatabase();
  const timestamp = nowIso();

  db.prepare(`
      INSERT INTO social_identity_links (
        channel,
        external_user_id,
        external_username,
        external_username_normalized,
        bantah_user_id,
        bantah_username,
        wallet_address,
        metadata_json,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(channel, external_user_id) DO UPDATE SET
        external_username = excluded.external_username,
        external_username_normalized = excluded.external_username_normalized,
        bantah_user_id = excluded.bantah_user_id,
        bantah_username = excluded.bantah_username,
        wallet_address = excluded.wallet_address,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `).run(
    input.channel,
    String(input.externalUserId || "").trim(),
    String(input.externalUsername || "").trim() || null,
    normalizeUsername(input.externalUsername),
    String(input.bantahUserId || "").trim(),
    String(input.bantahUsername || "").trim() || null,
    String(input.walletAddress || "").trim() || null,
    input.metadata ? JSON.stringify(input.metadata) : null,
    timestamp,
    timestamp,
  );

  const link = getSocialIdentityLinkByExternalUser(input.channel, input.externalUserId);
  if (!link) {
    throw new Error("Failed to persist social identity link.");
  }

  return link;
}

export function getSocialIdentityLinkByExternalUser(
  channel: SocialChannel,
  externalUserId: string,
): SocialIdentityLink | null {
  const db = getDatabase();
  const row = db
    .prepare(`
        SELECT
          channel,
          external_user_id,
          external_username,
          bantah_user_id,
          bantah_username,
          wallet_address,
          metadata_json,
          created_at,
          updated_at
        FROM social_identity_links
        WHERE channel = ? AND external_user_id = ?
      `)
    .get(channel, String(externalUserId || "").trim()) as
    | {
        channel: SocialChannel;
        external_user_id: string;
        external_username?: string | null;
        bantah_user_id: string;
        bantah_username?: string | null;
        wallet_address?: string | null;
        metadata_json?: string | null;
        created_at: string;
        updated_at: string;
      }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    channel: row.channel,
    externalUserId: row.external_user_id,
    externalUsername: row.external_username || null,
    bantahUserId: row.bantah_user_id,
    bantahUsername: row.bantah_username || null,
    walletAddress: row.wallet_address || null,
    metadata: parseJson<JsonRecord>(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getSocialIdentityLinkByUsername(
  channel: SocialChannel,
  externalUsername?: string | null,
): SocialIdentityLink | null {
  const normalized = normalizeUsername(externalUsername);
  if (!normalized) {
    return null;
  }

  const db = getDatabase();
  const row = db
    .prepare(`
        SELECT
          channel,
          external_user_id,
          external_username,
          bantah_user_id,
          bantah_username,
          wallet_address,
          metadata_json,
          created_at,
          updated_at
        FROM social_identity_links
        WHERE channel = ? AND external_username_normalized = ?
      `)
    .get(channel, normalized) as
    | {
        channel: SocialChannel;
        external_user_id: string;
        external_username?: string | null;
        bantah_user_id: string;
        bantah_username?: string | null;
        wallet_address?: string | null;
        metadata_json?: string | null;
        created_at: string;
        updated_at: string;
      }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    channel: row.channel,
    externalUserId: row.external_user_id,
    externalUsername: row.external_username || null,
    bantahUserId: row.bantah_user_id,
    bantahUsername: row.bantah_username || null,
    walletAddress: row.wallet_address || null,
    metadata: parseJson<JsonRecord>(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listSocialIdentityLinksForBantahUser(
  channel: SocialChannel,
  bantahUserId: string,
): SocialIdentityLink[] {
  const db = getDatabase();
  const rows = db
    .prepare(`
        SELECT
          channel,
          external_user_id,
          external_username,
          bantah_user_id,
          bantah_username,
          wallet_address,
          metadata_json,
          created_at,
          updated_at
        FROM social_identity_links
        WHERE channel = ? AND bantah_user_id = ?
        ORDER BY updated_at DESC
      `)
    .all(channel, String(bantahUserId || "").trim()) as Array<{
      channel: SocialChannel;
      external_user_id: string;
      external_username?: string | null;
      bantah_user_id: string;
      bantah_username?: string | null;
      wallet_address?: string | null;
      metadata_json?: string | null;
      created_at: string;
      updated_at: string;
    }>;

  return rows.map(row => ({
    channel: row.channel,
    externalUserId: row.external_user_id,
    externalUsername: row.external_username || null,
    bantahUserId: row.bantah_user_id,
    bantahUsername: row.bantah_username || null,
    walletAddress: row.wallet_address || null,
    metadata: parseJson<JsonRecord>(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function logAgentAuditEvent(event: AgentAuditEvent): void {
  const db = getDatabase();
  db.prepare(`
      INSERT INTO agent_audit_log (
        channel,
        event_type,
        bantah_user_id,
        external_user_id,
        external_username,
        status,
        detail,
        metadata_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
    String(event.channel || "unknown").trim(),
    String(event.eventType || "unknown").trim(),
    String(event.bantahUserId || "").trim() || null,
    String(event.externalUserId || "").trim() || null,
    String(event.externalUsername || "").trim() || null,
    String(event.status || "").trim() || null,
    String(event.detail || "").trim() || null,
    event.metadata ? JSON.stringify(event.metadata) : null,
    nowIso(),
  );
}
