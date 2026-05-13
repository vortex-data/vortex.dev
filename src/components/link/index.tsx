"use client";

import NextLink from "next/link";
import { useCallback, useEffect, useRef } from "react";

interface LinkProps extends React.ComponentProps<typeof NextLink> {
  children: string;
}

const SCRAMBLE_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const SCRAMBLE_WINDOW = 4;
const FRAME_MS = 30;

export const Link = ({ href, children, ...props }: LinkProps) => {
  const nodeRef = useRef<HTMLAnchorElement | null>(null);
  const frameRef = useRef<number | null>(null);

  const setNode = useCallback((node: HTMLAnchorElement | null) => {
    nodeRef.current = node;
  }, []);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    []
  );

  const replay = useCallback(() => {
    const el = nodeRef.current;
    if (!el) return;
    if (frameRef.current !== null) return;
    const target = children;
    let revealed = 0;
    let lastTime = 0;
    const tick = (now: number) => {
      if (now - lastTime >= FRAME_MS) {
        lastTime = now;
        if (revealed >= target.length) {
          el.textContent = target;
          frameRef.current = null;
          return;
        }
        const head = target.slice(0, revealed);
        let tail = "";
        const tailLen = Math.min(SCRAMBLE_WINDOW, target.length - revealed);
        for (let i = 0; i < tailLen; i++) {
          const ch = target.charAt(revealed + i);
          tail += /\s/.test(ch)
            ? ch
            : SCRAMBLE_CHARS.charAt(
                (Math.random() * SCRAMBLE_CHARS.length) | 0
              );
        }
        el.textContent = head + tail;
        revealed += 1;
      }
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
  }, [children]);

  return (
    <NextLink
      href={href}
      ref={setNode}
      onMouseEnter={replay}
      onTouchStart={replay}
      {...props}
    >
      {children}
    </NextLink>
  );
};
