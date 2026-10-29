// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

// Ambient types for the part of jsdom that tests construct directly. jsdom
// (a dev dependency, through vitest's jsdom environment) ships no types, and
// bench adds no `@types/jsdom` dependency for one test: the pre-paint script
// test (`components/OpenGroupsScript.test.tsx`) builds its own JSDOM so the
// script runs while the page parses. Extend this when a test needs more.
declare module 'jsdom' {
  /** Receives the page's console calls and jsdom's own errors. */
  export class VirtualConsole {
    /** A script error or other jsdom failure, which jsdom does not throw. */
    on(event: 'jsdomError', listener: (error: Error) => void): this;
  }

  /** A JSDOM page's window. */
  export type DOMWindow = Window & typeof globalThis;

  export interface ConstructorOptions {
    url?: string;
    runScripts?: 'dangerously' | 'outside-only';
    virtualConsole?: VirtualConsole;
    /** Runs on the new window before the page parses (before its scripts). */
    beforeParse?: (window: DOMWindow) => void;
  }

  export class JSDOM {
    constructor(html?: string, options?: ConstructorOptions);
    readonly window: DOMWindow;
  }
}
