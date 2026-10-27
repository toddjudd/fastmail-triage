<img src="assets/icon.svg" width="64" height="64" alt="">

# fastmail-triage

A rules engine for email that asks questions instead of matching strings.

Rules like "body contains *promo*" break on the first email that doesn't use the word. fastmail-triage hands each email, plus a description of you (the **reader profile**), to Ollama's [Clef](https://ollama.com/library/clef) decision model along with a list of typed **questions**. Clef answers with calibrated probabilities. **Rules** match on those answers and run **actions** against your mailbox through the [Fastmail JMAP API](https://www.fastmail.com/dev/).

```
reader profile + email ──► Clef (questions) ──► answers ──► rules ──► Fastmail actions
```

Example: ask *"Does this need to be read?"*. If the probability is under 0.15, mark it read.

> **Status: early prototype.** It type-checks and the config loads, but it has not yet been run end to end against a live mailbox. Use the default dry run (read-only) before `--apply`.

## Concepts

| Piece | What it is |
| --- | --- |
| Profile | Free text about the reader: who matters, what they care about. Sent to Clef with every email. |
| Questions | Named, typed questions for Clef: `noul` (yes/no probability), `choice` (pick a label), `score` (rate on levels, lowest first). |
| Rules | Conditions over answers (`gte`, `lt`, `is`, `minConfidence`) joined with AND. Evaluated in order; `stop: true` ends evaluation. |
| Actions | `markRead`, `markUnread`, `flag`, `unflag`, `archive`, `trash`, `moveTo`, `addKeyword`. |

All questions go to Clef in one request per email (up to 64), so adding questions costs little.

## Setup

Requirements: Node 22+, pnpm, Ollama 0.35.1+ (0.40.6+ for `clef:cloud`), a Fastmail account.

```sh
pnpm install
ollama pull clef            # or use clef:cloud / clef-flash
cp .env.example .env        # add FASTMAIL_API_TOKEN
cp triage.config.example.yaml triage.config.yaml
```

Create the Fastmail token under **Settings > Privacy & Security > Integrations > API tokens** with Email read/write access.

## Usage

```sh
pnpm triage                 # dry run: print which rules would fire
pnpm triage -v              # also print Clef's raw answers
pnpm triage --apply         # actually change mail
pnpm triage -c other.yaml   # different config
```

Start with dry runs and `-v` to tune thresholds before using `--apply`.

## Config

See [`triage.config.example.yaml`](triage.config.example.yaml). A minimal rule:

```yaml
questions:
  needs_reading:
    type: noul
    instructions: Given the reader profile, does this email need to be read?

rules:
  - name: skip-able -> mark read
    when:
      - { question: needs_reading, lt: 0.15 }
    actions:
      - { type: markRead }
```

Matching by answer type:

- `noul`: `gte` / `lt` compare the probability of "true". `is: "true"` means ≥ 0.5.
- `choice`: `is` matches the winning label. `minConfidence` requires a clear winner.
- `score`: `gte` / `lt` compare the probability-weighted level (0 = first level).

## Environment

| Var | Default | Notes |
| --- | --- | --- |
| `FASTMAIL_API_TOKEN` | | required |
| `OLLAMA_HOST` | `http://localhost:11434` | `https://ollama.com` to call the cloud directly |
| `OLLAMA_API_KEY` | | needed only for `https://ollama.com` |
| `CLEF_MODEL` | `clef` | `clef:cloud`, `clef-flash` |

## Layout

```
src/
  index.ts     CLI: load config, fetch mail, ask Clef, apply rules
  config.ts    YAML config schema (zod)
  clef.ts      /v1/systemone client
  fastmail.ts  JMAP client: session, mailboxes, query, Email/set
  engine.ts    state building, rule matching, action -> JMAP patch
```

## Roadmap

- Track processed emails so reruns skip them
- Watch mode via JMAP push / EventSource
- Send image attachments to Clef (it's multimodal)
- Tests for rule matching

## License

[MIT](LICENSE)
