# CDP AgentKit Vercel AI SDK Smart Wallet + Twitter Chatbot Example

This example keeps the existing Vercel AI SDK smart wallet chatbot and extends it with Twitter (X) automation. The chatbot still runs as a terminal app, and now it can:

- manage the smart wallet with AgentKit tools
- post tweets
- fetch account mentions
- reply to tweets and mentions
- serve a local browser chat page
- run a separate background worker that auto-replies to new mentions

## Example chat commands

- "Transfer a portion of your ETH to a random address"
- "What is the price of BTC?"
- "Post this tweet: GM world"
- "Check my mentions"
- "Reply to my latest mention"
- "Reply to tweet 1901234567890123456 with thanks for reaching out"

## How the agent uses Twitter tools

The chatbot merges the standard AgentKit Vercel AI SDK tools with three example-local Twitter tools:

- `post_tweet`
- `get_mentions`
- `reply_to_tweet`

The system prompt tells the model when to use each tool. In practice:

- for "Post this tweet: ..." it should call `post_tweet`
- for "Check my mentions" it should call `get_mentions`
- for "Reply to my latest mention" it should call `get_mentions` first, then `reply_to_tweet`

Tool results are printed during streaming so you can see what the agent actually executed.

## New files

- `lib/twitter.ts`: local Twitter service using `twitter-api-v2`; handles posting tweets, reading mentions, and replying
- `lib/agent.ts`: shared agent initialization, merged tool registration, environment checks, and prompt assembly
- `web/server.ts`: local HTTP server that exposes a browser chat endpoint and streams model output plus tool results
- `web/index.html`: single-page chat UI wired into the same agent
- `workers/twitterWorker.ts`: background worker that polls mentions every 15 seconds, drafts replies with the agent, posts them, and persists processed tweet IDs
- `twitter_worker_state.json`: created automatically the first time the worker runs to avoid duplicate replies

## Prerequisites

### Node.js

The example requires Node.js 18 or higher.

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
