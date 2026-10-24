import test from 'node:test';
import assert from 'node:assert/strict';
import { scene3D, model3D, assetPath } from '../scripts/vn-3d-state.mjs';

test('legacy scenes default to 2D and finite camera/model transforms', () => {
  assert.equal(scene3D().enabled, false);
  assert.equal(scene3D({ cameraX: Infinity, fov: 1000 }).cameraX, 0);
  assert.equal(scene3D({ fov: 1000 }).fov, 100);
  assert.equal(model3D({ scale: -1 }).scale, 0.0001);
  assert.equal(model3D({ speed: 'bad' }).speed, 1);
});
test('accept Foundry asset paths and signed URLs; reject unsupported formats/schemes', () => {
  for (const path of ['worlds/test/hero.fbx', '/models/a.GLB', 'https://example.com/a.gltf?token=x'])
    assert.equal(assetPath(path), path);
  for (const path of ['javascript:evil.glb', 'file:///private/a.fbx', 'data:model/gltf,a.glb', 'a.obj'])
    assert.throws(() => assetPath(path));
});
test('scene transforms and playback settings survive JSON round-trip', () => {
  const state = scene3D({ enabled: true, objects: [{ id: 'room', src: 'room.glb', x: 3, ry: 90, scale: 2 }] });
  assert.deepEqual(scene3D(JSON.parse(JSON.stringify(state))), state);
  assert.equal(model3D({ src: 'hero.fbx', animationSrc: 'idle.fbx', playing: false }).playing, false);
});

globalThis.foundry = { applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: c => c } }, utils: { deepClone: structuredClone } };
globalThis.game = { user: { isGM: true } };
globalThis.localStorage = { getItem: () => null };
const { DDVNManager, DDVNPresets, DDVNOverlay, DDVNApi } = await import('../scripts/visual-novel.mjs');
DDVNManager.broadcast = () => {};
DDVNManager.clearHorizonLine = () => {};
DDVNOverlay.ensureOpen = () => {};

test('scene presets preserve full 3D objects and character models; legacy preset clears 3D', () => {
  const state = DDVNManager.getState();
  state.scene3d = scene3D({ enabled: true, objects: [{ id: 'room', src: 'room.glb' }] });
  state.chars = [{ id: 'hero', model3d: model3D({ src: 'hero.fbx', animationSrc: 'walk.fbx', clip: 'Walk' }) }];
  const saved = DDVNPresets.makeSceneSnapshot(state, true);
  assert.equal(saved.scene3d.objects[0].src, 'room.glb');
  state.scene3d.objects[0].src = 'other.glb';
  DDVNManager.applySceneState(saved);
  assert.equal(state.scene3d.objects[0].src, 'room.glb');
  assert.equal(state.chars[0].model3d.clip, 'Walk');
  DDVNManager.applySceneState({ chars: [{ id: 'old', img: 'portrait.webp' }] });
  assert.equal(state.scene3d.enabled, false);
  assert.equal(state.chars[0].model3d.src, '');
});
test('3D API checks GM and validates before committing', () => {
  DDVNApi.setScene3D({ enabled: true });
  game.user.isGM = false;
  DDVNApi.setScene3D({ enabled: false });
  assert.equal(DDVNManager.getState().scene3d.enabled, true);
  game.user.isGM = true;
  assert.throws(() => DDVNApi.setScene3D({ enabled: false, objects: [{ src: 'bad.exe' }] }));
  assert.equal(DDVNManager.getState().scene3d.enabled, true);
});

test('3D mouse edits and locks survive scene snapshots; character locks stay consistent', () => {
  const state = DDVNManager.getState(); state.mouseControl = true;
  state.scene3d = scene3D({ enabled: true, objects: [{ id: 'room', src: 'room.glb' }] });
  state.chars = [{ id: 'hero', locked: false, model3d: model3D({ src: 'hero.fbx' }) }];
  DDVNManager.edit3D({ x: 4, z: -2, locked: true }, 'object:room');
  DDVNManager.edit3D({ cameraX: 3, cameraLocked: true }, null);
  DDVNManager.edit3D({ x: 1, locked: true }, 'char:hero');
  assert.equal(state.chars[0].locked, true);
  const snapshot = DDVNPresets.makeSceneSnapshot(state, true);
  DDVNManager.applySceneState(snapshot);
  assert.equal(state.scene3d.objects[0].locked, true);
  assert.equal(state.scene3d.objects[0].x, 4);
  assert.equal(state.scene3d.cameraLocked, true);
  DDVNManager.setLock('char', 'hero', false);
  assert.equal(state.chars[0].model3d.locked, false);
  state.mouseControl = false;
  DDVNManager.edit3D({ x: 100 }, 'char:hero');
  assert.equal(state.chars[0].model3d.x, 1);
});
