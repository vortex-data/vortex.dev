// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = [
  { ignores: ['.next/**', 'out/**', 'next-env.d.ts'] },
  ...nextVitals,
  ...nextTs,
  {
    // eslint-plugin-react-hooks 7 adds React Compiler rules. These two flag code that
    // version 5 accepted; turning them off keeps the Next.js 16 upgrade free of code changes.
    rules: {
      'react-hooks/immutability': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
];

export default eslintConfig;
