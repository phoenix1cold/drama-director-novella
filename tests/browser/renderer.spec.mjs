import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

// Self-contained animated glTF, no remote assets or Foundry installation needed.
const values = new Float32Array([-1,0,0, 1,0,0, 0,2,0, 0,1, 0,0,0, 0,0.5,0]);
const fixture = JSON.stringify({
  asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }],
  nodes: [{ name: 'Hero', mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
  materials: [{ doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [0.2,0.6,1,1], metallicFactor: 0 } }],
  buffers: [{ byteLength: values.byteLength, uri: `data:application/octet-stream;base64,${Buffer.from(values.buffer).toString('base64')}` }],
  bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 8 }, { buffer: 0, byteOffset: 44, byteLength: 24 }],
  accessors: [
    { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-1,0,0], max: [1,2,0] },
    { bufferView: 1, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] },
    { bufferView: 2, componentType: 5126, count: 2, type: 'VEC3' },
  ],
  animations: [{ name: 'Idle', samplers: [{ input: 1, output: 2 }], channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }] }],
});
let server, base;
test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<link rel="stylesheet" href="/styles/vn.css"><link rel="stylesheet" href="/styles/usability.css"><style>body{background:#0a0a14;color:#ccc}#vn-3d-host{position:relative}</style><div id="vn-3d-host" style="width:800px;height:450px"></div><div id="editor"></div>'); return; }
    if (path === '/hero.gltf') { res.setHeader('Content-Type', 'model/gltf+json'); res.end(fixture); return; }
    if (path === '/sample.fbx' && process.env.VN_FBX_SAMPLE) {
      res.end(await readFile(process.env.VN_FBX_SAMPLE)); return;
    }
    try {
      const file = resolve(`.${path}`);
      if (!['scripts', 'styles'].some(dir => file.startsWith(resolve(dir) + '\\') || file.startsWith(resolve(dir) + '/'))) throw Error();
      res.setHeader('Content-Type', ['.mjs', '.js'].includes(extname(file)) ? 'text/javascript' : extname(file) === '.wasm' ? 'application/wasm' : extname(file) === '.css' ? 'text/css' : 'text/plain');
      res.end(await readFile(file));
    } catch { res.statusCode = 404; res.end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(() => new Promise(done => server.close(done)));

async function boot(page) {
  await page.goto(base);
  await page.evaluate(async () => {
    window.errors = []; window.ui = { notifications: { error: e => errors.push(e), warn: e => errors.push(e), info: () => {} } };
    window.game = { user: { isGM: true }, i18n: { lang: 'ru' } };
    window.api = await import('/scripts/vn-3d.mjs');
    window.state = { open: true, scene3d: api.scene3D({ enabled: true }), chars: [{ id: 'hero', name: 'Hero', model3d: api.model3D({ src: '/hero.gltf' }) }] };
    window.commits = [];
    api.VN3D.sync(state, () => {}, (patch, key) => {
      commits.push({ patch, key });
      if (key === null) state.scene3d = api.scene3D({ ...state.scene3d, ...patch });
      else state.chars[0].model3d = api.model3D({ ...state.chars[0].model3d, ...patch });
      api.VN3D.sync(state, () => {});
    });
  });
  await page.waitForFunction(() => api.VN3D.hasCharacter('hero'));
}

test('loads animated model, changes transforms without reload, pauses and disposes', async ({ page }) => {
  const failures = []; page.on('pageerror', e => failures.push(e.message));
  await boot(page);
  await page.waitForFunction(() => api.VN3D.renderer.entries.get('char:hero').action.time > 0.05);
  await page.evaluate(() => {
    const e = api.VN3D.renderer.entries.get('char:hero'); window.originalRoot = e.root;
    state.chars[0].model3d.x = 2; state.chars[0].model3d.playing = false;
    api.VN3D.sync(state, () => {});
  });
  expect(await page.evaluate(() => {
    const e = api.VN3D.renderer.entries.get('char:hero');
    return { same: e.root === originalRoot, x: e.group.position.x, paused: e.action.paused };
  })).toEqual({ same: true, x: 2, paused: true });
  await page.evaluate(() => { state.chars[0].model3d.animationSrc = '/hero.gltf'; api.VN3D.sync(state, () => {}); });
  await page.waitForFunction(() => api.VN3D.renderer.entries.get('char:hero').external?.length === 1);
  expect(await page.evaluate(() => errors)).toEqual([]);
  await page.evaluate(() => { state.open = false; api.VN3D.sync(state, () => {}); });
  await expect(page.locator('canvas')).toHaveCount(0);
  expect(failures).toEqual([]);
});

test('failed model keeps fallback; closing while loading cannot resurrect canvas', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.chars[0].model3d.src = '/missing.glb'; api.VN3D.sync(state, () => {});
  });
  await page.waitForFunction(() => errors.length > 0);
  expect(await page.evaluate(() => api.VN3D.hasCharacter('hero'))).toBe(false);
  await page.evaluate(() => { api.VN3D.dispose(); api.VN3D.sync(state, () => {}); api.VN3D.dispose(); });
  await expect(page.locator('canvas')).toHaveCount(0);
});

