// Plain JSON only: these values travel through Foundry sockets and scene presets.
const num = (v, fallback, min = -10000, max = 10000) => Number.isFinite(Number(v)) && v !== ''
  ? Math.min(max, Math.max(min, Number(v))) : fallback;
export function assetPath(value = '') {
  const path = String(value).trim();
  if (!path) return '';
  if (!/\.(glb|gltf|fbx)(?:[?#]|$)/i.test(path) || /^(?!https?:)[a-z][a-z\d+.-]*:/i.test(path))
    throw new Error('Use a Foundry path or HTTP(S) URL to .glb, .gltf or .fbx');
  return path;
}
export function model3D(value = {}) {
  return {
    kind: ['model', 'cube', 'sphere', 'cylinder', 'cone', 'plane', 'pointLight', 'spotLight', 'sun', 'spawnpoint', 'billboard'].includes(value.kind) ? value.kind : 'model',
    texture: /^(?!https?:)[a-z][a-z\d+.-]*:/i.test(String(value.texture || '')) ? '' : String(value.texture || ''),
    color: /^#[a-f\d]{6}$/i.test(value.color || '') ? value.color : '#b8c8de',
    width: num(value.width, 1, 0.01, 1000), height: num(value.height, 1, 0.01, 1000), depth: num(value.depth, 1, 0.01, 1000),
    intensity: num(value.intensity, 5, 0, 10000), distance: num(value.distance, 20, 0, 10000),
    angle: num(value.angle, 35, 1, 89), penumbra: num(value.penumbra, 0.3, 0, 1),
    castShadow: value.castShadow === true,
    src: assetPath(value.src), animationSrc: assetPath(value.animationSrc),
    clip: String(value.clip || ''), playing: value.playing !== false, loop: value.loop !== false,
    speed: num(value.speed, 1, 0, 4),
    x: num(value.x, 0), y: num(value.y, 0), z: num(value.z, 0),
    rx: num(value.rx, 0, -360, 360), ry: num(value.ry, 0, -360, 360), rz: num(value.rz, 0, -360, 360),
    scale: num(value.scale, 1, 0.0001, 1000),
    locked: value.locked === true,
  };
}
export function scene3D(value = {}) {
  return {
    enabled: value.enabled === true,
    useBackground: value.useBackground === true,
    overlay2d: value.overlay2d === true,
    cameraLocked: value.cameraLocked === true,
    ground: value.ground !== false,
    light: num(value.light, 3, 0, 10),
    ambient: num(value.ambient, 1, 0, 10),
    cameraX: num(value.cameraX, 0), cameraY: num(value.cameraY, 2), cameraZ: num(value.cameraZ, 7),
    targetX: num(value.targetX, 0), targetY: num(value.targetY, 1), targetZ: num(value.targetZ, 0),
    fov: num(value.fov, 45, 15, 100),
    objects: (Array.isArray(value.objects) ? value.objects : []).slice(0, 100).map((o, i) => ({
      ...model3D(o), id: String(o.id || `object-${i}`), name: String(o.name || ''), visible: o.visible !== false,
    })),
  };
}
