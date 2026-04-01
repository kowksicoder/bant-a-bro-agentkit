import { TwitterApi, type TwitterApiTokens } from "twitter-api-v2";

type TwitterProvider = "x_v2" | "twitterapi_io";

export type TwitterAccount = {
  id: string;
  name: string;
  username: string;
  url: string;
};

export type TwitterMention = {
  id: string;
  text: string;
  authorId?: string;
  authorUsername?: string;
  authorName?: string;
  conversationId?: string;
  createdAt?: string;
  referencedTweets?: Array<{
    id?: string;
    type?: string;
  }>;
};

export type MentionsResult = {
  account: TwitterAccount;
  mentions: TwitterMention[];
};

type MentionTimelineResponse = {
  tweets?: Array<Record<string, unknown>>;
  includes?: {
    users?: Array<Record<string, unknown>>;
  };
  data?: {
    data?: Array<Record<string, unknown>>;
    meta?: Record<string, unknown>;
    includes?: {
      users?: Array<Record<string, unknown>>;
    };
  };
  _realData?: {
    data?: Array<Record<string, unknown>>;
    meta?: Record<string, unknown>;
    includes?: {
      users?: Array<Record<string, unknown>>;
    };
  };
};

let twitterClient: TwitterApi | null = null;

function getTwitterProvider(): TwitterProvider {
  const configured = String(process.env.TWITTER_PROVIDER || "").trim().toLowerCase();
  if (configured === "twitterapi_io") {
    return "twitterapi_io";
  }
  if (configured === "x_v2" || configured === "twitter" || configured === "twitter_api_v2") {
    return "x_v2";
  }

  if (hasTwitterApiV2Credentials()) {
    return "x_v2";
  }

  if (getTwitterApiIoKey()) {
    return "twitterapi_io";
  }

  return "x_v2";
}

function hasTwitterApiV2Credentials(): boolean {
  return Boolean(
    process.env.TWITTER_API_KEY &&
      process.env.TWITTER_API_SECRET &&
      process.env.TWITTER_ACCESS_TOKEN &&
      process.env.TWITTER_ACCESS_TOKEN_SECRET,
  );
}

function getTwitterApiIoKey(): string {
  return String(process.env.TWITTERAPI_IO_KEY || "").trim();
}

function getTwitterApiIoBaseUrl(): string {
  return String(process.env.TWITTERAPI_IO_BASE_URL || "https://api.twitterapi.io").trim();
}

function getTwitterApiIoUsername(): string {
  return String(process.env.TWITTERAPI_IO_USERNAME || "").trim();
}

function getTwitterApiIoLoginCookies(): string {
  return String(process.env.TWITTERAPI_IO_LOGIN_COOKIES || "").trim();
}

function getTwitterApiIoProxy(): string {
  return String(process.env.TWITTERAPI_IO_PROXY || "").trim();
}

