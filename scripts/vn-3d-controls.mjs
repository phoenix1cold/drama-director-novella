import * as T from './vendor/three-vn.mjs';

/** GM scene tools. Motion is streamed during gestures and finalized on release. */
export class SceneControls {
  constructor(view, commit) {
    this.view = view; this.commit = commit; this.mode = 'drag'; this.selected = null;
    this.events = new AbortController();
    const canvas = view.renderer.domElement;
    this.orbit = new T.OrbitControls(view.camera, canvas);
    this.orbit.enableDamping = false;
    this.orbit.addEventListener('start', () => { this.navigating = this.orbit.enabled; });
    this.orbit.addEventListener('change', () => {
      if (this.navigating && this.orbit.enabled) this.commitCamera(true);
    });
    this.orbit.addEventListener('end', () => {
      this.navigating = false;
      if (!this.orbit.enabled) return;
      this.commitCamera(false);
    });
    this.gizmo = new T.TransformControls(view.camera, canvas);
    view.scene.add(this.gizmo.getHelper());
    this.gizmo.addEventListener('mouseUp', () => queueMicrotask(() => this.commitTransform()));
    this.gizmo.addEventListener('objectChange', () => { if (this.gizmo.dragging) this.commitTransform(true); });
    this.ray = new T.Raycaster();
    this.grid = new T.GridHelper(40, 40, 0x8090b0, 0x515866); view.scene.add(this.grid);
    this.outline = new T.BoxHelper(undefined, 0xe6bd81); this.outline.visible = false; view.scene.add(this.outline);
    this.toolbar = document.createElement('div'); this.toolbar.className = 'vn-3d-tools';
    this.toolbar.setAttribute('role', 'dialog'); this.toolbar.setAttribute('aria-label', '3D scene tools');
    document.body.append(this.toolbar);
    this.ru = game.i18n?.lang === 'ru';
    this.header = document.createElement('div'); this.header.className = 'vn-3d-tools-header';
    const title = document.createElement('span'); title.textContent = this.ru ? '⬡ Редактор 3D' : '⬡ 3D Scene Editor'; this.header.append(title);
    this.toolbar.append(this.header);
    this.body = document.createElement('div'); this.body.className = 'vn-3d-tools-body'; this.toolbar.append(this.body);
    const collapse = document.createElement('button'); collapse.type = 'button'; collapse.textContent = '−'; collapse.title = this.ru ? 'Свернуть / развернуть' : 'Collapse / expand';
    collapse.setAttribute('aria-expanded', 'true');
    collapse.onclick = () => { this.body.hidden = !this.body.hidden; collapse.textContent = this.body.hidden ? '+' : '−'; collapse.setAttribute('aria-expanded', String(!this.body.hidden)); this.clampPanel?.(); };
    this.header.append(collapse);
    collapse.setAttribute('aria-label', collapse.title);
    this.list = document.createElement('select'); this.list.setAttribute('aria-label', '3D object'); this.body.append(this.list);
    this.list.addEventListener('change', () => this.select(this.list.value || null));
    const ru = game.i18n?.lang === 'ru';
    const labels = ru ? ['Тянуть', 'Оси', 'Поворот', 'Масштаб', 'Камера'] : ['Drag', 'Move', 'Rotate', 'Scale', 'Camera'];
    this.buttons = new Map();
    ['drag', 'translate', 'rotate', 'scale', 'camera'].forEach((mode, i) => {
      this.buttons.set(mode, this.button(labels[i], () => this.setMode(mode)));
    });
    this.lock = this.button(ru ? 'Закрепить' : 'Lock', () => {
      const e = view.entries.get(this.selected); if (e) commit({ locked: !this.isLocked(this.selected) }, this.selected);
    });
    this.cameraLock = this.button(ru ? 'Закрепить камеру' : 'Lock camera', () => commit({ cameraLocked: !view.state.scene3d.cameraLocked }, null));
    this.button(ru ? 'В фокус' : 'Focus', () => this.focusSelection());
    this.propertiesButton = this.button(ru ? '⚙ Свойства' : '⚙ Properties', () => window.dispatchEvent(new CustomEvent('vn-scene-properties', { detail: { key: this.selected } })));
    this.button(ru ? 'Элементы (B)' : 'Elements (B)', () => window.dispatchEvent(new CustomEvent('vn-scene-browser')));
    this.snap = false;
    const snap = this.button(ru ? 'Шаг 0.25' : 'Snap 0.25', () => {
      this.snap = !this.snap; snap.classList.toggle('active', this.snap);
      this.gizmo.setTranslationSnap(this.snap ? 0.25 : null);
      this.gizmo.setRotationSnap(this.snap ? Math.PI / 12 : null);
      this.gizmo.setScaleSnap(this.snap ? 0.1 : null);
    });
    this.status = document.createElement('span'); this.status.className = 'vn-3d-selection-status'; this.body.append(this.status);
    const hint = document.createElement('p'); hint.className = 'vn-3d-tools-hint';
    hint.textContent = ru ? 'Выберите объект кликом или из списка. Камера: ЛКМ — вращение, ПКМ — сдвиг, колесо — приближение.' : 'Select an object in the scene or list. Camera: left drag to orbit, right drag to pan, scroll to zoom.';
    this.body.append(hint);
    const listen = (target, type, fn, opts = {}) => target.addEventListener(type, fn, { ...opts, signal: this.events.signal });
    const clampPanel = () => {
      const r = this.toolbar.getBoundingClientRect();
      const x = Math.max(8, Math.min(r.left, innerWidth - r.width - 8));
      const y = Math.max(8, Math.min(r.top, innerHeight - r.height - 8));
      this.toolbar.style.left = `${x}px`; this.toolbar.style.top = `${y}px`; this.toolbar.style.right = 'auto';
    };
    try {
      const saved = JSON.parse(localStorage.getItem('dd-vn-3d-tools-position'));
      if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y)) { this.toolbar.style.left = `${saved.x}px`; this.toolbar.style.top = `${saved.y}px`; this.toolbar.style.right = 'auto'; }
    } catch {}
    listen(this.header, 'pointerdown', e => {
      if (e.button !== 0 || e.target.closest('button')) return;
      const r = this.toolbar.getBoundingClientRect();
      this.panelDrag = { x: e.clientX - r.left, y: e.clientY - r.top };
      this.header.setPointerCapture(e.pointerId); e.preventDefault();
    });
    listen(this.header, 'pointermove', e => {
      if (!this.panelDrag) return;
      this.toolbar.style.left = `${e.clientX - this.panelDrag.x}px`; this.toolbar.style.top = `${e.clientY - this.panelDrag.y}px`; this.toolbar.style.right = 'auto'; clampPanel();
    });
    listen(this.header, 'pointerup', () => {
      if (!this.panelDrag) return; this.panelDrag = null;
      const r = this.toolbar.getBoundingClientRect();
      localStorage.setItem('dd-vn-3d-tools-position', JSON.stringify({ x: r.left, y: r.top }));
    });
    listen(this.header, 'pointercancel', () => { this.panelDrag = null; });
    listen(window, 'resize', () => { if (!this.toolbar.hidden) clampPanel(); });
    this.clampPanel = clampPanel;
    // Capture prevents 2D document-level mouse shortcuts from also handling 3D gestures.
    for (const type of ['mousedown', 'mousemove', 'mouseup', 'wheel', 'contextmenu'])
      listen(view.host, type, e => { e.stopPropagation(); if (type === 'contextmenu') e.preventDefault(); });
    for (const type of ['pointerdown', 'mousedown', 'mousemove', 'mouseup', 'wheel', 'keydown'])
      listen(this.toolbar, type, e => e.stopPropagation());
    listen(canvas, 'pointerdown', e => this.down(e));
    listen(canvas, 'pointermove', e => this.move(e));
    listen(canvas, 'dblclick', () => { if (this.enabled && this.selected && !this.orbit.enabled) window.dispatchEvent(new CustomEvent('vn-scene-properties', { detail: { key: this.selected } })); });
    listen(canvas, 'pointerup', () => this.end());
    listen(canvas, 'pointercancel', () => this.cancel());
    listen(canvas, 'lostpointercapture', () => this.end());
    listen(canvas, 'wheel', e => {
      if (!this.enabled || this.orbit.enabled || this.drag || this.gizmo.dragging) return;
      e.preventDefault(); e.stopPropagation(); this.rayAt(e);
      const groups = [...view.entries.values()].map(entry => entry.group).filter(Boolean);
      const keys = [];
      for (const hit of this.ray.intersectObjects(groups, true)) {
        let node = hit.object; while (node.parent && !groups.includes(node)) node = node.parent;
        const key = [...view.entries].find(([, entry]) => entry.group === node)?.[0];
        if (key && !keys.includes(key)) keys.push(key);
      }
      if (!keys.length) return;
      const index = keys.indexOf(this.selected);
      this.select(keys[index < 0 ? (e.deltaY >= 0 ? 0 : keys.length - 1) : (index + (e.deltaY >= 0 ? 1 : -1) + keys.length) % keys.length]);
    }, { passive: false });
  }
  button(text, fn) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = text;
    b.addEventListener('click', fn); this.body.append(b); return b;
  }
  setMode(mode) {
    if (!['drag', 'translate', 'rotate', 'scale', 'camera'].includes(mode) || this.drag || this.gizmo.dragging) return;
    this.mode = mode; this.refresh();
  }
  temporaryCamera(active) {
    if (this.shiftCamera === active) return;
    if (active && (!this.enabled || this.view.state.scene3d.cameraLocked || this.drag || this.gizmo.dragging)) return;
    if (!active && this.navigating) { this.commitCamera(false); this.navigating = false; }
    this.shiftCamera = active; this.refresh();
  }
  focusSelection() {
    const e = this.view.entries.get(this.selected); if (!e?.group || this.view.state.scene3d.cameraLocked) return;
    const box = new T.Box3().setFromObject(e.group), center = box.getCenter(new T.Vector3());
    const distance = Math.max(box.getSize(new T.Vector3()).length(), 1) * 1.5;
    this.commit({ cameraX: center.x, cameraY: center.y + distance * 0.25, cameraZ: center.z + distance, targetX: center.x, targetY: center.y, targetZ: center.z }, null);
  }
  rayAt(event) {
    const r = this.view.renderer.domElement.getBoundingClientRect();
    this.view.scene.updateMatrixWorld(true); this.view.camera.updateMatrixWorld(true);
    this.ray.setFromCamera(new T.Vector2((event.clientX - r.left) / r.width * 2 - 1, -(event.clientY - r.top) / r.height * 2 + 1), this.view.camera);
  }
  down(event) {
    if (!this.enabled || event.button !== 0 || this.orbit.enabled || this.gizmo.axis) return;
    this.rayAt(event);
    const groups = [...this.view.entries.values()].map(e => e.group).filter(Boolean);
    const hits = this.ray.intersectObjects(groups, true);
    const selectedGroup = this.view.entries.get(this.selected)?.group;
    // Keep an object selected with the wheel, even if another model occludes it.
    const hit = hits.find(h => {
      let node = h.object; while (node) { if (node === selectedGroup) return true; node = node.parent; } return false;
    }) || hits[0];
    if (!hit) { this.select(null); return; }
    let node = hit.object; while (node.parent && !groups.includes(node)) node = node.parent;
    const key = [...this.view.entries].find(([, e]) => e.group === node)?.[0];
    this.select(key);
    const e = this.view.entries.get(key);
    if (this.mode !== 'drag' || !e || this.isLocked(key)) return;
    // Drag parallel to the viewport; axis tools provide precise depth movement.
    const normal = this.view.camera.getWorldDirection(new T.Vector3());
    const plane = new T.Plane().setFromNormalAndCoplanarPoint(normal, hit.point);
    this.drag = { plane, origin: hit.point.clone(), position: node.position.clone(), node, key, changed: false };
    this.view.renderer.domElement.setPointerCapture(event.pointerId);
    event.preventDefault();
  }
  move(event) {
    if (!this.drag) return;
    this.rayAt(event);
    const point = this.ray.ray.intersectPlane(this.drag.plane, new T.Vector3());
    if (!point) return;
    const pos = point.sub(this.drag.origin).add(this.drag.position);
    if (this.snap) for (const axis of ['x', 'y', 'z']) pos[axis] = Math.round(pos[axis] / 0.25) * 0.25;
    this.drag.node.position.copy(pos); this.drag.changed = true;
    this.outline.update();
    this.commitTransform(true);
  }
  end() { if (!this.drag) return; const changed = this.drag.changed; this.drag = null; if (changed) this.commitTransform(); }
  cancel() { if (this.drag) { this.drag.node.position.copy(this.drag.position); this.commitTransform(); } this.drag = null; }
  commitCamera(live) {
    const p = this.view.camera.position, t = this.orbit.target;
    this.commit({ cameraX: p.x, cameraY: p.y, cameraZ: p.z, targetX: t.x, targetY: t.y, targetZ: t.z }, null, live);
  }
  commitTransform(live = false) {
    const e = this.view.entries.get(this.selected);
    if (!this.enabled || !e?.group || this.isLocked(this.selected)) return;
    const p = e.group.position, r = e.group.rotation;
    // Model schema uses a uniform scale. Preserve the axis that was manipulated.
    const scales = e.group.scale.toArray();
    const scale = scales.reduce((a, b) => Math.abs(b - e.data.scale) > Math.abs(a - e.data.scale) ? b : a, scales[0]);
    this.commit({ x: p.x, y: p.y, z: p.z, rx: T.MathUtils.radToDeg(r.x), ry: T.MathUtils.radToDeg(r.y), rz: T.MathUtils.radToDeg(r.z), scale }, this.selected, live);
  }
  isLocked(key) {
    return this.view.entries.get(key)?.data.locked || (key?.startsWith('char:') && this.view.state.chars.find(c => `char:${c.id}` === key)?.locked);
  }
  select(key) {
    this.selected = key; this.refresh();
    window.dispatchEvent(new CustomEvent('vn-scene-select', { detail: { key } }));
  }
  refresh() {
    const { view } = this;
    this.enabled = !!(game.user?.isGM && view.state?.mouseControl);
    view.host.classList.toggle('vn-3d-editing', this.enabled);
    const wasHidden = this.toolbar.hidden;
    this.toolbar.hidden = !this.enabled; this.grid.visible = this.enabled;
    if (this.enabled && wasHidden) this.clampPanel();
    this.orbit.enabled = this.enabled && (this.mode === 'camera' || this.shiftCamera) && !view.state.scene3d.cameraLocked;
    if (this.enabled && (this.drag || this.gizmo.dragging)) return;
    const selection = view.entries.get(this.selected);
    this.outline.visible = !!(this.enabled && selection?.group);
    if (this.outline.visible) this.outline.setFromObject(selection.group);
    this.gizmo.detach(); this.gizmo.enabled = false;
    if (this.enabled && !this.shiftCamera && selection?.group && !this.isLocked(this.selected) && ['translate', 'rotate', 'scale'].includes(this.mode)) {
      this.gizmo.enabled = true; this.gizmo.setMode(this.mode); this.gizmo.attach(selection.group);
    }
    if (!this.enabled) this.cancel();
    this.list.replaceChildren(new Option('—', ''));
    for (const [key, e] of view.entries) {
      const name = key.startsWith('char:') ? view.state.chars.find(c => `char:${c.id}` === key)?.name : view.state.scene3d.objects.find(o => `object:${o.id}` === key)?.name;
      this.list.add(new Option(`${this.isLocked(key) ? '🔒 ' : ''}${name || key}`, key));
    }
    this.list.value = this.selected || '';
    this.lock.disabled = !selection;
    this.propertiesButton.disabled = !selection;
    this.lock.textContent = this.ru ? (this.isLocked(this.selected) ? 'Открепить' : 'Закрепить') : (this.isLocked(this.selected) ? 'Unlock' : 'Lock');
    this.lock.classList.toggle('active', !!this.isLocked(this.selected));
    this.cameraLock.classList.toggle('active', !!view.state.scene3d.cameraLocked);
    for (const [mode, button] of this.buttons) button.classList.toggle('active', mode === this.mode);
    this.status.textContent = selection ? (this.isLocked(this.selected) ? (this.ru ? '🔒 Позиция закреплена' : '🔒 Position locked') : (this.ru ? 'Объект выбран' : 'Object selected')) : (this.ru ? 'Выберите объект' : 'Select an object');
  }
  dispose() {
    this.enabled = false;
    this.cancel(); this.events.abort(); this.orbit.dispose(); this.gizmo.dispose();
    this.gizmo.getHelper().removeFromParent(); this.grid.removeFromParent();
    this.grid.geometry.dispose(); this.grid.material.dispose(); this.toolbar.remove();
    this.outline.removeFromParent(); this.outline.geometry.dispose(); this.outline.material.dispose();
    this.view.host.classList.remove('vn-3d-editing');
  }
}
