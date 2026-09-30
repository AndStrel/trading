import { cpSync, mkdirSync } from 'node:fs';

const destination = new URL('./public/', import.meta.url);
mkdirSync(destination, { recursive: true });
cpSync(new URL('../../src/web/public/', import.meta.url), destination, { recursive: true });
