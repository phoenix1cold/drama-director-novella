import { env, pipeline } from './vendor/whisper/transformers.min.js';

env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.numThreads = 1; // Works without COOP/COEP headers on Foundry.
env.backends.onnx.wasm.proxy = false;
env.backends.onnx.wasm.wasmPaths = new URL('./vendor/whisper/', import.meta.url).href;
let transcriber;
async function load() {
  if (!transcriber) transcriber = pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', {
    device: 'wasm', dtype: 'q8',
    progress_callback: data => postMessage({ type: 'progress', data }),
  }).catch(error => { transcriber = null; throw error; });
  return transcriber;
}
// Serialize inference: one model session per client, never concurrent WASM runs.
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      const pipe = await load();
      const result = data.type === 'load' ? true : await pipe(data.audio, {
        language: data.language, task: 'transcribe', return_timestamps: false,
        chunk_length_s: 15, stride_length_s: 2,
      });
      postMessage({ id: data.id, result });
    } catch (error) { postMessage({ id: data.id, error: error.message || String(error) }); }
  });
};