test('editor applies model and camera edits as normalized state', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => api.mount3DEditor(document.getElementById('editor'), state, (cfg, models) => { window.applied = { cfg, models }; }));
  await page.locator('summary').filter({ hasText: 'Hero' }).click();
  await page.getByLabel('Камера X', { exact: true }).fill('3');
  await page.getByLabel('Масштаб', { exact: true }).fill('0.01');
  await page.getByRole('button', { name: 'Применить 3D-сцену' }).click();
  expect(await page.evaluate(() => [applied.cfg.cameraX, applied.models[0].model3d.scale])).toEqual([3, 0.01]);
});

test('optional real FBX model and separate animation smoke test', async ({ page }) => {
  test.skip(!process.env.VN_FBX_SAMPLE, 'Set VN_FBX_SAMPLE to a local animated FBX file');
  await boot(page);
  await page.evaluate(() => {
    state.chars[0].model3d = api.model3D({ src: '/sample.fbx', scale: 0.01 });
    api.VN3D.sync(state, () => {});
  });
  await page.waitForFunction(() => api.VN3D.hasCharacter('hero'));
  await page.waitForFunction(() => api.VN3D.renderer.entries.get('char:hero').action?.time > 0.05);
  await page.evaluate(() => {
    state.chars[0].model3d.animationSrc = '/sample.fbx'; api.VN3D.sync(state, () => {});
  });
  await page.waitForFunction(() => api.VN3D.renderer.entries.get('char:hero').external?.length > 0);
  expect(await page.evaluate(() => errors)).toEqual([]);
});

async function heroPoint(page) {
  return page.evaluate(async () => {
    const T = await import('/scripts/vendor/three-vn.mjs');
    const view = api.VN3D.renderer, e = view.entries.get('char:hero');
    view.scene.updateMatrixWorld(true); view.camera.updateMatrixWorld(true);
    const point = new T.Box3().setFromObject(e.group).getCenter(new T.Vector3()).project(view.camera);
    const rect = view.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + (point.x + 1) / 2 * rect.width, y: rect.top + (1 - point.y) / 2 * rect.height };
  });
}

test('mouse drag commits position; locked model and Mouse Control off cannot move it', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { state.mouseControl = true; state.chars[0].model3d.playing = false; api.VN3D.sync(state, () => {}); });
  const p = await heroPoint(page);
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 60, p.y, { steps: 5 }); await page.mouse.up();
  expect(await page.evaluate(() => state.chars[0].model3d.x)).toBeGreaterThan(0.1);
  await page.getByRole('button', { name: 'Закрепить', exact: true }).click();
  const before = await page.evaluate(() => state.chars[0].model3d.x);
  const q = await heroPoint(page);
  await page.mouse.move(q.x, q.y); await page.mouse.down(); await page.mouse.move(q.x + 40, q.y); await page.mouse.up();
  expect(await page.evaluate(() => state.chars[0].model3d.x)).toBe(before);
  await page.evaluate(() => { state.mouseControl = false; api.VN3D.sync(state, () => {}); });
  await expect(page.locator('.vn-3d-tools')).toBeHidden();
  expect(await page.evaluate(() => api.VN3D.renderer.controls.gizmo.enabled)).toBe(false);
});

