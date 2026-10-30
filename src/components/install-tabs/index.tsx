"use client";

import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { CheckIcon, ContentCopyIcon } from "@/components/icons";
import { copyText, installTabs } from "@/lib/install";
import { nextIndex } from "@/lib/roving";

const DONE_MS = 1500;

/**
 * The design system's InstallTabs card: five tabs over one command block,
 * Rust first. The tabs are one tab stop (the arrow keys, Home and End move
 * between them). The copy button writes the selected tab's commands without
 * their prompts, shows `check` for 1.5s, and selects the text instead if the
 * clipboard is refused. `sparkVersion` is from `getSparkVersion`.
 *
 * Without JavaScript neither the tabs nor the copy button can work, so both
 * carry `data-requires-js` and hide, and every panel shows, stacked under its
 * tab's name (`data-label`, globals.css), so every command stays in reach.
 */
export function InstallTabs({ sparkVersion }: { sparkVersion: string | null }) {
  const tabs = installTabs(sparkVersion);
  const [active, setActive] = useState(0);
  const [done, setDone] = useState(false);
  const id = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const panelRefs = useRef<(HTMLPreElement | null)[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabRefs.current.indexOf(e.target as HTMLButtonElement);
    if (i < 0) return;
    const j = nextIndex(e.key, i, tabs.length, "horizontal");
    if (j === null) return;
    e.preventDefault();
    setActive(j);
    tabRefs.current[j]?.focus();
  };

  const copy = () => {
    const tab = tabs[active];
    const panel = panelRefs.current[active];
    if (!tab || !panel) return;
    const select = () => window.getSelection()?.selectAllChildren(panel);
    const ok = () => {
      setDone(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setDone(false), DONE_MS);
    };
    if (navigator.clipboard)
      navigator.clipboard.writeText(copyText(tab)).then(ok, select);
    else select();
  };

  return (
    <div className="vx-card vx-tabs">
      <div
        className="vx-tabs-list"
        role="tablist"
        aria-label="Install Vortex"
        data-requires-js
        onKeyDown={onKeyDown}
      >
        {tabs.map((tab, i) => (
          <button
            key={tab.key}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            className="vx-label-sm"
            role="tab"
            id={`${id}-tab-${tab.key}`}
            aria-selected={i === active}
            aria-controls={`${id}-panel-${tab.key}`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => setActive(i)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="vx-tabs-code">
        <div className="vx-tabs-panels">
          {tabs.map((tab, i) => (
            <pre
              key={tab.key}
              ref={(el) => {
                panelRefs.current[i] = el;
              }}
              className={i === active ? "vx-tabs-pre" : "vx-tabs-pre is-idle"}
              role="tabpanel"
              id={`${id}-panel-${tab.key}`}
              aria-labelledby={`${id}-tab-${tab.key}`}
              data-label={tab.label}
            >
              {tab.lines.map((line, n) => (
                <span key={n}>
                  {n > 0 && "\n"}
                  {line.prompt && (
                    <span className="vx-prompt">{line.prompt} </span>
                  )}
                  {line.text}
                </span>
              ))}
            </pre>
          ))}
        </div>
        <button
          type="button"
          className={done ? "vx-copy is-done" : "vx-copy"}
          aria-label="Copy to clipboard"
          data-requires-js
          onClick={copy}
        >
          <ContentCopyIcon className="is-copy" />
          <CheckIcon className="is-check" />
        </button>
        <span className="vx-sr-only" role="status">
          {done ? "Copied" : ""}
        </span>
      </div>
    </div>
  );
}
