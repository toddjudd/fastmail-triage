import type { Answer } from "./clef.js";
import type { Action, Config, Rule, When } from "./config.js";
import type { EmailSummary, FastmailClient } from "./fastmail.js";

/** Build the state Clef judges: reader profile plus the email. */
export function buildState(profile: string, email: EmailSummary) {
  return {
    reader_profile: profile,
    email: {
      from: email.from.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)),
      to: email.to.map((a) => a.email),
      subject: email.subject,
      received_at: email.receivedAt,
      body: email.body || email.preview,
    },
  };
}

export function matches(w: When, answer: Answer | undefined): boolean {
  if (!answer) return false;
  switch (answer.type) {
    case "noul":
      if (w.is !== undefined) return (w.is === "true") === answer.noul >= 0.5;
      return (w.gte === undefined || answer.noul >= w.gte) && (w.lt === undefined || answer.noul < w.lt);
    case "choice":
      if (w.minConfidence !== undefined && answer.confidence < w.minConfidence) return false;
      return w.is === undefined || answer.choice === w.is;
    case "score":
      if (w.minConfidence !== undefined && answer.confidence < w.minConfidence) return false;
      return (w.gte === undefined || answer.score >= w.gte) && (w.lt === undefined || answer.score < w.lt);
  }
}

/** Rules whose conditions all match, in order, honoring `stop`. */
export function firedRules(rules: Rule[], answers: Record<string, Answer>): Rule[] {
  const fired: Rule[] = [];
  for (const rule of rules) {
    if (rule.when.every((w) => matches(w, answers[w.question]))) {
      fired.push(rule);
      if (rule.stop) break;
    }
  }
  return fired;
}

export function toPatch(action: Action, mail: FastmailClient): Record<string, unknown> {
  switch (action.type) {
    case "markRead": return { "keywords/$seen": true };
    case "markUnread": return { "keywords/$seen": null };
    case "flag": return { "keywords/$flagged": true };
    case "unflag": return { "keywords/$flagged": null };
    case "addKeyword": return { [`keywords/${action.keyword}`]: true };
    case "archive": return { mailboxIds: { [mail.mailbox("archive").id]: true } };
    case "trash": return { mailboxIds: { [mail.mailbox("trash").id]: true } };
    case "moveTo": return { mailboxIds: { [mail.mailbox(action.mailbox).id]: true } };
  }
}

export function describe(action: Action): string {
  if (action.type === "moveTo") return `moveTo(${action.mailbox})`;
  if (action.type === "addKeyword") return `addKeyword(${action.keyword})`;
  return action.type;
}

export type { Config };