test('3D background isolation, camera lock and player editing guard', async ({ page }) => {
  await boot(page);
  expect(await page.evaluate(() => api.VN3D.renderer.scene.background !== null)).toBe(true);
  await page.evaluate(() => { state.scene3d.useBackground = true; state.mouseControl = true; api.VN3D.sync(state, () => {}); });
  expect(await page.evaluate(() => api.VN3D.renderer.scene.background)).toBe(null);
  await page.getByRole('button', { name: 'Камера', exact: true }).click();
  expect(await page.evaluate(() => api.VN3D.renderer.controls.orbit.enabled)).toBe(true);
  await page.getByRole('button', { name: 'Закрепить камеру', exact: true }).click();
  expect(await page.evaluate(() => api.VN3D.renderer.controls.orbit.enabled)).toBe(false);
  await page.evaluate(() => { game.user.isGM = false; api.VN3D.sync(state, () => {}); });
  await expect(page.locator('.vn-3d-tools')).toBeHidden();
});

test('3D tools are a separate movable panel above menus with collapse', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { state.mouseControl = true; api.VN3D.sync(state, () => {}); });
  const panel = page.getByRole('dialog', { name: '3D scene tools' });
  expect(await panel.evaluate(el => el.parentElement === document.body)).toBe(true);
  const before = await panel.boundingBox();
  const header = await page.locator('.vn-3d-tools-header span').boundingBox();
  await page.mouse.move(header.x + 40, header.y + 10); await page.mouse.down();
  await page.mouse.move(header.x - 60, header.y + 100, { steps: 5 }); await page.mouse.up();
  const after = await panel.boundingBox();
  expect(after.x).toBeLessThan(before.x - 50);
  expect(after.y).toBeGreaterThan(before.y + 50);
  await page.getByTitle('Свернуть / развернуть').click();
  await expect(page.locator('.vn-3d-tools-body')).toBeHidden();
  await page.getByTitle('Свернуть / развернуть').click();
  await expect(page.locator('.vn-3d-tools-body')).toBeVisible();
  await page.screenshot({ path: 'test-results/3d-editor-panel.png' });
});

async function attachCore(page) {
  await page.evaluate(async () => {
    window.foundry = { applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: c => c } }, utils: { deepClone: value => structuredClone(value) } };
    game.userId = 'gm'; game.user.id = 'gm'; game.users = new Map([['gm', game.user], ['player', { id: 'player', isGM: false }]]);
    game.i18n.localize = key => key; game.i18n.format = key => key;
    window.packets = []; game.socket = { emit: (channel, data) => packets.push(data) };
    window.core = await import('/scripts/visual-novel.mjs');
    Object.assign(core.DDVNManager.getState(), state); window.state = core.DDVNManager.getState();
    core.DDVNManager._shownToPlayers = true;
    window.applyOverlay = core.DDVNOverlay.apply;
    core.DDVNOverlay.apply = () => {};
  });
}

test('3D motion reaches a second client before mouse-up; final state follows motion', async ({ page, context }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await boot(page); await attachCore(page);
  const player = await context.newPage(); await boot(player); await attachCore(player);
  await player.evaluate(() => { game.userId = 'player'; game.user = game.users.get('player'); api.VN3D.sync(state, () => {}); });
  await page.exposeFunction('deliverMotion', data => player.evaluate(packet => core.DDVNManager.receiveMotion(packet), data));
  await page.evaluate(() => {
    game.socket.emit = (channel, data) => { packets.push(data); if (data.type === 'vn:motion') window.deliverMotion(data); };
    state.mouseControl = true; state.chars[0].model3d.playing = false;
    api.VN3D.renderer.controls.commit = (patch, key, live) => core.DDVNManager.edit3D(patch, key, live);
    api.VN3D.sync(state, () => {});
  });
  const p = await heroPoint(page);
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 60, p.y, { steps: 5 });
  await expect.poll(() => page.evaluate(() => packets.filter(p => p.type === 'vn:motion').length)).toBeGreaterThan(0);
  await expect.poll(() => player.evaluate(() => api.VN3D.renderer.entries.get('char:hero').group.position.x)).toBeGreaterThan(0.1);
  expect(await page.evaluate(() => packets.some(p => p.type === 'vn:state'))).toBe(false);
  await page.mouse.up();
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => packets.at(-1).type)).toBe('vn:state');
  await player.close();
});

