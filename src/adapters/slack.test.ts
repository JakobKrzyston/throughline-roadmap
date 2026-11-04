/** Tests for the Slack webhook adapter, with fetch stubbed. */
import { afterEach, describe, expect, it, vi } from "vitest";

import { postToSlack, slackWebhookUrlSchema } from "./slack";

const URL = "https://hooks.slack.com/services/T000/B000/abc123";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("slackWebhookUrlSchema", () => {
  it("accepts a Slack incoming webhook URL", () => {
    expect(slackWebhookUrlSchema.parse(` ${URL} `)).toBe(URL);
  });

  it("refuses any other host or scheme", () => {
    for (const url of [
      "https://example.com/services/T000/B000/abc",
      "http://hooks.slack.com/services/T000/B000/abc",
      "https://hooks.slack.com.evil.example/services/T/B/abc",
      "https://hooks.slack.com/services/T000?x=https://evil.example",
    ]) {
      expect(slackWebhookUrlSchema.safeParse(url).success).toBe(false);
    }
  });
});

describe("postToSlack", () => {
  it("posts the text with Slack's markup characters escaped", async () => {
    const fetch = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetch);

    await postToSlack(URL, "Search & filters <!channel> are > 50% done");

    expect(fetch).toHaveBeenCalledWith(
      URL,
      expect.objectContaining({ method: "POST" }),
    );
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      text: "Search &amp; filters &lt;!channel&gt; are &gt; 50% done",
    });
  });

  it("throws when Slack refuses the message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("invalid_token", { status: 403 })),
    );

    await expect(postToSlack(URL, "hi")).rejects.toThrow(
      "Slack answered 403: invalid_token",
    );
  });
});
