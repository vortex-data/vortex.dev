import { Geist, Geist_Mono } from "next/font/google";

// The design system's two faces, self-hosted by next/font, for both root
// layouts: the marketing site's and bench's. The tokens read them through
// these variables (src/styles/vortex-tokens.css), which carry next/font's
// metrics-matched fallback faces as well as the fonts.
const geistSans = Geist({
  variable: "--vx-face-sans",
  subsets: ["latin"]
});

const geistMono = Geist_Mono({
  variable: "--vx-face-mono",
  subsets: ["latin"]
});

/** The classes that set the faces' variables, for the root `<html>`. */
export const FONT_CLASSES = `${geistSans.variable} ${geistMono.variable}`;