test('2D drag streams before release and remote patches preserve the portrait DOM', async ({ page }) => {
  await boot(page); await attachCore(page);
  await page.evaluate(() => {
    api.VN3D.dispose(); state.scene3d.enabled = false; state.mouseControl = true;
    state.chars = [{ ...core.newChar(), id: 'hero', x: 80, y: 0, scale: 1 }];
    const container = document.createElement('div'); container.id = 'vn-unified-container'; container.style.cssText = 'position:fixed;inset:0;';
    const char = document.createElement('div'); char.dataset.charId = 'hero'; char.style.cssText = 'position:absolute;left:80px;top:80px;width:100px;height:100px;background:red;';
    char.innerHTML = '<div class="vn-char-wrapper"><div class="vn-char-portrait" style="transform:scaleX(1) scale(1)"></div></div>';
    container.append(char); document.body.append(container);
    core.DDVNOverlay._setupDrag(char, 'char', 'hero'); window.originalPortrait = char.firstChild;
  });
  await page.mouse.move(100, 100); await page.mouse.down(); await page.mouse.move(160, 120, { steps: 5 });
  await expect.poll(() => page.evaluate(() => packets.filter(p => p.type === 'vn:motion').length)).toBeGreaterThan(0);
  await page.mouse.up();
  const state = await page.evaluate(() => {
    game.userId = 'player'; game.user = game.users.get('player');
    core.DDVNManager.receiveMotion({ userId: 'gm', changes: [{ kind: 'char', id: 'hero', props: { x: 400, y: 25, scale: 1.2, _pinned: true } }] });
    const char = document.querySelector('[data-char-id="hero"]');
    return { x: char.style.left, y: char.firstChild.style.transform, preserved: char.firstChild === originalPortrait };
  });
  expect(state).toEqual({ x: '400px', y: 'translateY(25px)', preserved: true });
});

test('built-in lights, primitives and spawnpoints load without model files; wheel keeps occluded selection', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.chars = []; state.mouseControl = true;
    state.scene3d = api.scene3D({ enabled: true, objects: [
      { id: 'front', kind: 'cube', y: 1, z: 1 }, { id: 'back', kind: 'cube', y: 1, z: 0 },
      { id: 'spot', kind: 'spotLight', x: -3, y: 4, rx: -60, intensity: 12, castShadow: true },
      { id: 'sun', kind: 'sun', x: 4, y: 5 }, { id: 'point', kind: 'pointLight', x: 3, y: 2 },
      { id: 'spawn', kind: 'spawnpoint', x: -4 },
    ] }); api.VN3D.sync(state, () => {});
  });
  await page.waitForFunction(() => [...api.VN3D.renderer.entries.values()].every(e => e.root));
  expect(await page.evaluate(() => [...api.VN3D.renderer.entries.values()].flatMap(e => e.root.children).filter(o => o.isLight).map(o => o.type).sort())).toEqual(['DirectionalLight', 'PointLight', 'SpotLight']);
  const p = await page.evaluate(async () => {
    const T = await import('/scripts/vendor/three-vn.mjs'), v = api.VN3D.renderer;
    v.scene.updateMatrixWorld(true); const point = new T.Vector3(0, 1, 0).project(v.camera), r = v.renderer.domElement.getBoundingClientRect();
    return { x: r.left + (point.x + 1) * r.width / 2, y: r.top + (1 - point.y) * r.height / 2 };
  });
  await page.mouse.move(p.x, p.y); await page.mouse.wheel(0, 100);
  await expect.poll(() => page.evaluate(() => api.VN3D.renderer.controls.selected)).toBe('object:front');
  await page.mouse.wheel(0, 100);
  await expect.poll(() => page.evaluate(() => api.VN3D.renderer.controls.selected)).toBe('object:back');
  await page.mouse.down();
  expect(await page.evaluate(() => api.VN3D.renderer.controls.selected)).toBe('object:back'); await page.mouse.up();
  await page.evaluate(() => { game.user.isGM = false; api.VN3D.sync(state, () => {}); });
  expect(await page.evaluate(() => api.VN3D.renderer.entries.get('object:spawn').root.children[0].visible)).toBe(false);
});

