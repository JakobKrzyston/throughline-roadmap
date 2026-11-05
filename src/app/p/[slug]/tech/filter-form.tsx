"use client";
/** A GET filter form that applies each change at once, falling back to its submit button without JavaScript. Exports FilterForm. */
import { useRouter } from "next/navigation";
import {
  type ChangeEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useRef,
  useTransition,
} from "react";

// The page remounts the form when the filter changes; this is the field to focus again after that,
// so a keyboard user who changes a choice does not lose their place.
let refocusName: string | null = null;

/**
 * A `method="get"` form that navigates as soon as one of its fields changes. Choices left empty
 * ("Any") are dropped from the address. Without JavaScript it is a plain form, so put a submit
 * button for that case in a `<noscript>` among its children.
 *
 * Args:
 *   label: Accessible name of the form.
 *   children: The form's fields and links.
 *
 * Returns:
 *   The form.
 */
export function FilterForm({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): ReactElement {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (refocusName === null) return;
    const field = form.current?.elements.namedItem(refocusName);
    if (field instanceof HTMLElement) field.focus();
    refocusName = null;
  }, []);

  function apply(event: ChangeEvent<HTMLFormElement>): void {
    if (event.target instanceof HTMLSelectElement) {
      refocusName = event.target.name;
    }
    const params = new URLSearchParams();
    for (const [name, value] of new FormData(event.currentTarget)) {
      if (typeof value === "string" && value !== "") params.set(name, value);
    }
    const query = params.size > 0 ? `?${params}` : "";
    startTransition(() =>
      router.push(`${window.location.pathname}${query}`, { scroll: false }),
    );
  }

  return (
    <form
      ref={form}
      method="get"
      aria-label={label}
      aria-busy={pending}
      onChange={apply}
      className="flex flex-wrap items-end gap-x-3 gap-y-2"
    >
      {children}
      <span aria-live="polite" className="pb-1 text-sm text-muted-foreground">
        {pending ? "Updating…" : ""}
      </span>
    </form>
  );
}
