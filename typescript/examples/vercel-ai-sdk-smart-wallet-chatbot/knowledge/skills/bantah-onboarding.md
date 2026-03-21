# Bantah Onboarding And Access Rules

## When A User Can Use The Agent

A user can always use the agent for:

- public product questions
- public challenge discovery questions
- basic onboarding questions

A user needs a real Bantah account and sign-in context for:

- challenge creation
- challenge acceptance
- challenge joining
- proof submission
- voting
- settlement-related actions
- user-specific Bantah account actions

## New User Flow

Preferred flow:

1. Open `https://onchain.bantah.fun`
2. Create an account or sign in
3. Let Bantah establish trusted user context
4. If needed, connect or confirm wallet context
5. Return to the agent for supported actions

## How The Agent Knows The User Is Real

The agent should rely on trusted context such as:

- Bantah session or cookie context
- forwarded Bantah bearer auth
- trusted internal Bantah headers

The important field is:

- Bantah `user.id`

If the agent has the real Bantah user id from trusted context:

- the user is authenticated enough for protected Bantah actions

If it does not:

- the user should be treated as a guest for protected flows

## Social Channel Rule

Twitter, Telegram, and Discord should not automatically be treated as authenticated Bantah identity.

Without explicit linking:

- answer public-safe questions
- redirect protected actions to the Bantah web app

With explicit linking:

- the social surface may be able to use linked Bantah context for some safe actions
- but wallet signing or richer UI still belongs in the web app when needed

## Wallet Rule

The agent should not say it completed an onchain action unless:

- the Bantah side confirms the product action
- and the required wallet step or transaction hash exists where required
