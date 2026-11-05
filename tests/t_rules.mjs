// Firestore security rules (firestore.rules) on the real Firestore emulator, 2026-11-05.
// Run from the repository root (needs Java and firebase-tools; see tests/README.md):
//   MP_FBTOOLS=<folder with node_modules> npx --prefix "$MP_FBTOOLS" firebase emulators:exec --project demo-meal-planner --only firestore "node tests/t_rules.mjs"
// Proves: each account reads and writes only its own space; the file record shape is enforced; nothing else is open.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const tools = process.env.MP_FBTOOLS;
if (!tools) { console.log('SKIP t_rules: set MP_FBTOOLS to a folder where firebase-tools and @firebase/rules-unit-testing are installed'); process.exit(2); }
const req = createRequire(path.join(tools, 'package.json'));
const { initializeTestEnvironment, assertSucceeds, assertFails } = req('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, getDocs, collection, serverTimestamp, deleteDoc } = req('firebase/firestore');

const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085').split(':');
const env = await initializeTestEnvironment({ projectId: 'demo-meal-planner', firestore: { host, port: Number(port), rules: fs.readFileSync('firestore.rules', 'utf8') } });
let pass = 0, fail = 0;
async function ok(name, p) { try { await p; pass++; console.log('ok   ' + name); } catch (e) { fail++; console.log('FAIL ' + name + ' :: ' + (e && e.message || e).toString().slice(0, 200)); } }

const alice = env.authenticatedContext('alice').firestore();
const bob = env.authenticatedContext('bob').firestore();
const demo = env.authenticatedContext('anon123', { firebase: { sign_in_provider: 'anonymous' } }).firestore();
const nobody = env.unauthenticatedContext().firestore();
const rec = (p, text, extra) => Object.assign({ path: p, text: text, updated: serverTimestamp(), device: 'abc123' }, extra || {});
const P = 'data/users/x/profile.json', ID = encodeURIComponent(P);

await ok('owner creates a file in their own space', assertSucceeds(setDoc(doc(alice, 'spaces/alice/files', ID), rec(P, '{"a":1}\n'))));
await ok('owner reads it back', assertSucceeds(getDoc(doc(alice, 'spaces/alice/files', ID))));
await ok('owner updates it', assertSucceeds(setDoc(doc(alice, 'spaces/alice/files', ID), rec(P, '{"a":2}\n'))));
await ok('owner lists their own files', assertSucceeds(getDocs(collection(alice, 'spaces/alice/files'))));
await ok('another account cannot read it', assertFails(getDoc(doc(bob, 'spaces/alice/files', ID))));
await ok('another account cannot list it', assertFails(getDocs(collection(bob, 'spaces/alice/files'))));
await ok('another account cannot write into it', assertFails(setDoc(doc(bob, 'spaces/alice/files', ID), rec(P, 'x'))));
await ok('another account cannot delete it', assertFails(deleteDoc(doc(bob, 'spaces/alice/files', ID))));
await ok('signed-out visitor cannot read', assertFails(getDoc(doc(nobody, 'spaces/alice/files', ID))));
await ok('signed-out visitor cannot write', assertFails(setDoc(doc(nobody, 'spaces/alice/files', ID), rec(P, 'x'))));
await ok('the anonymous demo account writes its own space', assertSucceeds(setDoc(doc(demo, 'spaces/anon123/files', ID), rec(P, '{}'))));
await ok('the demo account cannot read a real account', assertFails(getDoc(doc(demo, 'spaces/alice/files', ID))));
await ok('an extra field is refused', assertFails(setDoc(doc(alice, 'spaces/alice/files', ID), rec(P, '{}', { admin: true }))));
await ok('a missing field is refused', assertFails(setDoc(doc(alice, 'spaces/alice/files', ID), { path: P, text: '{}', updated: serverTimestamp() })));
await ok('a client clock instead of server time is refused', assertFails(setDoc(doc(alice, 'spaces/alice/files', ID), rec(P, '{}', { updated: new Date() }))));
await ok('text over 900 kB is refused', assertFails(setDoc(doc(alice, 'spaces/alice/files', ID), rec(P, 'x'.repeat(900001)))));
await ok('text just under the limit is allowed', assertSucceeds(setDoc(doc(alice, 'spaces/alice/files', ID), rec(P, 'x'.repeat(899000)))));
await ok('a path outside data/ is refused', assertFails(setDoc(doc(alice, 'spaces/alice/files', 'x'), rec('secrets/x.json', '{}'))));
await ok('text that is not a string is refused', assertFails(setDoc(doc(alice, 'spaces/alice/files', ID), rec(P, 42))));
await ok('nothing outside spaces/ is open (write)', assertFails(setDoc(doc(alice, 'other/x'), { a: 1 })));
await ok('nothing outside spaces/ is open (read)', assertFails(getDoc(doc(alice, 'other/x'))));
await ok('the space document itself is closed', assertFails(setDoc(doc(alice, 'spaces/alice'), { a: 1 })));
await ok('owner deletes their own file', assertSucceeds(deleteDoc(doc(alice, 'spaces/alice/files', ID))));

await env.cleanup();
console.log(fail ? 'FAIL ' + fail + ' of ' + (pass + fail) : 'PASS rules: ' + pass + ' checks');
process.exit(fail ? 1 : 0);
