import * as THREE from 'three';
import { EffectComposer } from '../../vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../../vendor/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from '../../vendor/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from '../../vendor/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../../vendor/jsm/postprocessing/OutputPass.js';
import { clamp, damp, RNG } from './rng.js';
import { prefersReducedMotion } from './motion.js';

const cache = {};

export const QUALITY = {
  0: { name: 'low', pixel: 1, shadow: 0, shadowSpan: 46, bloom: 0, grade: 0.45, particles: 0.45, motes: 0.3, lamps: 4, torch: 9 },
  1: { name: 'medium', pixel: 1.35, shadow: 1024, shadowSpan: 34, bloom: 0.42, grade: 0.8, particles: 0.75, motes: 0.7, lamps: 7, torch: 12 },
  2: { name: 'high', pixel: 1.75, shadow: 2048, shadowSpan: 26, bloom: 0.68, grade: 1, particles: 1, motes: 1, lamps: 7, torch: 13 },
};

export function glowTexture(key, inner = 'rgba(255,236,190,1)', outer = 'rgba(255,180,60,0)') {
  if (cache[key]) return cache[key];
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.35, inner.replace(/,\s*1\)/, ',0.55)'));
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  cache[key] = t;
  return t;
}

export function erdtreeTexture() {
  if (cache.tree) return cache.tree;
  const c = document.createElement('canvas');
  c.width = 512; c.height = 768;
  const g = c.getContext('2d');
  const rnd = new RNG(7717);
  g.globalCompositeOperation = 'lighter';
  const halo = g.createRadialGradient(256, 250, 20, 256, 250, 250);
  halo.addColorStop(0, 'rgba(255,226,150,0.85)');
  halo.addColorStop(0.4, 'rgba(226,168,74,0.28)');
  halo.addColorStop(1, 'rgba(120,80,20,0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, 512, 768);
  g.strokeStyle = 'rgba(255,238,196,0.9)';
  g.lineCap = 'round';
  const branch = (x, y, ang, len, w, depth) => {
    if (depth <= 0 || len < 6) return;
    const nx = x + Math.cos(ang) * len, ny = y + Math.sin(ang) * len;
    g.lineWidth = w;
    g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke();
    branch(nx, ny, ang - rnd.range(0.25, 0.72), len * rnd.range(0.6, 0.78), w * 0.62, depth - 1);
    branch(nx, ny, ang + rnd.range(0.25, 0.72), len * rnd.range(0.6, 0.78), w * 0.62, depth - 1);
    if (rnd.chance(0.45)) branch(nx, ny, ang + rnd.range(-0.2, 0.2), len * 0.7, w * 0.5, depth - 1);
  };
  branch(256, 700, -Math.PI / 2, 130, 16, 6);
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = 'rgba(30,20,10,0.55)';
  g.fillRect(250, 690, 12, 78);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  cache.tree = t;
  return t;
}

class ParticlePool {
  constructor(capacity, blending = THREE.AdditiveBlending, texKey = 'soft') {
    this.capacity = capacity;
    this.head = 0;
    this.live = 0;
    this.drop = 0;
    this._uploaded = 0;
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.vz = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.grow = new Float32Array(capacity);
    this.baseSize = new Float32Array(capacity);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: glowTexture(texKey) }, uPixel: { value: 1 } },
      vertexShader: `attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
varying vec3 vC; varying float vA; uniform float uPixel;
void main(){ vC=aColor; vA=aAlpha; vec4 mv=modelViewMatrix*vec4(position,1.0);
gl_PointSize = aSize * uPixel * (420.0 / max(0.4,-mv.z)); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform sampler2D uTex; varying vec3 vC; varying float vA;
void main(){ if(vA<=0.001) discard; vec4 t=texture2D(uTex,gl_PointCoord); gl_FragColor=vec4(vC,1.0)*t.a*vA; }`,
      transparent: true, depthWrite: false, blending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    this.geo = geo;
    this.mat = mat;
  }

  emit(x, y, z, o) {
    let i;
    if (this.live < this.capacity) i = this.live++;
    else i = this.drop = (this.drop + 1) % this.capacity;
    const p3 = i * 3;
    this.pos[p3] = x; this.pos[p3 + 1] = y; this.pos[p3 + 2] = z;
    const c = o.color;
    this.col[p3] = c.r; this.col[p3 + 1] = c.g; this.col[p3 + 2] = c.b;
    this.baseSize[i] = o.size ?? 1;
    this.size[i] = this.baseSize[i];
    this.alpha[i] = o.alpha ?? 1;
    const sp = o.speed ?? 1, up = o.up ?? 0;
    const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.5) * (o.spread ?? 1);
    this.vx[i] = Math.cos(a) * sp * (1 - Math.abs(e));
    this.vz[i] = Math.sin(a) * sp * (1 - Math.abs(e));
    this.vy[i] = up + e * sp;
    if (o.dir) { this.vx[i] += o.dir.x * sp; this.vy[i] += o.dir.y * sp; this.vz[i] += o.dir.z * sp; }
    this.grav[i] = o.gravity ?? 0;
    this.drag[i] = o.drag ?? 1.6;
    this.grow[i] = o.grow ?? 0;
    this.life[i] = this.maxLife[i] = o.life ?? 0.7;
  }

  update(dt) {
    let i = 0;
    while (i < this.live) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this._recycle(i); continue; }
      const t = clamp(this.life[i] / this.maxLife[i], 0, 1);
      const d = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= d; this.vz[i] *= d;
      this.vy[i] = this.vy[i] * d + this.grav[i] * dt;
      const i3 = i * 3;
      this.pos[i3] += this.vx[i] * dt;
      this.pos[i3 + 1] += this.vy[i] * dt;
      this.pos[i3 + 2] += this.vz[i] * dt;
      this.alpha[i] = t * t;
      this.size[i] = this.baseSize[i] * (1 + this.grow[i] * (1 - t));
      if (this.pos[i3 + 1] < 0.02 && this.grav[i] < 0) { this._recycle(i); continue; }
      i++;
    }
    if (!this.live) { if (this._uploaded) { this._uploaded = 0; this.geo.setDrawRange(0, 0); } return; }
    this.geo.setDrawRange(0, this.live);
    const n3 = this.live * 3, n1 = this.live;
    const a = this.geo.attributes;
    a.position.clearUpdateRanges(); a.position.addUpdateRange(0, n3); a.position.needsUpdate = true;
    a.aColor.clearUpdateRanges(); a.aColor.addUpdateRange(0, n3); a.aColor.needsUpdate = true;
    a.aSize.clearUpdateRanges(); a.aSize.addUpdateRange(0, n1); a.aSize.needsUpdate = true;
    a.aAlpha.clearUpdateRanges(); a.aAlpha.addUpdateRange(0, n1); a.aAlpha.needsUpdate = true;
    this._uploaded = this.live;
  }

  _recycle(i) {
    const last = --this.live;
    if (i !== last) {
      const i3 = i * 3, l3 = last * 3;
      this.pos[i3] = this.pos[l3]; this.pos[i3 + 1] = this.pos[l3 + 1]; this.pos[i3 + 2] = this.pos[l3 + 2];
      this.col[i3] = this.col[l3]; this.col[i3 + 1] = this.col[l3 + 1]; this.col[i3 + 2] = this.col[l3 + 2];
      this.size[i] = this.size[last]; this.alpha[i] = this.alpha[last];
      this.vx[i] = this.vx[last]; this.vy[i] = this.vy[last]; this.vz[i] = this.vz[last];
      this.life[i] = this.life[last]; this.maxLife[i] = this.maxLife[last];
      this.grav[i] = this.grav[last]; this.drag[i] = this.drag[last];
      this.grow[i] = this.grow[last]; this.baseSize[i] = this.baseSize[last];
    }
    this.alpha[last] = 0; this.size[last] = 0; this.life[last] = 0;
  }

  clear() {
    this.life.fill(0); this.alpha.fill(0); this.size.fill(0);
    this.live = 0; this.drop = 0; this._uploaded = 0;
    this.geo.setDrawRange(0, 0);
  }
}

