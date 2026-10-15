import type { Depth, DescribeJob, RunOutcome } from "./claude-engine";
import type { DescribeEngine } from "./describe-run";

/**
 * Which engine does Describe's work: the Claude Code the user installed and
 * signed into, or their own Anthropic API key. Both are the user's own; the
 * choice only says whose bill a run lands on and what has to be set up.
 */

export type EngineKind = "claude-code" | "api-key";

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
}

/** Describe is offered when switched on, on desktop, and once the engine in force can run. */
export function engineReady(state: EngineState): boolean {
  if (!state.enabled || !state.desktop) return false;
  return state.engine === "claude-code" ? state.claudeFound : state.hasKey;
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
