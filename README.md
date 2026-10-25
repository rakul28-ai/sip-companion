# Tight-Month Companion (concept prototype)

An independent student project for the NextLeap PM Fellowship. **Not affiliated with or endorsed by Groww.** SIP actions are simulated; nothing is invested or changed. The assistant gives information only, not investment advice.

## What it does
Helps first-time SIP investors through a tight month at three moments:
1. **Before the debit:** a reminder with one-tap Keep, Skip this month, Lower this month, or Ask.
2. **At the stop moment:** an option to pause with a planned restart date instead of stopping by default.
3. **On the restart day:** a one-tap restart.

The assistant (Claude) has two jobs: extract the user's payday to plan a restart date (the date itself is calculated by a fixed rule in `lib/rules.js`), and explain how SIP controls work using only the cited sources in `lib/kb.js`.

## Eval gate
Every answer passes these checks before it is shown, otherwise a fallback is shown:
- G1 grounded: cites at least one knowledge base source, and only real ones
- G2 supported: a second model call confirms the answer is supported by the cited text
- G3 no advice: model flag, code check and judge
- G4 no pressure: banned-phrase check and judge
- G5 privacy: PAN and account numbers are blocked before reaching the model
- G6 in scope: out-of-scope questions get a fallback

`eval.html` runs the 20-case golden set from the PRD against the live API.

## Deploy (Vercel)
1. Import this repository in Vercel.
2. Add the environment variable `ANTHROPIC_API_KEY` (never commit it).
3. Deploy. Set a monthly spend limit on the API key.

## Files
- `index.html`, `styles.css`, `app.js`: prototype UI
- `api/chat.js`: serverless function (assistant, gate, fallbacks)
- `lib/kb.js`: knowledge base with sources
- `lib/rules.js`: restart date rule, privacy and wording checks
- `eval.html`: golden set runner
