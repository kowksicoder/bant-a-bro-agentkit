import {
  AgentKit,
  type Action,
  CdpSmartWalletProvider,
  cdpApiActionProvider,
  erc20ActionProvider,
  pythActionProvider,
  walletActionProvider,
} from "@coinbase/agentkit";
import { createOpenAI, openai } from "@ai-sdk/openai";
import { stepCountIs, tool, type ToolSet } from "ai";
import { z } from "zod";
import { type Address } from "viem";
import {
  AGENTIC_WALLET_ASSETS,
  AGENTIC_WALLET_CHAINS,
  AGENTIC_WALLET_SEND_CHAINS,
  fundAgenticWallet,
  getAgenticWalletAddress,
  getAgenticWalletBalance,
  getAgenticWalletStatus,
  loginAgenticWallet,
  sendAgenticWalletUsdc,
  showAgenticWallet,
  tradeAgenticWallet,
  verifyAgenticWallet,
} from "./agenticWallet";
import { getStoredSmartWallet, saveStoredSmartWallet } from "./persistence";
import {
  acceptBantahChallenge,
  createBantahChallenge,
  getBantahChallengeMessages,
  getBantahChallengeProofs,
  getBantahAvailability,
  getBantahChallenge,
  getBantahOnchainWalletBalance,
  getBantahPublicAvailability,
  getPublicBantahChallenge,
  joinBantahChallenge,
  listBantahChallenges,
  listPublicBantahChallenges,
  postBantahChallengeMessage,
  submitBantahChallengeProof,
  voteOnBantahChallenge,
} from "./bantah";
import { buildKnowledgePrompt } from "./knowledge";
import { buildSkillsPrompt } from "./skills";
import { getMentions, hasTwitterCredentials, postTweet, replyToTweet } from "./twitter";

type WalletData = {
  smartAccountName?: string;
  smartWalletAddress: Address;
  ownerAddress: Address;
};

export type ExampleMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type ExampleAgent = {
  model: ReturnType<typeof openai.chat>;
  system: string;
  stopWhen: ReturnType<typeof stepCountIs>;
  tools: ToolSet;
  twitterReplyTools: ToolSet;
  walletTools: ToolSet;
  agenticWalletTools: ToolSet;
  twitterEnabled: boolean;
  bantahEnabled: boolean;
};

export type ExampleAgentOptions = {
  bantahActingAsUserId?: string;
};

let exampleAgentPromise: Promise<ExampleAgent> | null = null;

function getOpenRouterApiKey(): string {
  return String(process.env.OPENROUTER_API_KEY || "").trim();
}

function getOpenAIApiKey(): string {
  return String(process.env.OPENAI_API_KEY || "").trim();
}

function getResolvedModelProvider():
  | { provider: "openrouter"; apiKey: string }
  | { provider: "openai"; apiKey: string }
  | null {
  const openRouterApiKey = getOpenRouterApiKey();
  if (openRouterApiKey) {
    return { provider: "openrouter", apiKey: openRouterApiKey };
  }

  const openAIApiKey = getOpenAIApiKey();
  if (!openAIApiKey) {
    return null;
  }

  if (openAIApiKey.startsWith("sk-or-")) {
    return { provider: "openrouter", apiKey: openAIApiKey };
  }

  return { provider: "openai", apiKey: openAIApiKey };
}

function hasModelCredentials(): boolean {
  return Boolean(getResolvedModelProvider());
}

