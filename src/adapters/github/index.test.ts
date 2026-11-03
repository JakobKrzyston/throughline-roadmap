/** Tests for the GitHub configuration checks. */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isGitHubConfigured,
  isOwnerAllowed,
  missingGitHubSettings,
} from "./index";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isGitHubConfigured", () => {
  it("needs an owner allowlist as well as credentials", () => {
    vi.stubEnv("GITHUB_APP_ID", "1");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "key");
    vi.stubEnv("GITHUB_ALLOWED_OWNERS", "");
    expect(isGitHubConfigured()).toBe(false);

    vi.stubEnv("GITHUB_ALLOWED_OWNERS", "acme");
    expect(isGitHubConfigured()).toBe(true);
  });
});

describe("missingGitHubSettings", () => {
  it("names each unset variable, treating a blank allowlist as unset", () => {
    vi.stubEnv("GITHUB_APP_ID", "1");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "");
    vi.stubEnv("GITHUB_ALLOWED_OWNERS", "  ");
    expect(missingGitHubSettings()).toEqual([
      "GITHUB_APP_PRIVATE_KEY",
      "GITHUB_ALLOWED_OWNERS",
    ]);

    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "key");
    vi.stubEnv("GITHUB_ALLOWED_OWNERS", "acme");
    expect(missingGitHubSettings()).toEqual([]);
  });
});

describe("isOwnerAllowed", () => {
  it("allows listed owners, ignoring case and spaces", () => {
    vi.stubEnv("GITHUB_ALLOWED_OWNERS", "Acme, JakobKrzyston");
    expect(isOwnerAllowed("acme/analytics")).toBe(true);
    expect(isOwnerAllowed("jakobkrzyston/throughline-roadmap")).toBe(true);
  });

  it("refuses other owners and anything when the list is unset", () => {
    vi.stubEnv("GITHUB_ALLOWED_OWNERS", "acme");
    expect(isOwnerAllowed("other-org/private")).toBe(false);
    expect(isOwnerAllowed("acme-evil/analytics")).toBe(false);

    vi.stubEnv("GITHUB_ALLOWED_OWNERS", "");
    expect(isOwnerAllowed("acme/analytics")).toBe(false);
  });
});
