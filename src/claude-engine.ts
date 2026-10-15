import { batchMessage, childEnv, claudeArgs, parseRun, spawnOptions, textCollector } from "./core/claude-engine";
import type { DescribeJob, Depth, RunOutcome } from "./core/claude-engine";
import type { DescribeEngine } from "./core/describe-run";
import { nodeRequire } from "./core/system";
import { claudePath, forgetClaudePath, hostEnv } from "./convert";

/**
 * Runs Claude Code for Describe. The thin half: what to send and how to read
 * the answer are in core/claude-engine.ts. One process per batch; the batch
 * goes in on stdin and the answer comes back as stream-json on stdout.
 */

interface Readable {
  on(event: "data", listener: (chunk: unknown) => void): void;
}

interface ChildProcess {
  stdin: { write(data: string): void; end(): void; on(event: "error", listener: () => void): void };
  stdout: Readable;
  on(event: "close", listener: () => void): void;
  on(event: "error", listener: (error: unknown) => void): void;
  kill(): boolean;
}

interface SpawnModule {
  spawn(
    command: string,
    args: string[],
    options: ReturnType<typeof spawnOptions>
  ): ChildProcess;
}

interface OsModule {
  tmpdir(): string;
}

interface PathModule {
  dirname(path: string): string;
}

export function claudeAvailable(): boolean {
  return nodeRequire("child_process") !== null && claudePath() !== null;
}

export class ClaudeCodeEngine implements DescribeEngine {
  private children = new Set<ChildProcess>();

  /** `preferLogin` is the user's switch to have Claude Code skip an ANTHROPIC_API_KEY it would otherwise bill. */
  constructor(private preferLogin: () => boolean) {}

  run(jobs: DescribeJob[], vocabulary: string[], timeoutMs: number, depth: Depth): Promise<RunOutcome> {
    const command = claudePath();
    const cp = nodeRequire("child_process") as SpawnModule | null;
    const os = nodeRequire("os") as OsModule | null;
    const path = nodeRequire("path") as PathModule | null;
    if (!command || !cp || !os || !path) {
      return Promise.resolve({ ok: false, failure: "not-found", message: "Claude Code was not found" });
    }

    return new Promise<RunOutcome>((resolve) => {
      const stdout = textCollector();
      let settled = false;
      let child: ChildProcess;
      const { env, delimiter } = hostEnv();

      try {
        // The temp folder as working directory, so no project CLAUDE.md is read.
        child = cp.spawn(
          command,
          claudeArgs(),
          spawnOptions(os.tmpdir(), childEnv(env, path.dirname(command), delimiter, this.preferLogin()))
        );
      } catch (error) {
        resolve({ ok: false, failure: "error", message: String(error) });
        return;
      }

      const finish = (outcome: RunOutcome): void => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        this.children.delete(child);
        resolve(outcome);
      };

      const timer = window.setTimeout(() => {
        child.kill();
        finish({ ok: false, failure: "error", message: "Claude Code timed out" });
      }, timeoutMs);

      this.children.add(child);
      child.stdout.on("data", (chunk) => stdout.push(chunk));
      child.on("error", (error) => {
        // ENOENT: the remembered path no longer leads to Claude Code.
        if ((error as { code?: unknown } | null)?.code === "ENOENT") {
          forgetClaudePath();
          finish({ ok: false, failure: "not-found", message: String(error) });
        } else {
          finish({ ok: false, failure: "error", message: String(error) });
        }
      });
      child.on("close", () => finish(parseRun(stdout.text())));
      // A process that dies before reading stdin closes the pipe; the close
      // handler above reports it, so the write error itself is not news.
      child.stdin.on("error", () => undefined);
      child.stdin.write(batchMessage(jobs, vocabulary, depth));
      child.stdin.end();
    });
  }

  cancelAll(): void {
    for (const child of this.children) child.kill();
    this.children.clear();
  }
}
