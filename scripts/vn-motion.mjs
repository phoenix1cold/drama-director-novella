/** Coalesce gestures to at most 30 socket messages/sec; final snapshots are barriers. */
export class MotionQueue {
  constructor(send, interval = 33) { this.send = send; this.interval = interval; this.pending = new Map(); this.timer = null; }
  push(kind, id, props) {
    const key = `${kind}:${id}`;
    const old = this.pending.get(key);
    this.pending.set(key, { kind, id, props: { ...old?.props, ...props } });
    if (!this.timer) this.timer = setTimeout(() => this.flush(), this.interval);
  }
  flush() {
    clearTimeout(this.timer); this.timer = null;
    const changes = [...this.pending.values()]; this.pending.clear();
    if (changes.length) this.send(changes);
  }
  clear() { clearTimeout(this.timer); this.timer = null; this.pending.clear(); }
}
