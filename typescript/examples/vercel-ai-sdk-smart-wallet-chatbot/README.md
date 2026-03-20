# CDP AgentKit Vercel AI SDK Smart Wallet + Twitter + Agentic Wallet Chatbot Example

This example keeps the existing Vercel AI SDK smart wallet chatbot and extends it with Twitter (X) automation plus an Agentic Wallet capability layer. The chatbot still runs as a terminal app, and now it can:

- manage the smart wallet with AgentKit tools
- authenticate a local Agentic Wallet with email OTP
- inspect Agentic Wallet status, address, and balances
- send USDC and trade tokens from an authenticated Agentic Wallet session
- post tweets
- fetch account mentions
- reply to tweets and mentions
- serve a local browser chat page
- run a separate background worker that auto-replies to new mentions

## Example chat commands

- "Transfer a portion of your ETH to a random address"
- "What is the price of BTC?"
- "Sign in to my wallet with me@example.com"
- "Verify my wallet code with flow ID abc123 and OTP 123456"
- "Help me fund my wallet"
- "Show my agentic wallet balance"
- "Send 1 USDC to vitalik.eth from my wallet"
- "Buy $5 of ETH from my wallet"
- "Post this tweet: GM world"
- "Check my mentions"
- "Reply to my latest mention"
- "Reply to tweet 1901234567890123456 with thanks for reaching out"

## How the agent uses wallet and Twitter tools

The chatbot now carries two wallet layers:

- smart-wallet tools from AgentKit for the app's built-in Coinbase smart wallet
- Agentic Wallet tools backed by the `awal` CLI for a user-authenticated wallet session

The Agentic Wallet tool names are:

- `agentic_wallet_status`
- `agentic_wallet_auth_login`
- `agentic_wallet_auth_verify`
- `agentic_wallet_address`
- `agentic_wallet_balance`
- `agentic_wallet_fund`
- `agentic_wallet_send_usdc`
- `agentic_wallet_trade`
- `agentic_wallet_show_companion`

The system prompt tells the model to prefer the Agentic Wallet tools when the user is asking about their own wallet, signing in, sending, or buying from a personal wallet.

The Twitter tools are:

- `post_tweet`
- `get_mentions`
- `reply_to_tweet`

- for "Sign in to my wallet with ..." it should call `agentic_wallet_auth_login`
- for OTP verification it should call `agentic_wallet_auth_verify`
- for "Show my agentic wallet balance" it should call `agentic_wallet_balance`
- for "Help me fund my wallet" it should call `agentic_wallet_fund`
- for "Send 1 USDC to ..." it should call `agentic_wallet_send_usdc`
- for "Buy $5 of ETH" it should call `agentic_wallet_trade`
- for "Post this tweet: ..." it should call `post_tweet`
- for "Check my mentions" it should call `get_mentions`
- for "Reply to my latest mention" it should call `get_mentions` first, then `reply_to_tweet`

Tool results are printed during streaming so you can see what the agent actually executed.

## Built-in behavior skills

The shared agent prompt now includes these Bantzz behavior skills:

- `wallet-auth-gate`: check Agentic Wallet auth before personal wallet send or trade actions
- `trade-confirmation`: restate buy, sell, and swap intents and ask for explicit confirmation before execution
- `twitter-wallet-redirect`: redirect Twitter users to the web app for wallet auth before personal wallet actions
- `viral-twitter-replies`: keep public Twitter replies concise, human, and socially natural
- `onboarding-assistant`: guide new users step by step through sign-in, OTP, funding, balance checks, and then actions
- `language-adaptation`: respond in standard English by default, and support natural Nigerian Pidgin when the user asks for it or speaks that way

## Project knowledge base

The agent also reads local project knowledge from:

- `knowledge/project.md`

Use this file as the editable source of truth for:

- what Bantzz is
- current product direction
- supported features
- product rules
- onboarding flow
- tone and brand guidance

If you want to expand later, split the knowledge base into additional markdown files and load them the same way.

## New files