test('novel chat stays above 3D canvas and accepts Enter while Mouse Control is on', async ({ page }) => {
  await boot(page); await attachCore(page);
  await page.evaluate(() => {
    api.VN3D.dispose(); document.getElementById('vn-3d-host').remove();
    core.DDVNOverlay.build();
    const overlay = document.getElementById('dd-vn-overlay'); overlay.style.display = 'block'; overlay.classList.add('interactive');
    state.open = true; state.mouseControl = true;
    core.DDVNOverlay._renderDialogue(state.dialogue);
    window.chatText = ''; core.DDVNManager.onSpeechResult = text => { window.chatText = text; };
    api.VN3D.sync(state, () => {});
  });
  await page.waitForFunction(() => api.VN3D.renderer);
  const input = page.locator('#vn-chat-input');
  await input.fill('Тест 3D чата'); await input.press('Enter');
  expect(await page.evaluate(() => chatText)).toBe('Тест 3D чата');
  await expect(input).toHaveValue('');
  const hit = await input.evaluate(el => { const r = el.getBoundingClientRect(); return document.elementFromPoint(r.x + 10, r.y + 10)?.id; });
  expect(hit, JSON.stringify(await input.evaluate(el => { const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + 10, r.y + 10); return { tag: hit?.tagName, cls: hit?.className, rect: r.toJSON(), overlay: getComputedStyle(document.getElementById('dd-vn-overlay')).pointerEvents }; }))).toBe('vn-chat-input');
});

