'use client';

import * as runtime from 'react/jsx-runtime';

interface MDXRendererProps {
  code: string;
  components?: Record<string, React.ComponentType>;
}

const sharedComponents = {
  // Global components can be added here
};

const useMDXComponent = (code: string) => {
  const fn = new Function(code);
  return fn({ ...runtime }).default;
};

export function MDXRenderer({ code, components }: MDXRendererProps) {
  try {
    const Component = useMDXComponent(code);
    return <Component components={{ ...sharedComponents, ...components }} />;
  } catch (error) {
    console.error('Error rendering MDX:', error);
    return (
      <div className="text-red-400 p-4 border border-red-400/30 rounded">
        <h3>Error rendering content</h3>
        <p>There was an error rendering this blog post content.</p>
        <details className="mt-2">
          <summary className="cursor-pointer">Debug info</summary>
          <pre className="text-xs mt-2 whitespace-pre-wrap">{String(error)}</pre>
        </details>
      </div>
    );
  }
}