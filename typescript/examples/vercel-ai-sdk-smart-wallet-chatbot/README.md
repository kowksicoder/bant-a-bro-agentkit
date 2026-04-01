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
- Bantah challenge tools backed by Bantah's internal offchain and onchain APIs

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
- `like_tweet`
- `retweet_tweet`

TwitterAPI.io notes:

- Set `TWITTER_PROVIDER=twitterapi_io` to use TwitterAPI.io instead of the X API v2 SDK.
- Read-only calls (mentions, feeds) require `TWITTERAPI_IO_KEY` + `TWITTERAPI_IO_USERNAME`.
- Write actions (post/reply/like/retweet) require `TWITTERAPI_IO_LOGIN_COOKIES` and `TWITTERAPI_IO_PROXY`.

ElizaOS Twitter notes:

- Set `TWITTER_WORKER_PROVIDER=eliza` to run the ElizaOS Twitter worker.
- ElizaOS uses OAuth 1.0a credentials and expects `TWITTER_API_SECRET_KEY` (in addition to the standard Twitter keys).

The Bantah tools are:

- `bantah_list_challenges`
- `bantah_get_challenge`
- `bantah_create_challenge`
- `bantah_accept_challenge`
- `bantah_join_challenge`
- `bantah_get_challenge_messages`
- `bantah_post_challenge_message`
- `bantah_get_challenge_proofs`
- `bantah_submit_challenge_proof`
- `bantah_vote_on_challenge`
- `bantah_onchain_wallet_balance`

- for "Sign in to my wallet with ..." it should call `agentic_wallet_auth_login`
- for OTP verification it should call `agentic_wallet_auth_verify`
- for "Show my agentic wallet balance" it should call `agentic_wallet_balance`
- for "Help me fund my wallet" it should call `agentic_wallet_fund`
- for "Send 1 USDC to ..." it should call `agentic_wallet_send_usdc`
- for "Buy $5 of ETH" it should call `agentic_wallet_trade`
- for "Post this tweet: ..." it should call `post_tweet`
- for "Check my mentions" it should call `get_mentions`
- for "Reply to my latest mention" it should call `get_mentions` first, then `reply_to_tweet`
- for "Like tweet 1901234567890123456" it should call `like_tweet`
- for "Retweet 1901234567890123456" it should call `retweet_tweet`
- for "Show open Bantah challenges" it should call `bantah_list_challenges`
- for "Get Bantah challenge 42" it should call `bantah_get_challenge`
- for "Create a Bantah challenge..." it should call `bantah_create_challenge`
- for "Accept Bantah challenge 42" it should call `bantah_accept_challenge`

Tool results are printed during streaming so you can see what the agent actually executed.

## Built-in behavior skills

The shared agent prompt now includes these Bant-A-Bro behavior skills:

- `wallet-auth-gate`: check Agentic Wallet auth before personal wallet send or trade actions
- `trade-confirmation`: restate buy, sell, and swap intents and ask for explicit confirmation before execution
- `twitter-wallet-redirect`: redirect Twitter users to the web app for wallet auth before personal wallet actions
- `viral-twitter-replies`: keep public Twitter replies concise, human, and socially natural
- `onboarding-assistant`: guide new users step by step through sign-in, OTP, funding, balance checks, and then actions
- `language-adaptation`: respond in standard English by default, and support natural Nigerian Pidgin when the user asks for it or speaks that way

## Project knowledge base

The agent also reads local project knowledge from:

- `knowledge/project.md`

The agent also reads local knowledge-skill markdown from:

- `knowledge/skills/contract-addresses.md`
- `knowledge/skills/security.md`
- `knowledge/skills/frontend-ux.md`
- `knowledge/skills/ens-primary-name.md`

Use this file as the editable source of truth for:

- what Bant-A-Bro is
- current product direction
- supported features
- product rules
- onboarding flow
- tone and brand guidance

If you want to expand later, split the knowledge base into additional markdown files and load them the same way.

## New files

