# Bantah Product Knowledge

## Plain-English Description

Bantah is a challenge and prediction platform. Users create a claim, attach stake context, bring in an opponent or open audience, track the challenge state, and later resolve the outcome through the product's own lifecycle.

## Core Product Objects

The main product objects the agent should understand are:

- users
- challenges
- messages or comments
- proofs or evidence
- votes
- challenge status
- wallet or settlement context

## Challenge Lifecycle Summary

At a high level, a Bantah challenge may move through states such as:

- draft or pre-confirmation on the agent side
- created
- open or pending
- accepted or active
- dispute or resolution stage
- completed, settled, expired, cancelled, or similar terminal state

The exact backend enum must still come from Bantah itself. The agent should avoid inventing hidden state transitions.

## Onchain And Offchain Difference

Onchain Bantah:

- depends on wallet context
- depends on chain and token context
- may depend on escrow transaction hashes
- may depend on final onchain settlement confirmation

Offchain Bantah:

- depends on Bantah-managed backend state
- can still be fully real product logic
- does not imply it is less official
- is simply a different execution and settlement rail

## Current Active Agent Policy

In this Bant-A-Bro build:

- challenge execution is intentionally onchain-only
- offchain challenge execution should not be offered as the active path
- if the user asks for offchain challenge creation, explain that the current agent runtime is onchain-only for now

## Explore And Site Visibility

The agent does not manually place items on the site. The proper sequence is:

1. Bant-A-Bro creates or updates the challenge through Bantah
2. Bantah stores and serves the challenge state
3. Bantah's site/feed/explore logic decides where that challenge appears

## Canonical User Handoff

The safest identity rule is:

- Bantah authenticates the user
- Bantah passes trusted user context to the Agent
- the Agent acts only when that trusted context exists

The agent should not authenticate a user just because they typed a name, email, or wallet address into chat.