async function twitterApiIoRequest<T>(
  path: string,
  options: { method?: string; query?: Record<string, string | number | undefined>; body?: unknown } = {},
): Promise<T> {
  const apiKey = getTwitterApiIoKey();
  if (!apiKey) {
    throw new Error("TWITTERAPI_IO_KEY must be configured for TwitterAPI.io usage.");
  }

  const url = new URL(path, getTwitterApiIoBaseUrl());
  if (options.query) {
    Object.entries(options.query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });
  }

  const response = await (globalThis as any).fetch(url, {
    method: options.method || "GET",
    headers: {
      "x-api-key": apiKey,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(
      payload?.msg ||
        payload?.message ||
        `TwitterAPI.io request failed with status ${response.status}`,
    );
  }

  if (payload && typeof payload.status === "string" && payload.status !== "success") {
    throw new Error(payload.msg || payload.message || "TwitterAPI.io request failed.");
  }

  return payload as T;
}

/**
 * Check whether all required Twitter credentials are present.
 *
 * @returns True when all Twitter credentials are configured
 */
export function hasTwitterCredentials(): boolean {
  const provider = getTwitterProvider();
  if (provider === "twitterapi_io") {
    return Boolean(getTwitterApiIoKey() && getTwitterApiIoUsername());
  }

  return hasTwitterApiV2Credentials();
}

/**
 * Validate that all Twitter credentials are set.
 *
 * @throws Error if any Twitter credential is missing
 */
export function validateTwitterEnvironment(options: { requireWrite?: boolean } = {}): void {
  const provider = getTwitterProvider();

  if (provider === "twitterapi_io") {
    const missingVars = ["TWITTERAPI_IO_KEY", "TWITTERAPI_IO_USERNAME"].filter(
      varName => !process.env[varName],
    );

    if (options.requireWrite) {
      ["TWITTERAPI_IO_LOGIN_COOKIES", "TWITTERAPI_IO_PROXY"].forEach(varName => {
        if (!process.env[varName]) {
          missingVars.push(varName);
        }
      });
    }

    if (missingVars.length > 0) {
      throw new Error(
        `Missing required TwitterAPI.io environment variables: ${missingVars.join(", ")}`,
      );
    }

    return;
  }

  const missingVars = [
    "TWITTER_API_KEY",
    "TWITTER_API_SECRET",
    "TWITTER_ACCESS_TOKEN",
    "TWITTER_ACCESS_TOKEN_SECRET",
  ].filter(varName => !process.env[varName]);

  if (missingVars.length > 0) {
    throw new Error(`Missing required Twitter environment variables: ${missingVars.join(", ")}`);
  }
}

/**
 * Post a new tweet.
 *
 * @param text - Tweet content
 * @returns The Twitter API response payload
 */
export async function postTweet(text: string) {
  const trimmedText = text.trim();
  if (!trimmedText) {
    throw new Error("Tweet text is required.");
  }

  if (trimmedText.length > 280) {
    throw new Error("Tweet text must be 280 characters or fewer.");
  }

  if (getTwitterProvider() === "twitterapi_io") {
    const loginCookies = getTwitterApiIoLoginCookies();
    const proxy = getTwitterApiIoProxy();
    if (!loginCookies || !proxy) {
      throw new Error(
        "TwitterAPI.io posting requires TWITTERAPI_IO_LOGIN_COOKIES and TWITTERAPI_IO_PROXY.",
      );
    }

    const response = await twitterApiIoRequest<Record<string, unknown>>(
      "/twitter/create_tweet_v2",
      {
        method: "POST",
        body: {
          login_cookies: loginCookies,
          tweet_text: trimmedText,
          proxy,
        },
      },
    );
    return response;
  }

  const response = await getClient().v2.tweet(trimmedText);
  return response.data;
}

/**
 * Get mentions for the authenticated Twitter account.
 *
 * @returns Account details and recent mentions
 */
export async function getMentions(): Promise<MentionsResult> {
  if (getTwitterProvider() === "twitterapi_io") {
    const account = await getAuthenticatedAccount();
    const response = await twitterApiIoRequest<{
      tweets?: Array<Record<string, unknown>>;
    }>("/twitter/user/mentions", {
      query: {
        userName: account.username,
      },
    });

    const rawMentions = response.tweets ?? [];
    const mentions = rawMentions.map(rawMention => {
      const author = rawMention.author as Record<string, unknown> | undefined;
      return {
        id: String(rawMention.id ?? ""),
        text: String(rawMention.text ?? ""),
        authorId: author?.id !== undefined ? String(author.id) : undefined,
        authorUsername: author?.userName !== undefined ? String(author.userName) : undefined,
        authorName: author?.name !== undefined ? String(author.name) : undefined,
        conversationId:
          rawMention.conversationId !== undefined ? String(rawMention.conversationId) : undefined,
        createdAt: rawMention.createdAt !== undefined ? String(rawMention.createdAt) : undefined,
      };
    });

    return { account, mentions };
  }

  const account = await getAuthenticatedAccount();
  const response = (await getClient().v2.userMentionTimeline(account.id, {
    max_results: 10,
    expansions: ["author_id"],
    "tweet.fields": ["author_id", "conversation_id", "created_at", "referenced_tweets"],
    "user.fields": ["username", "name"],
  })) as unknown as MentionTimelineResponse;

  const rawMentions = response.tweets ?? response.data?.data ?? response._realData?.data ?? [];
  const rawUsers =
    response.includes?.users ??
    response.data?.includes?.users ??
    response._realData?.includes?.users ??
    [];
  const usersById = new Map(
    rawUsers.map(rawUser => [
      String(rawUser.id ?? ""),
      {
        username: rawUser.username !== undefined ? String(rawUser.username) : undefined,
        name: rawUser.name !== undefined ? String(rawUser.name) : undefined,
      },
    ]),
  );

  const mentions = rawMentions.map(rawMention => ({
    id: String(rawMention.id ?? ""),
    text: String(rawMention.text ?? ""),
    authorId: rawMention.author_id !== undefined ? String(rawMention.author_id) : undefined,
    authorUsername: rawMention.author_id !== undefined
      ? usersById.get(String(rawMention.author_id))?.username
      : undefined,
    authorName: rawMention.author_id !== undefined
      ? usersById.get(String(rawMention.author_id))?.name
      : undefined,
    conversationId:
      rawMention.conversation_id !== undefined ? String(rawMention.conversation_id) : undefined,
    createdAt: rawMention.created_at !== undefined ? String(rawMention.created_at) : undefined,
    referencedTweets: Array.isArray(rawMention.referenced_tweets)
      ? (rawMention.referenced_tweets as Array<{ id?: string; type?: string }>)
      : undefined,
  }));

  return { account, mentions };
}

/**
 * Reply to an existing tweet.
 *
 * @param tweetId - Tweet ID to reply to
 * @param text - Reply content
 * @returns The Twitter API response payload
 */
export async function replyToTweet(tweetId: string, text: string) {
  const trimmedTweetId = tweetId.trim();
  const trimmedText = text.trim();

  if (!trimmedTweetId) {
    throw new Error("Tweet ID is required.");
  }

  if (!trimmedText) {
    throw new Error("Reply text is required.");
  }

  if (trimmedText.length > 280) {
    throw new Error("Reply text must be 280 characters or fewer.");
  }

  if (getTwitterProvider() === "twitterapi_io") {
    const loginCookies = getTwitterApiIoLoginCookies();
    const proxy = getTwitterApiIoProxy();
    if (!loginCookies || !proxy) {
      throw new Error(
        "TwitterAPI.io replies require TWITTERAPI_IO_LOGIN_COOKIES and TWITTERAPI_IO_PROXY.",
      );
    }

    const response = await twitterApiIoRequest<Record<string, unknown>>(
      "/twitter/create_tweet_v2",
      {
        method: "POST",
        body: {
          login_cookies: loginCookies,
          tweet_text: trimmedText,
          reply_to_tweet_id: trimmedTweetId,
          proxy,
        },
      },
    );

    return response;
  }

  const response = await getClient().v2.tweet(trimmedText, {
    reply: { in_reply_to_tweet_id: trimmedTweetId },
  });

  return response.data;
}

export async function likeTweet(tweetId: string) {
  const trimmedTweetId = tweetId.trim();
  if (!trimmedTweetId) {
    throw new Error("Tweet ID is required.");
  }

  if (getTwitterProvider() === "twitterapi_io") {
    const loginCookies = getTwitterApiIoLoginCookies();
    const proxy = getTwitterApiIoProxy();
    if (!loginCookies || !proxy) {
      throw new Error(
        "TwitterAPI.io likes require TWITTERAPI_IO_LOGIN_COOKIES and TWITTERAPI_IO_PROXY.",
      );
    }

    const response = await twitterApiIoRequest<Record<string, unknown>>(
      "/twitter/like_tweet_v2",
      {
        method: "POST",
        body: {
          login_cookies: loginCookies,
          tweet_id: trimmedTweetId,
          proxy,
        },
      },
    );
    return response;
  }

  const account = await getAuthenticatedAccount();
  const response = await getClient().v2.like(account.id, trimmedTweetId);
  return response.data;
}

export async function retweetTweet(tweetId: string) {
  const trimmedTweetId = tweetId.trim();
  if (!trimmedTweetId) {
    throw new Error("Tweet ID is required.");
  }

  if (getTwitterProvider() === "twitterapi_io") {
    const loginCookies = getTwitterApiIoLoginCookies();
    const proxy = getTwitterApiIoProxy();
    if (!loginCookies || !proxy) {
      throw new Error(
        "TwitterAPI.io retweets require TWITTERAPI_IO_LOGIN_COOKIES and TWITTERAPI_IO_PROXY.",
      );
    }

    const response = await twitterApiIoRequest<Record<string, unknown>>(
      "/twitter/retweet_tweet_v2",
      {
        method: "POST",
        body: {
          login_cookies: loginCookies,
          tweet_id: trimmedTweetId,
          proxy,
        },
      },
    );
    return response;
  }

  const account = await getAuthenticatedAccount();
  const response = await getClient().v2.retweet(account.id, trimmedTweetId);
  return response.data;
}

/**
 * Get the authenticated Twitter account details.
 *
 * @returns Authenticated account metadata
 */
async function getAuthenticatedAccount(): Promise<TwitterAccount> {
  if (getTwitterProvider() === "twitterapi_io") {
    const username = getTwitterApiIoUsername();
    if (!username) {
      throw new Error("TWITTERAPI_IO_USERNAME must be configured for TwitterAPI.io usage.");
    }

    const response = await twitterApiIoRequest<{
      data?: {
        id?: string;
        name?: string;
        userName?: string;
        url?: string;
      };
    }>("/twitter/user/info", {
      query: { userName: username },
    });

    const data = response.data;
    if (!data || !data.id || !data.userName) {
      throw new Error("TwitterAPI.io did not return valid account data.");
    }

    return {
      id: String(data.id),
      name: String(data.name || data.userName),
      username: String(data.userName),
      url: String(data.url || `https://x.com/${data.userName}`),
    };
  }

  const response = await getClient().v2.me();
  return {
    id: response.data.id,
    name: response.data.name,
    username: response.data.username,
    url: `https://x.com/${response.data.username}`,
  };
}

/**
 * Lazily initialize and return the Twitter API client.
 *
 * @returns Configured Twitter API client
 */
function getClient(): TwitterApi {
  validateTwitterEnvironment();

  if (!twitterClient) {
    const tokens: TwitterApiTokens = {
      appKey: process.env.TWITTER_API_KEY!,
      appSecret: process.env.TWITTER_API_SECRET!,
      accessToken: process.env.TWITTER_ACCESS_TOKEN!,
      accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET!,
    };

    twitterClient = new TwitterApi(tokens);
  }

  return twitterClient;
}
