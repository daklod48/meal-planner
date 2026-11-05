// Finds Playwright wherever this machine has it (2026-11-05). The tests used to import one fixed path
// (/opt/npm-tools/...), which does not exist on every machine. Order: $PLAYWRIGHT_PATH, the two known
// Claude workspace places, then a normal "playwright" package next to the tests.
import fs from 'fs';
import { createRequire } from 'module';
const tries = [process.env.PLAYWRIGHT_PATH, '/opt/npm-tools/node_modules/playwright/index.mjs', '/opt/node-tools/node_modules/playwright/index.mjs'].filter(Boolean);
let mod = null;
for (const p of tries) if (fs.existsSync(p)) { mod = await import(p); break; }
if (!mod) mod = createRequire(import.meta.url)('playwright');
export const chromium = mod.chromium;
