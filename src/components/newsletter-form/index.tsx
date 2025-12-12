"use client";

import { FormEvent, useState } from "react";

type FormState = "idle" | "loading" | "success" | "error";

interface NewsletterFormProps {
  variant?: "default" | "compact";
}

export const NewsletterForm = ({
  variant = "default"
}: NewsletterFormProps) => {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<FormState>("idle");
  const [errorMessage, setErrorMessage] = useState("");

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

  if (state === "success") {
    return (
      <div
        className={`font-mono text-sm text-spiral-green ${variant === "compact" ? "" : "py-4"}`}
      >
        Thanks for subscribing!
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={`flex flex-col ${variant === "compact" ? "gap-2" : "gap-3"}`}
    >
      {/* <label className="font-mono text-xs text-grey uppercase tracking-wide">
        Get updates
      </label> */}
      <div
        className={`flex ${variant === "compact" ? "flex-col sm:flex-row" : "flex-row"} gap-2`}
      >
        <input
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (state === "error") setState("idle");
          }}
          placeholder="you@email.com"
          required
          disabled={state === "loading"}
          className="bg-transparent border border-white/30 px-3 py-2 font-mono text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-white/60 disabled:opacity-50 flex-1 min-w-0"
        />
        <button
          type="submit"
          disabled={state === "loading" || !email.trim()}
          className="bg-spiral-light-blue text-background px-4 py-2 font-mono text-sm hover:bg-spiral-grey transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
        >
          {state === "loading" ? "..." : "Subscribe"}
        </button>
      </div>
      {state === "error" && (
        <span className="font-mono text-xs text-spiral-red">
          {errorMessage}
        </span>
      )}
    </form>
  );
};
