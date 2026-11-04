/** Posts digests to Slack through an incoming webhook. Exports slackWebhookUrlSchema, postToSlack. */
import { z } from "zod";

/** A Slack incoming webhook URL. Only Slack's own host is accepted, so the server posts nowhere else. */
export const slackWebhookUrlSchema = z
  .string({ error: "Enter a Slack webhook URL." })
  .trim()
  .regex(
    /^https:\/\/hooks\.slack\.com\/services\/[\w/]+$/,
    "Enter a Slack incoming webhook URL, starting https://hooks.slack.com/services/.",
  );

/**
 * Escape the three characters Slack treats as markup, so a product note cannot ping
 * the channel (`<!channel>`) or turn into a link.
 *
 * Args:
 *   text: Plain text.
 *
 * Returns:
 *   The text with &, < and > escaped as Slack asks.
 */
function escapeSlack(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * Post plain text to a Slack channel.
 *
 * Args:
 *   webhookUrl: The channel's incoming webhook URL.
 *   text: The message, as plain text.
 *
 * Raises:
 *   Error: Slack did not accept the message, or did not answer within 10 seconds.
 */
export async function postToSlack(
  webhookUrl: string,
  text: string,
): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: escapeSlack(text) }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(
      `Slack answered ${response.status}: ${(await response.text()).slice(0, 200)}`,
    );
  }
}
