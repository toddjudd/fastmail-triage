import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { z } from "zod";

/** A typed question sent to Clef. Mirrors the System One question schema. */
const QuestionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("noul"),
    instructions: z.string(),
    criteria: z.object({ true: z.string(), false: z.string() }).optional(),
  }),
  z.object({
    type: z.literal("choice"),
    instructions: z.string(),
    criteria: z.record(z.string(), z.string().nullable()),
  }),
  z.object({
    type: z.literal("score"),
    instructions: z.string(),
    criteria: z.array(z.string()).min(2).max(10),
  }),
]);

/** Something to do to an email. */
const ActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("markRead") }),
  z.object({ type: z.literal("markUnread") }),
  z.object({ type: z.literal("flag") }),
  z.object({ type: z.literal("unflag") }),
  z.object({ type: z.literal("archive") }),
  z.object({ type: z.literal("trash") }),
  z.object({ type: z.literal("moveTo"), mailbox: z.string() }),
  z.object({ type: z.literal("addKeyword"), keyword: z.string() }),
]);

/**
 * A condition over Clef's answers. All present fields must match.
 * - noul: probability the answer is true, compared with `gte` / `lt`
 * - choice: `is` matches the winning option (optionally `minConfidence`)
 * - score: probability-weighted level compared with `gte` / `lt`
 */
const WhenSchema = z.object({
  question: z.string(),
  is: z.string().optional(),
  gte: z.number().optional(),
  lt: z.number().optional(),
  minConfidence: z.number().min(0).max(1).optional(),
});

const RuleSchema = z.object({
  name: z.string(),
  when: z.array(WhenSchema).min(1),
  actions: z.array(ActionSchema).min(1),
  /** Stop evaluating later rules once this one fires. */
  stop: z.boolean().default(false),
});

export const ConfigSchema = z.object({
  /** Who is reading the mail. Given to Clef as part of the state. */
  profile: z.string(),
  /** Mailbox role or name to triage. */
  mailbox: z.string().default("inbox"),
  /** Only consider unread mail. */
  unreadOnly: z.boolean().default(true),
  limit: z.number().int().positive().default(25),
  /** Max characters of body text sent to Clef. */
  maxBodyChars: z.number().int().positive().default(8000),
  questions: z.record(z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/), QuestionSchema),
  rules: z.array(RuleSchema),
});

export type Question = z.infer<typeof QuestionSchema>;
export type Action = z.infer<typeof ActionSchema>;
export type When = z.infer<typeof WhenSchema>;
export type Rule = z.infer<typeof RuleSchema>;
export type Config = z.infer<typeof ConfigSchema>;

export async function loadConfig(path: string): Promise<Config> {
  const config = ConfigSchema.parse(parse(await readFile(path, "utf8")));
  for (const rule of config.rules) {
    for (const w of rule.when) {
      if (!(w.question in config.questions)) {
        throw new Error(`Rule "${rule.name}" references unknown question "${w.question}"`);
      }
    }
  }
  return config;
}
