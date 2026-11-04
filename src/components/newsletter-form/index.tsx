"use client";

import { type FormEvent, useEffect, useId, useRef, useState } from "react";

type FormState = "idle" | "loading" | "success" | "error";

/**
 * What the reader sees when a sign-up fails: what did not happen, then what
 * to do. The server's own error text and any exception stay out of it, so a
 * 502's HTML or "Failed to fetch" never reaches the page.
 */
export function subscribeError(status: number | null): string {
  if (status === null) {
    return "You are not subscribed. Check your connection and try again.";
  }
  if (status === 400) {
    return "You are not subscribed. Check the address and try again.";
  }
  if (status === 429) {
    return "You are not subscribed. Try again in a few minutes.";
  }
  return "You are not subscribed. Try again later.";
}

/**
 * The blog's newsletter sign-up, in the design system's Field card: the
 * email field and the primary `vx-btn` in a `vx-field-row`, and the error
 * under it in `vx-field-error`.
 *
 * Focus stays in the form while a request runs: the field turns read-only
 * and the button `aria-disabled`, because a `disabled` control that has
 * focus drops it to the page. On success the form goes, so focus moves to
 * the confirmation. The confirmation's live region is in the page from the
 * start, empty, so a screen reader announces the text when it arrives.
 */
export const NewsletterForm = () => {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<FormState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const doneRef = useRef<HTMLParagraphElement>(null);
  const id = useId();
  const loading = state === "loading";

  useEffect(() => {
    if (state === "success") doneRef.current?.focus();
  }, [state]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (loading || !email.trim()) return;

    setState("loading");
    setErrorMessage("");

    let status: number | null;
    try {
      const response = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() })
      });
      status = response.status;
      if (response.ok) {
        setState("success");
        setEmail("");
        return;
      }
    } catch {
      status = null;
    }
    setState("error");
    setErrorMessage(subscribeError(status));
  };

  return (
    // The sign-up posts through JavaScript; without it the form could not
    // send, so the whole section hides (data-requires-js, globals.css).
    <section
      className="blog-newsletter"
      aria-labelledby={`${id}-title`}
      data-requires-js
    >
      <h2 className="vx-label" id={`${id}-title`}>
        Newsletter
      </h2>
      <p className="vx-small blog-newsletter-text">
        Get each new post by email.
      </p>
      <p
        className="vx-small blog-newsletter-done"
        role="status"
        ref={doneRef}
        tabIndex={-1}
      >
        {state === "success" ? "You are subscribed." : ""}
      </p>
      {state !== "success" && (
        <form className="vx-field-row" onSubmit={handleSubmit}>
          <label className="vx-sr-only" htmlFor={`${id}-email`}>
            Email address
          </label>
          <input
            id={`${id}-email`}
            className="vx-field"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (state === "error") setState("idle");
            }}
            placeholder="you@example.com"
            required
            readOnly={loading}
            aria-invalid={state === "error"}
            {...(state === "error"
              ? { "aria-describedby": `${id}-error` }
              : {})}
          />
          <button
            type="submit"
            className="vx-btn vx-btn-primary"
            // Never `disabled`: the field's `required` and `type="email"`
            // catch an empty or malformed address, and while a request runs
            // the button only looks disabled, so it keeps focus. A second
            // press does nothing (handleSubmit).
            aria-disabled={loading}
          >
            {loading ? "Subscribing…" : "Subscribe"}
          </button>
        </form>
      )}
      {state === "error" && (
        <p className="vx-small vx-field-error" id={`${id}-error`} role="alert">
          {errorMessage}
        </p>
      )}
    </section>
  );
};
