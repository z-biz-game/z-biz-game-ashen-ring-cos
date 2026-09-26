import * as THREE from 'three';
import { clamp, damp, angleDamp } from './rng.js';

const CHEST = 1.32;

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.yaw = Math.PI;
    this.pitch = -0.22;
    this.dist = 5.2;
    this.wantDist = 5.2;
    this.focus = new THREE.Vector3();
    this.pos = new THREE.Vector3(0, 5, 10);
    this.lockBlend = 0;
    this.fovPunch = 0;
    this.forward = new THREE.Vector2(0, -1);
    this.right = new THREE.Vector2(1, 0);
  }

  orbit(dt, dx, dy, invert = false) {
    this.yaw -= dx;
    const p = (invert ? -dy : dy);
    this.pitch = clamp(this.pitch - p, -1.05, 0.78);
  }

  zoom(delta) { if (delta) this.wantDist = clamp(this.wantDist + delta * 0.65, 2.6, 9.5); }

  punch(amount = 0.35) { this.fovPunch = Math.min(1.4, this.fovPunch + amount); }

  update(dt, actor, grid, target) {
    const fx = actor.pos.x, fz = actor.pos.z, fy = actor.pos.y + CHEST;
    let yaw = this.yaw;
    this.lockBlend = damp(this.lockBlend, target ? 1 : 0, 7, dt);

    if (target && this.lockBlend > 0.02) {
      const toPlayer = Math.atan2(fx - target.pos.x, fz - target.pos.z);
      yaw = angleDamp(yaw, toPlayer, 9, dt);
      if (Math.abs(((yaw - toPlayer + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.22) this.yaw = yaw;
    }
    this.yaw = yaw;

    const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
    this.forward.set(-sinY, -cosY);
    this.right.set(cosY, -sinY);

    const shoulder = 0.42 * (1 - this.lockBlend * 0.55);
    const tx = fx + this.right.x * shoulder, tz = fz + this.right.y * shoulder;
    let gx = tx, gy = fy, gz = tz;
    if (target) {
      const k = this.lockBlend * 0.5;
      gx = fx + (target.pos.x - fx) * k * 0.6 + this.right.x * shoulder;
      gz = fz + (target.pos.z - fz) * k * 0.6 + this.right.y * shoulder;
      gy = damp(fy, target.pos.y + CHEST * 0.9, 5, dt) * 0.35 + fy * 0.65;
    }
    this.focus.set(damp(this.focus.x, gx, 12, dt), damp(this.focus.y, gy, 10, dt), damp(this.focus.z, gz, 12, dt));

    const sprint = actor.sprinting ? 0.9 : 0;
    const aiming = clamp(actor.speedNorm || 0, 0, 1);
    const want = this.wantDist + sprint + aiming * 0.35 + this.lockBlend * 0.25 + (actor.height - 1.7) * 0.6;
    let allow = want;
    if (grid) allow = Math.min(allow, this._clearDistance(grid, this.focus, this.yaw, this.pitch, want));
    this.dist = damp(this.dist, Math.max(1.5, allow), 12, dt);

    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this.pos.set(
      this.focus.x + sinY * cp * this.dist,
      this.focus.y - sp * this.dist + 0.35,
      this.focus.z + cosY * cp * this.dist
    );
    if (grid) {
      const gh = grid.heightAtWorld(this.pos.x, this.pos.z) + 0.45;
      if (this.pos.y < gh) this.pos.y = damp(this.pos.y, gh, 16, dt);
    }
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.focus);
    this.fovPunch = damp(this.fovPunch, 0, 6, dt);
    const fov = 58 + this.fovPunch * 5 + (actor.sprinting ? 3.5 : 0) + (actor.fastTime ? 6 : 0);
    if (Math.abs(this.camera.fov - fov) > 0.02) { this.camera.fov = damp(this.camera.fov, fov, 9, dt); this.camera.updateProjectionMatrix(); }
    return this;
  }

  _clearDistance(grid, from, yaw, pitch, want) {
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const dx = Math.sin(yaw) * cp, dy = -sp, dz = Math.cos(yaw) * cp;
    const step = 0.22;
    for (let d = 0.6; d < want; d += step) {
      if (grid.solidAtWorld(from.x + dx * d, from.z + dz * d, from.y + dy * d + 0.2)) return Math.max(1.6, d - 0.35);
    }
    return want;
  }

  screenPos(vec3, camera) {
    const v = vec3.clone().project(camera);
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight, z: v.z };
  }
}
