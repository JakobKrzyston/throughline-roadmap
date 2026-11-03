/** Canned agent inputs and model outputs, used by tests and by demo mode when no API key is set. Exports SAMPLE_ROADMAP, SAMPLE_IMPORT_OUTPUT, DEMO_LLM_FIXTURES. */
import type { z } from "zod";

import type { FakeFixtures } from "@/adapters/llm/fake";

import { IMPORT_TASK, type importOutputSchema } from "./import";

/** A short roadmap of the kind a PM might paste. */
export const SAMPLE_ROADMAP = `# Acme Analytics – H1 2027

## 1. Mobile app (Q2)
Customers keep asking to check dashboards on the go.
- iOS and Android app shell with login
- Read-only dashboard viewer optimised for small screens
- Push notification service

## 2. Anomaly alerts
Notify account owners when a metric moves unexpectedly.
- Anomaly detection job over daily metrics
- Alert settings page
`;

/** What the import agent's model returns for SAMPLE_ROADMAP. */
export const SAMPLE_IMPORT_OUTPUT: z.input<typeof importOutputSchema> = {
  rationale:
    "The roadmap lists two numbered initiatives, so each became an outcome in that order. Only the mobile app has a stated quarter.",
  outcomes: [
    {
      title: "Customers can view their dashboards on a phone",
      description:
        "A mobile app for iOS and Android shows dashboards wherever customers are.",
      target: "2027-Q2",
      priority: 1,
      requirements: [
        {
          title: "Mobile app shell with login",
          description: "React Native app for iOS and Android with SSO login.",
          user_visible: true,
          product_note: null,
        },
        {
          title: "Mobile dashboard viewer",
          description: "Read-only dashboard rendering for small screens.",
          user_visible: true,
          product_note: "Dashboards are view-only on mobile at first.",
        },
        {
          title: "Push notification service",
          description: "APNs and FCM delivery for mobile notifications.",
          user_visible: false,
          product_note: null,
        },
      ],
    },
    {
      title: "Customers are alerted when a metric changes unexpectedly",
      description:
        "Account owners hear about unusual movements without watching dashboards all day.",
      target: null,
      priority: 2,
      requirements: [
        {
          title: "Anomaly detection job",
          description:
            "Nightly job that flags metrics outside their expected range.",
          user_visible: false,
          product_note: null,
        },
        {
          title: "Alert settings page",
          description: "Let account owners choose which metrics alert them.",
          user_visible: true,
          product_note: null,
        },
      ],
    },
  ],
};

/** Fixtures the fake provider serves in demo mode, whatever text is pasted. */
export const DEMO_LLM_FIXTURES: FakeFixtures = {
  [IMPORT_TASK]: [SAMPLE_IMPORT_OUTPUT],
};
