import * as dotenv from "dotenv";
import { createServer } from "http";
import { AgentRuntime } from "@elizaos/core";
import { bootstrapPlugin } from "@elizaos/plugin-bootstrap";
import { openrouterPlugin } from "@elizaos/plugin-openrouter";
import { twitterPlugin } from "@elizaos/plugin-twitter";

dotenv.config();

function startWorkerHealthServer() {
  const port = Number(process.env.PORT || "");
  if (!port) {
    return;
  }

  const server = createServer((_, res) => {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, service: "bantabro-eliza-worker" }));
  });

  server.listen(port, () => {
    console.log(`Eliza Twitter worker health server ready at http://localhost:${port}`);
  });
}

function normalizeTwitterEnv() {
  if (!process.env.TWITTER_API_SECRET_KEY && process.env.TWITTER_API_SECRET) {
    process.env.TWITTER_API_SECRET_KEY = process.env.TWITTER_API_SECRET;
  }
}

function validateEnv() {
  const required = [
    "TWITTER_API_KEY",
    "TWITTER_API_SECRET_KEY",
    "TWITTER_ACCESS_TOKEN",
    "TWITTER_ACCESS_TOKEN_SECRET",
    "OPENROUTER_API_KEY",
  ];

  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

async function startElizaTwitterWorker() {
  normalizeTwitterEnv();
  validateEnv();

  const character = {
    name: "BantahBot",
    description:
      "Official Bantah Twitter assistant. Responds to mentions, shares Bantah info, and guides users to onchain.bantah.fun for protected actions.",
    clients: ["twitter"],
    plugins: [bootstrapPlugin, twitterPlugin, openrouterPlugin],
    postExamples: [
      "Prediction markets should feel fun and fair. Ask me how Bantah works.",
      "Need a market idea? Tag @bantahbot with your matchup.",
      "Bantah: create a challenge, share the link, settle onchain.",
    ],
    responseExamples: [
      {
        input: "How do I create a Bantah challenge?",
        output:
          "Head to onchain.bantah.fun, tap Create, add your question, stake, and share the link. I can help draft the market text too.",
      },
      {
        input: "Can you post this challenge for me?",
        output:
          "I can help format it, but for protected actions you’ll need to confirm on onchain.bantah.fun.",
      },
    ],
    settings: {
      TWITTER_API_KEY: process.env.TWITTER_API_KEY,
      TWITTER_API_SECRET_KEY: process.env.TWITTER_API_SECRET_KEY,
      TWITTER_ACCESS_TOKEN: process.env.TWITTER_ACCESS_TOKEN,
      TWITTER_ACCESS_TOKEN_SECRET: process.env.TWITTER_ACCESS_TOKEN_SECRET,
      TWITTER_POST_ENABLE: process.env.TWITTER_POST_ENABLE || "false",
      TWITTER_SEARCH_ENABLE: process.env.TWITTER_SEARCH_ENABLE || "true",
      TWITTER_AUTO_RESPOND_MENTIONS: process.env.TWITTER_AUTO_RESPOND_MENTIONS || "true",
      TWITTER_AUTO_RESPOND_REPLIES: process.env.TWITTER_AUTO_RESPOND_REPLIES || "true",
      TWITTER_POLL_INTERVAL: process.env.TWITTER_POLL_INTERVAL || "5",
      TWITTER_MAX_INTERACTIONS_PER_RUN: process.env.TWITTER_MAX_INTERACTIONS_PER_RUN || "5",
    },
  };

  const runtime = new AgentRuntime({ character });
  await runtime.start();
  console.log("Eliza Twitter worker is running.");

  const shutdown = async () => {
    try {
      await runtime.stop();
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (require.main === module) {
  startWorkerHealthServer();
  startElizaTwitterWorker().catch(error => {
    console.error("Fatal Eliza Twitter worker error:", error);
    process.exit(1);
  });
}
