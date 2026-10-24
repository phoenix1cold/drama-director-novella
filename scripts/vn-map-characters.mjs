import { model3D } from './vn-3d-state.mjs';

/** Import map token representations into the novel without changing map documents. */
export function charactersFromMap(state, tokens, users, makeChar) {
  const chars = structuredClone(state.chars || []), used = new Set(), occupied = new Map();
  const points = (state.scene3d?.objects || []).filter(o => o.kind === 'spawnpoint' && o.visible !== false);
  for (const c of chars) if (c.fromMap) c.visible = false;
  tokens.forEach((token, index) => {
    const uuid = token.uuid || `${token.parent?.id || 'scene'}.${token.id}`;
    const actorId = token.actorId || token.actor?.id;
    let char = chars.find(c => !used.has(c.id) && (c.tokenUuid === uuid || c.sourceTokenUuid === uuid));
    if (!char) char = chars.find(c => !used.has(c.id) && c.actorId === actorId && !c.tokenUuid && !c.sourceTokenUuid);
    if (!char) {
      const template = chars.find(c => c.actorId === actorId);
      char = template ? { ...structuredClone(template), id: makeChar().id, tokenUuid: '', sourceTokenUuid: '' } : makeChar();
      chars.push(char);
    }
    used.add(char.id);
    char.actorId = actorId; char.sourceTokenUuid = uuid; char.fromMap = true; char.visible = true;
    char.name ||= token.name || token.actor?.name || '';
    char.img ||= token.texture?.src || token.actor?.img || '';
    char.playerId ||= users.find(u => !u.isGM && (u.character?.id === actorId || token.actor?.testUserPermission?.(u, 'OWNER')))?.id || null;
    const point = points.find(p => p.id === char.spawnpointId) || points[index % Math.max(points.length, 1)];
    const position = point ? { x: point.x + (occupied.get(point.id) || 0) * 1.5, y: point.y, z: point.z, ry: point.ry }
      : { x: (index - (tokens.length - 1) / 2) * 1.5, y: 0, z: 0 };
    if (point) occupied.set(point.id, (occupied.get(point.id) || 0) + 1);
    const model = model3D(char.model3d);
    char.model3d = model3D({ ...model, ...position, ...(!model.src && model.kind === 'model' ? { kind: 'billboard', texture: char.img, height: 1.8, width: 1.2 } : {}) });
    char._pinned = true; char._pinnedWidth = 300;
    char.x = tokens.length === 1 ? 810 : 100 + index * (1420 / Math.max(1, tokens.length - 1));
    char.y = 0;
  });
  return chars;
}
