import { describe, expect, it } from "vitest";
import { z } from "zod";
import { completeJson, extractJson, type TextProvider } from "../src";

describe("extractJson", () => {
  it("extracts fenced and embedded JSON", () => {
    expect(extractJson('Here:\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(extractJson('prefix {"a": {"b": "}"}} suffix')).toEqual({ a: { b: "}" } });
    expect(extractJson("[1,2,3]")).toEqual([1, 2, 3]);
  });
  it("throws when there is no JSON", () => {
    expect(() => extractJson("no json here")).toThrow();
  });
});

describe("completeJson", () => {
  it("retries once with the validation error and sums usage", async () => {
    const replies = ['{"title": 5}', '{"title": "ok"}'];
    const prompts: string[] = [];
    const fake: TextProvider = {
      id: "fake",
      async complete(o) {
        prompts.push(o.prompt);
        return { text: replies.shift()!, usage: { inputTokens: 10, outputTokens: 5 }, model: "m" };
      },
      async test() {
        return "ok";
      },
    };
    const r = await completeJson(fake, { model: "m", prompt: "make json", schema: z.object({ title: z.string() }), schemaHint: '{"title": string}' });
    expect(r.data).toEqual({ title: "ok" });
    expect(r.usage).toEqual({ inputTokens: 20, outputTokens: 10 });
    expect(prompts[1]).toMatch(/previous answer was not valid/);
  });
});
