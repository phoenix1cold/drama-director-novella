import { scene3D, model3D } from './vn-3d-state.mjs';
export { scene3D, model3D };

// Lazy renderer: existing 2D worlds do not pay the cost of loading Three.js.
export const VN3D = {
  renderer: null, pending: null, version: 0, state: null,
  sync(state, refresh, commit = () => {}) {
    this.state = state;
    if (!state.open || !state.scene3d?.enabled) { this.dispose(); return; }
    if (this.renderer) { this.renderer.update(state); return; }
    if (this.pending) return;
    const version = ++this.version;
    this.pending = import('./vn-3d-renderer.mjs').then(({ VN3DRenderer }) => {
      if (version !== this.version) return;
      const host = document.getElementById('vn-3d-host');
      if (!host) return;
      this.renderer = new VN3DRenderer(host, refresh, commit);
      this.renderer.update(this.state);
    }).catch(error => {
      if (version !== this.version) return;
      console.error('DD Novella 3D', error);
      ui.notifications?.error(`3D: ${error.message}`);
    }).finally(() => { if (version === this.version) this.pending = null; });
  },
  hasCharacter(id) { return !!this.renderer?.hasCharacter(id); },
  dispose() { ++this.version; this.pending = null; this.renderer?.dispose(); this.renderer = null; },
};

const words = {
  ru: {
    enabled: 'Включить 3D', ground: 'Плоскость пола', light: 'Яркость света',
    locked: 'Закрепить объект', cameraLocked: 'Закрепить камеру', useBackground: 'Показывать 2D-фон за сценой', overlay2d: 'Показывать 2D-слои и портреты поверх 3D',
    ambient: 'Рассеянный свет', kind: 'Тип объекта', color: 'Цвет', intensity: 'Интенсивность', distance: 'Дальность (0 = без ограничения)', angle: 'Угол конуса', penumbra: 'Мягкость края', castShadow: 'Тени', width: 'Ширина', height: 'Высота', depth: 'Глубина', texture: 'Текстура токена',
    camera: 'Камера', target: 'Точка взгляда', fov: 'Угол обзора',
    objects: 'Окружение и объекты', add: 'Добавить объект', remove: 'Удалить',
    characters: '3D-персонажи', src: 'Модель GLB / GLTF / FBX', animationSrc: 'Отдельная анимация (необязательно)',
    clip: 'Имя анимации (пусто = первая)', playing: 'Воспроизведение', loop: 'Зациклить', speed: 'Скорость',
    scale: 'Масштаб', name: 'Название', visible: 'Видимый', apply: 'Применить 3D-сцену',
    hint: 'Пути относительно Data Foundry, например worlds/my-world/models/hero.fbx. Mixamo: FBX Binary With Skin для модели; Without Skin для анимации того же персонажа. Для FBX часто нужен масштаб 0.01. Положение — в единицах сцены, поворот — в градусах. Пустой путь модели оставляет 2D-портрет. Изменения вступают в силу после «Применить».',
    saved: '3D-сцена применена. Для просмотра откройте новеллу.',
  },
  en: {
    enabled: 'Enable 3D', ground: 'Ground plane', light: 'Light intensity', camera: 'Camera', target: 'Look at', fov: 'Field of view',
    locked: 'Lock object', cameraLocked: 'Lock camera', useBackground: 'Show 2D background behind scene', overlay2d: 'Show 2D layers and portraits over 3D',
    ambient: 'Ambient light', kind: 'Object type', color: 'Color', intensity: 'Intensity', distance: 'Range (0 = unlimited)', angle: 'Cone angle', penumbra: 'Soft edge', castShadow: 'Shadows', width: 'Width', height: 'Height', depth: 'Depth', texture: 'Token texture',
    objects: 'Environment and objects', add: 'Add object', remove: 'Remove', characters: '3D characters',
    src: 'GLB / GLTF / FBX model', animationSrc: 'Separate animation (optional)', clip: 'Clip name (empty = first)',
    playing: 'Playing', loop: 'Loop', speed: 'Speed', scale: 'Scale', name: 'Name', visible: 'Visible', apply: 'Apply 3D scene',
    hint: 'Paths relative to Foundry Data, e.g. worlds/my-world/models/hero.fbx. Mixamo: FBX Binary With Skin for models; Without Skin for animations of the same character. FBX often needs scale 0.01. Positions use scene units; rotations use degrees. An empty model path keeps the 2D portrait. Click Apply to use changes.',
    saved: '3D scene applied. Open the novel to preview.',
  },
};

