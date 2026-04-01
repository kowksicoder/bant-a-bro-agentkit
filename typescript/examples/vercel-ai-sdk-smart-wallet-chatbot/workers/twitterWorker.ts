import * as dotenv from "dotenv";
import { createServer } from "http";
import { generateText } from "ai";
import { createExampleAgent, formatToolOutput, type ExampleAgent } from "../lib/agent";
import {
  getBantahKnowledgeFallbackReply,
  isLikelyModelAvailabilityError,
} from "../lib/bantahKnowledgeFallback";
import { buildTwitterWorkerSkillsPrompt, getBantABroWebUrl } from "../lib/skills";
import {
  getSocialIdentityLinkByExternalUser,
  getSocialIdentityLinkByUsername,
  hasProcessedTwitterMention,
  logAgentAuditEvent,
  markTwitterMentionProcessed,
  type SocialIdentityLink,
} from "../lib/persistence";
import {
  getMentions,
  replyToTweet,
  validateTwitterEnvironment,
  type TwitterMention,
} from "../lib/twitter";
import { stripBoldMarkers } from "../lib/formatting";

dotenv.config();

const POLL_INTERVAL_MS = Math.max(
  5_000,
  Number(process.env.TWITTER_POLL_INTERVAL_MS || "5000"),
);
const agentCache = new Map<string, Promise<ExampleAgent>>();

function startWorkerHealthServer() {
  const port = Number(process.env.PORT || "");
  if (!port) {
    return;
  }

  const server = createServer((_, res) => {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, service: "bantabro-worker" }));
  });

  server.listen(port, () => {
    console.log(`Worker health server ready at http://localhost:${port}`);
  });
}

async function getReplyAgent(bantahUserId?: string | null): Promise<ExampleAgent> {
  const cacheKey = String(bantahUserId || "").trim() || "public";
  if (!agentCache.has(cacheKey)) {
    const nextAgent = createExampleAgent(
      bantahUserId ? { bantahActingAsUserId: bantahUserId } : {},
    ).catch(error => {
      agentCache.delete(cacheKey);
      throw error;
    });
    agentCache.set(cacheKey, nextAgent);
  }

  return agentCache.get(cacheKey)!;
}

/**
 * Sort mentions so the worker replies oldest-first.
 *
 * @param mentions - Mentions to sort
 * @returns Sorted mentions
 */
function sortMentionsOldestFirst(mentions: TwitterMention[]): TwitterMention[] {
  return [...mentions].sort((left, right) => {
    if (left.createdAt && right.createdAt) {
      return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    }

    try {
      const leftId = BigInt(left.id);
      const rightId = BigInt(right.id);
      if (leftId < rightId) {
        return -1;
      }
      if (leftId > rightId) {
        return 1;
      }
      return 0;
    } catch {
      return left.id.localeCompare(right.id);
    }
  });
}

function resolveLinkedIdentity(mention: TwitterMention): SocialIdentityLink | null {
  if (mention.authorId) {
    const linkedByUserId = getSocialIdentityLinkByExternalUser("twitter", mention.authorId);
    if (linkedByUserId) {
      return linkedByUserId;
    }
  }

  if (mention.authorUsername) {
    const linkedByUsername = getSocialIdentityLinkByUsername("twitter", mention.authorUsername);
    if (linkedByUsername) {
      return linkedByUsername;
    }
  }

  return null;
}

/**
 * Generate a draft reply for a mention using the shared agent.
 *
 * @param agent - Shared agent configuration
 * @param mention - Mention that needs a reply
 * @param linkedIdentity - Linked Bantah identity when the author is known
 * @returns Draft reply text
 */
