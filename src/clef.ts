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
    });
    if (!res.ok) {
      throw new Error(`Clef request failed: ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as ClefResponse;
  }
}
