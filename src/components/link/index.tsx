"use client";

import NextLink from "next/link";
import { useScramble } from "use-scramble";

interface LinkProps extends React.ComponentProps<typeof NextLink> {
  children: string;
}

export const Link = ({ href, children, ...props }: LinkProps) => {
  const { ref, replay } = useScramble({
    text: children,
    speed: 0.5,
    tick: 1,
    step: 1,
    scramble: 4,
    seed: 0,
    playOnMount: false
  });

  return (
    <NextLink
      href={href}
      ref={ref}
      onMouseOver={replay}
      onTouchStart={replay}
      {...props}
    >
      {children}
    </NextLink>
  );
};
