/** Picks the app's LLM providers from the environment. Exports getLLMProvider, getDemoLLMProvider, isDemoLLM, demoModel. */
import Anthropic from "@anthropic-ai/sdk";

import { AnthropicProvider, DEFAULT_MODEL } from "./anthropic";
import { type FakeFixtures, FakeLLMProvider } from "./fake";
import { FallbackLLMProvider } from "./fallback";
import { OPENROUTER_DEFAULT_MODEL, OpenRouterProvider } from "./openrouter";
import type { LLMProvider } from "./provider";

/**
 * Whether agents run on canned fixtures because no model key is set.
 *
 * Returns:
 *   True when both ANTHROPIC_API_KEY and OPENROUTER_API_KEY are unset or empty.
 */
export function isDemoLLM(): boolean {
  return !process.env.ANTHROPIC_API_KEY && !process.env.OPENROUTER_API_KEY;
}

/**
 * The OpenRouter model demo projects use, or null when OPENROUTER_API_KEY is unset.
 *
 * Returns:
 *   OPENROUTER_MODEL, or the default free model when the key is set and the model is not.
 */
export function demoModel(): string | null {
  if (!process.env.OPENROUTER_API_KEY) return null;
  return process.env.OPENROUTER_MODEL || OPENROUTER_DEFAULT_MODEL;
}

/**
 * Return the provider agents use for the owner's own projects.
 *
 * Args:
 *   demoFixtures: Outputs the fake provider serves per task when no key is set.
 *
 * Returns:
 *   An AnthropicProvider using ANTHROPIC_MODEL (default claude-sonnet-5-5) when ANTHROPIC_API_KEY
 *   is set, else an OpenRouterProvider when OPENROUTER_API_KEY is set, else a FakeLLMProvider
 *   serving demoFixtures.
 */
export function getLLMProvider(demoFixtures: FakeFixtures): LLMProvider {
  if (process.env.ANTHROPIC_API_KEY) {
    return new AnthropicProvider(
      new Anthropic(),
      process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
    );
  }
  return openRouterProvider() ?? new FakeLLMProvider(demoFixtures);
}

/**
 * Return the provider agents use for demo projects, whose agents visitors can trigger.
 *
 * It never uses the Anthropic key. OpenRouter is meant to run a free model here, and sample
 * results take over when it fails or is not set up.
 *
 * Args:
 *   demoFixtures: Sample outputs per task.
 *
 * Returns:
 *   An OpenRouterProvider with a FakeLLMProvider fallback, or the FakeLLMProvider alone.
 */
export function getDemoLLMProvider(demoFixtures: FakeFixtures): LLMProvider {
  const fake = new FakeLLMProvider(demoFixtures);
  const openRouter = openRouterProvider();
  return openRouter ? new FallbackLLMProvider(openRouter, fake) : fake;
}

function openRouterProvider(): OpenRouterProvider | null {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  return new OpenRouterProvider(key, demoModel()!);
}
