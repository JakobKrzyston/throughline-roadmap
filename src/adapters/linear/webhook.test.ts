/** Tests for verifying and reading Linear webhook deliveries. */
import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { parseLinearWebhook, verifyLinearSignature } from "./webhook";

const SECRET = "linear-secret";
const body = Buffer.from('{"type":"Issue"}');
const sign = (secret: string, data: Buffer) =>
  createHmac("sha256", secret).update(data).digest("hex");

describe("verifyLinearSignature", () => {
  it("accepts the hex HMAC of the exact body", () => {
    expect(verifyLinearSignature(SECRET, body, sign(SECRET, body))).toBe(true);
  });

  it("rejects another secret, another body, or a missing or malformed header", () => {
    expect(verifyLinearSignature(SECRET, body, sign("other", body))).toBe(
      false,
    );
    expect(
      verifyLinearSignature(SECRET, Buffer.from("{}"), sign(SECRET, body)),
    ).toBe(false);
    expect(verifyLinearSignature(SECRET, body, null)).toBe(false);
    expect(verifyLinearSignature(SECRET, body, "abc")).toBe(false);
  });
});

describe("parseLinearWebhook", () => {
  const delivery = (action: string, type = "Issue") => ({
    type,
    action,
    data: { id: "issue-1", teamId: "team-1", title: "CSV export" },
    webhookTimestamp: 1762420000000,
  });

  it("reads which issue and team a create or update is about", () => {
    expect(parseLinearWebhook(delivery("create"))).toEqual({
      issueId: "issue-1",
      teamId: "team-1",
    });
    expect(parseLinearWebhook(delivery("update"))).toEqual({
      issueId: "issue-1",
      teamId: "team-1",
    });
  });

  it("ignores removed issues and other kinds of delivery", () => {
    expect(parseLinearWebhook(delivery("remove"))).toBeNull();
    expect(parseLinearWebhook(delivery("create", "Comment"))).toBeNull();
    expect(parseLinearWebhook({ hello: "world" })).toBeNull();
  });

  it("rejects an issue delivery without its ids", () => {
    expect(() =>
      parseLinearWebhook({ type: "Issue", action: "update", data: {} }),
    ).toThrow(ZodError);
  });
});
