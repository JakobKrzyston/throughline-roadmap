/** Tests for the shared plain-language wording. */
import { describe, expect, it } from "vitest";

import { formatTarget } from "./product-text";

describe("formatTarget", () => {
  it("writes quarters and dates for reading", () => {
    expect(formatTarget("2026-Q4")).toBe("Q4 2026");
    expect(formatTarget("2027-01-11")).toBe("11 January 2027");
  });

  it("leaves anything else as written", () => {
    expect(formatTarget("Spring")).toBe("Spring");
    expect(formatTarget("2027-13-45")).toBe("2027-13-45");
  });
});
