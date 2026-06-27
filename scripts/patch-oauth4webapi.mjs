// oauth4webapi@3.8.6 references `crypto` without importing it in its CJS build.
// This prepends the missing import so the package works under Node.js ESM.
// Inline postinstall patch avoids adding patch-package as a dependency.
import { readFileSync, writeFileSync } from 'fs';

const file = 'node_modules/oauth4webapi/build/index.js';
const patch = 'import { webcrypto as crypto } from "node:crypto";\n';

const content = readFileSync(file, 'utf8');
if (!content.startsWith(patch)) {
  writeFileSync(file, patch + content);
  console.log('patched oauth4webapi: added crypto import');
}
