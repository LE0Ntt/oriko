/**
 * Where an external tool might live, as an ordered list of paths to try.
 *
 * The list is built from three tiers: an explicit override from settings, the
 * directories on PATH, and a set of fixed fallback locations for the package
 * managers whose install dirs commonly stay off Obsidian's PATH (Electron
 * launches with the desktop session's environment, and on macOS that omits
 * the shell profile that Homebrew edits). The caller checks existence; this
 * stays pure so the tiering can be tested.
 */

export interface ToolEnv {
  /** The PATH variable's raw value, "" when unavailable. */
  pathVar: string;
  /** ":" on POSIX, ";" on Windows. */
  delimiter: string;
  windows: boolean;
}

/**
 * A lookup remembered until reset, for discovery that touches the disk and is
 * asked far more often than its answer changes (the palette asks on every
 * keystroke; the answer changes when a path setting does).
 */
export function cached<T>(lookup: () => T): { get(): T; reset(): void } {
  let known = false;
  let value: T;
  return {
    get(): T {
      if (!known) {
        value = lookup();
        known = true;
      }
      return value;
    },
    reset(): void {
      known = false;
    },
  };
}

export function executableCandidates(
  name: string,
  env: ToolEnv,
  fixed: string[],
  override?: string
): string[] {
  const file = env.windows ? `${name}.exe` : name;
  const joiner = env.windows ? "\\" : "/";

  const fromPath = env.pathVar
    .split(env.delimiter)
    .map((dir) => dir.trim())
    .filter((dir) => dir.length > 0)
    .map((dir) => (dir.endsWith(joiner) ? dir.slice(0, -1) : dir))
    .map((dir) => `${dir}${joiner}${file}`);

  const candidates = [...fromPath, ...fixed];
  if (override?.trim()) candidates.unshift(override.trim());
  return candidates;
}
