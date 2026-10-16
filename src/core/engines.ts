import type { Depth, DescribeJob, RunOutcome } from "./claude-engine";
import type { DescribeEngine } from "./describe-run";

/**
 * Which engine does Describe's work: the Claude Code the user installed and
 * signed into, their own Anthropic API key, or Oriko Plus, the paid engine
 * on Trevware's server. The first two are the user's own and free; the
 * choice says whose bill a run lands on and what has to be set up.
 */

export type EngineKind = "claude-code" | "api-key" | "oriko-plus";

/**
 * Where the user's Anthropic API key is kept: Obsidian's keychain, under a
 * name of Oriko's own, so the key never enters data.json, which syncs.
 */
export const API_KEY_SECRET = "oriko-anthropic-api-key";

/** The engine in force. Until the user picks one, Claude Code when it is installed. */
export function effectiveEngine(chosen: EngineKind | "", claudeFound: boolean): EngineKind {
  if (chosen) return chosen;
  return claudeFound ? "claude-code" : "api-key";
}

export interface EngineState {
  enabled: boolean;
  desktop: boolean;
  engine: EngineKind;
  claudeFound: boolean;
  hasKey: boolean;
  hasLicense: boolean;
}

/** Describe is offered when switched on, on desktop, and once the engine in force can run. */
export function engineReady(state: EngineState): boolean {
  if (!state.enabled || !state.desktop) return false;
  if (state.engine === "claude-code") return state.claudeFound;
  return state.engine === "api-key" ? state.hasKey : state.hasLicense;
}

/** Runs each batch on the engine chosen at that moment, so a change in settings needs no reload. */
export class SwitchingEngine implements DescribeEngine {
  constructor(
    private engines: Record<EngineKind, DescribeEngine>,
    private choose: () => EngineKind
  ) {}

  run(jobs: DescribeJob[], vocabulary: string[], timeoutMs: number, depth: Depth): Promise<RunOutcome> {
    return this.engines[this.choose()].run(jobs, vocabulary, timeoutMs, depth);
  }

  cancelAll(): void {
    for (const engine of Object.values(this.engines)) engine.cancelAll();
  }
}
