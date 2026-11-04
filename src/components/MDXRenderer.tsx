// compileMDXComponent evaluates code with `new Function`. The CSP has no
// 'unsafe-eval', which is safe only while this runs on the server, so make
// importing it from a Client Component a build error.
import "server-only";
import NextLink from "next/link";
import * as runtime from "react/jsx-runtime";
import { mdxComponents } from "@/components/blog/mdx-components";
import { WarningIcon } from "@/components/icons";

interface MDXRendererProps {
  code: string;
}

const compileMDXComponent = (code: string) => {
  const fn = new Function(code);
  return fn({ ...runtime }).default;
};

export function MDXRenderer({ code }: MDXRendererProps) {
  try {
    const Component = compileMDXComponent(code);
    return <Component components={mdxComponents} />;
  } catch (error) {
    // The error goes to the server log, not the page: App strings never
    // shows a raw exception as the message.
    console.error("Error rendering MDX:", error);
    return (
      <div className="vx-callout" role="alert">
        <WarningIcon className="vx-callout-icon" />
        <div>
          <p className="vx-callout-title">This post did not render.</p>
          <p className="vx-callout-body">
            Try again later, or <NextLink href="/blog">go to the blog</NextLink>
            .
          </p>
        </div>
      </div>
    );
  }
}
