import * as T from './vendor/three-vn.mjs';
import { model3D } from './vn-3d-state.mjs';
import { SceneControls } from './vn-3d-controls.mjs';
import { builtinObject, builtinSignature } from './vn-3d-builtins.mjs';

function disposeTree(root) {
  if (root) root.userData.disposed = true;
  const textures = new Set(), materials = new Set(), geometries = new Set(), skeletons = new Set();
  root?.traverse(o => {
    if (o.isLight) o.dispose?.();
    if (o.geometry) geometries.add(o.geometry);
    if (o.skeleton) skeletons.add(o.skeleton);
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) if (m) {
      materials.add(m);
      for (const v of Object.values(m)) if (v?.isTexture) textures.add(v);
    }
  });
  skeletons.forEach(s => s.dispose());
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
  textures.forEach(t => { t.source?.data?.close?.(); t.dispose(); });
}

export class VN3DRenderer {
  constructor(host, onReady, commit = () => {}) {
    this.host = host; this.onReady = onReady; this.entries = new Map(); this.dead = false;
    this.scene = new T.Scene();
    this.camera = new T.PerspectiveCamera(45, 16 / 9, 0.01, 20000);
    this.renderer = new T.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0, 0);
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    host.append(this.renderer.domElement);
    this.ambient = new T.HemisphereLight(0xffffff, 0x586077, 1); this.scene.add(this.ambient);
    this.light = new T.DirectionalLight(0xffffff, 3);
    this.light.position.set(3, 6, 4); this.scene.add(this.light);
    this.ground = new T.Mesh(new T.PlaneGeometry(200, 200), new T.MeshStandardMaterial({ color: 0x343a46, roughness: 1 }));
    this.ground.rotation.x = -Math.PI / 2; this.ground.position.y = -0.005;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    this.controls = new SceneControls(this, commit);
    this.resize = new ResizeObserver(() => {
      if (this.dead) return;
      const w = host.clientWidth || 1920, h = host.clientHeight || 1080;
      this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    });
    this.resize.observe(host);
    this.lastTime = performance.now();
    this.renderer.setAnimationLoop(time => {
      const dt = Math.min(Math.max((time - this.lastTime) / 1000, 0), 0.1); this.lastTime = time;
      if (document.hidden) return;
      for (const e of this.entries.values()) e.mixer?.update(dt);
      this.renderer.render(this.scene, this.camera);
    });
  }

  async load(src) {
    if (/\.fbx(?:[?#]|$)/i.test(src)) {
      const root = await new T.FBXLoader().loadAsync(src);
      return { root, clips: root.animations || [] };
    }
    const gltf = await new T.GLTFLoader().loadAsync(src);
    return { root: gltf.scene, clips: gltf.animations || [] };
  }

  update(state) {
    this.state = state;
    const cfg = state.scene3d;
    this.scene.background = cfg.useBackground ? null : new T.Color(state.bgColor || '#0a0a14');
    if (!this.controls.navigating) {
      this.camera.position.set(cfg.cameraX, cfg.cameraY, cfg.cameraZ);
      this.camera.lookAt(cfg.targetX, cfg.targetY, cfg.targetZ);
      this.controls.orbit.target.set(cfg.targetX, cfg.targetY, cfg.targetZ);
      this.controls.orbit.update();
    }
    this.camera.fov = cfg.fov; this.camera.updateProjectionMatrix();
    this.light.intensity = cfg.light; this.ground.visible = cfg.ground;
    this.ambient.intensity = cfg.ambient ?? 1;
    const wanted = new Map();
    for (const o of cfg.objects || []) if (o.visible !== false && (o.src || (o.kind && o.kind !== 'model'))) wanted.set(`object:${o.id}`, model3D(o));
    for (const c of state.chars || []) if (c.visible !== false && (c.model3d?.src || (c.model3d?.kind && c.model3d.kind !== 'model'))) wanted.set(`char:${c.id}`, model3D(c.model3d));
    for (const [key, e] of this.entries) if (!wanted.has(key) || builtinSignature(wanted.get(key)) !== e.signature) {
      this.remove(key, e);
    }
    for (const [key, data] of wanted) {
      let e = this.entries.get(key);
      if (!e) {
        e = { src: data.src, signature: builtinSignature(data), data, animationSrc: null, animationVersion: 0 };
        this.entries.set(key, e);
        (data.kind === 'model' ? this.load(data.src) : Promise.resolve(builtinObject(data))).then(asset => {
          if (this.dead || this.entries.get(key) !== e) { disposeTree(asset.root); return; }
          e.root = asset.root; e.clips = asset.clips;
          e.root.traverse(node => { if (node.isMesh && !node.userData.editorOnly) { node.castShadow = true; node.receiveShadow = true; } });
          // Keep original model units: Mixamo FBX typically needs scale 0.01.
          e.group = new T.Group(); e.group.add(e.root); this.scene.add(e.group);
          e.mixer = new T.AnimationMixer(e.root);
          this.applyEntry(key, e); this.controls.refresh(); this.onReady();
        }).catch(error => this.report(key, e, error));
      }
      e.data = data;
      if (e.root) this.applyEntry(key, e);
    }
    this.controls.refresh();
  }

  applyEntry(key, e) {
    const d = e.data;
    e.root.traverse(node => { if (node.userData.editorOnly) node.visible = !!(game.user?.isGM && this.state.mouseControl); });
    if (this.controls.drag?.key === key || (this.controls.gizmo.dragging && this.controls.selected === key)) return;
    e.group.position.set(d.x, d.y, d.z);
    e.group.rotation.set(...[d.rx, d.ry, d.rz].map(v => T.MathUtils.degToRad(v)));
    e.group.scale.setScalar(d.scale);
    if (e.animationSrc !== d.animationSrc) {
      e.animationSrc = d.animationSrc; e.external = null;
      const version = ++e.animationVersion;
      e.mixer.stopAllAction(); e.action = null; e.animationKey = null;
      if (d.animationSrc) this.load(d.animationSrc).then(asset => {
        const clips = asset.clips;
        disposeTree(asset.root);
        if (this.dead || this.entries.get(key) !== e || e.animationVersion !== version) return;
        if (!clips.length) throw new Error('Animation file contains no clips');
        // Validate bone bindings instead of silently playing an incompatible rig.
        for (const clip of clips) for (const track of clip.tracks) {
          const binding = T.PropertyBinding.parseTrackName(track.name);
          if (!T.PropertyBinding.findNode(e.root, binding.nodeName))
            throw new Error(`Incompatible animation skeleton: ${binding.nodeName}`);
        }
        e.external = clips; this.play(e);
      }).catch(error => {
        if (e.animationVersion === version) this.report(key, e, error);
      });
    }
    this.play(e);
  }

  play(e) {
    const d = e.data;
    const clips = d.animationSrc ? e.external : e.clips;
    if (!clips) return;
    const clip = d.clip ? clips.find(c => c.name === d.clip) : clips[0];
    const key = `${e.animationSrc}|${d.clip}|${d.loop}`;
    if (e.animationKey !== key) {
      e.mixer.stopAllAction(); e.action = null; e.animationKey = key;
      if (clip) {
        e.action = e.mixer.clipAction(clip);
        e.action.setLoop(d.loop ? T.LoopRepeat : T.LoopOnce, d.loop ? Infinity : 1);
        e.action.clampWhenFinished = true; e.action.reset().play();
      } else if (d.clip) ui.notifications?.warn(`3D: animation "${d.clip}" not found`);
    }
    if (e.action) { e.action.paused = !d.playing; e.action.timeScale = d.speed; }
  }

  hasCharacter(id) { return !!this.entries.get(`char:${id}`)?.root; }
  report(key, entry, error) {
    if (this.dead || this.entries.get(key) !== entry) return;
    console.error('DD Novella 3D', entry.src, error);
    ui.notifications?.error(`3D: ${entry.src} — ${error.message}`);
  }
  remove(key, e) {
    this.entries.delete(key); ++e.animationVersion;
    e.mixer?.stopAllAction(); if (e.root) e.mixer?.uncacheRoot(e.root);
    e.group?.removeFromParent(); disposeTree(e.root);
  }
  dispose() {
    this.dead = true; this.resize.disconnect(); this.renderer.setAnimationLoop(null);
    this.controls.dispose();
    for (const [key, e] of this.entries) this.remove(key, e);
    disposeTree(this.ground); this.renderer.dispose(); this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
