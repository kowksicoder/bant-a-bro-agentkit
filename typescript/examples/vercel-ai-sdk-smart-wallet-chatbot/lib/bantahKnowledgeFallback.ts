import { getBantABroWebUrl } from "./skills";
import type { ExampleMessage } from "./agent";

type BantahKnowledgeContext = {
  bantahAuthenticated?: boolean;
  bantahUsername?: string | null;
  channel?: "web" | "twitter" | "cli";
};

type BantahFaqEntry = {
  id: string;
  keywords: string[];
  answer: (context: BantahKnowledgeContext) => string;
};

function normalizeInput(input: string): string {
  return input.toLowerCase().replace(/\s+/g, " ").trim();
}

function includesAny(input: string, keywords: string[]): boolean {
  return keywords.some(keyword => input.includes(keyword));
}

function currentChallengeMode(): "onchain_only" | "both" {
  const raw = String(process.env.BANTAH_CHALLENGE_MODE || "").trim().toLowerCase();
  return raw === "both" ? "both" : "onchain_only";
}

function signedInLine(context: BantahKnowledgeContext): string {
  if (context.bantahAuthenticated) {
    return context.bantahUsername
      ? `You already have Bantah sign-in context in this session as @${context.bantahUsername}.`
      : "You already have Bantah sign-in context in this session.";
  }

  return `If you want protected Bantah actions, sign in first at ${getBantABroWebUrl()}.`;
}

const FAQS: BantahFaqEntry[] = [
  {
    id: "what-is-bantah",
    keywords: ["what is bantah", "about bantah", "what does bantah do", "explain bantah"],
    answer: () =>
      `Bantah is a challenge and prediction product where users can create, discover, accept, join, track, and resolve challenges. Bantah is the source of truth for challenge state, settlement state, user state, and challenge routing.`,
  },
  {
    id: "what-is-bant-a-bro",
    keywords: ["what is bant-a-bro", "what is banta bro", "what is the agent", "about bant-a-bro"],
    answer: () =>
      `Bant-A-Bro is the official Bantah AI product. It helps users understand Bantah, navigate challenge flows, prepare challenges, inspect challenge state, and complete supported wallet or social actions on top of Bantah.`,
  },
  {
    id: "onchain-vs-offchain",
    keywords: ["onchain vs offchain", "difference between onchain and offchain", "what is onchain", "what is offchain"],
    answer: () =>
      `Onchain Bantah depends on wallet identity, chain and token context, escrow transaction hashes, and onchain settlement. Offchain Bantah depends on Bantah-managed backend state. In the current Bant-A-Bro runtime, challenge execution is intentionally onchain-only.`,
  },
  {
    id: "current-support",
    keywords: ["what can you do", "what can the agent do", "current build", "current support", "supported"],
    answer: () =>
      `Right now Bant-A-Bro can explain Bantah, answer common product questions, show public challenge information, help signed-in users through supported Bantah flows, and route users into the onchain Bantah path. The active challenge path in this build is onchain-only.`,
  },
  {
    id: "signup-required",
    keywords: ["do i need an account", "need account", "need to sign up", "sign in first", "signup", "sign up", "create account"],
    answer: context =>
      `For public product questions, no account is required. For protected Bantah actions like creating, accepting, joining, proving, or voting on a challenge, you need a real Bantah account and active sign-in context. ${signedInLine(context)}`,
  },
  {
    id: "agent-create-account",
    keywords: ["create my account", "does the agent create account", "will the agent create an account", "create bantah user"],
    answer: context =>
      `No. The agent does not silently create Bantah accounts behind the scenes. The proper flow is: open ${getBantABroWebUrl()}, create an account or sign in, let Bantah establish trusted user context, and then the agent can continue supported actions. ${signedInLine(context)}`,
  },
  {
    id: "how-knows-signed-in",
    keywords: ["how do you know if i signed in", "how do you know i have an account", "how will the agent know", "session magic", "how do you know who i am"],
    answer: context =>
      `The agent should not guess identity from free text like username, email, or wallet address. It should know from trusted Bantah context such as session or cookie state, forwarded bearer auth, or trusted internal headers. The key field is Bantah user.id. ${signedInLine(context)}`,
  },
  {
    id: "wallet-needed",
    keywords: ["do i need a wallet", "wallet required", "need wallet", "connect wallet"],
    answer: () =>
      `For onchain Bantah actions, wallet context is usually required. Bant-A-Bro can orchestrate the flow, but it should not pretend it can sign the user's onchain transaction by itself unless Bantah intentionally adopts a custodial or delegated signing model.`,
  },
  {
    id: "explore-page",
    keywords: ["explore page", "site explore", "will it show on explore", "does the agent paste to explore"],
    answer: () =>
      `The agent does not manually paste a challenge into the Bantah explore page UI. It creates or updates challenge state through Bantah, and Bantah's own frontend and feed logic decide where that challenge appears.`,
  },
  {
    id: "offchain-disabled",
    keywords: ["offchain", "use offchain", "offchain challenge", "why not offchain"],
    answer: () =>
      currentChallengeMode() === "onchain_only"
        ? `In this Bant-A-Bro build, challenge execution is intentionally onchain-only. Offchain challenge code may still exist in source, but the active runtime should not route users into offchain challenge execution for now.`
        : `This runtime supports both onchain and offchain modes, but Bantah remains the source of truth for which challenge rail should be used for any specific flow.`,
  },
  {
    id: "twitter-use",
    keywords: ["twitter", "x mention", "can i use twitter", "from x", "from twitter"],
    answer: () =>
      `Twitter/X is mainly a social and discovery surface. It is good for public-safe Bantah questions and social replies. Protected Bantah actions should usually redirect to ${getBantABroWebUrl()} unless the social identity is explicitly linked and the action is safe to complete without fresh wallet signing or richer UI.`,
  },
  {
    id: "telegram-discord",
    keywords: ["telegram", "discord", "clients", "other channels"],
    answer: () =>
      `Telegram and Discord should follow the same trust model as Twitter unless real identity linking is added. Public-safe help is fine, but protected Bantah actions should use real Bantah sign-in context and usually complete on the web app.`,
  },
  {
    id: "database",
    keywords: ["database", "own db", "own database", "migrations", "shared database"],
    answer: () =>
      `Bant-A-Bro should not become a second source of truth for Bantah users or challenges. Bantah offchain and onchain remain the core product state. The Agent can keep a small product persistence layer for things like audit logs, social identity links, and worker checkpoints, but not a competing challenge or user database.`,
  },
  {
    id: "create-challenge-flow",
    keywords: ["create challenge", "how do i create a challenge", "arsenal vs chelsea", "post a challenge"],
    answer: context =>
      `The safe current flow is: sign in to Bantah, confirm you are using the onchain path, provide the challenge details, and complete any required wallet confirmation. The active Bant-A-Bro runtime is onchain-only for challenge execution. ${signedInLine(context)}`,
  },
  {
    id: "proof-vote",
    keywords: ["proof", "evidence", "vote", "resolution", "settlement"],
    answer: () =>
      `Bantah can support proof, evidence, voting, and resolution flows, but the agent should only claim those actions succeeded if Bantah confirms them. If a signed vote payload, registered signing key, wallet confirmation, or settlement transaction hash is still required, the agent should say that clearly.`,
  },
];

