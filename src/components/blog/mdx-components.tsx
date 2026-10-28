import { type ComponentProps, isValidElement } from "react";
import { InfoIcon } from "@/components/icons";
import { codeLabel } from "@/lib/rehype-blog";
import { CopyCode } from "./copy-code";

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

/** An aside (`rehypeAsides`) as the Callout card; any other blockquote as it is. */
function Blockquote({ children, ...props }: ComponentProps<"blockquote">) {
  if (!("data-aside" in props))
    return <blockquote {...props}>{children}</blockquote>;
  return (
    <div className="vx-callout" role="note">
      <InfoIcon className="vx-callout-icon" />
      <div>{children}</div>
    </div>
  );
}

export const mdxComponents = {
  figure: Figure,
  pre: Pre,
  blockquote: Blockquote
};
