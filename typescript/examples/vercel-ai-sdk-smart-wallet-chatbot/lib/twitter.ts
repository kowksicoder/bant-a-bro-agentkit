import { TwitterApi, type TwitterApiTokens } from "twitter-api-v2";

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

/**
 * Check whether all required Twitter credentials are present.
 *
 * @returns True when all Twitter credentials are configured
 */
export function hasTwitterCredentials(): boolean {
  return Boolean(
    process.env.TWITTER_API_KEY &&
      process.env.TWITTER_API_SECRET &&
      process.env.TWITTER_ACCESS_TOKEN &&
      process.env.TWITTER_ACCESS_TOKEN_SECRET,
  );
}

/**
 * Validate that all Twitter credentials are set.
 *
 * @throws Error if any Twitter credential is missing
 */
export function validateTwitterEnvironment(): void {
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

  const response = await getClient().v2.tweet(trimmedText);
  return response.data;
}

/**
 * Get mentions for the authenticated Twitter account.
 *
 * @returns Account details and recent mentions
 */
export async function getMentions(): Promise<MentionsResult> {
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

  const response = await getClient().v2.tweet(trimmedText, {
    reply: { in_reply_to_tweet_id: trimmedTweetId },
  });

  return response.data;
}

/**
 * Get the authenticated Twitter account details.
 *
 * @returns Authenticated account metadata
 */
async function getAuthenticatedAccount(): Promise<TwitterAccount> {
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
