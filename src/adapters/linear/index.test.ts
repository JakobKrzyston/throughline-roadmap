/** Tests for picking the Linear source from the environment and the project. */
import { afterEach, describe, expect, it, vi } from "vitest";

import { LinearApiSource } from "./client";
import { FakeLinearSource } from "./fake";
import { linearSourceFor } from "./index";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("linearSourceFor", () => {
  it("reads the sample workspace without LINEAR_API_KEY", () => {
    vi.stubEnv("LINEAR_API_KEY", " ");
    const { source, sample } = linearSourceFor({ isDemo: false });
    expect(source).toBeInstanceOf(FakeLinearSource);
    expect(sample).toBe(true);
  });

  it("reads Linear with a key", () => {
    vi.stubEnv("LINEAR_API_KEY", "lin_api_x");
    const { source, sample } = linearSourceFor({ isDemo: false });
    expect(source).toBeInstanceOf(LinearApiSource);
    expect(sample).toBe(false);
  });

  it("never reads Linear for a demo project", () => {
    vi.stubEnv("LINEAR_API_KEY", "lin_api_x");
    const { source, sample } = linearSourceFor({ isDemo: true });
    expect(source).toBeInstanceOf(FakeLinearSource);
    expect(sample).toBe(true);
  });
});
