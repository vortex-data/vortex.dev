"use client";

import { type MouseEvent, useEffect, useRef, useState } from "react";
import { CheckIcon, ContentCopyIcon } from "@/components/icons";

const DONE_MS = 1500;

/**
 * The CodeBlock card's copy button. It writes the block's code, shows
 * `check` for 1.5s, and selects the code instead if the clipboard is
 * refused. Without JavaScript it cannot copy, so it hides
 * (`data-requires-js`, globals.css); the code stays selectable.
 */
export function CopyCode() {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = (e: MouseEvent<HTMLButtonElement>) => {
    const pre = e.currentTarget.closest(".vx-code")?.querySelector("pre");
    if (!pre) return;
    const select = () => window.getSelection()?.selectAllChildren(pre);
    const ok = () => {
      setDone(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setDone(false), DONE_MS);
    };
    if (navigator.clipboard)
      navigator.clipboard.writeText(pre.textContent ?? "").then(ok, select);
    else select();
  };

  return (
    <>
      <button
        type="button"
        className={done ? "vx-copy is-done" : "vx-copy"}
        aria-label="Copy code"
        data-requires-js
        onClick={copy}
      >
        <ContentCopyIcon className="is-copy" />
        <CheckIcon className="is-check" />
      </button>
      <span className="vx-sr-only" role="status">
        {done ? "Copied" : ""}
      </span>
    </>
  );
}
