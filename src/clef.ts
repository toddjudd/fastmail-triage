import type { Question } from "./config.js";

export type Answer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  | {
      type: "score";
      score: number;
      legend: Record<string, string>;
      probabilities: Record<string, number>;
      confidence: number;
    };

export interface ClefResponse {
  model: string;
  answers: Record<string, Answer>;
  usage?: { input_tokens: number; output_tokens: number };
}

export interface ClefOptions {
  host: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
}

/**
 * Minimal client for Ollama's System One endpoint (`/v1/systemone`).
 * Uses fetch directly so it works regardless of the ollama-js version installed.
 */
export class ClefClient {
  constructor(private readonly opts: ClefOptions) {}

  async decide(state: unknown, questions: Record<string, Question>): Promise<ClefResponse> {
    const res = await fetch(new URL("/v1/systemone", this.opts.host), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.opts.apiKey ? { Authorization: `Bearer ${this.opts.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: this.opts.model, state, questions }),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 120_000),
    }).catch((err: unknown) => {
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new Error(
          `Clef (${this.opts.model}) did not answer within ${(this.opts.timeoutMs ?? 120_000) / 1000}s. ` +
            "Check the model with a tiny request, or try CLEF_MODEL=clef-flash / clef:cloud.",
        );
      }
      throw err;
    });
    if (!res.ok) {
      throw new Error(`Clef request failed: ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as ClefResponse;
  }
}
