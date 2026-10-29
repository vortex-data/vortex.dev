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
 * other page is Dark only (`THEMEABLE`). The server cannot read the stored
 * choice, so it renders every button unpressed. Until the first effect
 * reads the choice, the system's CSS shows the one `THEME_BOOTSTRAP` wrote
 * to `data-theme-choice` pressed, and `RouteTheme` follows the OS for
 * System. The group is a fieldset, as the card has it.
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
