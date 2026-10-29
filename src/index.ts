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
      return `${a.choice} (${a.confidence.toFixed(2)})`;
    case "score": {
      const level = a.legend[String(Math.round(a.score))] ?? "?";
      return `${level} (${a.score.toFixed(2)})`;
    }
  }
}

const truncate = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** In-place progress text, only on an interactive terminal. */
const progress = (s: string) => {
  if (process.stderr.isTTY) process.stderr.write(s);
};

/** Print a box-drawn table. The first column is truncated so the table fits the terminal. */
function printTable(header: string[], rows: string[][]) {
  const widths = header.map((h, c) => Math.max(h.length, ...rows.map((r) => (r[c] ?? "").length)));
  const terminal = process.stdout.columns || 160;
  const others = widths.slice(1).reduce((a, b) => a + b, 0) + 3 * widths.length + 1;
  widths[0] = Math.max(20, Math.min(widths[0]!, terminal - others));

  const line = (l: string, m: string, r: string) => l + widths.map((w) => "─".repeat(w + 2)).join(m) + r;
  const row = (cells: string[]) =>
    "│" + widths.map((w, c) => ` ${truncate(cells[c] ?? "", w).padEnd(w)} `).join("│") + "│";

  console.log(line("┌", "┬", "┐"));
  console.log(row(header));
  console.log(line("├", "┼", "┤"));
  for (const r of rows) console.log(row(r));
  console.log(line("└", "┴", "┘"));
}

async function main() {
  const apply = values.apply === true;
  const config = await loadConfig(values.config!);
  if (values.limit) config.limit = Number(values.limit);

  const clef = new ClefClient({
    host: env("OLLAMA_HOST", "http://localhost:11434"),
    model: env("CLEF_MODEL", "clef"),
    apiKey: process.env.OLLAMA_API_KEY || undefined,
    timeoutMs: Number(process.env.CLEF_TIMEOUT_MS) || 120_000,
  });
  // Read-only unless --apply: writes throw before reaching Fastmail.
  const mail = new FastmailClient(env("FASTMAIL_API_TOKEN"), !apply);
  await mail.connect();

  const emails = await mail.listEmails(config);
  console.log(
    `${emails.length} email(s) in ${config.mailbox}. Mode: ${apply ? "APPLY (writing changes)" : "DRY RUN (read-only)"}\n`,
  );

  const questionNames = Object.keys(config.questions);
  const header = ["Email", ...questionNames, apply ? "Did" : "Would do"];
  const rows: string[][] = [];
  const tally = new Map<string, number>();

  for (const [i, email] of emails.entries()) {
    progress(`\rAsking Clef ${i + 1}/${emails.length}...`);
    const { answers } = await clef.decide(buildState(config.profile, email), config.questions);
    const rules = firedRules(config.rules, answers);

    if (values.verbose) {
      progress("\r\x1b[K");
      console.log(`${email.subject}\n  raw: ${JSON.stringify(answers)}`);
    }

    for (const rule of rules) {
      tally.set(rule.name, (tally.get(rule.name) ?? 0) + 1);
      if (apply) {
        for (const action of rule.actions) await mail.patch(email.id, toPatch(action, mail));
      }
    }
    if (rules.length === 0) tally.set("(none)", (tally.get("(none)") ?? 0) + 1);

    rows.push([
      email.subject || "(no subject)",
      ...questionNames.map((q) => (answers[q] ? formatAnswer(answers[q]) : "-")),
      rules.length ? rules.flatMap((r) => r.actions.map(describe)).join(", ") : "nothing",
    ]);
  }
  progress("\r\x1b[K");

  printTable(header, rows);

  console.log("\nSummary:");
  for (const [name, count] of tally) console.log(`  ${String(count).padStart(3)}  ${name}`);
  if (!apply) console.log("\nDry run: nothing was changed. Re-run with --apply to act.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
