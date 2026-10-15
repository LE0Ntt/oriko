import { resultsFrom } from "./claude-engine";
import type { Depth, DescribeJob, EngineFailure, RunOutcome } from "./claude-engine";

/**
 * Oriko Cloud, the paid engine: Describe on Trevware's server, for people
 * with no Claude Code and no Anthropic account. The server owns the prompt,
 * so a batch goes as structured jobs; this is that request and how each
 * answer the server gives is read. Pure; the calls are src/cloud-engine.ts.
 */

export const CLOUD_BASE = "https://oriko-cloud.trevware.com";
/** Off until launch: the engine works when chosen, but settings do not offer it. */
export const CLOUD_LAUNCHED = false;
/** Where Subscribe goes; empty until the Polar checkout exists. */
export const CLOUD_CHECKOUT = "";
export const CLOUD_PROTOCOL = 1;
/** Obsidian keychain id for the license key. */
export const LICENSE_SECRET = "oriko-cloud-license";
/** Obsidian local storage key for this device's install id. */
export const INSTALL_KEY = "oriko-cloud-install";

export interface CloudUsage {
  month: string;
  used: number;
  limit: number;
  bonus: number;
}

export interface CloudJob {
  id: number;
  image: string | null;
  title: string;
  description: string;
  domain: string;
  body: string;
}

export interface CloudBody {
  protocol: number;
  depth: Depth;
  vocabulary: string[];
  jobs: CloudJob[];
}

/** The batch as the server takes it: the note's path stays on the device. */
export function cloudBody(jobs: DescribeJob[], vocabulary: string[], depth: Depth): CloudBody {
  return {
    protocol: CLOUD_PROTOCOL,
    depth,
    vocabulary,
    jobs: jobs.map(({ id, image, title, description, domain, body }) => ({ id, image, title, description, domain, body })),
  };
}

const FAILURES: Record<string, EngineFailure> = {
  "license-unknown": "license-rejected",
  "license-inactive": "license-inactive",
  "device-limit": "device-limit",
  "allowance-used": "allowance-used",
  unavailable: "cloud-unavailable",
  "rate-limited": "rate-limit",
  overloaded: "rate-limit",
};

/** What the server's answer means for the run, or that this device needs activating first. */
export function cloudOutcome(status: number, body: unknown): RunOutcome | "not-activated" {
  const v = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (status === 200 && Array.isArray(v.results)) {
    return { ok: true, results: resultsFrom({ items: v.results }) };
  }
  const code = typeof v.error === "string" ? v.error : "";
  const message = typeof v.message === "string" && v.message ? v.message : `Oriko Cloud answered ${status}`;
  if (code === "not-activated") return "not-activated";
  return { ok: false, failure: FAILURES[code] ?? "error", message };
}

export function usageLine(usage: CloudUsage): string {
  const n = (value: number) => value.toLocaleString("en-US");
  const month = `${n(usage.used)} of ${n(usage.limit)} this month`;
  return usage.used >= usage.limit ? `${month}, ${n(usage.bonus)} bonus left` : month;
}

/** How the device shows in the server's activations, and Polar's: platform and vault. */
export function installLabel(platform: string, vault: string): string {
  return `${platform} · ${vault}`.slice(0, 100);
}
