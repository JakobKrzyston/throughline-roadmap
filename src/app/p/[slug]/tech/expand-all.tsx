"use client";
/** Buttons that open or close every row in the surrounding section. Exports ExpandAll. */
import {
  type MouseEvent,
  type ReactElement,
  useSyncExternalStore,
} from "react";

const subscribe = (): (() => void) => () => {};

/**
 * "Expand all" and "Collapse all" for every `<details>` in the closest `<section>`. They need
 * JavaScript, so they appear only once the page has hydrated.
 *
 * Returns:
 *   The two buttons, or nothing before hydration.
 */
export function ExpandAll(): ReactElement | null {
  // False on the server and during hydration, true after: the buttons never show without JavaScript.
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  if (!hydrated) return null;

  const setAll = (event: MouseEvent<HTMLButtonElement>, open: boolean): void =>
    event.currentTarget
      .closest("section")
      ?.querySelectorAll("details")
      .forEach((details) => (details.open = open));
  const buttonClass =
    "rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

  return (
    <div className="flex gap-1">
      <button
        type="button"
        className={buttonClass}
        onClick={(event) => setAll(event, true)}
      >
        Expand all
      </button>
      <button
        type="button"
        className={buttonClass}
        onClick={(event) => setAll(event, false)}
      >
        Collapse all
      </button>
    </div>
  );
}
