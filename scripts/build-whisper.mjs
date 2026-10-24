import { mkdir, copyFile } from 'node:fs/promises';
const dest = new URL('./vendor/whisper/', import.meta.url);
await mkdir(dest, { recursive: true });
for (const file of ['transformers.min.js', 'ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm'])
  await copyFile(new URL(`../node_modules/@huggingface/transformers/dist/${file}`, import.meta.url), new URL(file, dest));
for (const [pkg, name] of [['@huggingface/transformers', 'TRANSFORMERS-LICENSE']])
  await copyFile(new URL(`../node_modules/${pkg}/LICENSE`, import.meta.url), new URL(name, dest));