- `lib/agenticWallet.ts`: local Agentic Wallet service wrapper around the `awal` CLI; handles status, login, verification, address, balance, send, trade, and companion-window opening
- `lib/knowledge.ts`: local project knowledge loader that injects `knowledge/project.md` into the shared prompt
- `knowledge/project.md`: editable project about/knowledge-base markdown for Bant-A-Bro
- `lib/twitter.ts`: local Twitter service using `twitter-api-v2`; handles posting tweets, reading mentions, and replying
- `lib/bantah.ts`: Bantah internal API client and delegated auth signer for challenge and balance tools
- `lib/agent.ts`: shared agent initialization, merged tool registration, environment checks, and prompt assembly
- `web/server.ts`: local HTTP server that exposes a browser chat endpoint and streams model output plus tool results
- `web/index.html`: single-page chat UI wired into the same agent
- `workers/twitterWorker.ts`: background worker that polls mentions every 15 seconds, drafts replies with the agent, uses public or linked-user Bantah tools when appropriate, posts replies, and persists mention state in SQLite
- `lib/persistence.ts`: SQLite-backed persistence layer for smart-wallet snapshots, Twitter worker checkpoints, social identity links, and audit logs

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
- [OpenRouter API Key](https://openrouter.ai/)
- [Twitter (X) Developer credentials](https://developer.x.com/en/portal/dashboard)
- [TwitterAPI.io API Key](https://twitterapi.io/) (optional alternative provider)

Rename `.env-local` to `.env` and fill in:

- `CDP_API_KEY_ID`
- `CDP_API_KEY_SECRET`
- `CDP_WALLET_SECRET`
- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL` optional, defaults to `openai/gpt-4o-mini`
- `OPENROUTER_BASE_URL` optional, defaults to `https://openrouter.ai/api/v1`
- `OPENROUTER_HTTP_REFERER` optional, defaults to your Bant-A-Bro web URL
- `OPENROUTER_TITLE` optional, defaults to `Bant-A-Bro`
- `TWITTER_API_KEY`
- `TWITTER_API_SECRET`
- `TWITTER_ACCESS_TOKEN`
- `TWITTER_ACCESS_TOKEN_SECRET`
- `TWITTER_PROVIDER` optional, set to `twitterapi_io` to use TwitterAPI.io instead of X API v2
- `TWITTERAPI_IO_KEY` required when using TwitterAPI.io
- `TWITTERAPI_IO_USERNAME` the bot account handle to pull mentions for
- `TWITTERAPI_IO_LOGIN_COOKIES` required for TwitterAPI.io write actions (post/reply/like/retweet)
- `TWITTERAPI_IO_PROXY` required for TwitterAPI.io write actions
- `TWITTERAPI_IO_BASE_URL` optional, defaults to `https://api.twitterapi.io`
- `BANTAH_OFFCHAIN_BASE_URL` optional, enables offchain Bantah tools
- `BANTAH_ONCHAIN_BASE_URL` optional, enables onchain Bantah tools
- `BANTAH_AGENT_TOKEN_SECRET` required for Bantah delegated auth
- `BANTAH_ACTING_AS_USER_ID` optional, local development fallback when no real Bantah session is available
- `BANTAH_AGENT_SERVICE_ID` optional, defaults to `service:bantah-ai-agent`
- `BANTAH_OFFCHAIN_AUDIENCE` optional, defaults to `bantah-offchain`
- `BANTAH_ONCHAIN_AUDIENCE` optional, defaults to `bantah-onchain`
- `BANTAH_AGENT_TOKEN_TTL_MS` optional, defaults to 15 minutes
- `BANTAH_CHALLENGE_MODE` optional, defaults to `onchain_only` in the current build
- `BANT_A_BRO_WEB_URL` optional, defaults to `https://onchain.bantah.fun`
- `BANTZZ_WEB_URL` also works as a backward-compatible fallback
- `BANTABRO_DB_PATH` optional, defaults to `./data/bantabro.sqlite`
- `BANTAH_ALLOW_DEV_CONTEXT_FALLBACK` optional, defaults to `true` outside production
- `BANTAH_CONTEXT_HEADER_SECRET` optional, lets a trusted Bantah proxy inject `x-bantah-user-id` style headers safely
- `BANTABRO_FORCE_KNOWLEDGEBASE_MODE` optional, serves Bantah informational answers from the local knowledge base without calling the model
- `BANTABRO_MAX_TOOL_STEPS` optional, limits tool-call steps per turn (default 8). Lower = faster, higher = more thorough.
- `NETWORK_ID` optional, defaults to `base-sepolia`

Bantah notes:

- The current example prefers real Bantah session handoff first: trusted proxy headers, forwarded bearer auth, or forwarded Bantah cookies.
- `BANTAH_ACTING_AS_USER_ID` is now just a development fallback, not the primary production identity path.
- The current Bant-A-Bro challenge flow is intentionally `onchain_only`. Offchain challenge actions are left in code but blocked at runtime for now.
- The web server also exposes `GET /api/session` plus `GET/POST /api/channel-links/twitter` for resolved Bantah session inspection and linked Twitter identity persistence.
- A production Bantah deployment should pass identity through real Bantah auth/session context instead of relying on one fixed env user id.
- The Agent now includes a deterministic Bantah knowledge fallback for common Bantah product questions when the model provider is unavailable or quota is exhausted.

Example web chat request with Bantah user context:

```json
{
  "bantahUserId": "user_123",
  "messages": [
    {
      "role": "user",
      "content": "Create a Bantah challenge that Arsenal beats Chelsea for 5000."
    }
  ]
}
```

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

The default worker:

- polls mentions on the configured interval
- logs each new mention
- resolves whether the mention author is linked to a Bantah user
- asks the agent to draft a reply
- sends the reply with `replyToTweet`
- stores processed mention IDs and link state in the SQLite persistence store

To run the ElizaOS Twitter worker instead:

```bash
pnpm start:worker:eliza
```

## Deploy on Railway

This example is now wired so the same codebase can run as either:

- a `web` service for Bant-A-Bro's HTTP/chat runtime
- a `worker` service for the Twitter/X background worker

Both services use the same `railway.json` and switch behavior with one env var:

- `BANTABRO_SERVICE_ROLE=web`
- `BANTABRO_SERVICE_ROLE=worker`

Recommended Railway setup:

1. Create a Railway service from this directory:
   `typescript/examples/vercel-ai-sdk-smart-wallet-chatbot`
2. For the web service, set:
   - `BANTABRO_SERVICE_ROLE=web`
   - `PORT` provided by Railway
3. For the worker service, set:
   - `BANTABRO_SERVICE_ROLE=worker`
4. Use the included templates as your starting point:
   - `.env.railway.web.example`
   - `.env.railway.worker.example`
5. Mount a persistent volume at `/data` if you want SQLite state to survive restarts.
   - This is where `BANTABRO_DB_PATH=/data/bantabro.sqlite` points.
6. Use the same core env vars on both services:
   - `OPENROUTER_API_KEY`
   - `OPENROUTER_MODEL`
   - `OPENROUTER_BASE_URL`
   - `OPENROUTER_HTTP_REFERER`
   - `OPENROUTER_TITLE`
   - `CDP_API_KEY_ID`
   - `CDP_API_KEY_SECRET`
   - `CDP_WALLET_SECRET`
   - `BANTAH_OFFCHAIN_BASE_URL`
   - `BANTAH_ONCHAIN_BASE_URL`
   - `BANTAH_AGENT_TOKEN_SECRET`
   - `BANTAH_AGENT_SERVICE_ID`
   - `BANTAH_OFFCHAIN_AUDIENCE`
   - `BANTAH_ONCHAIN_AUDIENCE`
   - `BANTAH_AGENT_TOKEN_TTL_MS`
   - `BANTAH_CHALLENGE_MODE`
   - `BANT_A_BRO_WEB_URL`
   - `BANTABRO_DB_PATH`
7. Add Twitter credentials to the worker service:
   - `TWITTER_API_KEY`
   - `TWITTER_API_SECRET`
   - `TWITTER_API_SECRET_KEY` (required for ElizaOS worker)
   - `TWITTER_ACCESS_TOKEN`
   - `TWITTER_ACCESS_TOKEN_SECRET`
   - if using ElizaOS worker:
     - `TWITTER_WORKER_PROVIDER=eliza`
     - `TWITTER_POLL_INTERVAL` (seconds, optional)
     - `TWITTER_AUTO_RESPOND_MENTIONS=true`
     - `TWITTER_AUTO_RESPOND_REPLIES=true`
   - or use TwitterAPI.io by setting:
     - `TWITTER_PROVIDER=twitterapi_io`
     - `TWITTERAPI_IO_KEY`
     - `TWITTERAPI_IO_USERNAME`
     - `TWITTERAPI_IO_LOGIN_COOKIES`
     - `TWITTERAPI_IO_PROXY`

Recommended web-service extras:

- `BANTABRO_FORCE_KNOWLEDGEBASE_MODE=false`
- `BANTAH_ALLOW_DEV_CONTEXT_FALLBACK=false`
- health check path: `/api/session`

Recommended worker-service extras:

- no public domain required
- no health check path required

The Railway entrypoint is:

```bash
npm run start:railway
```

It chooses `start:web` or `start:worker` automatically based on `BANTABRO_SERVICE_ROLE`.

## Expected behavior

- `Post this tweet: GM world`
  The agent calls `post_tweet` and prints the posted tweet payload.

- `Check my mentions`
  The agent calls `get_mentions` and returns the recent mention list.

- `Reply to my latest mention`
  The agent fetches mentions, selects the newest mention, and replies using `reply_to_tweet`.

## License

[Apache-2.0](../../../LICENSE.md)
