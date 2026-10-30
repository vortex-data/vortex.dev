import { type ComponentProps, isValidElement } from "react";
import { InfoIcon, WarningIcon } from "@/components/icons";
import { codeLabel } from "@/vendor/vortex-design/code-block.js";
import { CopyCode } from "./copy-code";
import { Bars, Chain, Names, Quote } from "./figures";

/**
 * The elements of a post that take the design system's cards. Markdown
 * writes them, rehype-pretty-code and `src/lib/rehype-blog.ts` mark them,
 * and these components draw them.
 */

/** A fenced code block, as the CodeBlock card: a label row over the code. */
function Figure({ children, ...props }: ComponentProps<"figure">) {
  if (!("data-rehype-pretty-code-figure" in props))
    return <figure {...props}>{children}</figure>;
  const lang = isValidElement<{ "data-language"?: string }>(children)
    ? children.props["data-language"]
    : undefined;
  return (
    <figure {...props} className="vx-code">
      <div className="vx-code-head">
        <span className="vx-label">{codeLabel(lang)}</span>
        <CopyCode />
      </div>
      {children}
    </figure>
  );
}

function Pre({ className, ...props }: ComponentProps<"pre">) {
  return (
    <pre
      {...props}
      className={className ? `${className} vx-code-pre` : "vx-code-pre"}
    />
  );
}

type AsideProps = ComponentProps<"blockquote"> & {
  "data-aside"?: string;
  "data-title"?: string;
};

/**
 * An aside (`rehypeAsides`) as the Callout card: the kind's icon, the title
 * if the aside has one, then its paragraphs. Any other blockquote as it is.
 */
function Blockquote({
  children,
  "data-aside": kind,
  "data-title": title,
  ...props
}: AsideProps) {
  if (kind === undefined) return <blockquote {...props}>{children}</blockquote>;
  const Icon = kind === "warning" ? WarningIcon : InfoIcon;
  return (
    <div className="vx-callout" role="note">
      <Icon className="vx-callout-icon" />
      <div>
        {title && <p className="vx-callout-title">{title}</p>}
        {children}
      </div>
    </div>
  );
}

export const mdxComponents = {
  figure: Figure,
  pre: Pre,
  blockquote: Blockquote,
  Bars,
  Chain,
  Names,
  Quote
};