test('character preset footer keeps controls in two usable rows at 200px', async ({ page }) => {
  const template = await readFile('templates/vn-panel.hbs', 'utf8');
  const footer = template.match(/<div class="vn-chars-preset-footer">[\s\S]*?\n          <\/div>/)[0]
    .replace(/{{#each charPresets}}[\s\S]*?{{\/each}}/g, '<option>Example roster</option>')
    .replace(/{{localize "([^"]+)"}}/g, (_, key) => key.includes('rosterName') ? 'Roster name' : key.includes('rosterLoad') ? 'Load roster' : key.split('.').pop());
  await page.goto(base);
  await page.evaluate(markup => {
    const panel = document.createElement('div'); panel.id = 'dd-vn-panel'; panel.style.cssText = 'position:relative;width:220px;';
    panel.innerHTML = `<div class="vn-chars-list-panel">${markup}</div>`; document.body.append(panel);
  }, footer);
  const input = await page.locator('#vn-chars-preset-name').boundingBox();
  const select = await page.locator('#vn-chars-preset-select').boundingBox();
  expect(input.width).toBeGreaterThan(100); expect(select.width).toBeGreaterThan(90);
  expect(input.y).toBeGreaterThan(select.y + 30);
  for (const button of await page.locator('.vn-chars-preset-footer button').all()) expect((await button.boundingBox()).width).toBe(32);
  await page.locator('#dd-vn-panel').screenshot({ path: 'test-results/character-footer.png' });
});

async function bootSceneEditor(page) {
  await boot(page); await attachCore(page);
  await page.evaluate(async () => {
    game.settings = { get: () => ({}), set: async () => {} };
    api.VN3D.dispose(); document.getElementById('vn-3d-host').remove();
    state.mouseControl = true;
    state.layers = [{ id: 'caption', name: 'Надпись', type: 'text', text: 'Пример', x: 600, y: 300, width: 180, height: 60, scale: 1, fontSize: 24, color: '#ffffff', visible: true }];
    state.scene3d = api.scene3D({ ...state.scene3d, overlay2d: true, objects: [{ id: 'box', name: 'Куб', kind: 'cube', x: 2, visible: false }] });
    window.editor = (await import('/scripts/vn-scene-editor.mjs')).SceneEditor;
    core.DDVNOverlay.apply = applyOverlay;
    core.DDVNOverlay.apply(state);
  });
  await page.waitForFunction(() => api.VN3D.renderer?.entries.get('char:hero')?.root);
}

test('scene browser and contextual inspector edit, lock, copy and delete 2D and 3D items', async ({ page }) => {
  const failures = []; page.on('pageerror', e => failures.push(e.message));
  await bootSceneEditor(page);
  const list = page.locator('.vn-scene-browser'), inspector = page.locator('.vn-scene-inspector');
  await expect(list.locator('.vn-scene-item')).toHaveCount(3);
  const box = list.locator('[data-key="object:box"]');
  await box.getByRole('button', { name: 'Показать', exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!api.VN3D.renderer.entries.get('object:box')?.root)).toBe(true);
  await box.getByRole('button', { name: 'Свойства', exact: true }).click();
  await inspector.getByLabel('Масштаб', { exact: true }).fill('2');
  await inspector.getByLabel('Масштаб', { exact: true }).press('Tab');
  expect(await page.evaluate(() => state.scene3d.objects[0].scale)).toBe(2);
  await box.getByRole('button', { name: 'Заблокировать', exact: true }).click();
  await expect(inspector.getByLabel('Масштаб', { exact: true })).toBeDisabled();
  await box.getByRole('button', { name: 'Разблокировать', exact: true }).click();
  await expect(inspector.getByLabel('Масштаб', { exact: true })).toBeEnabled();
  await list.locator('[data-key="layer:caption"]').getByRole('button', { name: 'Свойства', exact: true }).click();
  await inspector.getByLabel('Ширина', { exact: true }).fill('260');
  await inspector.getByLabel('Ширина', { exact: true }).press('Tab');
  expect(await page.evaluate(() => state.layers[0].width)).toBe(260);
  await inspector.getByRole('button', { name: 'Дублировать элемент' }).click();
  await expect(list.locator('.vn-scene-item')).toHaveCount(4);
  await inspector.getByRole('button', { name: 'Удалить элемент' }).click();
  await inspector.getByRole('button', { name: 'Удалить элемент' }).click();
  await expect(list.locator('.vn-scene-item')).toHaveCount(3);
  await list.getByLabel('Поиск элементов').fill('куб');
  await expect(list.locator('.vn-scene-item')).toHaveCount(1);
  await list.getByLabel('Поиск элементов').fill('');
  await box.getByRole('button', { name: 'Свойства', exact: true }).click();
  await page.screenshot({ path: 'test-results/scene-editor.png' });
  expect(failures).toEqual([]);
});

test('scene shortcuts preserve typing, Shift temporarily enables camera and inspector follows selection', async ({ page }) => {
  const failures = []; page.on('pageerror', e => failures.push(e.message));
  await bootSceneEditor(page);
  await page.evaluate(() => editor.properties('char:hero'));
  await page.keyboard.press('e');
  expect(await page.evaluate(() => api.VN3D.renderer.controls.mode)).toBe('rotate');
  await page.keyboard.down('Shift');
  expect(await page.evaluate(() => api.VN3D.renderer.controls.orbit.enabled)).toBe(true);
  await page.keyboard.up('Shift');
  expect(await page.evaluate(() => ({ mode: api.VN3D.renderer.controls.mode, orbit: api.VN3D.renderer.controls.orbit.enabled }))).toEqual({ mode: 'rotate', orbit: false });
  await page.locator('.vn-scene-inspector').getByLabel('Название', { exact: true }).fill('Hello world');
  await page.keyboard.press('w');
  expect(await page.evaluate(() => api.VN3D.renderer.controls.mode)).toBe('rotate');
  await page.evaluate(() => { document.activeElement.blur(); core.DDVNOverlay._applyScrollHighlight('caption', 'layer'); });
  await expect(page.locator('.vn-scene-inspector').getByLabel('Текст', { exact: true })).toHaveValue('Пример');
  await expect(page.locator('.vn-scene-gear')).toHaveCount(0);
  await page.keyboard.press('l');
  expect(await page.evaluate(() => state.layers[0].locked)).toBe(true);
  await page.keyboard.press('l');
  expect(await page.evaluate(() => state.layers[0].locked)).toBe(false);
  await page.evaluate(() => { state.scene3d.enabled = false; core.DDVNOverlay.apply(state); editor.properties('char:hero'); });
  await expect(page.locator('.vn-scene-inspector').getByLabel('Изображение', { exact: true })).toBeVisible();
  await page.evaluate(() => { state.open = false; core.DDVNOverlay.apply(state); });
  await expect(page.locator('.vn-scene-browser')).toHaveCount(0);
  expect(failures).toEqual([]);
});

test('hover creates no floating gear; wheel and browser still open properties', async ({ page }) => {
  await bootSceneEditor(page);
  await page.evaluate(() => { editor.browser.hidden = true; });
  const point = await page.evaluate(async () => {
    const T = await import('/scripts/vendor/three-vn.mjs'), view = api.VN3D.renderer;
    const p = new T.Vector3(0, 1, 0).project(view.camera), r = view.renderer.domElement.getBoundingClientRect();
    return { x: r.x + (p.x + 1) * r.width / 2, y: r.y + (1 - p.y) * r.height / 2 };
  });
  await page.mouse.move(point.x, point.y);
  await expect(page.locator('.vn-scene-gear')).toHaveCount(0);
  await page.mouse.wheel(0, 100);
  await expect.poll(() => page.evaluate(() => editor.selected)).toBe('char:hero');
  await page.keyboard.press('p');
  await expect(page.locator('.vn-scene-inspector').getByLabel('Модель GLB / GLTF / FBX')).toHaveValue('/hero.gltf');
  await page.evaluate(() => { editor.inspector.hidden = true; state.scene3d.enabled = false; core.DDVNOverlay.apply(state); });
  await page.locator('[data-layer-id="caption"]').hover();
  await expect(page.locator('.vn-scene-gear')).toHaveCount(0);
  await page.keyboard.press('b');
  await page.locator('.vn-scene-browser [data-key="layer:caption"]').getByRole('button', { name: 'Свойства', exact: true }).click();
  await expect(page.locator('.vn-scene-inspector').getByLabel('Текст', { exact: true })).toHaveValue('Пример');
});

test('optional real Whisper download, audio worklet, inference and offline model cache', async ({ page, context }) => {
  test.skip(!process.env.VN_WHISPER_TEST, 'Set VN_WHISPER_TEST=1 to download the model');
  test.setTimeout(240000);
  await page.goto(base);
  const result = await page.evaluate(async () => {
    const { Whisper } = await import('/scripts/vn-whisper.mjs');
    await Whisper.download();
    const response = await Whisper.request('transcribe', { audio: new Float32Array(16000), language: 'en' });
    // Exercise the actual AudioWorklet path without opening a user's microphone.
    const { LocalSpeech } = await import('/scripts/vn-whisper.mjs');
    const ctx = new AudioContext(); await ctx.resume();
    const destination = ctx.createMediaStreamDestination();
    const capture = new LocalSpeech(() => {}, e => { throw e; }, 'en-US', () => 18);
    await capture.start(ctx, destination.stream);
    capture.stop(); await ctx.close();
    const ready = Whisper.ready;
    Whisper.cancel('Test complete');
    return { ready, text: response.text };
  });
  expect(result.ready).toBe(true);
  expect(typeof result.text).toBe('string');
  await context.route('https://**/*', route => route.abort());
  const cached = await page.evaluate(async () => {
    const { Whisper } = await import('/scripts/vn-whisper.mjs');
    await Whisper.download(); const ready = Whisper.ready; Whisper.cancel('Test complete'); return ready;
  });
  expect(cached).toBe(true);
});
