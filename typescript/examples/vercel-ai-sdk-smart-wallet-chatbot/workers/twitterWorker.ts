import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { generateText } from "ai";
import { createExampleAgent, formatToolOutput } from "../lib/agent";
import { buildTwitterWorkerSkillsPrompt } from "../lib/skills";
import {
  getMentions,
  replyToTweet,
  validateTwitterEnvironment,
  type TwitterMention,
} from "../lib/twitter";

dotenv.config();

const POLL_INTERVAL_MS = 15_000;
const STATE_FILE = path.resolve(__dirname, "..", "twitter_worker_state.json");

type WorkerState = {
  processedTweetIds: string[];
};

/**
 * Load processed mention IDs from disk.
 *
 * @returns Set of processed mention IDs
 */
function loadState(): Set<string> {
  if (!fs.existsSync(STATE_FILE)) {
    return new Set<string>();
  }

  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as WorkerState;
    return new Set(state.processedTweetIds ?? []);
  } catch (error) {
    console.error("Failed to read worker state, starting with empty memory:", error);
    return new Set<string>();
  }
}

/**
 * Persist processed mention IDs to disk.
 *
 * @param processedTweetIds - Mention IDs that have already been handled
 */
function saveState(processedTweetIds: Set<string>): void {
  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify({ processedTweetIds: [...processedTweetIds] }, null, 2),
  );
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

/**
 * Generate a draft reply for a mention using the shared agent.
 *
 * @param agent - Shared agent configuration
 * @param mention - Mention that needs a reply
 * @returns Draft reply text
 */
async function generateReply(
  agent: Awaited<ReturnType<typeof createExampleAgent>>,
  mention: TwitterMention,
) {
  const result = await generateText({
    model: agent.model,
    system: `${agent.system}
You are generating a reply to a Twitter mention for a background worker.
Return only the reply text that should be posted. Do not wrap it in quotes.
Do not mention tool names. Do not say that you are an AI assistant.
Do not call Twitter posting tools yourself; the worker will send the reply after you draft it.
${buildTwitterWorkerSkillsPrompt()}`,
    tools: agent.walletTools,
    stopWhen: agent.stopWhen,
    messages: [
      {
        role: "user",
        content: `Draft a concise reply to this mention. Mention ID: ${mention.id}\nMention text: ${mention.text}`,
      },
    ],
    onStepFinish: async ({ toolResults }) => {
      for (const tr of toolResults) {
        console.log(`Tool ${tr.toolName}: ${formatToolOutput(tr.output)}`);
      }
    },
  });

  return result.text.trim();
}

/**
 * Poll mentions continuously and reply to newly seen mentions.
 *
 * @returns Promise that runs until the worker exits
 */
async function processMentions() {
  validateTwitterEnvironment();

  const agent = await createExampleAgent();
  const processedTweetIds = loadState();

  console.log("Twitter worker started. Polling every 15 seconds.");

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const { account, mentions } = await getMentions();
      const newMentions = sortMentionsOldestFirst(
        mentions.filter(mention => mention.id && !processedTweetIds.has(mention.id)),
      );

      if (newMentions.length > 0) {
        console.log(`Found ${newMentions.length} new mention(s) for @${account.username}.`);
      }

      for (const mention of newMentions) {
        console.log(`New mention ${mention.id}: ${mention.text}`);

        try {
          const replyText = await generateReply(agent, mention);
          if (!replyText) {
            throw new Error("Generated reply was empty.");
          }

          const replyResult = await replyToTweet(mention.id, replyText);
          processedTweetIds.add(mention.id);
          saveState(processedTweetIds);

          console.log(`Reply sent for mention ${mention.id}: ${formatToolOutput(replyResult)}`);
        } catch (error) {
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
  processMentions().catch(error => {
    console.error("Fatal worker error:", error);
    process.exit(1);
  });
}
