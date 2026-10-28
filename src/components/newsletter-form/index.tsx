"use client";

import { type FormEvent, useId, useState } from "react";

type FormState = "idle" | "loading" | "success" | "error";

/**
 * The blog's newsletter sign-up, in the design system's controls: the email
 * field and the primary `vx-btn`. The system has no Field card, so the field
 * is styled from its tokens in globals.css (`.site-field`).
 */
export const NewsletterForm = () => {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<FormState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const id = useId();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!email.trim()) return;

    setState("loading");
    setErrorMessage("");

    try {
      const response = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to subscribe");
      }

      setState("success");
      setEmail("");
    } catch (error) {
      setState("error");
      setErrorMessage(
        error instanceof Error ? error.message : "Something went wrong"
      );
    }
  };

  return (
    <section className="blog-newsletter" aria-labelledby={`${id}-title`}>
      <h2 className="vx-label" id={`${id}-title`}>
        Newsletter
      </h2>
      <p className="vx-small blog-newsletter-text">
        Get each new post by email.
      </p>
      {state === "success" ? (
        <p className="vx-small blog-newsletter-done" role="status">
          You are subscribed.
        </p>
      ) : (
        <form className="blog-newsletter-form" onSubmit={handleSubmit}>
          <label className="vx-sr-only" htmlFor={`${id}-email`}>
            Email address
          </label>
          <input
            id={`${id}-email`}
            className="site-field"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (state === "error") setState("idle");
            }}
            placeholder="you@example.com"
            required
            disabled={state === "loading"}
            aria-invalid={state === "error"}
            {...(state === "error"
              ? { "aria-describedby": `${id}-error` }
              : {})}
          />
          <button
            type="submit"
            className="vx-btn vx-btn-primary"
            disabled={state === "loading" || !email.trim()}
          >
            {state === "loading" ? "Subscribing" : "Subscribe"}
          </button>
        </form>
      )}
      {state === "error" && (
        <p
          className="vx-small blog-newsletter-error"
          id={`${id}-error`}
          role="alert"
        >
          {errorMessage}
        </p>
      )}
    </section>
  );
};