/** Draft editor: no network requests or world mutations until Apply. */
export function mount3DEditor(host, state, commit, liveEdit = null) {
  if (!host || !game.user?.isGM) return;
  const w = words[game.i18n.lang] || words.en;
  const draft = scene3D(state.scene3d);
  const chars = (state.chars || []).map(c => ({ id: c.id, name: c.name, model: model3D({ ...c.model3d, locked: !!(c.locked || c.model3d?.locked) }) }));
  const element = (tag, parent, text, cls) => {
    const node = document.createElement(tag); if (text) node.textContent = text;
    if (cls) node.className = cls; parent.append(node); return node;
  };
  const field = (parent, obj, key, label = w[key] || key, type = 'number') => {
    const row = element('label', parent, null, 'vn-3d-field'); element('span', row, label);
    const input = element('input', row); input.type = type;
    input._vn3dObject = obj; input._vn3dKey = key;
    if (type === 'checkbox') input.checked = obj[key];
    else input.value = obj[key];
    if (type === 'number') input.step = 'any';
    input.addEventListener('change', () => { obj[key] = type === 'checkbox' ? input.checked : input.value; });
    const liveFields = ['x', 'y', 'z', 'rx', 'ry', 'rz', 'scale', 'speed', 'playing', 'loop', 'light', 'ambient', 'fov', 'cameraX', 'cameraY', 'cameraZ', 'targetX', 'targetY', 'targetZ', 'color', 'intensity', 'distance', 'angle', 'penumbra', 'width', 'height', 'depth'];
    if (liveEdit && liveFields.includes(key)) {
      const send = live => {
        if (type === 'number' && (input.value === '' || !Number.isFinite(Number(input.value)))) return;
        const value = type === 'checkbox' ? input.checked : type === 'number' ? Number(input.value) : input.value;
        obj[key] = value;
        const id = obj === draft ? null : chars.find(c => c.model === obj)?.id;
        const address = obj === draft ? null : id ? `char:${id}` : `object:${obj.id}`;
        liveEdit({ [key]: value }, address, live);
      };
      input.addEventListener('input', () => send(true));
      input.addEventListener('change', () => send(false));
    }
  };
  const button = (parent, text, fn) => {
    const b = element('button', parent, text); b.type = 'button'; b.addEventListener('click', fn); return b;
  };
  function modelFields(parent, data, builtin = false) {
    const types = builtin ? ['model', 'cube', 'sphere', 'cylinder', 'cone', 'plane', 'pointLight', 'spotLight', 'sun', 'spawnpoint', 'billboard'] : ['model', 'billboard'];
    const label = element('label', parent, w.kind, 'vn-3d-field');
    const kind = element('select', label);
    for (const type of types) kind.add(new Option(type, type)); kind.value = data.kind;
    const assetFields = element('div', parent);
    for (const key of ['src', 'animationSrc', 'clip']) field(assetFields, data, key, w[key], 'text');
    const shapeFields = element('div', parent, null, 'vn-3d-grid');
    for (const key of ['width', 'height', 'depth']) field(shapeFields, data, key);
    field(shapeFields, data, 'color', w.color, 'color');
    const textureFields = element('div', parent); field(textureFields, data, 'texture', w.texture, 'text');
    const lightFields = element('div', parent, null, 'vn-3d-grid');
    for (const key of ['intensity', 'distance', 'angle', 'penumbra']) field(lightFields, data, key);
    field(lightFields, data, 'castShadow', w.castShadow, 'checkbox');
    const visibility = () => {
      assetFields.hidden = data.kind !== 'model';
      shapeFields.hidden = ['model', 'spawnpoint'].includes(data.kind);
      lightFields.hidden = !['pointLight', 'spotLight', 'sun'].includes(data.kind);
      textureFields.hidden = data.kind !== 'billboard';
    };
    kind.onchange = () => { data.kind = kind.value; visibility(); }; visibility();
    const grid = element('div', parent, null, 'vn-3d-grid');
    for (const key of ['x', 'y', 'z', 'rx', 'ry', 'rz', 'scale', 'speed']) field(grid, data, key);
    for (const key of ['playing', 'loop', 'locked']) field(grid, data, key, w[key], 'checkbox');
  }
  host.replaceChildren();
  element('p', host, w.hint);
  const settings = element('section', host, null, 'dd-section');
  const grid = element('div', settings, null, 'vn-3d-grid');
  field(grid, draft, 'enabled', w.enabled, 'checkbox'); field(grid, draft, 'ground', w.ground, 'checkbox');
  for (const key of ['cameraLocked', 'useBackground', 'overlay2d']) field(grid, draft, key, w[key], 'checkbox');
  field(grid, draft, 'light'); field(grid, draft, 'ambient'); field(grid, draft, 'fov');
  for (const prefix of ['camera', 'target']) for (const axis of ['X', 'Y', 'Z']) field(grid, draft, prefix + axis, `${w[prefix]} ${axis}`);
  element('h3', host, w.objects);
  const objects = element('div', host);
  function drawObjects() {
    objects.replaceChildren();
    for (const obj of draft.objects) {
      const card = element('section', objects, null, 'dd-section');
      field(card, obj, 'name', w.name, 'text'); field(card, obj, 'visible', w.visible, 'checkbox');
      modelFields(card, obj, true);
      button(card, w.remove, () => { draft.objects = draft.objects.filter(o => o !== obj); drawObjects(); });
    }
  }
  drawObjects();
  button(host, w.add, () => { draft.objects.push({ ...model3D(), id: crypto.randomUUID(), name: '', visible: true }); drawObjects(); });
  element('h3', host, w.characters);
  for (const char of chars) {
    const card = element('details', host, null, 'dd-section'); element('summary', card, char.name || char.id);
    modelFields(card, char.model);
  }
  button(host, w.apply, () => {
    try {
      const normalized = scene3D(draft);
      const models = chars.map(c => ({ id: c.id, model3d: model3D(c.model) }));
      commit(normalized, models);
      ui.notifications?.info(w.saved);
    } catch (error) { ui.notifications?.error(error.message); }
  }).classList.add('vn-btn-primary');
  // Keep mouse edits in the draft so Apply cannot restore stale transforms.
  host.addEventListener('vn3d-transform', event => {
    const { key, patch } = event.detail;
    const target = key === null ? draft : key.startsWith('char:')
      ? chars.find(c => `char:${c.id}` === key)?.model : draft.objects.find(o => `object:${o.id}` === key);
    if (!target) return;
    Object.assign(target, patch);
    for (const input of host.querySelectorAll('input')) if (input._vn3dObject === target && input._vn3dKey in patch) {
      if (input.type === 'checkbox') input.checked = target[input._vn3dKey]; else input.value = target[input._vn3dKey];
    }
  });
}
