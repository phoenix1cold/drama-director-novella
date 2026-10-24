const el = (tag, parent, text, cls) => {
  const node = document.createElement(tag); if (text) node.textContent = text;
  if (cls) node.className = cls; parent?.append(node); return node;
};
export function typingTarget(target) {
  return !!target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]');
}
export function sceneItems(state) {
  return [
    ...(state.chars || []).map(data => ({ key: `char:${data.id}`, label: 'Персонаж', data, model: state.scene3d?.enabled && (data.model3d?.src || (data.model3d?.kind && data.model3d.kind !== 'model')) ? data.model3d : null })),
    ...(state.layers || []).map(data => ({ key: `layer:${data.id}`, label: data.type === 'text' ? 'Текст 2D' : 'Слой 2D', data })),
    ...(state.interactiveImages || []).map(data => ({ key: `interactive:${data.id}`, label: 'Интерактив 2D', data })),
    ...(state.scene3d?.objects || []).map(data => ({ key: `object:${data.id}`, label: `3D · ${data.kind || 'model'}`, data, model: data })),
  ];
}

export const SceneEditor = {
  bridge: null, selected: null, browser: null, inspector: null, inputs: [],
  configure(bridge) { this.bridge = bridge; },
  sync() {
    if (!this.bridge) return;
    const state = this.bridge.state();
    if (!game.user?.isGM || !state.open) { this.dispose(); return; }
    if (!this.browser) this.build();
    if (this.selected && !this.item(this.selected)) { this.selected = null; this.inspector.hidden = true; }
    this.renderList(); this.syncFields();
  },
  item(key) { return sceneItems(this.bridge.state()).find(item => item.key === key); },
  button(parent, text, title, fn) {
    const b = el('button', parent, text); b.type = 'button'; b.title = title; b.setAttribute('aria-label', title); b.onclick = fn; return b;
  },
  panel(title, cls, position) {
    const node = el('section', document.body, null, `vn-scene-window ${cls}`); node.setAttribute('role', 'dialog'); node.setAttribute('aria-label', title);
    node.style.cssText = position;
    const clamp = () => {
      if (node.hidden) return;
      const top = Math.max(8, Math.min(parseFloat(node.style.top) || 90, innerHeight - 100));
      const r = node.getBoundingClientRect();
      node.style.top = `${top}px`; node.style.setProperty('--vn-window-top', `${top}px`);
      node.style.left = `${Math.max(8, Math.min(r.left, innerWidth - r.width - 8))}px`; node.style.right = 'auto';
    };
    window.addEventListener('resize', clamp, { signal: this.events.signal });
    clamp();
    const header = el('header', node, null, 'vn-scene-window-header'); el('strong', header, title);
    this.button(header, '×', `Закрыть: ${title}`, () => { node.hidden = true; });
    const body = el('div', node, null, 'vn-scene-window-body');
    let drag;
    header.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.target.closest('button')) return;
      const r = node.getBoundingClientRect(); drag = { x: e.clientX - r.x, y: e.clientY - r.y };
      header.setPointerCapture(e.pointerId); e.preventDefault();
    });
    header.addEventListener('pointermove', e => {
      if (!drag) return;
      node.style.left = `${Math.max(0, Math.min(innerWidth - node.offsetWidth, e.clientX - drag.x))}px`;
      node.style.top = `${Math.max(8, Math.min(innerHeight - 100, e.clientY - drag.y))}px`; node.style.right = 'auto'; clamp();
    });
    header.addEventListener('pointerup', () => { drag = null; });
    header.addEventListener('pointercancel', () => { drag = null; });
    for (const type of ['mousedown', 'pointerdown', 'wheel']) node.addEventListener(type, e => e.stopPropagation());
    return { node, body };
  },
  build() {
    this.events = new AbortController();
    const browser = this.panel('Элементы сцены', 'vn-scene-browser', 'left:240px;top:90px;');
    this.browser = browser.node;
    this.search = el('input', browser.body); this.search.type = 'search'; this.search.placeholder = 'Поиск по имени или типу'; this.search.setAttribute('aria-label', 'Поиск элементов');
    this.search.oninput = () => this.renderList(true);
    this.filter = el('select', browser.body); this.filter.setAttribute('aria-label', 'Тип элементов');
    for (const [v, text] of [['all', 'Все элементы'], ['char:', 'Персонажи'], ['layer:', 'Слои 2D'], ['interactive:', 'Интерактив 2D'], ['object:', 'Объекты 3D']]) this.filter.add(new Option(text, v));
    this.filter.onchange = () => this.renderList(true);
    this.list = el('div', browser.body, null, 'vn-scene-items');
    el('p', browser.body, 'B — список · P — свойства · L — замок · H — видимость. Q/W/E/R — режимы 3D · C — камера · Shift — камера временно.', 'vn-scene-help');
    const inspector = this.panel('Свойства элемента', 'vn-scene-inspector', 'right:344px;top:90px;');
    this.inspector = inspector.node; this.inspectorBody = inspector.body; this.inspector.hidden = true;
    const listen = (type, fn, capture = false) => window.addEventListener(type, fn, { capture, signal: this.events.signal });
    listen('vn-scene-select', e => this.select(e.detail.key, true));
    listen('vn-scene-properties', e => this.properties(e.detail.key || this.selected));
    listen('vn-scene-browser', () => { this.browser.hidden = !this.browser.hidden; });
    listen('keydown', e => this.keydown(e), true);
    listen('keyup', e => { if (e.key === 'Shift') this.bridge.cameraShift(false); }, true);
    listen('blur', () => this.bridge.cameraShift(false));
    this.lastList = null;
  },
  keydown(e) {
    if (typingTarget(e.target) || !game.user?.isGM || !this.bridge.state().open || e.ctrlKey || e.metaKey || e.altKey) return;
    // Leave unrelated Foundry windows and their shortcuts alone.
    if (e.target.closest?.('.application') && !e.target.closest('.vn-scene-window')) return;
    if (e.key === 'Shift') { if (this.bridge.state().mouseControl) this.bridge.cameraShift(true); return; }
    if (e.repeat) return;
    const code = e.code;
    const modes = { KeyQ: 'drag', KeyW: 'translate', KeyE: 'rotate', KeyR: 'scale', KeyC: 'camera' };
    let handled = true;
    if (code === 'KeyB') { this.browser.hidden = !this.browser.hidden; }
    else if (code === 'KeyP') this.properties(this.selected);
    else if (code === 'KeyL') this.toggle('locked');
    else if (code === 'KeyH') this.toggle('visible');
    else if (code === 'KeyF') this.bridge.focus(this.selected);
    else if (code === 'Escape') { this.inspector.hidden = true; this.select(null); }
    else if (modes[code] && this.bridge.state().mouseControl && this.bridge.state().scene3d?.enabled) this.bridge.mode(modes[code]);
    else handled = false;
    if (handled) { e.preventDefault(); e.stopImmediatePropagation(); }
  },
  select(key, fromScene = false) {
    if (key && !this.item(key)) return;
    this.selected = key;
    if (!fromScene) this.bridge.select(key);
    this.renderList(true);
    if (!this.inspector.hidden && key) this.properties(key, false);
  },
  toggle(field, key = this.selected) {
    const item = this.item(key); if (!item) return;
    const value = field === 'locked' ? !(item.data.locked || item.model?.locked) : item.data.visible === false;
    this.bridge.patch(key, { [field]: value }, false, false); this.sync();
  },
  renderList(force = false) {
    if (!this.list) return;
    const items = sceneItems(this.bridge.state());
    const signature = JSON.stringify(items.map(i => [i.key, i.label, i.data.name, i.data.visible, i.data.locked, i.model?.locked]));
    if (!force && signature === this.lastList) return;
    this.lastList = signature; this.list.replaceChildren();
    const search = this.search.value.toLocaleLowerCase();
    for (const item of items) {
      if ((this.filter.value !== 'all' && !item.key.startsWith(this.filter.value)) || !`${item.data.name || ''} ${item.label}`.toLocaleLowerCase().includes(search)) continue;
      const row = el('div', this.list, null, `vn-scene-item${this.selected === item.key ? ' selected' : ''}`); row.dataset.key = item.key;
      const name = this.button(row, item.data.name || item.label, `Выбрать: ${item.data.name || item.label}`, () => this.select(item.key)); name.className = 'vn-scene-item-name';
      el('small', name, item.label);
      this.button(row, item.data.visible === false ? '◌' : '●', item.data.visible === false ? 'Показать' : 'Скрыть', () => this.toggle('visible', item.key));
      this.button(row, item.data.locked || item.model?.locked ? '🔒' : '🔓', item.data.locked || item.model?.locked ? 'Разблокировать' : 'Заблокировать', () => this.toggle('locked', item.key));
      this.button(row, '⚙', 'Свойства', () => this.properties(item.key));
    }
    if (!this.list.children.length) el('p', this.list, 'Нет подходящих элементов');
  },
  properties(key, select = true) {
    const item = this.item(key); if (!item) return;
    if (select) { this.selected = key; this.bridge.select(key); this.renderList(true); }
   
    this.inspector.hidden = false;
    if (this.inspected === key && this.inspectedKind === item.model?.kind) { this.syncFields(); return; }
    this.inspected = key; this.inspectedKind = item.model?.kind;
    this.inspectorBody.replaceChildren(); this.inspectorBody.scrollTop = 0; this.inputs = [];
    const field = (name, label, type = 'number', model = false, transform = false, parent = this.inspectorBody) => {
      const row = el('label', parent, label, `vn-scene-field${type === 'checkbox' ? ' vn-scene-check' : ''}`);
      const input = el(type === 'textarea' ? 'textarea' : 'input', row); if (type !== 'textarea') input.type = type;
      if (type === 'number') input.step = 'any';
      this.inputs.push({ input, name, model, transform });
      const send = live => {
        if (type === 'number' && (input.value === '' || !Number.isFinite(Number(input.value)))) return;
        const value = type === 'checkbox' ? input.checked : type === 'number' ? Number(input.value) : input.value;
        try { this.bridge.patch(key, { [name]: value }, model, live); this.sync(); }
        catch (error) { ui.notifications?.error(error.message); }
      };
      if (type === 'number' || type === 'color') input.addEventListener('input', () => send(true));
      input.addEventListener('change', () => send(false));
    };
    field('name', 'Название', 'text'); field('visible', 'Видимость', 'checkbox'); field('locked', 'Закрепить', 'checkbox');
    const model = !!item.model;
    const transforms = el('div', this.inspectorBody, null, 'vn-scene-transform-grid');
    for (const name of ['x', 'y', ...(model ? ['z', 'rx', 'ry', 'rz'] : ['zIndex'])]) field(name, name === 'zIndex' ? 'Порядок слоёв' : name.toUpperCase(), 'number', model, true, transforms);
    field('scale', 'Масштаб', 'number', model, true);
    if (model) {
      if (item.model.kind === 'model') { field('src', 'Модель GLB / GLTF / FBX', 'text', true); field('animationSrc', 'Файл анимации', 'text', true); field('clip', 'Клип анимации', 'text', true); }
      if (item.model.kind === 'billboard') field('texture', 'Текстура', 'text', true);
      if (!['model', 'spawnpoint'].includes(item.model.kind)) {
        for (const name of ['width', 'height', 'depth']) field(name, { width: 'Ширина', height: 'Высота', depth: 'Глубина' }[name], 'number', true, true);
        field('color', 'Цвет', 'color', true);
      }
      if (['pointLight', 'spotLight', 'sun'].includes(item.model.kind)) {
        for (const name of ['intensity', 'distance', 'angle', 'penumbra']) field(name, { intensity: 'Интенсивность', distance: 'Дальность', angle: 'Угол', penumbra: 'Мягкость' }[name], 'number', true);
        field('castShadow', 'Тени', 'checkbox', true);
      } else if (item.model.kind !== 'spawnpoint') { field('playing', 'Воспроизведение', 'checkbox', true); field('loop', 'Повтор', 'checkbox', true); field('speed', 'Скорость', 'number', true); }
    } else {
      if (item.key.startsWith('char:')) { field('img', 'Изображение', 'text'); field('activeImg', 'Активное изображение', 'text'); field('mirror', 'Отражение', 'checkbox'); field('nameColor', 'Цвет имени', 'color'); }
      else {
        field('width', 'Ширина', 'number', false, true); field('height', 'Высота', 'number', false, true); field('opacity', 'Непрозрачность');
        if (item.data.type === 'text') { field('text', 'Текст', 'textarea'); field('fontSize', 'Размер шрифта'); field('color', 'Цвет', 'color'); }
        else { field('src', 'Изображение / видео', 'text'); if (item.key.startsWith('interactive:')) { field('hoverSrc', 'При наведении', 'text'); field('macroId', 'ID макроса', 'text'); field('triggerOnHover', 'Смена при наведении', 'checkbox'); field('triggerOnClick', 'Действие при клике', 'checkbox'); } }
      }
    }
    const actions = el('div', this.inspectorBody, null, 'vn-scene-actions');
    this.button(actions, 'В фокус', 'В фокус', () => this.bridge.focus(key));
    this.button(actions, 'Копия', 'Дублировать элемент', () => { const newKey = this.bridge.duplicate(key); this.properties(newKey); });
    const remove = this.button(actions, 'Удалить', 'Удалить элемент', () => {
      if (remove.dataset.armed !== 'yes') { remove.dataset.armed = 'yes'; remove.textContent = 'Подтвердить удаление'; return; }
      this.bridge.remove(key); this.selected = null; this.inspected = null; this.inspector.hidden = true; this.sync();
    });
    this.syncFields();
  },
  syncFields() {
    if (!this.inspected || this.inspector?.hidden) return;
    const item = this.item(this.inspected); if (!item) { this.inspector.hidden = true; return; }
    if (this.inspectedKind !== item.model?.kind) { this.properties(this.inspected, false); return; }
    for (const { input, name, model, transform } of this.inputs) {
      input.disabled = !!(transform && (item.data.locked || item.model?.locked));
      if (document.activeElement === input) continue;
      const data = model ? item.model : item.data;
      const value = name === 'locked' ? !!(item.data.locked || item.model?.locked) : name === 'visible' ? item.data.visible !== false : data?.[name];
      if (input.type === 'checkbox') input.checked = !!value; else input.value = input.type === 'number' && Number.isFinite(value) ? Number(value.toPrecision(8)) : value ?? '';
    }
  },
  dispose() {
    this.bridge?.cameraShift(false); this.events?.abort();
    this.browser?.remove(); this.inspector?.remove();
    this.browser = this.inspector = null; this.selected = this.inspected = null; this.inputs = [];
  },
};