async function generateReply(
  agent: ExampleAgent,
  mention: TwitterMention,
  linkedIdentity: SocialIdentityLink | null,
) {
  const linkedContextPrompt = linkedIdentity
    ? `This mention author is linked to Bantah user ${linkedIdentity.bantahUserId}${linkedIdentity.bantahUsername ? ` (@${linkedIdentity.bantahUsername})` : ""}.
You may use protected Bantah tools for this linked user when the action is safe to perform from a mention and does not require a fresh wallet signature, escrow transaction hash, missing OTP, or missing sensitive confirmation.
If the action still needs wallet confirmation, tx hashes, or a fuller UI, redirect the user to ${getBantABroWebUrl()}.`
    : `This mention author is not linked to a Bantah account in the agent. Treat them as a public user only and redirect protected Bantah actions to ${getBantABroWebUrl()}.`;

  try {
    const result = await generateText({
      model: agent.model,
      system: `${agent.system}
You are generating a reply to a Twitter mention for a background worker.
Return only the reply text that should be posted. Do not wrap it in quotes.
Do not mention tool names. Do not say that you are an AI assistant.
Do not call Twitter posting tools yourself; the worker will send the reply after you draft it.
Do not imply that a protected Bantah or wallet action has already been completed from a public mention unless a tool actually confirmed it.
${buildTwitterWorkerSkillsPrompt({
  hasLinkedBantahUserContext: Boolean(linkedIdentity?.bantahUserId),
})}
${linkedContextPrompt}`,
    tools: agent.twitterReplyTools,
    stopWhen: agent.stopWhen,
    messages: [
      {
        role: "user",
        content: `Draft a concise reply to this mention.
Mention ID: ${mention.id}
Mention text: ${mention.text}
Mention author id: ${mention.authorId || "unknown"}
Mention author username: ${mention.authorUsername || "unknown"}`,
      },
    ],
    onStepFinish: async ({ toolResults }) => {
      for (const tr of toolResults) {
        console.log(`Tool ${tr.toolName}: ${formatToolOutput(tr.output)}`);
      }
    },
    });

    return result.text.trim();
  } catch (error) {
    if (isLikelyModelAvailabilityError(error)) {
      const fallback = getBantahKnowledgeFallbackReply(
        [{ role: "user", content: mention.text }],
        {
          bantahAuthenticated: Boolean(linkedIdentity?.bantahUserId),
          bantahUsername: linkedIdentity?.bantahUsername || null,
          channel: "twitter",
        },
      );
      if (fallback) {
        return fallback;
      }
    }

    throw error;
  }
}

/**
 * Poll mentions continuously and reply to newly seen mentions.
 *
 * @returns Promise that runs until the worker exits
 */
async function processMentions() {
  validateTwitterEnvironment({ requireWrite: true });

  const publicAgent = await getReplyAgent();

  console.log(`Twitter worker started. Polling every ${Math.round(POLL_INTERVAL_MS / 1000)} seconds.`);
  if (Object.keys(publicAgent.twitterReplyTools).length > 0) {
    console.log(
      "Twitter reply tools enabled. Public Bantah reads are available, and linked Bantah users can access protected Bantah tools when safe.",
    );
  } else {
    console.log("Twitter reply Bantah tools disabled. Public Bantah reads will not be available.");
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const { account, mentions } = await getMentions();
      const newMentions = sortMentionsOldestFirst(
        mentions.filter(mention => mention.id && !hasProcessedTwitterMention(mention.id)),
      );

      if (newMentions.length > 0) {
        console.log(`Found ${newMentions.length} new mention(s) for @${account.username}.`);
      }

      for (const mention of newMentions) {
        console.log(`New mention ${mention.id}: ${mention.text}`);
        const linkedIdentity = resolveLinkedIdentity(mention);

        if (linkedIdentity) {
          console.log(
            `Linked Bantah identity found for mention ${mention.id}: ${linkedIdentity.bantahUserId}`,
          );
        }

        try {
          const agent = await getReplyAgent(linkedIdentity?.bantahUserId);
          const replyText = stripBoldMarkers(
            await generateReply(agent, mention, linkedIdentity),
          );
          if (!replyText) {
            throw new Error("Generated reply was empty.");
          }

          const replyResult = await replyToTweet(mention.id, replyText);
          const replyTweetId =
            replyResult && typeof replyResult === "object" && "id" in replyResult
              ? String((replyResult as { id?: unknown }).id || "")
              : null;

          markTwitterMentionProcessed({
            tweetId: mention.id,
            authorId: mention.authorId || null,
            authorUsername: mention.authorUsername || null,
            replyTweetId,
          });
          logAgentAuditEvent({
            channel: "twitter",
            eventType: "mention_replied",
            bantahUserId: linkedIdentity?.bantahUserId || null,
            externalUserId: mention.authorId || null,
            externalUsername: mention.authorUsername || null,
            status: "processed",
            detail: `Mention ${mention.id} replied successfully.`,
            metadata: {
              mentionId: mention.id,
              conversationId: mention.conversationId || null,
              linkedBantahUserId: linkedIdentity?.bantahUserId || null,
            },
          });

          console.log(`Reply sent for mention ${mention.id}: ${formatToolOutput(replyResult)}`);
        } catch (error) {
          logAgentAuditEvent({
            channel: "twitter",
            eventType: "mention_reply_failed",
            bantahUserId: linkedIdentity?.bantahUserId || null,
            externalUserId: mention.authorId || null,
            externalUsername: mention.authorUsername || null,
            status: "failed",
            detail: error instanceof Error ? error.message : "Unknown Twitter worker failure",
            metadata: {
              mentionId: mention.id,
              conversationId: mention.conversationId || null,
            },
          });
          console.error(`Failed to process mention ${mention.id}:`, error);
        }
      }
    } catch (error) {
      console.error("Twitter worker error:", error);
    }

    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

if (require.main === module) {
  startWorkerHealthServer();
  processMentions().catch(error => {
    console.error("Fatal worker error:", error);
    process.exit(1);
  });
}
