import { parseArgs } from "node:util";
import { ClefClient } from "./clef.js";
import { loadConfig } from "./config.js";
import { buildState, describe, firedRules, toPatch } from "./engine.js";
import { FastmailClient } from "./fastmail.js";

const { values } = parseArgs({
  options: {
    config: { type: "string", short: "c", default: "triage.config.yaml" },
    apply: { type: "boolean", default: false },
    verbose: { type: "boolean", short: "v", default: false },
  },
});

function env(name: string, fallback?: string): string {
  const v = process.env[name] || fallback;
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

async function main() {
  const config = await loadConfig(values.config!);
  const clef = new ClefClient({
    host: env("OLLAMA_HOST", "http://localhost:11434"),
    model: env("CLEF_MODEL", "clef"),
    apiKey: process.env.OLLAMA_API_KEY || undefined,
  });
  const mail = new FastmailClient(env("FASTMAIL_API_TOKEN"));
  await mail.connect();

  const emails = await mail.listEmails(config);
  console.log(`${emails.length} email(s) in ${config.mailbox}. ${values.apply ? "APPLYING" : "dry run"}\n`);

  for (const email of emails) {
    const { answers } = await clef.decide(buildState(config.profile, email), config.questions);
    const rules = firedRules(config.rules, answers);

    console.log(`- ${email.subject} (${email.from[0]?.email ?? "unknown"})`);
    if (values.verbose) console.log(`  answers: ${JSON.stringify(answers)}`);
    for (const rule of rules) {
      console.log(`  ${rule.name}: ${rule.actions.map(describe).join(", ")}`);
      if (values.apply) {
        for (const action of rule.actions) await mail.patch(email.id, toPatch(action, mail));
      }
    }
    if (rules.length === 0) console.log("  (no rules fired)");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
