import { hashPassword } from '../auth/password.js';

const plain = process.argv[2];
if (!plain) {
  console.error('Uso: node scripts/hash-password.mjs <password>');
  process.exit(1);
}
console.log(hashPassword(plain));
