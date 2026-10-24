import * as T from './vendor/three-vn.mjs';

export function builtinObject(data) {
  const root = new T.Group();
  if (['pointLight', 'spotLight', 'sun'].includes(data.kind)) {
    const light = data.kind === 'pointLight' ? new T.PointLight(data.color, data.intensity, data.distance)
      : data.kind === 'spotLight' ? new T.SpotLight(data.color, data.intensity, data.distance, T.MathUtils.degToRad(data.angle), data.penumbra)
        : new T.DirectionalLight(data.color, data.intensity);
    if (light.target) { light.target.position.set(0, 0, -1); root.add(light.target); }
    light.castShadow = data.castShadow; light.shadow.mapSize.set(1024, 1024);
    root.add(light);
    const marker = new T.Mesh(new T.OctahedronGeometry(0.18), new T.MeshBasicMaterial({ color: data.color, wireframe: true }));
    marker.userData.editorOnly = true; root.add(marker);
  } else if (data.kind === 'spawnpoint') {
    const marker = new T.Mesh(new T.ConeGeometry(0.3, 0.7, 8), new T.MeshBasicMaterial({ color: 0x4ade80, wireframe: true }));
    marker.position.y = 0.35; marker.userData.editorOnly = true; root.add(marker);
  } else if (data.kind === 'billboard') {
    const material = new T.SpriteMaterial({ color: data.texture ? 0xffffff : data.color });
    const sprite = new T.Sprite(material); sprite.scale.set(data.width, data.height, 1);
    sprite.position.y = data.height / 2; root.add(sprite);
    if (data.texture) new T.TextureLoader().load(data.texture, texture => {
      if (root.userData.disposed) { texture.dispose(); return; }
      texture.colorSpace = T.SRGBColorSpace; material.map = texture; material.needsUpdate = true;
    }, undefined, error => console.warn('DD VN token texture:', data.texture, error));
  } else {
    const geometry = data.kind === 'sphere' ? new T.SphereGeometry(0.5, 24, 16)
      : data.kind === 'cylinder' ? new T.CylinderGeometry(0.5, 0.5, 1, 24)
        : data.kind === 'cone' ? new T.ConeGeometry(0.5, 1, 24)
          : data.kind === 'plane' ? new T.PlaneGeometry(1, 1)
            : new T.BoxGeometry(1, 1, 1);
    const mesh = new T.Mesh(geometry, new T.MeshStandardMaterial({ color: data.color, roughness: 0.8, side: T.DoubleSide }));
    mesh.scale.set(data.width, data.height, data.depth);
    mesh.castShadow = mesh.receiveShadow = true; root.add(mesh);
  }
  return { root, clips: [] };
}

export function builtinSignature(data) {
  if (data.kind === 'model') return data.src;
  return JSON.stringify([data.kind, data.texture, data.color, data.width, data.height, data.depth, data.intensity, data.distance, data.angle, data.penumbra, data.castShadow]);
}