const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVig: { value: 1 },
    uGrain: { value: 0.05 },
    uSat: { value: 1.05 },
    uTone: { value: 1 },
  },
  vertexShader: `varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uVig, uGrain, uSat, uTone;
varying vec2 vUv;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
void main(){
  vec2 uv = vUv;
  vec3 c = texture2D(tDiffuse, uv).rgb;
  float r2 = dot(uv - 0.5, uv - 0.5) * 2.6;
  c.r = texture2D(tDiffuse, uv + (uv - 0.5) * r2 * 0.0026).r;
  c.b = texture2D(tDiffuse, uv - (uv - 0.5) * r2 * 0.0026).b;
  float l = dot(c, vec3(0.2125, 0.7154, 0.0721));
  c = mix(vec3(l), c, uSat);
  c *= mix(vec3(0.84, 0.94, 1.18), vec3(1.14, 1.01, 0.82), clamp(l * 1.5, 0.0, 1.0) * uTone);
  float vig = 1.0 - smoothstep(0.3, 1.5, r2) * 0.5 * uVig;
  c *= vec3(vig);
  float g = hash(gl_FragCoord.xy + vec2(0.0, fract(uTime) * 431.0));
  c += (g - 0.5) * uGrain * (0.16 + min(l, 1.2));
  gl_FragColor = vec4(c, 1.0);
}`,
};

