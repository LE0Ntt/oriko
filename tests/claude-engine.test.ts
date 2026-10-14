import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BATCH_SCHEMA,
  SYSTEM_PROMPT,
  batchMessage,
  childEnv,
  claudeArgs,
  parseRun,
  spawnOptions,
  textCollector,
} from "../src/core/claude-engine";
import type { DescribeJob } from "../src/core/claude-engine";

const fixture = (name: string): string =>
  readFileSync(`tests/fixtures/describe/${name}.jsonl`, "utf8");

const job = (over: Partial<DescribeJob> = {}): DescribeJob => ({
  id: 0,
  path: "Clippings/A.md",
  image: "QUJD",
  title: "A",
  description: "",
  domain: "example.com",
  body: "",
  ...over,
});

const after = (args: string[], flag: string): string => args[args.indexOf(flag) + 1];

interface Block {
  type: string;
  text?: string;
  source?: unknown;
}

interface Message {
  type: string;
  message: { role: string; content: Block[] };
}

const parse = (line: string): Message => JSON.parse(line) as Message;

describe("claudeArgs", () => {
  it("runs Haiku headless at low effort with hooks, tools and MCP servers off", () => {
    const args = claudeArgs();
    expect(args[0]).toBe("-p");
    expect(after(args, "--model")).toBe("haiku");
    expect(after(args, "--effort")).toBe("low");
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--no-session-persistence");
    expect(args).toContain("--verbose");
    expect(after(args, "--tools")).toBe("");
    expect(JSON.parse(after(args, "--settings"))).toEqual({ disableAllHooks: true });
    expect(after(args, "--input-format")).toBe("stream-json");
    expect(after(args, "--output-format")).toBe("stream-json");
    expect(JSON.parse(after(args, "--json-schema"))).toEqual(BATCH_SCHEMA);
    expect(after(args, "--system-prompt")).toBe(SYSTEM_PROMPT);
  });
});

describe("batchMessage", () => {
  it("labels each clipping, then sends its image and note text, then the instructions", () => {
    const line = batchMessage(
      [job({ id: 0, title: "Golf" }), job({ id: 1, image: null, title: "Rice" })],
      ["design", "ios"]
    );
    expect(line.endsWith("\n")).toBe(true);
    const message = parse(line);
    expect(message.type).toBe("user");
    const content = message.message.content;
    expect(content[0]).toEqual({ type: "text", text: "Clipping 0:" });
    expect(content[1]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: "QUJD" },
    });
    expect(content[2].text).toContain("Title: Golf");
    expect(content[3]).toEqual({ type: "text", text: "Clipping 1:" });
    expect(content[4].type).toBe("text");
    expect(content[4].text).toContain("Title: Rice");
    expect(content[content.length - 1].text).toContain("Existing categories: design, ios.");
  });

  it("says so when the wall has no categories yet", () => {
    const content = parse(batchMessage([job()], [])).message.content;
    expect(content[content.length - 1].text).toContain("Existing categories: none yet.");
  });

  it("leaves out empty note fields", () => {
    const content = parse(batchMessage([job()], ["x"])).message.content;
    expect(content[2].text).toBe("Title: A\nSource: example.com");
  });
});

describe("parseRun", () => {
  it("reads a batch of ten from real Claude Code output", () => {
    const run = parseRun(fixture("batch-result"));
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.results).toHaveLength(10);
    expect(run.results[0].id).toBe(0);
    expect(run.results[0].caption).toMatch(/pixel-art/);
    expect(run.results[4].proposals[0].term).toBe("sports");
  });

  it("reads a single answer without an items list as id 0", () => {
    const run = parseRun(fixture("single-result"));
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.results).toHaveLength(1);
    expect(run.results[0].id).toBe(0);
    expect(run.results[0].categories).toContain("design");
  });

  it("recognises a Claude Code that is not logged in", () => {
    const run = parseRun(fixture("not-logged-in"));
    expect(run).toMatchObject({ ok: false, failure: "not-logged-in" });
  });

  it("treats a refused rate limit status as the usage limit", () => {
    const stdout = [
      JSON.stringify({ type: "rate_limit_event", rate_limit_info: { status: "rejected" } }),
      JSON.stringify({ type: "result", is_error: true, result: "Claude AI usage limit reached" }),
    ].join("\n");
    expect(parseRun(stdout)).toMatchObject({ ok: false, failure: "usage-limit" });
  });

  it("recognises a rate limit as something to wait out", () => {
    const stdout = JSON.stringify({ type: "result", is_error: true, result: "API Error: 429 rate limit" });
    expect(parseRun(stdout)).toMatchObject({ ok: false, failure: "rate-limit" });
  });

  it("skips lines that are not JSON", () => {
    const run = parseRun(`warning: something odd\n{not json\n${fixture("batch-result")}`);
    expect(run.ok).toBe(true);
  });

  it("reports a run that ended without a result line", () => {
    expect(parseRun("")).toMatchObject({ ok: false, failure: "error" });
  });
});

describe("childEnv", () => {
  it("drops the API key and puts the tool's folder and Homebrew on PATH", () => {
    const env = childEnv(
      { PATH: "/usr/bin:/opt/homebrew/bin", ANTHROPIC_API_KEY: "sk-x", HOME: "/Users/t" },
      "/Users/t/.local/bin",
      ":"
    );
    expect("ANTHROPIC_API_KEY" in env).toBe(false);
    expect(env.PATH).toBe("/Users/t/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin");
    expect(env.HOME).toBe("/Users/t");
  });

  it("only adds the tool's folder on Windows", () => {
    const env = childEnv({ Path: "C:\\Windows" }, "C:\\Tools", ";");
    expect(env.Path).toBe("C:\\Tools;C:\\Windows");
  });
});

describe("textCollector", () => {
  it("decodes a character split across chunks", () => {
    const bytes = new TextEncoder().encode("a·b 从这里开始");
    const collect = textCollector();
    collect.push(bytes.slice(0, 2));
    collect.push(bytes.slice(2, 9));
    collect.push(bytes.slice(9));
    expect(collect.text()).toBe("a·b 从这里开始");
  });

  it("takes strings as they come", () => {
    const collect = textCollector();
    collect.push("ab");
    collect.push("c");
    expect(collect.text()).toBe("abc");
  });
});

describe("spawnOptions", () => {
  it("discards stderr so a chatty Claude Code cannot block on a full pipe", () => {
    expect(spawnOptions("/tmp", { PATH: "/usr/bin" })).toEqual({
      cwd: "/tmp",
      env: { PATH: "/usr/bin" },
      stdio: ["pipe", "pipe", "ignore"],
    });
  });
});
