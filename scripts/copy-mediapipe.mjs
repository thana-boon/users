/**
 * Stage the MediaPipe vision WASM runtime into `public/mediapipe/wasm` so the
 * browser loads it from our own origin instead of Google's CDN — school links
 * are flaky and a CDN miss would break photo upload with no obvious cause.
 *
 * The .wasm blobs are ~11MB each, too big to keep in git, so they are copied
 * out of node_modules on `predev` / `prebuild` and gitignored. The .tflite
 * model next to them IS committed (230KB) — it has no npm package to copy from.
 *
 * SIMD + nosimd are both staged: FilesetResolver probes for SIMD support and
 * picks one at runtime, so shipping only the SIMD build would break any
 * browser without it.
 */
import { copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const dest = join(root, 'public', 'mediapipe', 'wasm');

const FILES = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
];

if (!existsSync(src)) {
  console.error(`[mediapipe] not found: ${src}\n[mediapipe] run \`npm install\` first.`);
  process.exit(1);
}

mkdirSync(dest, { recursive: true });

let copied = 0;
for (const f of FILES) {
  const from = join(src, f);
  const to = join(dest, f);
  if (!existsSync(from)) {
    console.error(`[mediapipe] missing ${f} in the installed package — version mismatch?`);
    process.exit(1);
  }
  // Skip unchanged files so `npm run dev` restarts stay fast.
  if (existsSync(to) && statSync(to).size === statSync(from).size) continue;
  copyFileSync(from, to);
  copied++;
}

console.log(`[mediapipe] wasm ready in public/mediapipe/wasm (${copied} file(s) copied)`);
