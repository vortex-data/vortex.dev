"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ContrastIcon, DarkModeIcon, LightModeIcon } from "@/components/icons";
import {
  chooseTheme,
  isThemeable,
  readChoice,
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
 * The design system's ThemeSwitch card: Light, Dark and System, stored in
 * `localStorage["vx-theme"]`. It renders on blog pages only, because every
 * other page is Dark only (`themeFor`). The server cannot read the stored
 * choice, so no button is pressed until the first effect reads it. The
 * theme itself is already right by then: `THEME_BOOTSTRAP` set it before
 * first paint, and `RouteTheme` follows the OS for System. The group is a
 * fieldset rather than the card's `div role="group"`, which Biome's a11y
 * rules reject.
 */
export function ThemeSwitch() {
  const pathname = usePathname();
  const [choice, setChoice] = useState<ThemeChoice | null>(null);
  useEffect(() => setChoice(readChoice(storage())), []);

  if (!isThemeable(pathname)) return null;
  return (
    <fieldset className="vx-theme-switch" aria-label="Theme">
      {BUTTONS.map(({ choice: c, label, Icon }) => (
        <button
          key={c}
          type="button"
          data-choice={c}
          aria-pressed={choice === c}
          aria-label={label}
          title={label}
          onClick={() => {
            chooseTheme(pathname, c, window);
            setChoice(c);
          }}
        >
          <Icon />
        </button>
      ))}
    </fieldset>
  );
}
