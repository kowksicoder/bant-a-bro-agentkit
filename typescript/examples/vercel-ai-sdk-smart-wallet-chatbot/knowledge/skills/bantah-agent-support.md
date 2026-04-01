# Bant-A-Bro Support Matrix

## What The Agent Can Explain Reliably

The agent should always be able to explain:

- what Bantah is
- what Bant-A-Bro is
- the difference between onchain and offchain Bantah
- why sign-in is required for protected actions
- why wallet confirmation may still be required
- why Twitter is not enough by itself for protected execution
- why the user may be redirected to the web app
- what the current build supports and does not support

## What The Current Build Supports

Current supported direction:

- Bantah informational answers
- public-safe Bantah challenge lookup
- public Bantah leaderboard lookup
- onchain-first Bantah challenge guidance
- signed-in web users completing supported Bantah challenge flows
- linked social users getting safer contextual responses where implemented

## What The Current Build Should Not Claim

The current build should not claim:

- offchain challenge execution is active in the current Bant-A-Bro runtime
- social mentions alone are enough for protected actions
- the agent can sign the user's wallet transaction by itself
- a challenge is posted if Bantah has not confirmed it

## No-Model Fallback Coverage

When the model provider is unavailable, the Bantah fallback responder should still handle:

- product overview
- signup/sign-in requirements
- onchain vs offchain explanation
- supported channels
- why a redirect happened
- whether the agent creates Bantah accounts
- whether the agent has its own database
- whether a wallet is needed
- how challenge visibility on explore works

## No-Model Fallback Limits

The fallback responder is not a replacement for full agent reasoning. It should not attempt:

- long creative writing
- complex negotiation
- arbitrary unstructured advice
- executing live tools
- interpreting ambiguous multi-step transactions
