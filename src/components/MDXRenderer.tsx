import * as runtime from "react/jsx-runtime";
import { mdxComponents } from "@/components/blog/mdx-components";
import { WarningIcon } from "@/components/icons";

interface MDXRendererProps {
  code: string;
  components?: Record<string, React.ComponentType>;
}

const compileMDXComponent = (code: string) => {
  const fn = new Function(code);
  return fn({ ...runtime }).default;
};

export function MDXRenderer({ code, components }: MDXRendererProps) {
  try {
    const Component = compileMDXComponent(code);
    return <Component components={{ ...mdxComponents, ...components }} />;
  } catch (error) {
    console.error("Error rendering MDX:", error);
    return (
      <div className="vx-callout" role="alert">
        <WarningIcon className="vx-callout-icon" />
        <div>
          <p className="vx-callout-title">This post did not render</p>
          <p className="vx-callout-body">{String(error)}</p>
        </div>
      </div>
    );
  }
}
