"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ContrastIcon, DarkModeIcon, LightModeIcon } from "@/components/icons";
import {
  chooseTheme,
  cookieOf,
  readChoice,
  THEME_CHANGE,
  type ThemeChoice
} from "@/lib/theme";

const BUTTONS = [
  { choice: "light", label: "Light", Icon: LightModeIcon },
  { choice: "dark", label: "Dark", Icon: DarkModeIcon },
  { choice: "system", label: "System", Icon: ContrastIcon }
] as const satisfies readonly {
  choice: ThemeChoice;
  label: string;
  Icon: unknown;
}[];

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The design system's ThemeSwitch card: Light, Dark and System, on every
 * page of both sites. The choice is kept in a `vx-theme` cookie on
 * vortex.dev, so it holds on the docs, bench and the Explorer too, and in
 * `localStorage["vx-theme"]`. The server cannot read it, so it renders every
 * button unpressed. Until the first effect reads the choice, the system's CSS
 * shows the one `THEME_BOOTSTRAP` wrote to `data-theme-choice` pressed, and
 * `RouteTheme` follows the OS for System. The header holds two (one in the
 * Menu panel for phones): a click in one fires `THEME_CHANGE`, which the
 * other follows. The group is a fieldset, as the card has it. Without
 * JavaScript it cannot switch, and the page follows the OS, so it carries
 * `data-requires-js` and hides.
 */
export function ThemeSwitch() {
  const pathname = usePathname() ?? "/";
  const [choice, setChoice] = useState<ThemeChoice | null>(null);
  useEffect(() => {
    setChoice(readChoice(storage(), cookieOf(document)));
    const follow = (e: Event) => {
      const detail = (e as CustomEvent<unknown>).detail;
      const next = BUTTONS.find((b) => b.choice === detail)?.choice;
      if (next) setChoice(next);
    };
    document.addEventListener(THEME_CHANGE, follow);
    return () => document.removeEventListener(THEME_CHANGE, follow);
  }, []);

  return (
    <fieldset className="vx-theme-switch" aria-label="Theme" data-requires-js>
      {BUTTONS.map(({ choice: c, label, Icon }) => (
        <button
          key={c}
          type="button"
          data-choice={c}
          aria-pressed={choice === c}
          aria-label={label}
          title={label}
          onClick={() => chooseTheme(pathname, c, window)}
        >
          <Icon />
        </button>
      ))}
    </fieldset>
  );
}
