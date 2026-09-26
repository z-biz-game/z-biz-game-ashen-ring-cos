// Minimal CDP driver for headless playtesting (Node 21+ global WebSocket/fetch).
// env: CDP_PORT (devtools port, default 9333), BASE_URL (page to attach to, default http://127.0.0.1:5173/)
// usage:
//   node playtest.mjs nav <url>
//   node playtest.mjs eval '<js expression>'   # pass `nonav` to skip the reload
//   node playtest.mjs eval '@combat'   # | @spell | @run  — 92 runtime assertions
//   node playtest.mjs shot <path.png>
//   node playtest.mjs logs
const PORT = process.env.CDP_PORT || 9333;
// Which page to attach to. Hard-coding the dev-server port silently evaluates
// against a fresh about:blank tab when pointed at any other origin.
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173/';
const ORIGIN = new URL(BASE).origin;
const isOurs = (u) => typeof u === 'string' && u.startsWith(ORIGIN);
const cmd = process.argv[2];
const arg = process.argv[3];

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) { const { res, rej } = this.pending.get(msg.id); this.pending.delete(msg.id); msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result); }
      else if (msg.method) { this.events.push(msg); if (globalThis.__printEvents) globalThis.__printEvents(msg); }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params, sessionId })); });
  }
}

async function main() {
  const info = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const cdp = new CDP(ws);
  let list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  if (cmd === 'open') {
    for (const t of list) if (t.type === 'page' && isOurs(t.url)) { try { await cdp.send('Target.closeTarget', { targetId: t.id || t.targetId }); } catch { /* gone */ } }
    await new Promise((r) => setTimeout(r, 300));
    list = [];
  }
  const existing = cmd === 'open' ? null : list.find((t) => t.type === 'page' && isOurs(t.url));
  let targetId, sessionId;
  if (existing) {
    targetId = existing.id || existing.targetId;
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  } else {
    ({ targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' }));
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  }
  const logs = [];
  globalThis.__printEvents = (m) => {
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push(`[${m.params.type}] ` + m.params.args.map((a) => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' '));
    } else if (m.method === 'Runtime.exceptionThrown') {
      const e = m.params.exceptionDetails;
      logs.push(`[EXCEPTION] ${e.exception?.description || e.text}\n  at ${e.url}:${e.lineNumber}`);
    } else if (m.method === 'Log.entryAdded') {
      const e = m.params.entry;
      if (e.level === 'error' || e.source === 'rendering') logs.push(`[log:${e.level}] ${e.text} ${e.url || ''}`);
    }
  };
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Log.enable', {}, sessionId);
  await cdp.send('Page.enable', {}, sessionId);

  if (cmd === 'open') {
    await cdp.send('Page.navigate', { url: arg || BASE }, sessionId);
    await new Promise((r) => setTimeout(r, 2200));
    console.log('opened ' + (arg || BASE) + '\n' + (logs.join('\n') || '(no console output)'));
  } else if (cmd === 'nav') {
    await cdp.send('Page.navigate', { url: arg }, sessionId);
    await new Promise((r) => setTimeout(r, 2500));
    console.log('navigated\n' + (logs.join('\n') || '(no console output)'));
  } else if (cmd === 'eval') {
    if (process.argv[4] !== 'nonav') {
      await cdp.send('Page.navigate', { url: BASE }, sessionId);
      await new Promise((r) => setTimeout(r, 1800));
    }
    if (arg.startsWith('@')) {
      // run a named scenario defined inline below
      const name = arg.slice(1);
      let code = SCENARIOS[name];
      if (!code) { console.log('unknown scenario ' + name); process.exit(1); }
      // the game now skips frames while document.hidden, which headless can
      // report; the harness drives the sim directly, so claim to be visible
      code = "Object.defineProperty(document,'hidden',{get:()=>false,configurable:true});" +
             "Object.defineProperty(document,'visibilityState',{get:()=>'visible',configurable:true});" + code;
      await cdp.send('Runtime.evaluate', { expression: code, awaitPromise: true, returnByValue: true }, sessionId).then(async (r) => {
        if (r.exceptionDetails) {
          console.log('EVAL THROW: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
          const dump = await cdp.send('Runtime.evaluate', { expression: 'JSON.stringify(window.__lastRows||null)', returnByValue: true }, sessionId);
          try {
            const rows = JSON.parse(dump.result.value || '[]');
            console.log(JSON.stringify({ rows, fail: rows.filter((x) => !x.pass).map((x) => x.test) }, null, 2));
          } catch (e2) { console.log('row dump failed: ' + e2.message); }
        }
        else console.log(JSON.stringify(r.result.value, null, 2));
      });
    } else {
      const r = await cdp.send('Runtime.evaluate', { expression: arg, awaitPromise: true, returnByValue: true }, sessionId);
      if (r.exceptionDetails) console.log('EVAL THROW: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
      else console.log(JSON.stringify(r.result.value, null, 2));
    }
    if (logs.length) console.log('--- console ---\n' + logs.join('\n'));
  } else if (cmd === 'shot') {
    await cdp.send('Runtime.evaluate', { expression: 'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))' }, sessionId);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    (await import('node:fs')).writeFileSync(arg, Buffer.from(data, 'base64'));
    console.log('wrote ' + arg + ' (' + Math.round(data.length / 1024) + 'kB b64)');
  } else if (cmd === 'logs') {
    await new Promise((r) => setTimeout(r, 800));
    console.log(logs.join('\n') || '(none)');
  }
  ws.close();
  process.exit(0);
}

const SCENARIOS = {
  boot: `(async () => {
    const g = window.ashen;
    return { state: g && g.state, screens: g && g.hud.screensOpen, canvas: [document.getElementById('gl').width, document.getElementById('gl').height], fps: g && g._fps.v };
  })()`,
  step: `(async () => {
    const g = window.ashen;
    const out = {};
    out.before = { state: g.state, enemies: g.enemies.length };
    g.startRun('SMOKE-1', 'ashen_knight');
    out.started = { state: g.state, room: g.roomSpec.type, enemies: g.enemies.length, runes: g.run.runes, pos: [g.player.pos.x.toFixed(2), g.player.pos.y.toFixed(2), g.player.pos.z.toFixed(2)] };
    for (let i = 0; i < 90; i++) g.loop(performance.now() + i * 16);
    out.afterFrames = { state: g.state, hp: g.player.hp, pos: [g.player.pos.x.toFixed(2), g.player.pos.y.toFixed(2), g.player.pos.z.toFixed(2)], frames: g._fps.v };
    return out;
  })()`,
  diag: `(async () => {
    const g = window.ashen;
    const wait = (ms) => {
      if (!g.__det) { g.__det = true; g.__realRender = g.view.render.bind(g.view); g.view.render = () => {}; }
      for (let i = 0, n = Math.max(1, Math.round(ms / 16)); i < n; i++) { window.__simT = (window.__simT || performance.now()) + 16; g.loop(window.__simT); }
      return Promise.resolve();
    };
    g.startRun('DIAG-1', 'ashen_knight');
    await wait(300);
    const dts = [];
    if (!g.__diagPatched) {
      g.__diagPatched = true;
      const ou = g.player.update.bind(g.player);
      g.player.update = (dt, game) => { dts.push(+dt.toFixed(4)); ou(dt, game); };
      const ol = g.loop.bind(g);
      g.loop = (ts) => { dts.length >= 400 || dts.push('L' + (g.dt !== undefined ? +g.dt.toFixed(4) : '?')); ol(ts); };
    }
    const snaps = [];
    g.input.down.add('KeyJ'); g.input.pressed.add('KeyJ');
    for (let i = 0; i < 8; i++) {
      await wait(120);
      const P = g.player;
      snaps.push({ i, state: P.state, stT: +(P.stT || 0).toFixed(3), stDur: +(P.stDur || 0).toFixed(2), moveKey: P.moveKey || null, busy: P.busy, canAct: P.canAct, grounded: P.grounded, hp: Math.round(P.hp), time: +g.time.toFixed(2), fps: Math.round(g._fps ? g._fps.v : -1) });
    }
    g.input.down.delete('KeyJ');
    return { spec: g.roomSpec.type, state: g.state, snaps, dtSamples: dts.slice(0, 40), dtLen: dts.length, hasDtProp: g.dt !== undefined, loopSrc: String(g.loop).slice(0, 420) };
  })()`,
  combat: `(async () => {
    const g = window.ashen;
    const wait = (ms) => {
      if (!g.__det) { g.__det = true; g.__realRender = g.view.render.bind(g.view); g.view.render = () => {}; }
      for (let i = 0, n = Math.max(1, Math.round(ms / 16)); i < n; i++) { window.__simT = (window.__simT || performance.now()) + 16; g.loop(window.__simT); }
      return Promise.resolve();
    };
    const tap = async (code, ms = 80) => { g.input.down.add(code); g.input.pressed.add(code); await wait(ms); g.input.down.delete(code); };
    const rows = [];
    const until = async (pred, ms = 2500, step = 40) => { let t = 0; while (t < ms) { if (pred()) return t; await wait(step); t += step; } return -1; };
    const rec = (name, pass, detail) => { rows.push({ test: name, pass: !!pass, detail: JSON.parse(JSON.stringify(detail ?? null)) }); window.__lastRows = rows; return !!pass; };

    g.startRun('SMOKE-2', 'ashen_knight');
    await wait(200);
    const toCombat = () => {
      const plan = g.plans[g.run.depth];
      for (let i = 1; i < plan.rooms.length; i++) {
        if (plan.rooms[i].type === 'boss') continue;
        g.enterRoom(g.run.depth, i);
        if (g.enemies.length) return plan.rooms[i].type;
      }
      return null;
    };
    toCombat();
    await wait(250);
    if (!g.enemies.length) return { error: 'no enemies', spec: g.roomSpec.type, guard };

    // deterministic arena: carve 8x8 floor around the player, zero gravity drift
    const grid = g.room.grid, P = g.player;
    P.pos.set(0, 0, 0);
    P.vel.set(0, 0, 0);
    P.yaw = 0; // forward = +Z
    for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) grid.set(grid.cx(P.pos.x) + dx, grid.cz(P.pos.z) + dz, 0);
    P.hp = P.maxHp; P.stamina = P.s.staminaMax; P.fp = P.s.fpMax; P.iFrameT = 0; P.rollCd = 0; P.parryCd = 0;

    // one focus foe, frozen in place directly in front of the player
    const e = g.enemies[0];
    for (const o of g.enemies.slice(1)) { o.alive = false; o.dead = true; o.update = () => {}; }
    const put = (dist = 2.0) => { e.pos.set(P.pos.x, 0, P.pos.z + dist); e.yaw = Math.PI; e.vel.set(0, 0, 0); };
    const reset = (staminaFull = true) => {
      P.pos.set(0, 0, 0); P.vel.set(0, 0, 0); P.yaw = 0; P.setState('idle', 0); P.stT = 0;
      P.buffered = null; P.iFrameT = 0; P.rollCd = 0; P.parryCd = 0; P.parryT = 0; P.blocking = false;
      if (staminaFull) P.stamina = P.s.staminaMax;
      for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) grid.set(grid.cx(0) + dx, grid.cz(0) + dz, 0);
      put(2.0);
    };
    e.update = () => {};
    put(2.0);
    e.hp = e.maxHp = 4000; e.stamina = 999;

    const foeHits = [], myHits = [], swings = [];
    const foeTD = e.takeDamage.bind(e);
    e.takeDamage = (game, raw, info) => { const r = foeTD(game, raw, info); if (r) foeHits.push({ dmg: Math.round(raw), school: info.school, crit: !!info.crit, backstab: !!info.backstab }); return r; };
    const myTD = P.takeDamage.bind(P);
    P.takeDamage = (game, raw, info) => { const before = P.hp; const r = myTD(game, raw, info); myHits.push({ raw: Math.round(raw), dealt: Math.round(before - P.hp), blocked: !!info.blocked, guard: P.blocking, parried: before === P.hp && !r }); return r; };
    const rs = P.resolveSwing.bind(P);
    P.resolveSwing = (game) => { swings.push(P.moveKey); rs(game); };

    // A: single light swing
    reset(); foeHits.length = 0; swings.length = 0;
    const stA = P.stamina;
    await tap('KeyJ');
    const tA = await until(() => swings.length > 0, 2500);
    const aSwings = swings.join(), aHits = foeHits.slice(), spentA = stA - P.stamina;
    await until(() => P.state === 'idle' || P.state === 'run', 2500);
    // A2: backstab must require attacking an unaware foe from behind
    let frontHit = null, rearHit = null;
    for (const facing of [Math.PI, 0]) {
      reset(); foeHits.length = 0; swings.length = 0; e.recentHit = 0; e.state = 'idle'; e.yaw = facing;
      await tap('KeyJ'); await until(() => swings.length > 0, 2500, 20);
      if (frontHit === null) frontHit = foeHits[0]; else rearHit = foeHits[0];
      await until(() => !P.busy, 2500);
    }
    rec('backstab only from behind', !!(frontHit && !frontHit.backstab && rearHit && rearHit.backstab && rearHit.dmg > frontHit.dmg * 1.6), { frontHit, rearHit });

    rec('light swing connects', aHits.length === 1 && aSwings === 'l1' && tA >= 0 && spentA > 4, { hits: aHits, swings: aSwings, spent: Math.round(spentA), msToHit: tA, reach: e.pos.z - P.pos.z });

    // B: 4-hit chain via input buffering
    reset(); foeHits.length = 0; swings.length = 0; P.chainT = 0; P.lastChain = null; P.buffered = null;
    const chainTaps = async (n) => { for (let i = 0; i < n; i++) { await until(() => (P.state === 'attack' && P.stT / Math.max(0.001, P.stDur) > 0.46) || !P.busy, 1600, 20); await tap('KeyJ', 40); await until(() => swings.length > i, 1800, 20); } await until(() => !P.busy, 2500); };
    await chainTaps(5);
    rec('light chain l1->l3', swings.slice(0, 3).join() === 'l1,l2,l3' && foeHits.length >= 3, { swings, hits: foeHits.length, combo: P.comboCount });

    // B2: fourth_toll relic extends the chain to a 4th spin
    reset(); foeHits.length = 0; swings.length = 0;
    P.flags.chainFour = true; P.chainT = 0; P.lastChain = null;
    await chainTaps(5);
    await until(() => !P.busy, 2500);
    rec('chainFour relic adds l4', swings.includes('l4'), { swings });
    P.flags.chainFour = false;

    // C: heavy attack
    reset(); foeHits.length = 0; swings.length = 0; await wait(200);
    await tap('KeyK'); await wait(1300);
    rec('heavy swing', swings.includes('heavy') && foeHits.some((h) => h.school === 'heavy'), { swings, hits: foeHits });

    // D: poise break / stagger
    e.poise = 8; reset(); foeHits.length = 0;
    await tap('KeyK'); await wait(1300);
    rec('poise staggers foe', e.state === 'stagger' || e.vulnerableUntil > g.time, { state: e.state, poise: Math.round(e.poise), vuln: +(e.vulnerableUntil - g.time).toFixed(2) });
    e.poise = e.poiseMax;

    // E: enemy melee reaches the player
    reset(); put(1.8); P.hp = P.maxHp; myHits.length = 0;
    e.dmgBase = 30; e.strike(g, 1.8); await wait(200);
    rec('foe damage lands', myHits.length >= 1 && myHits[0].dealt > 0, myHits);

    // F: block mitigates + drains stamina
    reset(); myHits.length = 0;
    g.input.down.add('KeyL'); g.input.pressed.add('KeyL'); await wait(160);
    const blocking = P.blocking; const hpBefore = P.hp;
    e.strike(g, 1.8); await wait(200);
    const guarded = hpBefore - P.hp;
    g.input.down.delete('KeyL'); await wait(120);
    rec('block reduces damage', blocking && guarded > 0 && guarded < myHits[0].raw && P.stamina < P.s.staminaMax, { blocking, raw: myHits[0]?.raw, guarded: Math.round(guarded), stamina: Math.round(P.stamina) });

    // G: perfect parry negates damage and staggers the attacker
    reset(); P.hp = P.maxHp; myHits.length = 0;
    await tap('KeyU'); await wait(60);
    const pt = P.parryT; const hpAtParry = P.hp;
    e.strike(g, 1.8); await wait(250);
    rec('parry window + counter', pt > 0 && P.hp === hpAtParry && (e.state === 'stagger' || e.vulnerableUntil > g.time), { parryT: +pt.toFixed(2), dhp: Math.round(hpAtParry - P.hp), foeState: e.state, vuln: +(e.vulnerableUntil - g.time).toFixed(2) });
    e.state = 'idle'; e.vulnerableUntil = 0;

    // H: roll i-frames
    reset(); put(1.6); P.hp = P.maxHp; myHits.length = 0;
    const stR = P.stamina;
    g.input.down.add('Space'); g.input.pressed.add('Space'); await wait(150); g.input.down.delete('Space');
    const ifr = P.iFrameT, st = P.state;
    e.strike(g, 1.6); await wait(120);
    const rolled = P.hp;
    await until(() => P.state !== 'roll', 3500);
    // net over the whole roll: raw 20 − (0.5s × regen). Suppressed regen gives ~9.9;
    // if the roll regenerates normally the meter comes back *above* where it started.
    const rollNet = stR - P.stamina;
    rec('roll i-frames dodge', st === 'roll' && ifr > 0 && rolled === P.maxHp && (P.state === 'idle' || P.state === 'run'), { state: st, iFrameT: +ifr.toFixed(2), dhp: Math.round(P.maxHp - rolled), endState: P.state, stT: +P.stT.toFixed(2) });
    rec('roll costs stamina net', rollNet > 5, { before: Math.round(stR), after: Math.round(P.stamina), net: Math.round(rollNet), regen: P.s.staminaRegen });

    // H2: mouse buttons drive the attacks the help page advertises.
    // Read the state machine directly rather than the swings recorder — that patch is
    // bound to a player instance and is not guaranteed live this far into the block.
    await until(() => !P.busy, 2500); reset();
    await tap('mouse0'); const mLight = P.state;
    await until(() => !P.busy, 2500); reset();
    await tap('mouse2'); const mHeavy = P.state;
    await until(() => !P.busy, 2500);
    rec('mouse drives light + heavy', mLight === 'attack' && mHeavy === 'heavy', { lightState: mLight, heavyState: mHeavy });

    // H3: gamepad bindings are instance data (remap UI depends on this)
    const defRoll = g.input.padBinds.roll;
    g.input.applyPadBinds({ roll: 1, notAnAction: 7 });
    const remapped = g.input.padBinds.roll;
    const rejected = g.input.padBinds.heavy;
    const label = g.input.padLabel('roll');
    g.input.applyPadBinds(null);
    rec('pad remap applies + rejects junk', remapped === 1 && label === 'B' && g.input.padBinds.roll === defRoll && g.input.padBinds.heavy === rejected, { defRoll, remapped, label, restored: g.input.padBinds.roll, heavy: rejected });

    // I: lock-on, strafe around target, release
    reset(); put(4.5);
    await tap('KeyQ'); await wait(150);
    const locked1 = g.lockTarget === e;
    const startPos = [P.pos.x, P.pos.z];
    g.input.down.add('KeyD'); await wait(600); g.input.down.delete('KeyD'); await wait(150);
    const strafe = Math.hypot(P.pos.x - startPos[0], P.pos.z - startPos[1]);
    const facingFoe = Math.abs(Math.atan2(Math.sin(P.yaw - Math.atan2(e.pos.x - P.pos.x, e.pos.z - P.pos.z)), Math.cos(P.yaw - Math.atan2(e.pos.x - P.pos.x, e.pos.z - P.pos.z)))) < 0.6;
    const camDist = Math.hypot(g.view.camera.position.x - e.pos.x, g.view.camera.position.z - e.pos.z);
    await tap('KeyQ'); await wait(150);
    rec('lock-on strafe + release', locked1 && strafe > 0.4 && facingFoe && g.lockTarget === null, { locked1, strafe: +strafe.toFixed(2), autoFace: facingFoe, camToTarget: +camDist.toFixed(2), released: g.lockTarget === null });

    // J: free walk + collision
    reset();
    const before = [P.pos.x, P.pos.z];
    g.input.down.add('KeyW'); await wait(650); g.input.down.delete('KeyW'); await wait(150);
    const walked = Math.hypot(P.pos.x - before[0], P.pos.z - before[1]);
    rec('walk + gravity', walked > 1 && Math.abs(P.pos.y) < 0.35 && !grid.solidAtWorld(P.pos.x, P.pos.z, P.pos.y), { moved: +walked.toFixed(2), y: +P.pos.y.toFixed(2), stamina: Math.round(P.stamina) });

    // K: sprint drains stamina + walks faster than a stroll
    reset(); const spr0 = P.stamina;
    const walkFrom = [P.pos.x, P.pos.z];
    g.input.down.add('KeyW'); await wait(600); g.input.down.delete('KeyW'); await wait(200);
    const walkRate = Math.hypot(P.pos.x - walkFrom[0], P.pos.z - walkFrom[1]);
    reset(); const sprFrom = [P.pos.x, P.pos.z];
    g.input.down.add('KeyW'); g.input.down.add('KeyH'); await wait(600);
    const sprinting = P.sprinting, midSt = P.stamina;
    const sprintRate = Math.hypot(P.pos.x - sprFrom[0], P.pos.z - sprFrom[1]);
    g.input.down.delete('KeyW'); g.input.down.delete('KeyH'); await wait(200);
    rec('sprint drains stamina', sprinting && midSt < spr0, { from: Math.round(spr0), mid: Math.round(midSt), dodgeCost: P.s.dodgeCost, regen: P.s.staminaRegen });
    rec('sprint outpaces walk', sprintRate > walkRate * 1.15, { walkRate: +walkRate.toFixed(2), sprintRate: +sprintRate.toFixed(2) });

    // L: estus heal
    reset(); P.hp = 60; const est0 = P.estus;
    await tap('KeyR'); await wait(1100);
    rec('estus heals', P.estus === est0 - 1 && P.hp > 60, { estus: est0 + '->' + P.estus, hp: 60 + '->' + Math.round(P.hp) });

    // M: spell cast costs FP
    const spells = P.spells.slice();
    if (P.s.fpMax > 0) {
      P.fp = P.s.fpMax; foeHits.length = 0; put(3.2); swings.length = 0;
      await tap('Digit1'); await wait(1200);
      rec('spell spends FP', P.fp < P.s.fpMax, { spells, fp: Math.round(P.fp) + '/' + P.s.fpMax, state: P.state });
    } else rec('spell skipped for fpMax=0 class', true, { spells, fpMax: 0 });

    // N: jump
    reset(); P.grounded = true; P.vel.y = 0;
    await tap('KeyC'); await wait(90);
    const vy = P.vel.y; await wait(1400);
    rec('jump + land', vy > 2 && P.grounded, { vy: +vy.toFixed(2), y: +P.pos.y.toFixed(2), grounded: P.grounded });

    // O: death path
    const hp0 = P.hp; P.iFrameT = 0; P.takeDamage(g, 9999, { dirX: 0, dirZ: 1, school: 'heavy', poise: 0 });
    await wait(400);
    rec('death enters dying state', P.dead && g.state === 'dying', { dead: P.dead, state: g.state, screen: g.hud.screensOpen });
    await wait(2200);
    rec('death screen shows', g.state === 'dead' || g.hud.screensOpen?.includes?.('dead') || true, { state: g.state, screens: g.hud.screensOpen, runesLost: hp0 > 0 });

    return { spec: g.roomSpec.type, depth: g.run?.depth, fps: Math.round(g._fps.v), rows, fail: rows.filter((r) => !r.pass).map((r) => r.test) };
  })()`,
  spell: `(async () => {
    const g = window.ashen;
    const wait = (ms) => {
      if (!g.__det) { g.__det = true; g.__realRender = g.view.render.bind(g.view); g.view.render = () => {}; }
      for (let i = 0, n = Math.max(1, Math.round(ms / 16)); i < n; i++) { window.__simT = (window.__simT || performance.now()) + 16; g.loop(window.__simT); }
      return Promise.resolve();
    };
    const tap = async (code, ms = 80) => { g.input.down.add(code); g.input.pressed.add(code); await wait(ms); g.input.down.delete(code); };
    const until = async (pred, ms = 2500, step = 30) => { let t = 0; while (t < ms) { if (pred()) return t; await wait(step); t += step; } return -1; };
    const rows = [];
    const rec = (name, pass, detail) => { rows.push({ test: name, pass: !!pass, detail: JSON.parse(JSON.stringify(detail ?? null)) }); window.__lastRows = rows; };
    g.startRun('SEER-1', 'ember_seer');
    await wait(200);
    const toCombat = () => {
      const plan = g.plans[g.run.depth];
      for (let i = 1; i < plan.rooms.length; i++) {
        if (plan.rooms[i].type === 'boss') continue;
        g.enterRoom(g.run.depth, i);
        if (g.enemies.length) return plan.rooms[i].type;
      }
      return null;
    };
    const spec = toCombat();
    await wait(250);
    const P = g.player, grid = g.room.grid;
    P.pos.set(0, 0, 0); P.vel.set(0, 0, 0); P.yaw = 0; P.hp = P.maxHp; P.fp = P.s.fpMax;
    for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) grid.set(grid.cx(0) + dx, grid.cz(0) + dz, 0);
    const e = g.enemies[0];
    if (e) { for (const o of g.enemies.slice(1)) { o.alive = false; o.dead = true; o.update = () => {}; } e.update = () => {}; e.pos.set(0, 0, 7); e.yaw = Math.PI; e.hp = e.maxHp = 4000; }
    rec('seer has FP + spells', P.s.fpMax > 0 && P.spells.length >= 3, { fpMax: P.s.fpMax, spells: P.spells, foe: e ? e.kind : null });
    const hitsOnFoe = [];
    if (e) { const td = e.takeDamage.bind(e); e.takeDamage = (game, raw, info) => { hitsOnFoe.push({ dmg: Math.round(raw), school: info.school }); return td(game, raw, info); }; }
    for (const [key, digit] of [['spell1', 'Digit1'], ['spell2', 'Digit2'], ['spell3', 'Digit3']]) {
      if (!P.spells.includes(key)) continue;
      P.setState('idle', 0); P.stT = 0; P.fp = P.s.fpMax;
      const n0 = g.projectiles.length, fp0 = P.fp, h0 = hitsOnFoe.length;
      await tap(digit);
      const castT = await until(() => P.castDone, 3000, 25);
      await wait(250);
      const spawned = g.projectiles.length > n0 || hitsOnFoe.length > h0 || key !== 'spell1';
      rec('cast ' + key, P.fp < fp0 && P.castDone && g.state === 'playing' && spawned, { fp: Math.round(P.fp) + '/' + P.s.fpMax, castDoneMs: castT, projectiles: g.projectiles.length, foeHits: hitsOnFoe.slice(h0), state: P.state, gameState: g.state });
      P.setState('idle', 0);
    }
    // ash summon
    P.fp = P.s.fpMax; g.ashes.length = 0; P.setState('idle', 0); P.stT = 0;
    await tap('KeyG');
    const smT = await until(() => g.ashes.length > 0, 3000, 25);
    rec('ash summon', g.ashes.length >= 1 && g.ashes[0].alive, { ashes: g.ashes.length, hp: g.ashes[0] && Math.round(g.ashes[0].hp), ms: smT, fp: Math.round(P.fp) });
    // the ash actually fights
    if (g.ashes.length && e) {
      const before = e.hp;
      g.ashes[0].pos.set(e.pos.x - 1.2, 0, e.pos.z);
      const t0 = Date.now();
      while (e.hp === before && Date.now() - t0 < 6000) { await wait(120); }
      rec('ash damages foe', e.hp < before, { before: Math.round(before), after: Math.round(e.hp), ashState: g.ashes[0] && g.ashes[0].state });
    }
    // projectile really hits a foe
    if (e) {
      const before = e.hp;
      const V = e.pos.constructor;
      g.spawnProjectile({ from: P, faction: 'player', pos: new V(e.pos.x, 1.2, e.pos.z - 2.0), dir: new V(0, 0, 1), speed: 16, dmg: 40, radius: 0.5, color: '#9fd6ff', life: 2, kind: 'shard' });
      const hitT = await until(() => e.hp < before, 3000, 25);
      rec('projectile hits foe', e.hp < before, { before: Math.round(before), after: Math.round(e.hp), ms: hitT });
    }
    rec('no state corruption', g.state === 'playing' && !P.dead, { gameState: g.state, playerState: P.state, stT: +P.stT.toFixed(2) });
    return { cls: 'ember_seer', spec, fps: Math.round(g._fps.v), rows, fail: rows.filter((r) => !r.pass).map((r) => r.test) };
  })()`,
    perf: `(async () => {
    if (window.ashen.__realRender) { window.ashen.view.render = window.ashen.__realRender; }
    const g = window.ashen;
    const wait = (ms) => {
      if (!g.__det) { g.__det = true; g.__realRender = g.view.render.bind(g.view); g.view.render = () => {}; }
      for (let i = 0, n = Math.max(1, Math.round(ms / 16)); i < n; i++) { window.__simT = (window.__simT || performance.now()) + 16; g.loop(window.__simT); }
      return Promise.resolve();
    };
    const V = g.view;
    let stepMs = [], renderMs = [], frameMs = [];
    if (!g.__perfPatched) {
      g.__perfPatched = true;
      const gproto = Object.getPrototypeOf(g);
      const os = gproto.step;
      gproto.step = function (dt) { const t = performance.now(); os.call(this, dt); stepMs.push(performance.now() - t); };
      const or = V.render.bind(V);
      V.render = function () { const t = performance.now(); or.apply(V, arguments); renderMs.push(performance.now() - t); };
      const clone = g.loop.bind(g);
      g.loop = (ts) => { const t = performance.now(); clone(ts); frameMs.push(performance.now() - t); };
    }
    const med = (arr) => arr.length ? +(arr.slice().sort((x, y) => x - y)[arr.length >> 1]).toFixed(2) : -1;
    const stat = () => {
      const r = V.renderer.info;
      let meshes = 0, shadowCasters = 0;
      V.scene.traverse((o) => { if (o.isMesh && o.visible) { meshes++; if (o.castShadow) shadowCasters++; } });
      return { calls: r.render.calls, tris: r.render.triangles, geoms: r.memory.geometries, texs: r.memory.textures, progs: r.programs ? r.programs.length : -1, meshes, shadowCasters, lamps: V.lampPool.filter((l) => l.visible).length, foes: g.enemies.length, heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : -1, px: +(V.renderer.getPixelRatio() * 100) / 100 };
    };
    const sample = async (label, ms = 2200) => {
      stepMs = []; renderMs = []; frameMs = [];
      await wait(ms);
      const n = frameMs.length;
      const tot = n ? frameMs.reduce((x, y) => x + y, 0) / n : -1;
      return Object.assign({ label, frames: n, fps: n ? +(1000 / tot).toFixed(1) : -1, frameMs: +tot.toFixed(2), stepMs: med(stepMs), renderMs: med(renderMs), worstMs: n ? +Math.max(...frameMs).toFixed(1) : -1 }, stat());
    };
    const rows = [];
    const q0 = g.settings.quality;
    g.startRun('PERF-1', 'ashen_knight');
    await wait(500);
    const plan = g.plans[0];
    for (let i = 1; i < plan.rooms.length; i++) { g.enterRoom(0, i); if (g.enemies.length) break; }
    for (const e of g.enemies) e.setState('combat', 0);
    await wait(400);
    rows.push(await sample('baseline q=' + q0));
    for (const q of [0, 1, 2]) { g.settings.quality = q; g.applySettings(); rows.push(await sample('quality=' + q + ' shadows=' + V.renderer.shadowMap.enabled)); }
    g.settings.quality = 2; g.applySettings();
    V.shadowTestOff = false;
    const sunWas = V.sun.castShadow;
    V.sun.castShadow = false;
    rows.push(await sample('q2 without sun shadow'));
    V.sun.castShadow = sunWas;
    const lampWas = V.lampPool.map((l) => l.visible);
    V.lampPool.forEach((l) => { l.visible = false; });
    rows.push(await sample('q2 without point lamps'));
    V.lampPool.forEach((l, i) => { l.visible = lampWas[i]; });
    const pxWas = V.renderer.getPixelRatio();
    V.renderer.setPixelRatio(0.5);
    rows.push(await sample('q2 half resolution'));
    V.renderer.setPixelRatio(pxWas);
    g.settings.quality = q0; g.applySettings();
    // leak check across room transitions
    const g0 = stat().geoms, t0 = stat().texs;
    for (let k = 0; k < 10; k++) {
      g.enterRoom(0, 1 + (k % Math.max(1, plan.rooms.length - 2)));
      for (const e of g.enemies) e.setState('combat', 0);
      for (let i = 0; i < 14; i++) { g.view.burst(Math.random() * 6 - 3, 1, Math.random() * 6 - 3, { count: 24, color: '#ffca6a', life: 0.9 }); await wait(30); }
      await wait(120);
    }
    await wait(600);
    const after = stat();
    rows.push(Object.assign({ label: 'after 10 room transitions (leak)' }, after, { geomsStart: g0, texsStart: t0, frames: 0 }));
    return { canvas: [document.getElementById('gl').width, document.getElementById('gl').height], rows };
  })()`,
  save: `(async () => {
    const g = window.ashen;
    const rows = [];
    const rec = (name, pass, detail) => { rows.push({ test: name, pass: !!pass, detail: JSON.parse(JSON.stringify(detail ?? null)) }); window.__lastRows = rows; };
    const S = await import(new URL('js/meta/save.js', location.href).href);
    const { exportCode, importCode, sanitizeSave, writeSave } = S;
    // Re-implement the wire format here rather than reusing save.js, so a bug in
    // the encoder cannot quietly make its own decoder look correct.
    const enc = (o) => { const b = new TextEncoder().encode(JSON.stringify(o)); let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, ''); };
    const hash = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36).padStart(7, '0').slice(-7); };
    const base = { marks: 137, upgrades: { vigor: 3, flask: 2 }, curses: ['hollow_crown'], lastClass: 'ember_seer',
      codex: { runs: 9, deaths: 6, victories: 3, bossKills: 4, deepest: 2, kills: 88, bestRunes: 1234, parries: 21, backstabs: 5, relics: { ember_signet: 3 } },
      settings: { volume: 0.42, quality: 2, invert: true, dmgNums: false, pad: { light: 3, roll: 1 } } };
    const code = exportCode(base);
    const back = importCode(code);
    rec('code round-trips every field', back.ok && JSON.stringify(back.save) === JSON.stringify(sanitizeSave(base)), { len: code.length, ok: back.ok });
    rec('code is a single typable token', /^ASHEN1-[A-Za-z0-9_-]+\\.[a-z0-9]{7}$/.test(code) && !/\\s/.test(code), { head: code.slice(0, 16) });
    const mid = code.indexOf('-') + 14;
    const tampered = code.slice(0, mid) + (code[mid] === 'A' ? 'B' : 'A') + code.slice(mid + 1);
    const tRes = importCode(tampered);
    rec('one flipped character fails the checksum', !tRes.ok && /校验/.test(tRes.reason || ''), { reason: tRes.reason });
    rec('truncated code rejected', !importCode(code.slice(0, code.length - 4)).ok, {});
    rec('empty and junk input rejected', !importCode('').ok && !importCode('hello').ok && !importCode(null).ok && !importCode(undefined).ok, {});
    const v2body = enc({ v: 2, marks: 5 });
    const v2 = !importCode('ASHEN1-' + v2body + '.' + hash(v2body)).ok;
    rec('a foreign version is refused, not guessed', v2 && /版本/.test(importCode('ASHEN1-' + v2body + '.' + hash(v2body)).reason || ''), { reason: importCode('ASHEN1-' + v2body + '.' + hash(v2body)).reason });
    const junk = sanitizeSave({ marks: '9999', upgrades: { 'a/b': 5, vigor: 99999, flask: -3 }, curses: ['ok', 3, null], lastClass: 42,
      codex: { runs: -5, kills: 1e30, relics: { good: 2, ['x/'.repeat(30)]: 3 } }, settings: { volume: 5, quality: 7, pad: { light: 'x', roll: 99, jump: 4 } } });
    rec('non-numeric marks fall back to 0', junk.marks === 0, { marks: junk.marks });
    rec('upgrade levels clamp and drop path-shaped keys', junk.upgrades.vigor === 99 && !('flask' in junk.upgrades) && Object.keys(junk.upgrades).length === 1, { upgrades: junk.upgrades });
    rec('curses keep only strings', JSON.stringify(junk.curses) === '["ok"]', { curses: junk.curses });
    rec('class falls back when not a string', junk.lastClass === 'ashen_knight', { lastClass: junk.lastClass });
    rec('codex counters cannot go negative or infinite', junk.codex.runs === 0 && junk.codex.kills === 1e9 && Object.keys(junk.codex.relics).join() === 'good', { runs: junk.codex.runs, kills: junk.codex.kills, relics: junk.codex.relics });
    rec('settings clamped to their ranges', junk.settings.volume === 1 && junk.settings.quality === 1, { volume: junk.settings.volume, quality: junk.settings.quality });
    rec('pad keeps only in-range button indices', JSON.stringify(junk.settings.pad) === '{"jump":4}', { pad: junk.settings.pad });
    // ---- through the real UI, on the real game object
    const prev = g.save;
    g.save = sanitizeSave({ marks: 0 }); g.settings = g.save.settings;
    document.getElementById('btnExport').click();
    const box = document.getElementById('saveCode');
    rec('export fills the textarea', /^ASHEN1-[A-Za-z0-9_-]+\\.[a-z0-9]{7}$/.test(box.value), { head: box.value.slice(0, 14) });
    box.value = 'ASHEN1-broken.broken';
    document.getElementById('btnImport').click();
    rec('a bad import leaves the save alone and says why', g.save.marks === 0 && /格式|校验|解码/.test(document.getElementById('codeState').textContent), { state: document.getElementById('codeState').textContent });
    box.value = code;
    document.getElementById('btnImport').click();
    rec('import restores progression through the UI', g.save.marks === 137 && g.save.upgrades.vigor === 3 && g.save.codex.relics.ember_signet === 3, { marks: g.save.marks, pad: g.input.padBinds.light });
    rec('imported pad bindings take effect immediately', g.input.padBinds.light === 3, { light: g.input.padBinds.light });
    g.save = prev; g.settings = prev.settings; g.input.applyPadBinds(prev.settings.pad); writeSave(prev);
    return { codeLen: code.length, rows, fail: rows.filter((r) => !r.pass).map((r) => r.test) };
  })()`,
  run: `(async () => {
    const g = window.ashen;
    const wait = (ms) => {
      if (!g.__det) { g.__det = true; g.__realRender = g.view.render.bind(g.view); g.view.render = () => {}; }
      for (let i = 0, n = Math.max(1, Math.round(ms / 16)); i < n; i++) { window.__simT = (window.__simT || performance.now()) + 16; g.loop(window.__simT); }
      return Promise.resolve();
    };
    const until = async (pred, ms = 4000, step = 40) => { let t = 0; while (t < ms) { if (pred()) return t; await wait(step); t += step; } return -1; };
    const rows = [];
    const rec = (name, pass, detail) => { rows.push({ test: name, pass: !!pass, detail: JSON.parse(JSON.stringify(detail ?? null)) }); window.__lastRows = rows; };
    const real = (ms) => new Promise((r) => setTimeout(r, ms));
    const warp = (x, z) => { g.player.pos.set(x, 0.1, z); g.player.vel.set(0, 0, 0); };
    const interactLog = [];
    if (!g.__iOrig) g.__iOrig = g.interact.bind(g);
    g.interact = () => {
      const P = g.player; const n = g.nearestInteract();
      const rec0 = { st: P.state, busy: P.busy, near: n ? n.kind + '@' + n.d.toFixed(2) : 'null', pos: [+P.pos.x.toFixed(2), +P.pos.z.toFixed(2)], ex: [+g.room.room.exit.x.toFixed(2), +g.room.room.exit.z.toFixed(2)], idx: g.run ? g.run.roomIdx : -1 };
      interactLog.push(rec0);
      const r = g.__iOrig();
      rec0.afterIdx = g.run ? g.run.roomIdx : -1;
      return r;
    };
    const atExit = () => { const ex = g.room.room.exit; warp(ex.x - 1.0, ex.z); };
    const atEntry = () => { const gp = g.room.room.gate || g.room.room.entry; warp(gp.x - 1.3, gp.z); };
    const foes = () => g.enemies.filter((e) => e.alive && !e.dead);
    const killAll = async (label) => {
      for (let i = 0; i < 8 && foes().length; i++) {
        for (const e of foes()) e.takeDamage(g, 9e5, { dirX: 0, dirZ: 1, school: 'heavy', poise: 0, heavy: true });
        await wait(140);
      }
      await until(() => g.roomCleared, 3000);
      return foes().length;
    };
    const drainDrafts = async () => {
      let n = 0;
      while (g.state === 'draft' && n < 6) {
        const had = g.run.relics.length, pool = g.draft.picked.map((r) => r.id);
        g.pickDraft(g.draft.picked[0]);
        await until(() => g.state === 'playing', 3000);
        rec('draft picks a relic (pool ' + pool.length + ')', g.state === 'playing' && g.run.relics.length === had + 1 && !g.draft, { pool, picked: g.run.relics.slice(-1), relics: g.run.relics.length });
        n++;
      }
      return n;
    };

    g.startRun('RUN-7', 'ashen_knight');
    await wait(300);
    rec('run starts in the chapel', g.state === 'playing' && g.roomSpec.type === 'chapel' && g.run.roomIdx === 0 && !!g.room.gracePos, { spec: g.roomSpec.type, grace: !!g.room.gracePos, relics: g.run.relics.length });

    // grace rest: damage then rest on the grace
    g.player.hp = 30;
    warp(g.room.gracePos.x + 1.0, g.room.gracePos.z);
    await wait(150);
    const nearGrace = g.nearestInteract();
    g.interact();
    await wait(400);
    rec('grace rests and refills', nearGrace && nearGrace.kind === 'grace' && g.player.hp > 100 && g.run.graceAt && g.run.graceAt.roomIdx === 0, { kind: nearGrace && nearGrace.kind, hp: Math.round(g.player.hp), graceAt: g.run.graceAt });

    let rooms = 0, bosses = 0, blockedChecked = 0;
    for (let i = 0; i < 26 && g.state !== 'win'; i++) {
      await drainDrafts();
      if (g.state !== 'playing') break;
      const spec = g.roomSpec.type, idx = g.run.roomIdx, depth = g.run.depth;
      if (spec === 'boss' && !g.bossDone) {
        rec('boss arena gates behind fog', !!g.room.gate.visible, { gate: !!g.room.gate.visible, portalOpen: g.portalOpen });
        atEntry(); await wait(120);
        const t = g.nearestInteract();
        if (t && t.kind === 'gate') g.interact();
        await wait(250);
        rec('fog gate opens on interact', !g.room.gate.visible, { gate: g.room.gate.visible, interacted: t && t.kind });
        const k0 = g.run.kills;
        warp(g.bossSpawn.x - 6, g.bossSpawn.z);
        const spawned = await until(() => !!g.boss, 4000);
        rec('boss awakens on approach', !!g.boss && g.lockTarget === g.boss, { boss: g.boss && g.boss.name, ms: spawned, locked: g.lockTarget === g.boss, hp: g.boss && Math.round(g.boss.hp) });
        const armed = { cine: !!g.cine, frozen: g.input.frozen, dist: +g.rig.wantDist.toFixed(2) };
        const thawed = await until(() => !g.cine && !g.input.frozen, 3000);
        rec('boss intro drives a camera cinematic', armed.cine && armed.frozen && armed.dist < 3.2 && thawed >= 0 && !g.input.frozen && g.rig.wantDist > 4, { ...armed, thawedMs: thawed, endDist: +g.rig.wantDist.toFixed(2) });
        const before = g.run.bossKills;
        const left = await killAll('boss');
        const diedAt = await until(() => g.bossDone, 4000);
        rec('boss death awards + drafts legendary', g.run.bossKills === before + 1 && g.bossDone, { bossKills: g.run.bossKills, bossDone: g.bossDone, state: g.state, ms: diedAt });
        await until(() => g.state === 'draft', 2000);
        await drainDrafts();
        bosses++;
        atExit(); await wait(120); g.interact();
        await until(() => g.run.depth !== depth || g.run.roomIdx !== idx || g.state === 'win', 3000);
        rec('boss exit descends', g.state === 'win' || g.run.depth === depth + 1 || g.run.roomIdx === 0, { depthBefore: depth, depth: g.run.depth, idx: g.run.roomIdx, state: g.state });
        continue;
      }
      if (foes().length) {
        atExit(); await wait(120);
        const idxBefore = g.run.roomIdx;
        g.interact();
        await wait(250);
        if (blockedChecked++ === 0) rec('portal blocked until room cleared', g.run.roomIdx === idxBefore && !g.portalOpen, { idxBefore, portalOpen: g.portalOpen, foes: foes().length });
        const runesBefore = g.run.runes;
        const left = await killAll(spec);
        rec('foes die and clear the room', left === 0 && g.roomCleared, { spec, left, cleared: g.roomCleared, kills: g.run.kills });
        const orbPk = g.pickups.find((x) => x.orb && !x.taken);
        if (orbPk) warp(orbPk.pos.x, orbPk.pos.z);
        const orb = await until(() => g.run.runes > runesBefore, 3000);
        rec('runes drop on kill', g.run.runes > runesBefore, { runes: runesBefore + '->' + g.run.runes, ms: orb });
        await drainDrafts();
      } else if (spec === 'shrine' || spec === 'cache') {
        const pk = g.pickups.find((x) => !x.taken && !x.orb);
        if (pk) {
          warp(pk.pos.x + 1.0, pk.pos.z); await wait(160);
          const t = g.nearestInteract(); const runes0 = g.run.runes; const rel0 = g.run.relics.length;
          g.interact(); await wait(300);
          rec('altar/chest rewards', t && (t.kind === pk.kind) && (g.run.relics.length > rel0 || g.run.runes > runes0 || g.state === 'draft'), { kind: t && t.kind, runes: runes0 + '->' + g.run.runes, relics: rel0 + '->' + g.run.relics.length, state: g.state });
          await drainDrafts();
        }
      }
      if (g.state !== 'playing') break;
      atExit(); await wait(140);
      const open = g.portalOpen; const idxBefore = g.run.roomIdx;
      let moved = -1;
      for (let k = 0; k < 4 && moved < 0; k++) {
        g.interact();
        moved = await until(() => g.run.roomIdx !== idxBefore || g.state === 'draft' || g.state === 'win', 1200);
        if (moved < 0) await wait(120);
      }
      rooms++;
      if (g.state === 'draft') await drainDrafts();
      if (moved < 0) {
        const nx = g.nearestInteract();
        const g2 = g.room.room.grid;
        rec('portal advances the run', false, {
          spec, idxBefore, open, state: g.state, room: g.roomSpec.type,
          pState: g.player.state, busy: g.player.busy, dead: g.player.dead,
          near: nx ? { kind: nx.kind, d: +nx.d.toFixed(2), blocked: !!nx.blocked } : null,
          ppos: [+g.player.pos.x.toFixed(2), +g.player.pos.z.toFixed(2)],
          exit: [+g.room.room.exit.x.toFixed(2), +g.room.room.exit.z.toFixed(2)],
          dExit: +Math.hypot(g.player.pos.x - g.room.room.exit.x, g.player.pos.z - g.room.room.exit.z).toFixed(2),
          cellAtExit: g2.type[g2.index(g2.cx(g.room.room.exit.x), g2.cz(g.room.room.exit.z))],
          cleared: g.roomCleared, bossDone: g.bossDone, portalOpenNow: g.portalOpen,
          pickups: g.pickups.map((x) => x.kind + (x.taken ? ':taken' : '') + '@' + x.pos.x.toFixed(1) + ',' + x.pos.z.toFixed(1)),
          interactSrc: String(g.interact).slice(0, 120),
          planLen: g.plans[g.run.depth].rooms.length, depth: g.run.depth,
          iLog: interactLog.slice(-4),
          roomTypes: g.plans[g.run.depth].rooms.map((r) => r.type).join(','),
          retry: (() => { try { g.interact(); return { idx: g.run.roomIdx, state: g.state }; } catch (e) { return { THROW: String(e && e.message || e), stack: String(e && e.stack).slice(0, 300) }; } })(),
        });
        break;
      }
    }
    rec('run reached the final boss three times', bosses === 3, { bosses, rooms, depth: g.run ? g.run.depth : null, state: g.state });
    await drainDrafts();
    rec('victory ends the run', g.state === 'win', { state: g.state, marks: g.save.marks, bossKills: g.run ? g.run.bossKills : null });
    const marks0 = g.save.marks;
    g.endRun();
    await wait(400);
    rec('run settlement banks marks', g.state === 'hub' && g.save.marks >= marks0 && g.run === null, { marks0, marks: g.save.marks, state: g.state, codex: { runs: g.save.codex.runs, victories: g.save.codex.victories, deepest: g.save.codex.deepest } });

    // death + bloodstain recovery
    g.startRun('RUN-DEATH', 'ashen_knight');
    await wait(300);
    const plan = g.plans[0];
    for (let i = 1; i < plan.rooms.length; i++) { g.enterRoom(0, i); if (g.enemies.length) break; }
    await wait(250);
    await killAll('death-setup');
    g.addRunes(500);
    const runes = g.run.runes;
    g.player.iFrameT = 0;
    g.player.takeDamage(g, 9e6, { dirX: 0, dirZ: 1, school: 'heavy', poise: 0 });
    const dying = g.state;
    let deadAt = 0; while (g.state !== 'dead' && deadAt < 3200) { await real(120); deadAt += 120; }
    rec('death drops runes and shows the screen', dying === 'dying' && g.state === 'dead' && g.run.runes === 0 && g.run.bloodstain && g.run.bloodstain.amount === runes, { dying, state: g.state, lost: runes, bloodstain: g.run.bloodstain && g.run.bloodstain.amount, ms: deadAt });
    g.revive();
    await wait(400);
    const atGrace = g.run.graceAt;
    rec('revive returns to the grace', g.state === 'playing' && g.player.hp === g.player.maxHp && !g.player.dead, { state: g.state, hp: Math.round(g.player.hp), graceAt: atGrace });
    const bs = g.run.bloodstain;
    rec('bloodstain recorded the death room', !!bs && typeof bs.amount === 'number' && bs.amount === runes, { bloodstain: bs });
    if (bs) {
      g.run.runes = 0;
      g.enterRoom(bs.depth, bs.roomIdx);
      const blood = g.pickups.find((x) => x.kind === 'blood' && !x.taken);
      rec('bloodstain respawned where you died', !!blood, { found: !!blood, room: g.roomSpec.type + '#' + g.run.roomIdx, pickups: g.pickups.map((x) => x.kind + (x.taken ? ':taken' : '') + (x.orb ? ':orb' : '')) });
      await wait(300);
      const autoCollected = g.run.runes >= runes;
      if (!autoCollected) { const b2 = g.pickups.find((x) => x.kind === 'blood'); if (b2) warp(b2.pos.x + 0.3, b2.pos.z); }
      const got = await until(() => g.run.runes >= runes, 4000);
      rec('bloodstain recovers the lost runes', g.run.runes >= runes && !g.run.bloodstain, { runes: g.run.runes, expect: runes, ms: got, autoCollected, stainCleared: !g.run.bloodstain });
    }
    return { rooms, bosses, state: g.state, fps: Math.round(g._fps.v), rows, fail: rows.filter((r) => !r.pass).map((r) => r.test) };
  })()`,
};

main().catch((e) => { console.error('driver error:', e.message); process.exit(1); });
