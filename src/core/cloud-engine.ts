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
/** The server's cap on one picture, in base64 characters. */
export const CLOUD_IMAGE_MAX = 1_000_000;
/** The server's caps on text: title, description and domain, and the category list and each category. */
export const CLOUD_LIMITS = { field: 500, terms: 500, term: 80 };

/** A whole Polar license key: an uppercase UUID, with the benefit's prefix in front when set. */
const KEY_SHAPE = /^(?:[A-Z0-9_]{1,32}-)?[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;

export function looksLikeKey(key: string): boolean {
  return KEY_SHAPE.test(key.trim());
}

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
  const cut = (text: string) => text.slice(0, CLOUD_LIMITS.field);
  return {
    protocol: CLOUD_PROTOCOL,
    depth,
    // The wall's categories come most used first, so the cut keeps the ones that matter.
    vocabulary: vocabulary.filter((term) => term.length <= CLOUD_LIMITS.term).slice(0, CLOUD_LIMITS.terms),
    // A picture past the server's cap would fail the whole batch; that clip
    // is described from its text instead.
    jobs: jobs.map(({ id, image, title, description, domain, body }) => ({
      id,
      image: image && image.length <= CLOUD_IMAGE_MAX ? image : null,
      title: cut(title),
      description: cut(description),
      domain: cut(domain),
      body,
    })),
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
  // Every batch would be refused the same way: stop and say so.
  "bad-request": "cloud-refused",
  // Charged though unanswered: retrying clip by clip would charge it again.
  timeout: "batch-lost",
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

export type Readiness = { ok: true } | { ok: false; failure: EngineFailure; message: string };

/**
 * Makes sure this device is activated before a run's batches go out, once for
 * all six lanes: without it each lane would send a whole batch only to hear
 * "not activated", then all six would try to activate at once. Remembered
 * per key until a batch says otherwise.
 */
export class ActivationGate {
  private key: string | null = null;
  private ready = false;
  private pending: Promise<Readiness> | null = null;

  constructor(private check: () => Promise<Readiness>) {}

  wait(key: string): Promise<Readiness> {
    if (this.key !== key) {
      this.key = key;
      this.ready = false;
      this.pending = null;
    }
    if (this.ready) return Promise.resolve({ ok: true });
    this.pending ??= this.check().then((result) => {
      if (result.ok) this.ready = true;
      this.pending = null;
      return result;
    });
    return this.pending;
  }

  forget(): void {
    this.ready = false;
    this.pending = null;
  }
}