export class View {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.fog = new THREE.FogExp2(new THREE.Color('#14161d'), 0.03);
    this.scene.fog = this.fog;
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.08, 300);
    this.scene.add(this.camera);

    this.hemi = new THREE.HemisphereLight('#5d6b8c', '#1a1410', 0.62);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#ffdca8', 2.0);
    this.sun.position.set(18, 26, 12);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1536, 1536);
    const sc = this.sun.shadow.camera;
    sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 90;
    this.sun.shadow.bias = -0.0012;
    this.sun.shadow.normalBias = 0.045;
    this.scene.add(this.sun, this.sun.target);
    this.fill = new THREE.DirectionalLight('#6f7fb5', 0.5);
    this.fill.position.set(-14, 10, -18);
    this.scene.add(this.fill);

    this.lampPool = [];
    for (let i = 0; i < 7; i++) {
      const l = new THREE.PointLight('#ffab52', 0, 13, 2);
      // kept visible with zero intensity: toggling light visibility rebuilds every
      // material program mid-run, which is what the per-room lamp swap used to do
      l.intensity = 0;
      this.scene.add(l);
      this.lampPool.push(l);
    }
    // carried ember: rooms are walled and self-shadowing, so without a light that
    // rides with the player the far corners collapse to pure black
    this.torch = new THREE.PointLight('#ff9d55', 0, 12, 2);
    this._torchAt = new THREE.Vector3();
    this._torchInt = this.preset?.torch ?? 12;
    this.scene.add(this.torch);

    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        uTop: { value: new THREE.Color('#0b0d16') },
        uBot: { value: new THREE.Color('#3a2c22') },
        uGlow: { value: new THREE.Color('#c99a3f') },
        uStar: { value: 0.5 },
      },
      vertexShader: `varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uTop; uniform vec3 uBot; uniform vec3 uGlow; uniform float uStar; varying vec3 vP;
float h(vec2 p){ return fract(sin(dot(p,vec2(41.3,289.1)))*43758.5453); }
void main(){ vec3 d=normalize(vP); float t=clamp(d.y*0.5+0.5,0.0,1.0);
vec3 col=mix(uBot,uTop,pow(t,0.72));
float band=pow(clamp(1.0-abs(d.y-0.02)*2.4,0.0,1.0),2.5);
col+=uGlow*band*0.55;
vec2 g=floor(d.xz*140.0+d.y*40.0); float s=h(g);
float star=step(1.0-uStar*0.05, s)*(0.35+0.65*h(g+7.1));
col+=vec3(star)*clamp(d.y,0.0,1.0)*smoothstep(0.75,1.0,s)*0.9;
gl_FragColor=vec4(col,1.0); }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(150, 24, 16), this.skyMat);
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    this.tree = new THREE.Mesh(
      new THREE.PlaneGeometry(78, 117),
      new THREE.MeshBasicMaterial({ map: erdtreeTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })
    );
    this.tree.renderOrder = -1;
    this.scene.add(this.tree);

    this.sparks = new ParticlePool(900, THREE.AdditiveBlending, 'soft');
    this.smoke = new ParticlePool(420, THREE.NormalBlending, 'smoke');
    this.scene.add(this.sparks.points, this.smoke.points);
    this.smoke.mat.uniforms.uTex.value = glowTexture('smoke', 'rgba(190,190,205,0.5)', 'rgba(90,90,110,0)');

    this.shakeAmp = 0;
    this.shakeT = 0;
    this.motes = 0;
    this.time = 0;
    this.quality = 1;
    this.preset = QUALITY[1];
    this._camOffset = new THREE.Vector3();
    this._sunFocus = new THREE.Vector3();
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.55, 0.85);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const px = this.renderer.getPixelRatio();
    this.sparks.mat.uniforms.uPixel.value = px;
    this.smoke.mat.uniforms.uPixel.value = px;
    this.composer.setPixelRatio(px);
    this.composer.setSize(w, h);
  }

  setMood({ top, bot, glow, fogColor, fogDensity, sunColor, sunInt, hemiInt, star }) {
    if (top) this.skyMat.uniforms.uTop.value.set(top);
    if (bot) this.skyMat.uniforms.uBot.value.set(bot);
    if (glow) this.skyMat.uniforms.uGlow.value.set(glow);
    if (star != null) this.skyMat.uniforms.uStar.value = star;
    if (fogColor) this.fog.color.set(fogColor);
    if (fogDensity != null) this.fog.density = fogDensity;
    if (sunColor) this.sun.color.set(sunColor);
    if (sunInt != null) this.sun.intensity = sunInt;
    if (hemiInt != null) this.hemi.intensity = hemiInt;
  }

  setWorldCenter(x, z) {
    this.tree.position.set(x - 6, 40, z - 74);
    this.tree.lookAt(x, 30, z);
  }

  followTorch(x, y, z) { this._torchAt.set(x, y + 1.35, z); }

  followSun(px, py, pz) {
    // the shadow frustum is tight, so it has to ride with the player rather than
    // sit at the room centre
    this._sunFocus.set(px, 0, pz);
    this.sun.target.position.copy(this._sunFocus);
    this.sun.position.set(px + 18, 34, pz + 14);
    this.sky.position.set(px, 0, pz);
  }

  setLamps(list) {
    const budget = Math.min(this.preset.lamps, this.lampPool.length);
    for (let i = 0; i < this.lampPool.length; i++) {
      const l = this.lampPool[i];
      const s = i < budget ? list[i] : null;
      if (s) {
        l.position.set(s.x, s.y, s.z);
        l.color.set(s.color || '#ffab52');
        l.intensity = s.intensity ?? 16;
        l.distance = s.distance ?? 13;
      } else l.intensity = 0;
    }
    this._lampFlicker = list;
  }

  shake(amp = 1, dur = 0.24) {
    if (prefersReducedMotion()) return;   // 晃镜头是前庭敏感者的雷区，这里整条关掉
    this.shakeAmp = Math.max(this.shakeAmp, Math.min(amp, 3.2));
    this.shakeT = Math.max(this.shakeT, dur);
  }

  burst(x, y, z, o = {}) {
    let n = Math.round((o.count ?? 12) * this.quality);
    // 保留一颗火花：命中还得看得见，满屏粒子不行。
    if (prefersReducedMotion()) n = Math.min(n, 1);
    const color = o.color instanceof THREE.Color ? o.color : new THREE.Color(o.color ?? '#ffca6a');
    for (let i = 0; i < n; i++) {
      this.sparks.emit(x + (Math.random() - 0.5) * (o.jitter ?? 0.2), y + (Math.random() - 0.5) * (o.jitter ?? 0.2), z + (Math.random() - 0.5) * (o.jitter ?? 0.2), {
        color, size: o.size ?? 0.5, alpha: o.alpha ?? 1, life: o.life ?? 0.5, speed: o.speed ?? 5,
        up: o.up ?? 1.6, gravity: o.gravity ?? -14, drag: o.drag ?? 2.4, grow: o.grow ?? 0, spread: o.spread ?? 1, dir: o.dir,
      });
    }
  }

  puff(x, y, z, o = {}) {
    const n = Math.round((o.count ?? 6) * this.quality);
    const color = o.color instanceof THREE.Color ? o.color : new THREE.Color(o.color ?? '#6d6a74');
    for (let i = 0; i < n; i++) {
      this.smoke.emit(x, y, z, {
        color, size: o.size ?? 2.2, alpha: o.alpha ?? 0.35, life: o.life ?? 1.1, speed: o.speed ?? 1.1,
        up: o.up ?? 0.9, gravity: o.gravity ?? 0.4, drag: o.drag ?? 1.1, grow: o.grow ?? 1.6,
      });
    }
  }

  runeStream(x, y, z, target, count = 22, color = '#ffd071') {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, r = 0.4 + Math.random() * 1.5;
      this.sparks.emit(x + Math.cos(a) * r, y + Math.random() * 1.4, z + Math.sin(a) * r, {
        color: c, size: 0.42 + Math.random() * 0.3, life: 0.8 + Math.random() * 0.6, speed: 0.6,
        up: 2.4, gravity: 0.6, drag: 0.7,
        dir: { x: (target.x - x) * 1.5, y: (target.y - y) * 1.5, z: (target.z - z) * 1.5 },
      });
    }
  }

  update(dt, camPos) {
    this.time += dt;
    this.sparks.update(dt);
    this.smoke.update(dt);
    this.motes -= dt;
    if (this.motes <= 0 && camPos) {
      this.motes = 0.09;
      const c = new THREE.Color('#8e9a70');
      for (let i = 0; i < 2; i++) {
        this.smoke.emit(camPos.x + (Math.random() - 0.5) * 26, 0.3 + Math.random() * 4, camPos.z + (Math.random() - 0.5) * 26, {
          color: c, size: 0.5, alpha: 0.5, life: 3.4, speed: 0.25, up: 0.14, gravity: 0.02, drag: 0.2,
        });
      }
    }
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const k = clamp(this.shakeT / 0.24, 0, 1);
      const a = this.shakeAmp * k * k * 0.16;
      this._camOffset.set((Math.random() - 0.5) * a, (Math.random() - 0.5) * a, (Math.random() - 0.5) * a);
    } else { this.shakeAmp = 0; this._camOffset.multiplyScalar(damp(1, 0, 18, dt)); }
    for (let i = 0; i < this.lampPool.length; i++) {
      const l = this.lampPool[i];
      if (!l.visible) continue;
      const src = this._lampFlicker?.[i];
      if (!src) { if (l.intensity !== 0) l.intensity = 0; continue; }
      const f = 0.82 + 0.18 * Math.sin(this.time * (7 + i * 1.7) + i) + 0.08 * Math.sin(this.time * 23.5 + i * 3.3);
      l.intensity = (src?.intensity ?? 16) * f * (src?.fade ?? 1);
    }
    const tf = 0.85 + 0.11 * Math.sin(this.time * 8.7) + 0.07 * Math.sin(this.time * 21.3);
    this.torch.intensity = this._torchInt * tf;
    this.torch.position.copy(this._torchAt);
  }

  render() {
    this.camera.position.add(this._camOffset);
    this.grade.uniforms.uTime.value = this.time;
    this.composer.render();
    this.camera.position.sub(this._camOffset);
  }

  setQuality(level) {
    const p = QUALITY[level] || QUALITY[1];
    this.preset = p;
    this.qualityLevel = level;
    this.quality = p.particles;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, p.pixel));
    this.renderer.shadowMap.enabled = p.shadow > 0;
    this.sun.castShadow = p.shadow > 0;
    if (p.shadow > 0 && this.sun.shadow.mapSize.x !== p.shadow) {
      this.sun.shadow.mapSize.set(p.shadow, p.shadow);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    const sc = this.sun.shadow.camera;
    const span = p.shadowSpan;
    sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span;
    sc.near = 1; sc.far = 120;
    sc.updateProjectionMatrix();
    this.bloom.enabled = p.bloom > 0;
    this.bloom.strength = p.bloom;
    this.grade.uniforms.uGrain.value = p.grade * 0.055;
    this.grade.uniforms.uVig.value = 0.42 + p.grade * 0.3;
    this.grade.uniforms.uSat.value = 1 + p.grade * 0.07;
    this.grade.uniforms.uTone.value = p.grade;
    this._torchInt = p.torch;
    this.resize();
  }

  clearParticles() { this.sparks.clear(); this.smoke.clear(); }
}

export { THREE, ParticlePool };
