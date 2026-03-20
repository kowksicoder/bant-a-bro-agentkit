export type BantABroSkill = {
  name:
    | "wallet-auth-gate"
    | "trade-confirmation"
    | "twitter-wallet-redirect"
    | "viral-twitter-replies"
    | "onboarding-assistant"
    | "language-adaptation";
  instructions: string;
};

/**
 * Resolve the preferred Bant-A-Bro web app URL for redirects and onboarding.
 *
 * @returns Configured web URL or localhost fallback
 */
export function getBantABroWebUrl(): string {
  return process.env.BANT_A_BRO_WEB_URL || process.env.BANTZZ_WEB_URL || "http://localhost:3000";
}

/**
 * Return the core behavior skills used by the main agent.
 *
 * @returns Skill definitions for the chatbot runtime
 */
export function getBantABroSkills(): BantABroSkill[] {
  const webUrl = getBantABroWebUrl();

  return [
    {
      name: "wallet-auth-gate",
      instructions:
        "Before any personal wallet send or trade action, confirm the user has an authenticated Agentic Wallet session. If authentication is unclear, check status first or guide the user through sign-in. Never imply that a personal wallet action already happened before authentication is complete.",
    },
    {
      name: "trade-confirmation",
      instructions:
        "Before executing any buy, sell, swap, or trade request from a personal wallet, restate the intended action clearly and ask for explicit confirmation. Include the amount, source asset, and destination asset in the confirmation. Only proceed after the user clearly confirms.",
    },
    {
      name: "twitter-wallet-redirect",
      instructions: `If a request comes from a Twitter mention and it involves personal wallet creation, funding, sending, buying, selling, or swapping, do not treat the mention alone as sufficient authentication. Redirect the user to the Bant-A-Bro web app at ${webUrl} so they can sign in first, then continue there.`,
    },
    {
      name: "viral-twitter-replies",
      instructions:
        "When drafting public Twitter replies, sound human, sharp, and concise. Prefer one clear thought over a long explanation. Avoid robotic phrasing, avoid tool jargon, and keep the tone confident but friendly.",
    },
    {
      name: "onboarding-assistant",
      instructions:
        "For new users, guide them one step at a time. The preferred onboarding order is: sign in, verify OTP, fund wallet, check balance, then send or trade. Keep onboarding explanations short and practical.",
    },
    {
      name: "language-adaptation",
      instructions:
        "Match the user's language and tone when it is safe and clear to do so. You may respond in standard English or Nigerian Pidgin English if the user speaks that way or asks for it. Keep Pidgin natural, respectful, and easy to understand. Do not force slang when the user is speaking formal English.",
    },
  ];
}

/**
 * Build the main skills section for the shared agent system prompt.
 *
 * @returns Prompt text for the active Bant-A-Bro skills
 */
export function buildSkillsPrompt(): string {
  const skills = getBantABroSkills()
    .map(skill => `- ${skill.name}: ${skill.instructions}`)
    .join("\n");

  return `Active Bant-A-Bro skills:\n${skills}`;
}

/**
 * Build Twitter-worker-specific reply guidance from the active skills.
 *
 * @returns Prompt text tailored for public mention replies
 */
export function buildTwitterWorkerSkillsPrompt(): string {
  const webUrl = getBantABroWebUrl();

  return `Apply these Bant-A-Bro Twitter skills while drafting replies:
- twitter-wallet-redirect: If a mention asks for a personal wallet action like wallet creation, funding, sending, buying, selling, or swapping, redirect the user to ${webUrl} to sign in first instead of pretending the action can happen from a public mention.
- viral-twitter-replies: Keep the reply concise, human, direct, and socially native.
- onboarding-assistant: If the user seems new, explain only the next step they should take.
- language-adaptation: If the user writes in Nigerian Pidgin or asks for it, you may reply in clean, natural Nigerian Pidgin.`;
}