function getConfiguredModel() {
  const providerConfig = getResolvedModelProvider();
  if (!providerConfig) {
    throw new Error("OPENROUTER_API_KEY or OPENAI_API_KEY must be configured.");
  }

  if (providerConfig.provider === "openrouter") {
    const provider = createOpenAI({
      apiKey: providerConfig.apiKey,
      baseURL: String(process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").trim(),
      headers: {
        "HTTP-Referer": String(
          process.env.OPENROUTER_HTTP_REFERER ||
            process.env.BANT_A_BRO_WEB_URL ||
            "https://onchain.bantah.fun",
        ).trim(),
        "X-Title": String(process.env.OPENROUTER_TITLE || "Bant-A-Bro").trim(),
      },
    });

    return provider.chat(
      String(process.env.OPENROUTER_MODEL || process.env.OPENAI_MODEL || "openai/gpt-4o-mini").trim(),
    );
  }

  return openai.chat(String(process.env.OPENAI_MODEL || "gpt-4o-mini").trim());
}

/**
 * Validate required environment variables for the base wallet chatbot.
 *
 * @throws Error if required environment variables are missing
 */
export function validateEnvironment(): void {
  const missingVars = ["CDP_API_KEY_ID", "CDP_API_KEY_SECRET"].filter(varName => !process.env[varName]);

  if (!hasModelCredentials()) {
    missingVars.unshift("OPENROUTER_API_KEY or OPENAI_API_KEY");
  }

  if (missingVars.length > 0) {
    throw new Error(`Required environment variables are not set: ${missingVars.join(", ")}`);
  }

  if (!process.env.NETWORK_ID) {
    console.warn("Warning: NETWORK_ID not set, defaulting to base-sepolia testnet");
  }
}

/**
 * Create the example agent configuration.
 *
 * @returns Agent configuration for the chatbot and worker
 */
export async function createExampleAgent(options: ExampleAgentOptions = {}): Promise<ExampleAgent> {
  const actingAsUserId = String(options.bantahActingAsUserId || "").trim();

  if (actingAsUserId) {
    return createExampleAgentInternal({ bantahActingAsUserId: actingAsUserId });
  }

  if (exampleAgentPromise) {
    return exampleAgentPromise;
  }

  exampleAgentPromise = createExampleAgentInternal({});

  try {
    return await exampleAgentPromise;
  } catch (error) {
    exampleAgentPromise = null;
    throw error;
  }
}

/**
 * Build the cached agent instance the first time it is requested.
 *
 * @returns Agent configuration for the chatbot, worker, and web UI
 */
async function createExampleAgentInternal(
  options: ExampleAgentOptions,
): Promise<ExampleAgent> {
  validateEnvironment();

  const networkId = process.env.NETWORK_ID || "base-sepolia";
  const actingAsUserId =
    String(options.bantahActingAsUserId || "").trim() ||
    String(process.env.BANTAH_ACTING_AS_USER_ID || "").trim();

  let smartAccountName: string | undefined;
  let smartWalletAddress: Address | undefined;
  let ownerAddress: Address | undefined;

  try {
    const walletData = getStoredSmartWallet(networkId) as WalletData | null;
    if (walletData) {
      smartAccountName = walletData.smartAccountName;
      smartWalletAddress = walletData.smartWalletAddress as Address;
      ownerAddress = walletData.ownerAddress as Address;
    }
  } catch (error) {
    console.error(`Error reading stored wallet data for ${networkId}:`, error);
  }

  const walletProvider = await CdpSmartWalletProvider.configureWithWallet({
    networkId,
    smartAccountName,
    address: smartWalletAddress,
    owner: ownerAddress,
  });

  const agentKit = await AgentKit.from({
    walletProvider,
    actionProviders: [
      cdpApiActionProvider(),
      erc20ActionProvider(),
      pythActionProvider(),
      walletActionProvider(),
    ],
  });

  const data = await walletProvider.exportWallet();
  saveStoredSmartWallet(networkId, {
    smartAccountName: data.name,
    smartWalletAddress: data.address,
    ownerAddress: data.ownerAddress,
  } as WalletData);

  const walletTools = getExampleVercelAITools(agentKit);
  const agenticWalletTools = createAgenticWalletTools();
  const twitterEnabled = hasTwitterCredentials();
  const bantahUserContextAvailable = Boolean(actingAsUserId);
  const bantahAvailability = getBantahAvailability(actingAsUserId || undefined);
  const bantahPublicAvailability = getBantahPublicAvailability();
  const bantahEnabled = bantahAvailability.enabled;
  const tools: ToolSet = {
    ...walletTools,
    ...agenticWalletTools,
    ...(bantahEnabled ? createBantahTools(actingAsUserId || undefined) : {}),
    ...(twitterEnabled ? createTwitterTools() : {}),
  };
  const twitterReplyTools: ToolSet = createTwitterReplyTools({
    bantahActingAsUserId: actingAsUserId || undefined,
    bantahEnabled,
    bantahPublicEnabled: bantahPublicAvailability.enabled,
  });

  if (!twitterEnabled) {
    console.warn(
      "Warning: Twitter credentials are not configured. Twitter tools will be disabled.",
    );
  }

  if (!bantahEnabled) {
    const missingGlobalVars = bantahAvailability.missingGlobalVars.join(", ");
    if (missingGlobalVars) {
      console.warn(
        `Warning: Bantah delegated auth is incomplete. Missing: ${missingGlobalVars}. Bantah tools will be disabled.`,
      );
    } else if (!bantahAvailability.offchainEnabled && !bantahAvailability.onchainEnabled) {
      console.warn(
        "Warning: Bantah base URLs are not configured. Bantah tools will be disabled.",
      );
    }
  }

  return {
    model: getConfiguredModel(),
    system: createSystemPrompt({
      canUseFaucet: walletProvider.getNetwork().networkId === "base-sepolia",
      twitterEnabled,
      bantahEnabled,
      bantahUserContextAvailable,
    }),
    stopWhen: stepCountIs(10),
    tools,
    twitterReplyTools,
    walletTools,
    agenticWalletTools,
    twitterEnabled,
    bantahEnabled,
  };
}

/**
 * Convert AgentKit actions into Vercel AI SDK tools locally for this example.
 *
 * @param agentKit - AgentKit instance with registered actions
 * @returns Tool set compatible with the AI SDK
 */
function getExampleVercelAITools(agentKit: AgentKit): ToolSet {
  const actions: Action[] = agentKit.getActions();

  return actions.reduce((acc, action) => {
    acc[action.name] = tool({
      description: action.description,
      inputSchema: action.schema,
      execute: async (args: z.output<typeof action.schema>) => {
        const result = await action.invoke(args);
        return result;
      },
    });

    return acc;
  }, {} as ToolSet);
}

/**
 * Format tool output for logs.
 *
 * @param output - Raw tool output
 * @returns Stringified representation
 */
export function formatToolOutput(output: unknown): string {
  if (typeof output === "string") {
    return output;
  }

  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

/**
 * Create the example-local Twitter tools exposed to the chatbot.
 *
 * @returns Twitter-specific AI SDK tools
 */
function createTwitterTools(): ToolSet {
  return {
    post_tweet: tool({
      description:
        "Post a new tweet to the authenticated Twitter (X) account. Use this when the user explicitly asks to publish a tweet.",
      inputSchema: z.object({
        text: z.string().min(1).max(280).describe("The tweet text to publish."),
      }),
      execute: async ({ text }) => ({
        success: true,
        action: "post_tweet",
        tweet: await postTweet(text),
      }),
    }),
    get_mentions: tool({
      description:
        "Fetch the latest mentions for the authenticated Twitter (X) account. Use this before replying to a recent mention or when the user asks to inspect mentions.",
      inputSchema: z.object({}),
      execute: async () => ({
        success: true,
        action: "get_mentions",
        result: await getMentions(),
      }),
    }),
    reply_to_tweet: tool({
      description:
        "Reply to an existing tweet by tweet ID. Use this after identifying the correct tweet to respond to.",
      inputSchema: z.object({
        tweetId: z.string().min(1).describe("The tweet ID to reply to."),
        text: z.string().min(1).max(280).describe("The reply text to post."),
      }),
      execute: async ({ tweetId, text }) => ({
        success: true,
        action: "reply_to_tweet",
        tweet: await replyToTweet(tweetId, text),
      }),
    }),
  };
}

/**
 * Create public-safe Bantah read tools for social replies.
 *
 * These are suitable for Twitter/X mentions because they do not rely on
 * delegated user auth and do not perform protected writes.
 *
 * @returns Bantah public-read tools for social reply generation
 */
function createTwitterBantahTools(): ToolSet {
  return {
    bantah_public_list_challenges: tool({
      description:
        "List public Bantah challenges for a public social reply. Use this for discovery questions such as what challenges are open.",
      inputSchema: z.object({
        target: z.enum(["offchain", "onchain"]).optional().describe("Which Bantah surface to query."),
        feed: z
          .string()
          .optional()
          .describe("Optional public feed selector. Defaults to all."),
      }),
      execute: async ({ target, feed }) => ({
        success: true,
        action: "bantah_public_list_challenges",
        result: await listPublicBantahChallenges({ target, feed }),
      }),
    }),
    bantah_public_get_challenge: tool({
      description:
        "Fetch public Bantah challenge details by id for a social reply.",
      inputSchema: z.object({
        target: z.enum(["offchain", "onchain"]).optional().describe("Which Bantah surface to query."),
        challengeId: z.number().int().positive().describe("The Bantah challenge id."),
      }),
      execute: async ({ target, challengeId }) => ({
        success: true,
        action: "bantah_public_get_challenge",
        result: await getPublicBantahChallenge({ target, challengeId }),
      }),
    }),
  };
}

function createTwitterReplyTools(options: {
  bantahActingAsUserId?: string;
  bantahEnabled: boolean;
  bantahPublicEnabled: boolean;
}): ToolSet {
  const tools: ToolSet = {};

  if (options.bantahPublicEnabled) {
    Object.assign(tools, createTwitterBantahTools());
  }

  if (options.bantahEnabled && options.bantahActingAsUserId) {
    Object.assign(tools, createBantahTools(options.bantahActingAsUserId));
  }

  return tools;
}

/**
 * Create Bantah tools backed by Bantah's offchain and onchain APIs.
 *
 * @returns Bantah-specific AI SDK tools
 */
function createBantahTools(actingAsUserId?: string): ToolSet {
  return {
    bantah_list_challenges: tool({
      description:
        "List Bantah challenges from the offchain or onchain feed. Use this when the user asks what challenges are open, active, or available.",
      inputSchema: z.object({
        target: z.enum(["offchain", "onchain"]).optional().describe("Which Bantah surface to query."),
        feed: z
          .string()
          .optional()
          .describe("Optional feed selector. Use 'all' for the global feed when needed."),
      }),
      execute: async ({ target, feed }) => ({
        success: true,
        action: "bantah_list_challenges",
        result: await listBantahChallenges({ target, feed, actingAsUserId }),
      }),
    }),
    bantah_get_challenge: tool({
      description:
        "Fetch a specific Bantah challenge by id from the offchain or onchain API.",
      inputSchema: z.object({
        target: z.enum(["offchain", "onchain"]).optional().describe("Which Bantah surface to query."),
        challengeId: z.number().int().positive().describe("The Bantah challenge id."),
      }),
      execute: async ({ target, challengeId }) => ({
        success: true,
        action: "bantah_get_challenge",
        result: await getBantahChallenge({ target, challengeId, actingAsUserId }),
      }),
    }),
    bantah_create_challenge: tool({
      description:
        "Create a Bantah challenge. Use the offchain target for standard challenge creation. Use the onchain target only when the request explicitly includes chain/token context.",
      inputSchema: z.object({
        target: z
          .enum(["offchain", "onchain"])
          .optional()
          .describe("Which Bantah surface to create the challenge on."),
        title: z.string().min(1).describe("Challenge title."),
        category: z.string().min(1).describe("Challenge category."),
        amount: z.number().int().positive().describe("Stake amount in Bantah units."),
        description: z.string().optional().describe("Optional challenge description."),
        dueDate: z.string().optional().describe("Optional ISO due date."),
        challenged: z
          .string()
          .optional()
          .describe("Optional Bantah user id for direct offchain challenges."),
        challengedWalletAddress: z
          .string()
          .optional()
          .describe("Optional wallet address for direct onchain challenges."),
        chainId: z.number().int().positive().optional().describe("Optional onchain chain id."),
        tokenSymbol: z
          .string()
          .optional()
          .describe("Optional onchain token symbol, for example USDC."),
      }),
      execute: async input => ({
        success: true,
        action: "bantah_create_challenge",
        result: await createBantahChallenge({ ...input, actingAsUserId }),
      }),
    }),
    bantah_accept_challenge: tool({
      description:
        "Accept a Bantah challenge. For onchain challenges, provide escrowTxHash when the user has already completed the wallet transaction.",
      inputSchema: z.object({
        target: z
          .enum(["offchain", "onchain"])
          .optional()
          .describe("Which Bantah surface the challenge belongs to."),
        challengeId: z.number().int().positive().describe("The Bantah challenge id."),
        escrowTxHash: z
          .string()
          .optional()
          .describe("Required for contract-backed onchain accept flows after the user signs."),
      }),
      execute: async ({ target, challengeId, escrowTxHash }) => ({
        success: true,
        action: "bantah_accept_challenge",
        result: await acceptBantahChallenge({
          target,
          challengeId,
          escrowTxHash,
          actingAsUserId,
        }),
        }),
      }),
    bantah_join_challenge: tool({
      description:
        "Join an admin-created Bantah YES/NO challenge. For onchain joins, provide escrowTxHash only after the user completes the wallet step.",
      inputSchema: z.object({
        target: z
          .enum(["offchain", "onchain"])
          .optional()
          .describe("Which Bantah surface the challenge belongs to."),
        challengeId: z.number().int().positive().describe("The Bantah challenge id."),
        stake: z.enum(["YES", "NO"]).describe("Which side to join."),
        escrowTxHash: z
          .string()
          .optional()
          .describe("Required for contract-backed onchain joins after the user signs."),
      }),
      execute: async ({ target, challengeId, stake, escrowTxHash }) => ({
        success: true,
        action: "bantah_join_challenge",
        result: await joinBantahChallenge({
          target,
          challengeId,
          stake,
          escrowTxHash,
          actingAsUserId,
        }),
      }),
    }),
    bantah_get_challenge_messages: tool({
      description:
        "Read Bantah challenge messages/comments for a specific challenge.",
      inputSchema: z.object({
        target: z.enum(["offchain", "onchain"]).optional().describe("Which Bantah surface to query."),
        challengeId: z.number().int().positive().describe("The Bantah challenge id."),
      }),
      execute: async ({ target, challengeId }) => ({
        success: true,
        action: "bantah_get_challenge_messages",
        result: await getBantahChallengeMessages({ target, challengeId, actingAsUserId }),
      }),
    }),
    bantah_post_challenge_message: tool({
      description:
        "Post a message or comment into a Bantah challenge thread.",
      inputSchema: z.object({
        target: z.enum(["offchain", "onchain"]).optional().describe("Which Bantah surface the challenge belongs to."),
        challengeId: z.number().int().positive().describe("The Bantah challenge id."),
        message: z.string().min(1).describe("The text message to post."),
        type: z.string().optional().describe("Optional message type. Defaults to text."),
        evidence: z.unknown().nullable().optional().describe("Optional evidence payload to attach."),
      }),
      execute: async ({ target, challengeId, message, type, evidence }) => ({
        success: true,
        action: "bantah_post_challenge_message",
        result: await postBantahChallengeMessage({
          target,
          challengeId,
          message,
          type,
          evidence,
          actingAsUserId,
        }),
      }),
    }),
    bantah_get_challenge_proofs: tool({
      description:
        "Read proof or evidence entries that have already been attached to a Bantah challenge.",
      inputSchema: z.object({
        target: z.enum(["offchain", "onchain"]).optional().describe("Which Bantah surface to query."),
        challengeId: z.number().int().positive().describe("The Bantah challenge id."),
      }),
      execute: async ({ target, challengeId }) => ({
        success: true,
        action: "bantah_get_challenge_proofs",
        result: await getBantahChallengeProofs({ target, challengeId, actingAsUserId }),
      }),
    }),
    bantah_submit_challenge_proof: tool({
      description:
        "Submit proof or evidence for a Bantah challenge.",
      inputSchema: z.object({
        target: z.enum(["offchain", "onchain"]).optional().describe("Which Bantah surface the challenge belongs to."),
        challengeId: z.number().int().positive().describe("The Bantah challenge id."),
        proofUri: z.string().min(1).describe("A URL or URI pointing to the proof."),
        proofHash: z.string().min(1).describe("The proof hash, for example sha256:..."),
      }),
      execute: async ({ target, challengeId, proofUri, proofHash }) => ({
        success: true,
        action: "bantah_submit_challenge_proof",
        result: await submitBantahChallengeProof({
          target,
          challengeId,
          proofUri,
          proofHash,
          actingAsUserId,
        }),
      }),
    }),
    bantah_vote_on_challenge: tool({
      description:
        "Submit a Bantah challenge vote after the user or client has already produced the signed vote payload.",
      inputSchema: z.object({
        target: z.enum(["offchain", "onchain"]).optional().describe("Which Bantah surface the challenge belongs to."),
        challengeId: z.number().int().positive().describe("The Bantah challenge id."),
        voteChoice: z
          .enum(["challenger", "challenged", "creator", "opponent"])
          .describe("Who the vote favors."),
        proofHash: z.string().min(1).describe("The proof hash tied to this vote."),
        signedVote: z
          .string()
          .min(1)
          .describe("The signed vote JSON payload produced by the user or client."),
      }),
      execute: async ({ target, challengeId, voteChoice, proofHash, signedVote }) => ({
        success: true,
        action: "bantah_vote_on_challenge",
        result: await voteOnBantahChallenge({
          target,
          challengeId,
          voteChoice,
          proofHash,
          signedVote,
          actingAsUserId,
        }),
      }),
    }),
    bantah_onchain_wallet_balance: tool({
      description:
        "Get the Bantah onchain wallet balance for the configured acting user.",
      inputSchema: z.object({}),
      execute: async () => ({
        success: true,
        action: "bantah_onchain_wallet_balance",
        result: await getBantahOnchainWalletBalance(actingAsUserId),
      }),
    }),
  };
}

/**
 * Create Agentic Wallet tools backed by the awal CLI.
 *
 * @returns Agentic wallet AI SDK tools
 */
function createAgenticWalletTools(): ToolSet {
  return {
    agentic_wallet_status: tool({
      description:
        "Check whether the local Agentic Wallet session is authenticated and ready. Use this before Agentic Wallet send or trade requests when wallet login state is unclear.",
      inputSchema: z.object({}),
      execute: async () => ({
        success: true,
        action: "agentic_wallet_status",
        result: await getAgenticWalletStatus(),
      }),
    }),
    agentic_wallet_auth_login: tool({
      description:
        "Start Agentic Wallet email OTP authentication for a user's own wallet. Use this when the user wants to create or sign in to their personal wallet.",
      inputSchema: z.object({
        email: z.string().email().describe("The email address to send the OTP to."),
      }),
      execute: async ({ email }) => ({
        success: true,
        action: "agentic_wallet_auth_login",
        result: await loginAgenticWallet(email),
      }),
    }),
    agentic_wallet_auth_verify: tool({
      description:
        "Complete Agentic Wallet email OTP verification using the flow ID and 6-digit OTP code.",
      inputSchema: z.object({
        flowId: z.string().min(1).describe("The flow ID returned by the login step."),
        otp: z
          .string()
          .regex(/^\d{6}$/)
          .describe("The 6-digit OTP code from the user's email."),
      }),
      execute: async ({ flowId, otp }) => ({
        success: true,
        action: "agentic_wallet_auth_verify",
        result: await verifyAgenticWallet(flowId, otp),
      }),
    }),
    agentic_wallet_address: tool({
      description:
        "Get the address for the currently authenticated Agentic Wallet session. Use this when the user asks for their own wallet address.",
      inputSchema: z.object({
        chain: z.enum(AGENTIC_WALLET_CHAINS).optional().describe("Optional chain selector."),
      }),
      execute: async ({ chain }) => ({
        success: true,
        action: "agentic_wallet_address",
        result: await getAgenticWalletAddress(chain),
      }),
    }),
    agentic_wallet_balance: tool({
      description:
        "Get balances for the authenticated Agentic Wallet. Supports optional chain and asset filters.",
      inputSchema: z.object({
        chain: z.enum(AGENTIC_WALLET_CHAINS).optional().describe("Optional chain selector."),
        asset: z.enum(AGENTIC_WALLET_ASSETS).optional().describe("Optional asset selector."),
      }),
      execute: async ({ chain, asset }) => ({
        success: true,
        action: "agentic_wallet_balance",
        result: await getAgenticWalletBalance({ chain, asset }),
      }),
    }),
    agentic_wallet_fund: tool({
      description:
        "Open the Agentic Wallet funding flow and provide the wallet address for manual funding or onramp. Use this when the user wants to add money to their own wallet.",
      inputSchema: z.object({}),
      execute: async () => ({
        success: true,
        action: "agentic_wallet_fund",
        result: await fundAgenticWallet(),
      }),
    }),
    agentic_wallet_send_usdc: tool({
      description:
        "Send USDC from the authenticated Agentic Wallet to an address or ENS name. Use this only for requests involving the user's own wallet after confirming authentication.",
      inputSchema: z.object({
        amount: z.string().min(1).describe("The amount of USDC to send, such as 1 or 5.25."),
        recipient: z.string().min(1).describe("The destination address or ENS name."),
        chain: z
          .enum(AGENTIC_WALLET_SEND_CHAINS)
          .optional()
          .describe("Optional supported chain. Defaults to base."),
      }),
      execute: async ({ amount, recipient, chain }) => ({
        success: true,
        action: "agentic_wallet_send_usdc",
        result: await sendAgenticWalletUsdc(amount, recipient, chain),
      }),
    }),
    agentic_wallet_trade: tool({
      description:
        "Trade tokens using the authenticated Agentic Wallet on Base. Use this for buy, swap, or trade requests from the user's own wallet.",
      inputSchema: z.object({
        amount: z
          .string()
          .min(1)
          .describe("The amount string supported by awal, such as 5, 0.05, or $1."),
        fromAsset: z
          .string()
          .min(1)
          .describe("Source token symbol or contract address, for example usdc or eth."),
        toAsset: z.string().min(1).describe("Destination token symbol or contract address."),
      }),
      execute: async ({ amount, fromAsset, toAsset }) => ({
        success: true,
        action: "agentic_wallet_trade",
        result: await tradeAgenticWallet(amount, fromAsset, toAsset),
      }),
    }),
    agentic_wallet_show_companion: tool({
      description:
        "Open or focus the local Agentic Wallet companion window. Use this when the user needs the wallet UI for funding or manual inspection.",
      inputSchema: z.object({}),
      execute: async () => ({
        success: true,
        action: "agentic_wallet_show_companion",
        result: await showAgenticWallet(),
      }),
    }),
  };
}

/**
 * Build the system prompt for the combined wallet and Twitter agent.
 *
 * @param options - Prompt configuration flags
 * @param options.canUseFaucet - Whether the active network supports faucet funding
 * @param options.twitterEnabled - Whether Twitter tools are available in this run
 * @returns The system prompt string
 */
function createSystemPrompt(options: {
  canUseFaucet: boolean;
  twitterEnabled: boolean;
  bantahEnabled: boolean;
  bantahUserContextAvailable: boolean;
}): string {
  const faucetMessage = options.canUseFaucet
    ? "If you ever need funds, you can request them from the faucet."
    : "If you need funds, you can provide your wallet details and request funds from the user.";
  const skillsMessage = buildSkillsPrompt();
  const knowledgeMessage = buildKnowledgePrompt();

  const agenticWalletMessage = `You also have Agentic Wallet tools for a user-authenticated wallet session.
Use agentic_wallet_auth_login when the user wants to create or sign in to their own wallet with email.
Use agentic_wallet_auth_verify when the user gives you the OTP code and flow ID.
Use agentic_wallet_status whenever the Agentic Wallet login state is unclear before a user wallet action.
Use agentic_wallet_address and agentic_wallet_balance for a user's own wallet details and balances.
Use agentic_wallet_fund when the user wants to add money to their own wallet.
Use agentic_wallet_send_usdc for "send" requests from the user's own authenticated wallet.
Use agentic_wallet_trade for buy, trade, or swap requests from the user's own authenticated wallet.
Use agentic_wallet_show_companion if the user needs the wallet companion window for funding or inspection.
If the user is clearly asking about their personal wallet, prefer the Agentic Wallet tools over the smart-wallet tools.
If Agentic Wallet authentication is missing, help the user sign in first before attempting send or trade actions.`;

  const twitterMessage = options.twitterEnabled
    ? `You can also manage Twitter (X) activity. Use post_tweet when the user wants to publish a tweet.
Use get_mentions when the user asks to check mentions or when you need the latest mention before replying.
Use reply_to_tweet when the user asks you to answer a mention or a specific tweet.
If the user says "Reply to my latest mention", call get_mentions first, choose the newest relevant mention, then call reply_to_tweet.`
    : "Twitter (X) tools are not available right now because the required Twitter credentials are missing.";

  const bantahMessage = !options.bantahUserContextAvailable
    ? `Bantah protected challenge actions require a real Bantah account and active sign-in context.
If a user wants to create, accept, join, prove, vote, or settle a Bantah challenge and you do not have confirmed Bantah user context for them, tell them to create an account or sign in first at https://onchain.bantah.fun, then continue there.
You may still answer safe public Bantah questions when public reads are available.`
    : options.bantahEnabled
    ? `You also have Bantah first-party product tools.
In the current build, Bantah challenge flows are onchain-only.
Do not route users into offchain Bantah challenge creation or participation from this agent.
Use bantah_list_challenges to inspect current onchain Bantah challenges.
Use bantah_get_challenge to retrieve a specific onchain Bantah challenge by id.
Use bantah_create_challenge to create an onchain Bantah challenge when the user clearly wants to create one.
Use bantah_accept_challenge when the user clearly wants to accept an onchain Bantah challenge.
Use bantah_join_challenge for admin-created onchain YES/NO challenges that require picking a side.
Use bantah_get_challenge_messages and bantah_post_challenge_message for onchain challenge discussion.
Use bantah_get_challenge_proofs and bantah_submit_challenge_proof for onchain evidence flows.
Use bantah_vote_on_challenge only after the user or client has already produced the required signed vote payload.
Use bantah_onchain_wallet_balance to inspect the configured Bantah user's onchain balance.
Bantah is the source of truth for challenge execution, status, and settlement.
If an onchain Bantah action requires a wallet signature or escrow transaction hash, explain that the user must complete the wallet step first before the action can finish.
If Bantah voting requires a signedVote payload or registered signing key, explain that the client or user must complete that signing step first before the vote can be submitted.`
    : "Bantah challenge tools are not available right now because Bantah internal access is not configured.";

  return `You are a helpful agent that can interact onchain using the Coinbase Developer Platform AgentKit.
You are empowered to interact onchain using your tools. ${faucetMessage}
Before executing your first smart-wallet action, get the smart-wallet details to see what network you're on.
${skillsMessage}
${knowledgeMessage}
${agenticWalletMessage}
${twitterMessage}
${bantahMessage}
If there is a 5XX (internal) HTTP error code, ask the user to try again later.
If someone asks you to do something you can't do with your currently available tools, you must say so, and
encourage them to implement it themselves using the CDP SDK + AgentKit. Recommend they go to
docs.cdp.coinbase.com for more information.
Be concise and helpful with your responses. Refrain from restating your tools' descriptions unless it is explicitly requested.`;
}
