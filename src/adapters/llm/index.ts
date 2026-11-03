/** Picks the app's LLM provider: Claude when ANTHROPIC_API_KEY is set, the fake provider otherwise. Exports getLLMProvider, isDemoLLM. */
import Anthropic from "@anthropic-ai/sdk";

import { AnthropicProvider, DEFAULT_MODEL } from "./anthropic";
import { type FakeFixtures, FakeLLMProvider } from "./fake";
import type { LLMProvider } from "./provider";

/**
 * Whether agents run on canned fixtures because no API key is set.
 *
 * Returns:
 *   True when ANTHROPIC_API_KEY is unset or empty.
 */
export function isDemoLLM(): boolean {
  return !process.env.ANTHROPIC_API_KEY;
}

/**
 * Return the provider agents should use.
 *
 * Args:
 *   demoFixtures: Outputs the fake provider serves per task when no API key is set.
 *
 * Returns:
 *   An AnthropicProvider using ANTHROPIC_MODEL (default claude-sonnet-5-5), or a FakeLLMProvider
 *   serving demoFixtures when no API key is set.
 */
export function getLLMProvider(demoFixtures: FakeFixtures): LLMProvider {
  if (isDemoLLM()) return new FakeLLMProvider(demoFixtures);
  return new AnthropicProvider(
    new Anthropic(),
    process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
  );
}
