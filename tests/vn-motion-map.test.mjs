import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionQueue } from '../scripts/vn-motion.mjs';
import { charactersFromMap } from '../scripts/vn-map-characters.mjs';
import { scene3D } from '../scripts/vn-3d-state.mjs';

test('motion coalesces samples and sends during gesture, before final flush', async () => {
  const packets = [], queue = new MotionQueue(changes => packets.push(changes), 5);
  queue.push('char', 'a', { x: 1, y: 3 }); queue.push('char', 'a', { x: 2 });
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.deepEqual(packets, [[{ kind: 'char', id: 'a', props: { x: 2, y: 3 } }]]);
  queue.push('3d', 'object:cube', { x: 9 }); queue.flush();
  assert.equal(packets.length, 2);
  queue.push('char', 'a', { x: 100 }); queue.clear();
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(packets.length, 2);
});

let uid = 0;
const makeChar = () => ({ id: `new-${++uid}`, visible: true });
const tokens = [1, 2].map(i => ({ id: `t${i}`, uuid: `Scene.s.Token.t${i}`, actorId: 'actor', name: `Token ${i}`, texture: { src: 'token.webp' }, actor: { id: 'actor' } }));
test('map launch honors token-specific binding and spawnpoint, preserves authored model', () => {
  const state = { chars: [{ id: 'hero', actorId: 'actor', tokenUuid: tokens[1].uuid, spawnpointId: 'entry', model3d: { src: 'hero.glb', scale: 0.01 } }],
    scene3d: scene3D({ enabled: true, objects: [{ id: 'entry', kind: 'spawnpoint', x: 3, y: 2, z: 4, ry: 90 }] }) };
  const result = charactersFromMap(state, tokens, [{ id: 'player', character: { id: 'actor' } }], makeChar);
  const hero = result.find(c => c.id === 'hero');
  assert.equal(hero.sourceTokenUuid, tokens[1].uuid);
  assert.equal(hero.model3d.src, 'hero.glb'); assert.equal(hero.model3d.scale, 0.01);
  assert.equal(hero.model3d.y, 2); assert.equal(hero.model3d.ry, 90);
  assert.equal(hero.playerId, 'player');
  assert.equal(state.chars.length, 1); // Source is not mutated.
});
test('repeated map launch is idempotent; departed tokens hide; unbound tokens become billboards', () => {
  const state = { chars: [], scene3d: scene3D({ enabled: true }) };
  state.chars = charactersFromMap(state, tokens, [], makeChar);
  assert.equal(state.chars.length, 2);
  assert.equal(state.chars[0].model3d.kind, 'billboard');
  assert.equal(state.chars[0].model3d.texture, 'token.webp');
  const ids = state.chars.map(c => c.id);
  state.chars = charactersFromMap(state, tokens, [], makeChar);
  assert.deepEqual(state.chars.map(c => c.id), ids);
  state.chars = charactersFromMap(state, tokens.slice(0, 1), [], makeChar);
  assert.equal(state.chars.filter(c => c.visible).length, 1);
});
