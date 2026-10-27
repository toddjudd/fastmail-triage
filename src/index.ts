import { parseArgs } from "node:util";
import { ClefClient, type Answer } from "./clef.js";
import { loadConfig } from "./config.js";
import { buildState, describe, firedRules, toPatch } from "./engine.js";
import { FastmailClient } from "./fastmail.js";

const { values } = parseArgs({
  options: {
    config: { type: "string", short: "c", default: "triage.config.yaml" },
    apply: { type: "boolean", default: false },
    limit: { type: "string", short: "n" },
    verbose: { type: "boolean", short: "v", default: false },
  },
});

function env(name: string, fallback?: string): string {
  const v = process.env[name] || fallback;
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

function formatAnswer(a: Answer): string {
  switch (a.type) {
    case "noul":
      return `${a.noul >= 0.5 ? "yes" : "no"} (${a.noul.toFixed(2)})`;
    case "choice":
      return `${a.choice} (conf ${a.confidence.toFixed(2)})`;
    case "score": {
      const level = a.legend[String(Math.round(a.score))] ?? "?";
      return `${a.score.toFixed(2)} ~ ${level}`;
    }
  }
}

async function main() {
  const apply = values.apply === true;
  const config = await loadConfig(values.config!);
  if (values.limit) config.limit = Number(values.limit);

  const clef = new ClefClient({
    host: env("OLLAMA_HOST", "http://localhost:11434"),
    model: env("CLEF_MODEL", "clef"),
    apiKey: process.env.OLLAMA_API_KEY || undefined,
  });
  // Read-only unless --apply: writes throw before reaching Fastmail.
  const mail = new FastmailClient(env("FASTMAIL_API_TOKEN"), !apply);
  await mail.connect();

  const emails = await mail.listEmails(config);
  console.log(
    `${emails.length} email(s) in ${config.mailbox}. Mode: ${apply ? "APPLY (writing changes)" : "DRY RUN (read-only)"}\n`,
  );

  const tally = new Map<string, number>();
  for (const email of emails) {
    const started = Date.now();
    const { answers } = await clef.decide(buildState(config.profile, email), config.questions);
    const rules = firedRules(config.rules, answers);

    const from = email.from[0];
    console.log(`■ ${email.subject || "(no subject)"}`);
    console.log(`  from: ${from ? (from.name ? `${from.name} <${from.email}>` : from.email) : "unknown"}  ·  ${email.receivedAt}  ·  ${Date.now() - started}ms`);
    for (const [name, answer] of Object.entries(answers)) {
      console.log(`  ${name.padEnd(16)} ${formatAnswer(answer)}`);
    }
    if (values.verbose) console.log(`  raw: ${JSON.stringify(answers)}`);

    if (rules.length === 0) {
      console.log("  → no rules fired (leave as is)");
      tally.set("(none)", (tally.get("(none)") ?? 0) + 1);
    }
    for (const rule of rules) {
      const verb = apply ? "→" : "→ would";
      console.log(`  ${verb} ${rule.actions.map(describe).join(", ")}   [${rule.name}]`);
      tally.set(rule.name, (tally.get(rule.name) ?? 0) + 1);
      if (apply) {
        for (const action of rule.actions) await mail.patch(email.id, toPatch(action, mail));
      }
    }
    console.log();
  }

  console.log("Summary:");
  for (const [name, count] of tally) console.log(`  ${String(count).padStart(3)}  ${name}`);
  if (!apply) console.log("\nDry run: nothing was changed. Re-run with --apply to act.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
