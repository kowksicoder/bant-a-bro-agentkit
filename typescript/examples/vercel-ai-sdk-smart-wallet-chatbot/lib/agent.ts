import * as fs from "fs";
import {
  AgentKit,
  type Action,
  CdpSmartWalletProvider,
  cdpApiActionProvider,
  erc20ActionProvider,
  pythActionProvider,
  walletActionProvider,
} from "@coinbase/agentkit";
import { openai } from "@ai-sdk/openai";
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
  walletTools: ToolSet;
  agenticWalletTools: ToolSet;
  twitterEnabled: boolean;
};

let exampleAgentPromise: Promise<ExampleAgent> | null = null;

/**
 * Validate required environment variables for the base wallet chatbot.
 *
 * @throws Error if required environment variables are missing
 */
export function validateEnvironment(): void {
  const missingVars = ["OPENAI_API_KEY", "CDP_API_KEY_ID", "CDP_API_KEY_SECRET"].filter(
    varName => !process.env[varName],
  );

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
export async function createExampleAgent(): Promise<ExampleAgent> {
  if (exampleAgentPromise) {
    return exampleAgentPromise;
  }

  exampleAgentPromise = createExampleAgentInternal();

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
async function createExampleAgentInternal(): Promise<ExampleAgent> {
  validateEnvironment();

  const networkId = process.env.NETWORK_ID || "base-sepolia";
  const walletDataFile = `wallet_data_${networkId.replace(/-/g, "_")}.txt`;

  let smartAccountName: string | undefined;
  let smartWalletAddress: Address | undefined;
  let ownerAddress: Address | undefined;

  if (fs.existsSync(walletDataFile)) {
    try {
      const walletData = JSON.parse(fs.readFileSync(walletDataFile, "utf8")) as WalletData;
      smartAccountName = walletData.smartAccountName;
      smartWalletAddress = walletData.smartWalletAddress;
      ownerAddress = walletData.ownerAddress;
    } catch (error) {
      console.error(`Error reading wallet data for ${networkId}:`, error);
    }
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
  fs.writeFileSync(
    walletDataFile,
    JSON.stringify({
      smartAccountName: data.name,
      smartWalletAddress: data.address,
      ownerAddress: data.ownerAddress,
    } as WalletData),
  );

  const walletTools = getExampleVercelAITools(agentKit);
  const agenticWalletTools = createAgenticWalletTools();
  const twitterEnabled = hasTwitterCredentials();
  const tools: ToolSet = {
    ...walletTools,
    ...agenticWalletTools,
    ...(twitterEnabled ? createTwitterTools() : {}),
  };

  if (!twitterEnabled) {
    console.warn(
      "Warning: Twitter credentials are not configured. Twitter tools will be disabled.",
    );
  }

  return {
    model: openai.chat("gpt-4o-mini"),
    system: createSystemPrompt({
      canUseFaucet: walletProvider.getNetwork().networkId === "base-sepolia",
      twitterEnabled,
    }),
    stopWhen: stepCountIs(10),
    tools,
    walletTools,
    agenticWalletTools,
    twitterEnabled,
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
function createSystemPrompt(options: { canUseFaucet: boolean; twitterEnabled: boolean }): string {
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

  return `You are a helpful agent that can interact onchain using the Coinbase Developer Platform AgentKit.
You are empowered to interact onchain using your tools. ${faucetMessage}
Before executing your first smart-wallet action, get the smart-wallet details to see what network you're on.
${skillsMessage}
${knowledgeMessage}
${agenticWalletMessage}
${twitterMessage}
If there is a 5XX (internal) HTTP error code, ask the user to try again later.
If someone asks you to do something you can't do with your currently available tools, you must say so, and
encourage them to implement it themselves using the CDP SDK + AgentKit. Recommend they go to
docs.cdp.coinbase.com for more information.
Be concise and helpful with your responses. Refrain from restating your tools' descriptions unless it is explicitly requested.`;
}