- `lib/agenticWallet.ts`: local Agentic Wallet service wrapper around the `awal` CLI; handles status, login, verification, address, balance, send, trade, and companion-window opening
- `lib/knowledge.ts`: local project knowledge loader that injects `knowledge/project.md` into the shared prompt
- `knowledge/project.md`: editable project about/knowledge-base markdown for Bantzz
- `lib/twitter.ts`: local Twitter service using `twitter-api-v2`; handles posting tweets, reading mentions, and replying
- `lib/agent.ts`: shared agent initialization, merged tool registration, environment checks, and prompt assembly
- `web/server.ts`: local HTTP server that exposes a browser chat endpoint and streams model output plus tool results
- `web/index.html`: single-page chat UI wired into the same agent
- `workers/twitterWorker.ts`: background worker that polls mentions every 15 seconds, drafts replies with the agent, posts them, and persists processed tweet IDs
- `twitter_worker_state.json`: created automatically the first time the worker runs to avoid duplicate replies

## Prerequisites

### Node.js

The smart wallet and Twitter flow works on modern Node versions, but Agentic Wallet support requires Node.js 24 or higher.

```bash
node --version
```

If needed:

```bash
nvm install node
```

### API keys

You will need:

- [CDP API Key](https://portal.cdp.coinbase.com/access/api)
- [OpenAI API Key](https://platform.openai.com/docs/quickstart#create-and-export-an-api-key)
- [Twitter (X) Developer credentials](https://developer.x.com/en/portal/dashboard)

Rename `.env-local` to `.env` and fill in:

- `CDP_API_KEY_ID`
- `CDP_API_KEY_SECRET`
- `CDP_WALLET_SECRET`
- `OPENAI_API_KEY`
- `TWITTER_API_KEY`
- `TWITTER_API_SECRET`
- `TWITTER_ACCESS_TOKEN`
- `TWITTER_ACCESS_TOKEN_SECRET`
- `BANTZZ_WEB_URL` optional, defaults to `http://localhost:3000`
- `NETWORK_ID` optional, defaults to `base-sepolia`

## Build

From the `typescript` directory, install dependencies and build the workspace:

```bash
pnpm install
pnpm run build
```

## Run the chatbot

From `typescript/examples/vercel-ai-sdk-smart-wallet-chatbot`:

```bash
pnpm start
```

Choose chat mode to issue wallet and Twitter commands interactively.

## Run the web chat page

From `typescript/examples/vercel-ai-sdk-smart-wallet-chatbot`:

```bash
pnpm start:web
```

Then open:

```text
http://localhost:3000
```

The browser UI uses the same agent logic as the terminal chatbot. It streams assistant text and shows tool calls in the page.

## Agentic Wallet auth flow

Agentic Wallet uses email OTP authentication through the local `awal` CLI session.

Typical chat flow:

1. Ask: `Sign in to my wallet with me@example.com`
2. The agent calls `agentic_wallet_auth_login` and returns a `flowId`
3. After you receive the email code, ask: `Verify my wallet code with flow ID ... and OTP 123456`
4. The agent calls `agentic_wallet_auth_verify`
5. If you need funds, ask `Help me fund my wallet` and the agent will open the companion/onramp flow and show the wallet address
6. You can then ask for address, balance, send, or trade actions from that authenticated wallet session

Important:

- this local demo uses one Agentic Wallet session for the running machine
- it is not yet a production multi-user wallet session manager like Bankrbot
- Agentic Wallet send/trade actions depend on successful authentication and available funds

## Run the Twitter worker

From `typescript/examples/vercel-ai-sdk-smart-wallet-chatbot` in a separate terminal:

```bash
pnpm start:worker
```

The worker:

- polls mentions every 15 seconds
- logs each new mention
- asks the agent to draft a reply
- sends the reply with `replyToTweet`
- stores processed mention IDs in `twitter_worker_state.json`

## Expected behavior

- `Post this tweet: GM world`
  The agent calls `post_tweet` and prints the posted tweet payload.

- `Check my mentions`
  The agent calls `get_mentions` and returns the recent mention list.

- `Reply to my latest mention`
  The agent fetches mentions, selects the newest mention, and replies using `reply_to_tweet`.

## License

[Apache-2.0](../../../LICENSE.md)
