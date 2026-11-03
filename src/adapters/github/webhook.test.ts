/** Tests for GitHub webhook signature checks and payload parsing. */
import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { issuePayload, pullRequestPayload } from "./fixtures";
import { parseWebhookEvent, verifyWebhookSignature } from "./webhook";

const SECRET = "test-secret";
const body = Buffer.from('{"hello":"world"}');
const sign = (secret: string, data: Buffer): string =>
  `sha256=${createHmac("sha256", secret).update(data).digest("hex")}`;

describe("verifyWebhookSignature", () => {
  it("accepts a signature made with the secret", () => {
    expect(verifyWebhookSignature(SECRET, body, sign(SECRET, body))).toBe(true);
  });

  it("rejects a signature made with another secret", () => {
    expect(verifyWebhookSignature(SECRET, body, sign("other", body))).toBe(
      false,
    );
  });

  it("rejects a signature for a different body", () => {
    const tampered = Buffer.from('{"hello":"there"}');
    expect(verifyWebhookSignature(SECRET, tampered, sign(SECRET, body))).toBe(
      false,
    );
  });

  it("rejects a missing or malformed header", () => {
    expect(verifyWebhookSignature(SECRET, body, null)).toBe(false);
    expect(verifyWebhookSignature(SECRET, body, "sha256=abc")).toBe(false);
    expect(
      verifyWebhookSignature(SECRET, body, sign(SECRET, body).slice(7)),
    ).toBe(false);
  });
});

describe("parseWebhookEvent", () => {
  it("reads an open pull request", () => {
    expect(parseWebhookEvent("pull_request", pullRequestPayload())).toEqual({
      repository: { externalId: "4242", fullName: "acme/analytics" },
      item: {
        source: "github",
        externalId: "4242#41",
        kind: "pull_request",
        title: "Add CSV export",
        body: "Implements TL-3",
        url: "https://github.com/acme/analytics/pull/41",
        state: "open",
        mergedAt: null,
        closedAt: null,
        updatedAt: new Date("2026-11-01T09:00:00Z"),
      },
    });
  });

  it("marks a closed pull request with a merge date as merged", () => {
    const event = parseWebhookEvent(
      "pull_request",
      pullRequestPayload(
        {
          state: "closed",
          merged_at: "2026-11-01T10:00:00Z",
          closed_at: "2026-11-01T10:00:00Z",
        },
        "closed",
      ),
    );
    expect(event?.item.state).toBe("merged");
    expect(event?.item.mergedAt).toEqual(new Date("2026-11-01T10:00:00Z"));
  });

  it("keeps a pull request closed without merging as closed", () => {
    const event = parseWebhookEvent(
      "pull_request",
      pullRequestPayload(
        { state: "closed", closed_at: "2026-11-01T10:00:00Z" },
        "closed",
      ),
    );
    expect(event?.item.state).toBe("closed");
    expect(event?.item.mergedAt).toBeNull();
  });

  it("reads an issue and treats a null body as empty", () => {
    const event = parseWebhookEvent("issues", issuePayload());
    expect(event?.item).toMatchObject({
      externalId: "4242#7",
      kind: "issue",
      state: "open",
      body: "",
    });
  });

  it("tells an issue closed as done from one closed as not planned or duplicate", () => {
    const closed = (state_reason: string | null) =>
      parseWebhookEvent(
        "issues",
        issuePayload({ state: "closed", state_reason }, "closed"),
      )?.item.state;
    expect(closed("completed")).toBe("closed");
    expect(closed(null)).toBe("closed");
    expect(closed("not_planned")).toBe("not_planned");
    expect(closed("duplicate")).toBe("not_planned");
  });

  it("ignores deleted and transferred issues", () => {
    expect(parseWebhookEvent("issues", issuePayload({}, "deleted"))).toBeNull();
    expect(
      parseWebhookEvent("issues", issuePayload({}, "transferred")),
    ).toBeNull();
  });

  it("ignores events it does not track", () => {
    expect(parseWebhookEvent("ping", { zen: "Keep it simple." })).toBeNull();
    expect(parseWebhookEvent(null, {})).toBeNull();
  });

  it("rejects a tracked event with missing fields", () => {
    expect(() =>
      parseWebhookEvent("pull_request", { action: "opened" }),
    ).toThrow(ZodError);
  });
});
