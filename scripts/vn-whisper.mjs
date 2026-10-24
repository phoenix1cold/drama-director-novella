import { SpeechSegments } from './vn-audio.mjs';

const MODEL_KEY = 'dd-vn-whisper-tiny-ready';
const PROVIDER_KEY = 'dd-vn-stt-provider';
export const Whisper = {
  worker: null, requests: new Map(), nextId: 0, loading: null, ready: false, status: '',
  get downloaded() { return localStorage.getItem(MODEL_KEY) === '1'; },
  get provider() { return localStorage.getItem(PROVIDER_KEY) || 'auto'; },
  set provider(value) { localStorage.setItem(PROVIDER_KEY, value); },
  get useLocal() { return this.provider === 'whisper' || (this.provider === 'auto' && this.downloaded); },
  notify(status) { this.status = status; globalThis.dispatchEvent(new Event('vn-whisper-status')); },
  request(type, extra = {}) {
    if (!this.worker) {
      this.worker = new Worker(new URL('./vn-whisper-worker.mjs', import.meta.url), { type: 'module' });
      this.worker.onmessage = ({ data }) => {
        if (data.type === 'progress') {
          const p = data.data;
          this.notify(`${p.file || 'Whisper'} ${Number.isFinite(p.progress) ? Math.round(p.progress) + '%' : p.status || ''}`); return;
        }
        const pending = this.requests.get(data.id); if (!pending) return;
        this.requests.delete(data.id);
        if (data.error) pending.reject(new Error(data.error)); else pending.resolve(data.result);
      };
      this.worker.onerror = event => this.cancel(event.message || 'Whisper worker failed');
    }
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.requests.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, ...extra }, extra.audio ? [extra.audio.buffer] : []);
    });
  },
  async download() {
    if (this.ready) return;
    if (this.loading) return this.loading;
    this.notify('Whisper: загрузка модели…');
    this.loading = this.request('load').then(() => {
      this.ready = true; localStorage.setItem(MODEL_KEY, '1');
      this.notify('Whisper готов — распознавание локально');
      navigator.storage?.persist?.().catch(() => {});
    }).catch(error => { this.notify(`Whisper: ${error.message}`); throw error; }).finally(() => { this.loading = null; this.notify(this.status); });
    this.notify(this.status);
    return this.loading;
  },
  cancel(reason = 'Загрузка Whisper отменена') {
    this.worker?.terminate(); this.worker = null; this.ready = false;
    for (const pending of this.requests.values()) pending.reject(new Error(reason));
    this.requests.clear(); this.notify(reason);
  },
};

export class LocalSpeech {
  constructor(onText, onError, language, threshold) {
    this.onText = onText; this.onError = onError; this.language = language;
    this.threshold = threshold; this.stopped = false; this.queue = []; this.busy = false;
  }
  async start(context, stream) {
    await Whisper.download();
    if (this.stopped) return;
    await context.audioWorklet.addModule(new URL('./vn-audio-worklet.js', import.meta.url));
    if (this.stopped) return;
    this.segments = new SpeechSegments(context.sampleRate, audio => {
      if (this.queue.length >= 3) { this.onError(new Error('Whisper не успевает: говорите короче и делайте паузы.')); return; }
      this.queue.push(audio); this.drain();
    });
    this.source = context.createMediaStreamSource(stream);
    this.capture = new AudioWorkletNode(context, 'vn-capture');
    this.capture.port.onmessage = ({ data }) => { if (!this.stopped) this.segments.push(data, Math.max(0.004, this.threshold() / 1500)); };
    this.source.connect(this.capture); this.capture.connect(context.destination);
  }
  async drain() {
    if (this.busy || this.stopped) return;
    this.busy = true;
    while (this.queue.length && !this.stopped) {
      try {
        const result = await Whisper.request('transcribe', { audio: this.queue.shift(), language: this.language.split('-')[0] });
        if (!this.stopped && result.text?.trim()) this.onText(result.text.trim());
      } catch (error) { if (!this.stopped) this.onError(error); this.queue = []; break; }
    }
    this.busy = false;
  }
  stop() {
    this.stopped = true; this.queue = [];
    this.source?.disconnect(); this.capture?.disconnect(); this.capture?.port.close();
  }
}

export function mountSTTSettings(host, restart) {
  if (!host) return;
  host.replaceChildren();
  const select = document.createElement('select'); select.setAttribute('aria-label', 'STT');
  for (const [v, t] of [['auto', 'Авто: Whisper, если скачан'], ['whisper', 'Whisper — локально'], ['browser', 'Браузер / Google STT'], ['off', 'Без распознавания']]) select.add(new Option(t, v));
  select.value = Whisper.provider;
  select.onchange = () => { Whisper.provider = select.value; restart(); };
  const download = document.createElement('button'); download.type = 'button'; download.textContent = 'Скачать Whisper tiny';
  download.onclick = async () => {
    try { await Whisper.download(); Whisper.provider = 'whisper'; select.value = 'whisper'; restart(); }
    catch (error) { ui.notifications?.error(`Whisper: ${error.message}`); }
  };
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Отменить загрузку';
  cancel.onclick = () => Whisper.cancel();
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  const hint = document.createElement('p');
  hint.textContent = 'Первое скачивание требует доступа к Hugging Face (десятки мегабайт). Затем речь обрабатывается на этом устройстве. Модель хранится в кэше браузера; при его очистке скачайте снова. Нужен HTTPS или localhost.';
  host.append(select, download, cancel, status, hint);
  const update = () => {
    if (!host.isConnected) { globalThis.removeEventListener('vn-whisper-status', update); return; }
    status.textContent = Whisper.status || (Whisper.downloaded ? 'Модель ранее скачана' : 'Whisper ещё не скачан');
    download.disabled = !!Whisper.loading; cancel.hidden = !Whisper.loading;
  };
  globalThis.addEventListener('vn-whisper-status', update); update();
}
