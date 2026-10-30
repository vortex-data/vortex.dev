// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors
// SPDX-FileCopyrightText: Copyright Google LLC

// Material Symbols Sharp, outline, weight 400 (Apache-2.0): the Vortex design
// system's icon set. Each path is copied from google/material-design-icons at
// commit bd8cb85, `symbols/web/<name>/materialsymbolssharp/<name>_24px.svg`.
// Add an icon from the same path; never redraw one.

import type { ReactElement } from 'react';

interface IconProps {
  className?: string;
  size?: number;
}

function MaterialSymbol({
  d,
  className = 'btn-icon',
  size = 16,
}: IconProps & { d: string }): ReactElement {
  return (
    <svg
      className={className}
      viewBox="0 -960 960 960"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

/** `menu`: the navigation menu. */
export function MenuIcon(props: IconProps = {}): ReactElement {
  return (
    <MaterialSymbol
      {...props}
      d={'M120-240v-80h720v80H120Zm0-200v-80h720v80H120Zm0-200v-80h720v80H120Z'}
    />
  );
}

/** `keyboard_double_arrow_down`: expand every group. */
export function ExpandAllIcon(props: IconProps = {}): ReactElement {
  return (
    <MaterialSymbol
      {...props}
      d={
        'M480-200 240-440l56-56 184 183 184-183 56 56-240 240Zm0-240L240-680l56-56 184 183 184-183 56 56-240 240Z'
      }
    />
  );
}

/** `keyboard_double_arrow_up`: collapse every group. */
export function CollapseAllIcon(props: IconProps = {}): ReactElement {
  return (
    <MaterialSymbol
      {...props}
      d={
        'm296-224-56-56 240-240 240 240-56 56-184-183-184 183Zm0-240-56-56 240-240 240 240-56 56-184-183-184 183Z'
      }
    />
  );
}

/** `light_mode`: the light theme. */
export function LightModeIcon(props: IconProps = {}): ReactElement {
  return (
    <MaterialSymbol
      {...props}
      d={
        'M480-360q50 0 85-35t35-85q0-50-35-85t-85-35q-50 0-85 35t-35 85q0 50 35 85t85 35Zm0 80q-83 0-141.5-58.5T280-480q0-83 58.5-141.5T480-680q83 0 141.5 58.5T680-480q0 83-58.5 141.5T480-280ZM200-440H40v-80h160v80Zm720 0H760v-80h160v80ZM440-760v-160h80v160h-80Zm0 720v-160h80v160h-80ZM256-650l-101-97 57-59 96 100-52 56Zm492 496-97-101 53-55 101 97-57 59Zm-98-550 97-101 59 57-100 96-56-52ZM154-212l101-97 55 53-97 101-59-57Zm326-268Z'
      }
    />
  );
}

/** `dark_mode`: the dark theme. */
export function DarkModeIcon(props: IconProps = {}): ReactElement {
  return (
    <MaterialSymbol
      {...props}
      d={
        'M480-120q-150 0-255-105T120-480q0-150 105-255t255-105q14 0 27.5 1t26.5 3q-41 29-65.5 75.5T444-660q0 90 63 153t153 63q55 0 101-24.5t75-65.5q2 13 3 26.5t1 27.5q0 150-105 255T480-120Zm0-80q88 0 158-48.5T740-375q-20 5-40 8t-40 3q-123 0-209.5-86.5T364-660q0-20 3-40t8-40q-78 32-126.5 102T200-480q0 116 82 198t198 82Zm-10-270Z'
      }
    />
  );
}

/** `link`: copy a link. */
export function LinkIcon(props: IconProps = {}): ReactElement {
  return (
    <MaterialSymbol
      {...props}
      d={
        'M440-280H280q-83 0-141.5-58.5T80-480q0-83 58.5-141.5T280-680h160v80H280q-50 0-85 35t-35 85q0 50 35 85t85 35h160v80ZM320-440v-80h320v80H320Zm200 160v-80h160q50 0 85-35t35-85q0-50-35-85t-85-35H520v-80h160q83 0 141.5 58.5T880-480q0 83-58.5 141.5T680-280H520Z'
      }
    />
  );
}

/** `check`: a copy that succeeded. */
export function CheckIcon(props: IconProps = {}): ReactElement {
  return <MaterialSymbol {...props} d={'M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z'} />;
}

/** `filter_alt`: the series filter. */
export function FilterIcon(props: IconProps = {}): ReactElement {
  return (
    <MaterialSymbol
      {...props}
      d={'M400-160v-280L118-800h724L560-440v280H400Zm80-308 198-252H282l198 252Zm0 0Z'}
    />
  );
}

/** `list`: the group list. */
export function ListIcon(props: IconProps = {}): ReactElement {
  return (
    <MaterialSymbol
      {...props}
      d={
        'M280-600v-80h560v80H280Zm0 160v-80h560v80H280Zm0 160v-80h560v80H280ZM160-600q-17 0-28.5-11.5T120-640q0-17 11.5-28.5T160-680q17 0 28.5 11.5T200-640q0 17-11.5 28.5T160-600Zm0 160q-17 0-28.5-11.5T120-480q0-17 11.5-28.5T160-520q17 0 28.5 11.5T200-480q0 17-11.5 28.5T160-440Zm0 160q-17 0-28.5-11.5T120-320q0-17 11.5-28.5T160-360q17 0 28.5 11.5T200-320q0 17-11.5 28.5T160-280Z'
      }
    />
  );
}

/** `info`: a group's one-line description. */
export function InfoIcon(props: IconProps = {}): ReactElement {
  return (
    <MaterialSymbol
      {...props}
      d={
        'M440-280h80v-240h-80v240Zm40-320q17 0 28.5-11.5T520-640q0-17-11.5-28.5T480-680q-17 0-28.5 11.5T440-640q0 17 11.5 28.5T480-600Zm0 520q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z'
      }
    />
  );
}

/** `menu_book`: a benchmark's description. */
export function BookIcon(props: IconProps = {}): ReactElement {
  return (
    <MaterialSymbol
      {...props}
      d={
        'M260-320q47 0 91.5 10.5T440-278v-394q-41-24-87-36t-93-12q-36 0-71.5 7T120-692v396q35-12 69.5-18t70.5-6Zm260 42q44-21 88.5-31.5T700-320q36 0 70.5 6t69.5 18v-396q-33-14-68.5-21t-71.5-7q-47 0-93 12t-87 36v394Zm-40 118q-48-38-104-59t-116-21q-53 0-111 20T40-158v-580q44-30 103.5-46T260-800q58 0 113.5 15T480-740q51-30 106.5-45T700-800q57 0 116.5 16T920-738v580q-50-42-108.5-62T700-240q-60 0-116 21t-104 59ZM280-499Zm280-65v-68q33-14 67.5-21t72.5-7q26 0 51 4t49 10v64q-24-9-48.5-13.5T700-600q-38 0-73 9.5T560-564Zm0 220v-68q33-14 67.5-21t72.5-7q26 0 51 4t49 10v64q-24-9-48.5-13.5T700-380q-38 0-73 9t-67 27Zm0-110v-68q33-14 67.5-21t72.5-7q26 0 51 4t49 10v64q-24-9-48.5-13.5T700-490q-38 0-73 9.5T560-454Z'
      }
    />
  );
}