const BANTAH_HINT_KEYWORDS = [
  "bantah",
  "bant-a-bro",
  "banta bro",
  "challenge",
  "prediction",
  "onchain",
  "offchain",
  "explore page",
  "sign in",
  "sign up",
  "wallet",
  "twitter",
  "telegram",
  "discord",
];

function latestUserText(messages: ExampleMessage[]): string {
  const latest = [...messages].reverse().find(message => message.role === "user");
  return latest?.content || "";
}

export function isLikelyBantahKnowledgeQuestion(messages: ExampleMessage[]): boolean {
  const text = normalizeInput(latestUserText(messages));
  if (!text) {
    return false;
  }

  return includesAny(text, BANTAH_HINT_KEYWORDS);
}

function scoreFaq(input: string, entry: BantahFaqEntry): number {
  let score = 0;
  for (const keyword of entry.keywords) {
    if (input.includes(keyword)) {
      score += keyword.length >= 12 ? 5 : 3;
    }
  }
  if (input.includes("bantah") && entry.id === "what-is-bantah") {
    score += 1;
  }
  return score;
}

function genericAnswer(context: BantahKnowledgeContext): string {
  return `Bantah is a challenge and prediction product, and Bant-A-Bro is the official Bantah AI assistant. The main trusted surface for protected actions is ${getBantABroWebUrl()}, and the current Bant-A-Bro runtime is onchain-only for challenge execution. ${signedInLine(context)}`;
}

export function getBantahKnowledgeFallbackReply(
  messages: ExampleMessage[],
  context: BantahKnowledgeContext = {},
): string | null {
  const input = normalizeInput(latestUserText(messages));
  if (!input) {
    return null;
  }

  if (!isLikelyBantahKnowledgeQuestion(messages)) {
    return null;
  }

  const ranked = FAQS.map(entry => ({
    entry,
    score: scoreFaq(input, entry),
  }))
    .filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score);

  if (ranked.length === 0) {
    return genericAnswer(context);
  }

  const primary = ranked[0].entry.answer(context);
  const secondary =
    ranked.length > 1 && ranked[1].score >= Math.max(4, ranked[0].score - 1)
      ? ranked[1].entry.answer(context)
      : null;

  const parts = [primary];
  if (secondary && secondary !== primary) {
    parts.push(secondary);
  }

  return parts.join("\n\n");
}

export function isLikelyModelAvailabilityError(error: unknown): boolean {
  const message = String(error instanceof Error ? error.message : error || "")
    .toLowerCase()
    .trim();

  if (!message) {
    return false;
  }

  return [
    "insufficient_quota",
    "quota",
    "rate limit",
    "429",
    "openai_api_key",
    "api key",
    "authentication",
    "billing",
    "model request failed",
    "provider",
  ].some(fragment => message.includes(fragment));
}
