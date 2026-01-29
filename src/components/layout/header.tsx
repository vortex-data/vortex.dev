"use client";

import LogoMobile from "@/assets/logo-mobile.svg";
import Logo from "@/assets/logo.svg";
import Image from "next/image";
import NextLink from "next/link";
import { Link } from "../link";

const NAV = [
  { href: "https://github.com/vortex-data/vortex", label: "GitHub", external: true },
  { href: "https://docs.vortex.dev", label: "Docs", external: true },
  { href: "https://bench.vortex.dev", label: "Bench", external: true },
  { href: "https://vortex.dev/slack", label: "Slack", external: true },
  { href: "/blog", label: "Blog", external: false },
] as const;

export const Header = () => {
  return (
    <div className="flex justify-between items-center m-4 mb-2 md:m-10 md:mb-6 dashed-top dashed-bottom h-[72px] md:h-[108px]">
      <NextLink
        href="/"
        className="flex items-center gap-4 dashed-right h-full px-8"
      >
        <Image
          src={Logo}
          alt="Vortex Logo"
          width={120}
          height={44}
          className="hidden md:block"
        />
        <Image
          src={LogoMobile}
          alt="Vortex Logo"
          width={40}
          height={40}
          className="block md:hidden w-full h-[40px]"
        />
      </NextLink>

      {/* Desktop / tablet: original links */}
      <div className="hidden md:flex items-center gap-8 flex-1 justify-end md:flex-none dashed-left before:hidden md:before:block h-full px-10">
        {NAV.map(({ href, label, external }) => (
          <Link
            key={href}
            href={href}
            className="uppercase text-white font-mono text-base md:text-[18px] font-medium"
            {...(external ? { target: "_blank" } : {})}
          >
            {label}
          </Link>
        ))}
      </div>

      {/* Mobile: pure-CSS hamburger (no JS, anchor tags only) */}
      <div className="md:hidden relative flex-1 justify-end dashed-left h-full px-6 flex items-center">
        <details className="group relative">
          <summary
            className="list-none flex items-center justify-center w-10 h-10 rounded-lg border border-white/20 cursor-pointer"
            aria-label="Toggle navigation"
          >
            {/* hamburger icon */}
            <div className="relative w-5 h-3.5">
              <span className="absolute inset-x-0 top-0 h-0.5 bg-white transition-transform duration-200 group-open:translate-y-1.5 group-open:rotate-45"></span>
              <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-0.5 bg-white transition-opacity duration-200 group-open:opacity-0"></span>
              <span className="absolute inset-x-0 bottom-0 h-0.5 bg-white transition-transform duration-200 group-open:-translate-y-1.5 group-open:-rotate-45"></span>
            </div>
          </summary>

          {/* dropdown panel */}
          <nav className="absolute right-0 mt-3 w-48 rounded-xl border border-white/20 bg-black/90 backdrop-blur p-2 shadow-lg z-51">
            <ul className="flex flex-col">
              {NAV.map(({ href, label, external }) => (
                <li key={href}>
                  <a
                    href={href}
                    {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                    className="block w-full px-3 py-2 rounded-lg uppercase text-white font-mono text-sm hover:bg-white/10"
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </details>
      </div>
    </div>
  );
};
