// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

/**
 * When Escape closes a disclosure panel, move focus to the panel's trigger if
 * the panel holds it, as the WAI-ARIA disclosure pattern does, so focus never
 * stays on a control that is now hidden. Focus that has already left the
 * panel stays where the reader put it.
 *
 * `container` holds the panel's controls, and may hold the trigger too. Call
 * this before the panel hides, while focus is still inside it.
 */
export function returnFocusToTrigger(container: Element | null, trigger: HTMLElement | null): void {
  if (container === null || trigger === null) {
    return;
  }
  const active = container.ownerDocument.activeElement;
  if (active !== null && active !== trigger && container.contains(active)) {
    trigger.focus();
  }
}
