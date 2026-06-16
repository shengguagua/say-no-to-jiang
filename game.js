(() => {
const VW = 450, VH = 800;
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

let scale = 1;
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  const ratio = VW / VH;
  let cw, ch;
  if (w / h > ratio) { ch = h; cw = h * ratio; }
  else { cw = w; ch = w / ratio; }
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = cw + 'px';
  canvas.style.height = ch + 'px';
  canvas.width = VW * dpr;
  canvas.height = VH * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  scale = cw / VW;
}
window.addEventListener('resize', resize);

// ===== State =====
const STATE = { MENU: 0, PLAYING: 1, PAUSED: 2, GAME_OVER: 3 };
let state = STATE.MENU;

const INVITE_TEXTS = ["吃饭?", "桌球?", "上网?"];

let player, enemies, bullets, xpOrbs, smokes, floats, shieldHits;
let score, level, xp, xpNeed;
let shootTimer, spawnTimer, eliteTimer, bossSpawned;
let upgradeChoices = [];
let time = 0;
let gameTime = 0;
let stats = defaultStats();

function defaultStats() {
  return {
    range: 220,
    cooldown: 0.55,
    pierce: 0,
    speedMul: 1,
    sizeMul: 1,
    knockback: 40,
    crazyThursday: false,
    shield: false,
    shieldRadius: 60,
    shieldTick: 0,
  };
}

function reset() {
  player = { x: VW/2, y: VH*0.7, r: 15, baseSpeed: 320 };
  enemies = []; bullets = []; xpOrbs = []; smokes = []; floats = []; shieldHits = [];
  score = 0; level = 1; xp = 0; xpNeed = 50;
  shootTimer = 0; spawnTimer = 0; eliteTimer = 0; bossSpawned = false;
  gameTime = 0;
  stats = defaultStats();
  playerVel.x = 0; playerVel.y = 0;
  resetJoystick();
  state = STATE.PLAYING;
}

// ===== Audio (Web Audio API, procedural) =====
let audioCtx = null, masterGain = null, bgmGain = null;
let bgmTimer = null, bgmStep = 0;
const SCALE_HZ = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25]; // C major pentatonic-ish

let silentEl = null;
function forceMediaChannel() {
  if (silentEl) return;
  // Silent looping MP3 (base64) — locks iOS to media audio channel, bypasses ringer switch
  silentEl = new Audio('data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjQ1LjEwMAAAAAAAAAAAAAAA//tAwAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAACAAACgAD///////////////////////////////////////////////////////////////////8AAAA8TEFNRTMuMTAwAc0AAAAAAAAAABSAJAJAQgAAgAAAAoCJ9DQAAAAAAAAAAAAAAAD/+0DEAAPH3Yc1AAR8AAAANIAAAAQBTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//tCxFmDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+0LE/4PAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//tCxP+DwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU=');
  silentEl.loop = true;
  silentEl.volume = 0.001;
  silentEl.setAttribute('playsinline', '');
  silentEl.play().catch(() => {});
}

function ensureAudio() {
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = 0.5;
      masterGain.connect(audioCtx.destination);
      bgmGain = audioCtx.createGain();
      bgmGain.gain.value = 0.22;
      bgmGain.connect(masterGain);
      
      // 【核心修改】不要给 iOS 喂空 buffer！给它一个真正的振荡器波形，但把音量调到 0
      const t = audioCtx.currentTime;
      const dummyOsc = audioCtx.createOscillator();
      const dummyGain = audioCtx.createGain();
      dummyOsc.type = 'sine';
      dummyOsc.frequency.setValueAtTime(440, t); // 标准 A 音高
      dummyGain.gain.value = 0.0001; // 极小音量，人耳听不见，但系统能检测到有波形数据
      dummyOsc.connect(dummyGain);
      dummyGain.connect(audioCtx.destination);
      dummyOsc.start(t);
      dummyOsc.stop(t + 0.1); // 响 0.1 秒后自动销毁
      
      startBGM();
    } catch (e) { audioCtx = null; return; }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
}

// 把原本的 WeixinJSBridgeReady 监听改成这样：
function onWxReady() {
  // 微信就绪时，如果还没有 audioCtx，直接无脑强行创建它！
  if (!audioCtx) {
    ensureAudio();
  } else if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
}

// 兼容微信的各种加载时机
if (typeof WeixinJSBridge !== 'undefined') {
  WeixinJSBridge.invoke('getNetworkType', {}, onWxReady); // 强制唤醒
} else {
  document.addEventListener('WeixinJSBridgeReady', onWxReady);
}

function blip(freq, dur, type = 'square', vol = 0.25, slide = 0) {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g); g.connect(masterGain);
  osc.start(t); osc.stop(t + dur + 0.02);
}

function noiseBurst(dur, vol = 0.2) {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * dur, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = audioCtx.createBufferSource();
  const g = audioCtx.createGain();
  g.gain.value = vol;
  src.buffer = buf; src.connect(g); g.connect(masterGain);
  src.start(t);
}

const sfx = {
  shoot:   () => blip(880, 0.06, 'square', 0.06, -300),
  hit:     () => blip(220, 0.08, 'triangle', 0.18, -80),
  kill:    () => { blip(440, 0.1, 'square', 0.15, 200); noiseBurst(0.12, 0.08); },
  level:   () => { blip(523, 0.1, 'triangle', 0.25); setTimeout(() => blip(784, 0.18, 'triangle', 0.25), 90); },
  gameover:() => { blip(330, 0.2, 'sawtooth', 0.3, -200); setTimeout(() => blip(180, 0.4, 'sawtooth', 0.3, -120), 180); },
  boss:    () => { blip(80, 0.4, 'sawtooth', 0.3); setTimeout(() => blip(70, 0.4, 'sawtooth', 0.3), 200); },
};

function stopBGM() { if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; } }
function startBGM() {
  stopBGM();
  bgmStep = 0;
  bgmTimer = setInterval(() => {
    if (!audioCtx || state === STATE.GAME_OVER) return;
    const t = audioCtx.currentTime;
    const beat = bgmStep % 8;
    // bassline
    if (beat % 2 === 0) {
      const bass = [130.81, 130.81, 174.61, 196.0][Math.floor(bgmStep / 2) % 4];
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = bass;
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      osc.connect(g); g.connect(bgmGain);
      osc.start(t); osc.stop(t + 0.28);
    }
    // melody
    const note = SCALE_HZ[(beat * 3 + Math.floor(bgmStep / 8)) % SCALE_HZ.length];
    const osc2 = audioCtx.createOscillator();
    const g2 = audioCtx.createGain();
    osc2.type = 'square';
    osc2.frequency.value = note;
    g2.gain.setValueAtTime(0.05, t);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc2.connect(g2); g2.connect(bgmGain);
    osc2.start(t); osc2.stop(t + 0.2);
    bgmStep++;
  }, 200);
}

// ===== Input: Dynamic Virtual Joystick =====
const JOY_OUTER = 40, JOY_INNER = 15;
const joy = { active: false, baseX: 0, baseY: 0, knobX: 0, knobY: 0, dirX: 0, dirY: 0, intensity: 0 };
const playerVel = { x: 0, y: 0 };

function resetJoystick() {
  joy.active = false;
  joy.dirX = 0; joy.dirY = 0; joy.intensity = 0;
  joy.knobX = joy.baseX; joy.knobY = joy.baseY;
}

function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  const t = e.touches ? e.touches[0] : e;
  return { x: (t.clientX - rect.left) / scale, y: (t.clientY - rect.top) / scale };
}
function pointerDown(e) {
  e.preventDefault();
  
  // 【核心修改 1】只要用户一按屏幕，立刻无脑强制解锁 iOS 媒体通道
  if (!silentEl) {
    silentEl = new Audio('data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjQ1LjEwMAAAAAAAAAAAAAAA//tAwAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAACAAACgAD///////////////////////////////////////////////////////////////////8AAAA8TEFNRTMuMTAwAc0AAAAAAAAAABSAJAJAQgAAgAAAAoCJ9DQAAAAAAAAAAAAAAAD/+0DEAAPH3Yc1AAR8AAAANIAAAAQBTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//tCxFmDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+0LE/4PAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//tCxP+DwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU=');
    silentEl.loop = true;
    silentEl.volume = 0.001;
    silentEl.setAttribute('playsinline', '');
  }
  // 必须在点击事件的当前调用栈里直接 play()，才能破除 iOS 静音开关限制！
  silentEl.play().then(() => {
    // 激活 Web Audio 上下文
    ensureAudio(); 
  }).catch(() => {
    ensureAudio();
  });

  const p = getPos(e);
  if (state === STATE.MENU) { if (hitBtn(p, VW/2, 550, 200, 60)) reset(); return; }
  if (state === STATE.GAME_OVER) { if (hitBtn(p, VW/2, 545, 180, 50)) reset(); return; }
  if (state === STATE.PAUSED) { handleUpgradeClick(p); return; }
  if (state === STATE.PLAYING) {
    if (p.x > VW / 2) return; // joystick only spawns in left half
    joy.active = true;
    joy.baseX = p.x; joy.baseY = p.y;
    joy.knobX = p.x; joy.knobY = p.y;
    joy.dirX = 0; joy.dirY = 0; joy.intensity = 0;
  }
}
function pointerMove(e) {
  e.preventDefault();
  if (!joy.active) return;
  const p = getPos(e);
  const dx = p.x - joy.baseX, dy = p.y - joy.baseY;
  const d = Math.hypot(dx, dy);
  if (d > JOY_OUTER) {
    joy.knobX = joy.baseX + (dx / d) * JOY_OUTER;
    joy.knobY = joy.baseY + (dy / d) * JOY_OUTER;
  } else {
    joy.knobX = p.x; joy.knobY = p.y;
  }
  if (d > 0.5) {
    joy.dirX = dx / d;
    joy.dirY = dy / d;
    joy.intensity = Math.min(1, d / JOY_OUTER);
  } else {
    joy.dirX = 0; joy.dirY = 0; joy.intensity = 0;
  }
}
function pointerUp(e) {
  e.preventDefault();
  resetJoystick();
  playerVel.x = 0; playerVel.y = 0;
}
canvas.addEventListener('touchstart', pointerDown, { passive: false });
canvas.addEventListener('touchmove', pointerMove, { passive: false });
canvas.addEventListener('touchend', pointerUp, { passive: false });
canvas.addEventListener('touchcancel', pointerUp, { passive: false });
canvas.addEventListener('mousedown', pointerDown);
canvas.addEventListener('mousemove', pointerMove);
canvas.addEventListener('mouseup', pointerUp);
document.addEventListener('gesturestart', e => e.preventDefault());

// 专门用来拯救夸克和国内各种魔改浏览器的兜底
canvas.addEventListener('click', (e) => {
  // 如果 touchstart 没触发，用 click 强行把 pointerDown 顶进去
  pointerDown(e); 
});

function hitBtn(p, cx, cy, w, h) {
  return p.x > cx - w/2 && p.x < cx + w/2 && p.y > cy - h/2 && p.y < cy + h/2;
}

// ===== Upgrades =====
const UPGRADES = [
  {
    name: "疯狂星期四", sub: "Crazy Thursday Frenzy",
    desc: "拒绝频率 +35%，射程 +25%，金色光环",
    apply: () => { stats.cooldown *= 0.65; stats.range *= 1.25; stats.crazyThursday = true; }
  },
  {
    name: "勿扰模式", sub: "Do-Not-Disturb Shield",
    desc: "蓝色脉冲护盾，进入即击退并造成伤害",
    apply: () => { stats.shield = true; stats.shieldRadius = Math.min(90, stats.shieldRadius * 1.0 + (stats.shield ? 15 : 0)); }
  },
  {
    name: "共享单车", sub: "Shared-Bike Speedrun",
    desc: "移动速度 +25%",
    apply: () => { stats.speedMul *= 1.25; }
  },
  {
    name: "言语穿透", sub: "Piercing Words",
    desc: "弹幕额外穿透 +1",
    apply: () => { stats.pierce += 1; }
  },
  {
    name: "底气十足", sub: "Heavy Words",
    desc: "弹幕变大 +30%，击退 +50%",
    apply: () => { stats.sizeMul *= 1.3; stats.knockback *= 1.5; }
  },
];

function pickUpgrades() {
  const pool = [...UPGRADES];
  const picks = [];
  for (let i = 0; i < 3 && pool.length; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    picks.push(pool.splice(idx, 1)[0]);
  }
  upgradeChoices = picks.map((u, i) => ({
    ...u,
    rect: { x: 35, y: 220 + i * 130, w: 380, h: 110 }
  }));
}

function handleUpgradeClick(p) {
  for (const c of upgradeChoices) {
    const r = c.rect;
    if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) {
      c.apply();
      level++;
      xp -= xpNeed; if (xp < 0) xp = 0;
      xpNeed = Math.floor(xpNeed * 1.25);
      state = STATE.PLAYING;
      if (xp >= xpNeed) levelUp();
      return;
    }
  }
}

function levelUp() { pickUpgrades(); state = STATE.PAUSED; sfx.level(); }

// ===== Spawn =====
function spawnAtEdge() {
  const side = Math.floor(Math.random() * 4);
  if (side === 0) return { x: -30, y: Math.random() * VH };
  if (side === 1) return { x: VW + 30, y: Math.random() * VH };
  if (side === 2) return { x: Math.random() * VW, y: -30 };
  return { x: Math.random() * VW, y: VH + 30 };
}

function difficultyMul() {
  const timeMul = 1 + gameTime / 120;          // +1.0 per 2 minutes (was 1)
  const levelMul = Math.pow(1.06, level - 1);  // ~6% per level (was 12%)
  return timeMul * levelMul;
}

function spawnRegular() {
  const p = spawnAtEdge();
  const dx = player.x - p.x, dy = player.y - p.y;
  const d = Math.hypot(dx, dy) || 1;
  const dm = difficultyMul();
  const sp = 42 * (0.85 + dm * 0.25);
  const hp = Math.max(2, Math.floor(2 + (level - 1) * 0.3 + gameTime * 0.015));
  enemies.push({
    kind: 'normal',
    x: p.x, y: p.y, w: 32, h: 42,
    vx: dx/d * sp, vy: dy/d * sp, speed: sp,
    hp, maxHp: hp,
    inviteText: INVITE_TEXTS[Math.floor(Math.random() * INVITE_TEXTS.length)],
    dizzy: 0, hitFlash: 0, defeated: false, defeatTimer: 0,
    knockVx: 0, knockVy: 0, phase: Math.random() * Math.PI * 2,
  });
}

function spawnElite() {
  const p = spawnAtEdge();
  const dx = player.x - p.x, dy = player.y - p.y;
  const d = Math.hypot(dx, dy) || 1;
  const sp = 140;
  enemies.push({
    kind: 'voice',
    x: p.x, y: p.y, w: 26, h: 36,
    vx: dx/d * sp, vy: dy/d * sp, speed: sp,
    wobble: Math.random() * Math.PI * 2,
    hp: 2, maxHp: 2,
    inviteText: "🔊 60\"",
    dizzy: 0, hitFlash: 0, defeated: false, defeatTimer: 0,
    knockVx: 0, knockVy: 0, phase: Math.random() * Math.PI * 2,
    voiceBanner: 0,
  });
}

function spawnBoss() {
  const p = spawnAtEdge();
  const dx = player.x - p.x, dy = player.y - p.y;
  const d = Math.hypot(dx, dy) || 1;
  const sp = 35;
  enemies.push({
    kind: 'boss',
    x: p.x, y: p.y, w: 90, h: 120,
    vx: dx/d * sp, vy: dy/d * sp, speed: sp,
    hp: 60, maxHp: 60,
    inviteText: "我到你家小区门口了，赶紧下楼!!",
    dizzy: 0, hitFlash: 0, defeated: false, defeatTimer: 0,
    knockVx: 0, knockVy: 0, phase: Math.random() * Math.PI * 2,
  });
}

function nearestEnemy() {
  let best = null, bd = Infinity;
  for (const e of enemies) {
    if (e.defeated) continue;
    const d = Math.hypot(e.x - player.x, e.y - player.y);
    if (d < bd) { bd = d; best = e; }
  }
  return (best && bd <= stats.range) ? best : null;
}

function shoot() {
  const e = nearestEnemy();
  if (!e) return;
  const dx = e.x - player.x, dy = e.y - player.y;
  const d = Math.hypot(dx, dy) || 1;
  const sp = 520;
  bullets.push({
    x: player.x, y: player.y,
    vx: dx/d * sp, vy: dy/d * sp,
    w: 14 * stats.sizeMul, h: 16 * stats.sizeMul,
    pierce: stats.pierce,
    hits: new Set(),
  });
  sfx.shoot();
}

function rectCircleHit(rx, ry, rw, rh, cx, cy, cr) {
  const nx = Math.max(rx - rw/2, Math.min(cx, rx + rw/2));
  const ny = Math.max(ry - rh/2, Math.min(cy, ry + rh/2));
  return Math.hypot(cx - nx, cy - ny) < cr;
}
function rectRectHit(a, b) {
  return Math.abs(a.x - b.x) < (a.w + b.w)/2 && Math.abs(a.y - b.y) < (a.h + b.h)/2;
}

function damageEnemy(e, dmg, fromX, fromY, knockMul = 1) {
  e.hp -= dmg;
  const dx = e.x - fromX, dy = e.y - fromY;
  const d = Math.hypot(dx, dy) || 1;
  const kb = stats.knockback * knockMul * (e.kind === 'boss' ? 0.25 : 1);
  e.knockVx = dx/d * kb * 8;
  e.knockVy = dy/d * kb * 8;
  e.hitFlash = 0.12;
  e.dizzy = e.kind === 'boss' ? 0.3 : 0.6;
  if (e.kind === 'voice') e.voiceBanner = 0.5;
  sfx.hit();
  if (e.hp <= 0 && !e.defeated) {
    sfx.kill();
    e.defeated = true;
    e.defeatTimer = e.kind === 'boss' ? 1.2 : 0.6;
    const count = e.kind === 'boss' ? 30 : 10;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp2 = 30 + Math.random() * 60;
      smokes.push({
        x: e.x, y: e.y,
        vx: Math.cos(a) * sp2, vy: Math.sin(a) * sp2 - 20,
        r: 4 + Math.random() * 8, life: 0.7, max: 0.7,
      });
    }
    const xpDrop = e.kind === 'boss' ? 90 : (e.kind === 'voice' ? 15 : 10);
    score += e.kind === 'boss' ? 20 : (e.kind === 'voice' ? 3 : 1);
    xp += xpDrop;
    floats.push({ x: e.x, y: e.y, life: 1, text: `+${xpDrop} XP`, color: '#2BB673' });
    if (xp >= xpNeed) levelUp();
  }
}

// ===== Update =====
function update(dt) {
  time += dt;
  if (state !== STATE.PLAYING) return;
  gameTime += dt;

  // Move player via virtual joystick — instant response, no inertia
  const sp = player.baseSpeed * stats.speedMul;
  if (joy.active) {
    playerVel.x = joy.dirX * joy.intensity * sp;
    playerVel.y = joy.dirY * joy.intensity * sp;
  } else {
    playerVel.x = 0; playerVel.y = 0;
  }
  player.x += playerVel.x * dt;
  player.y += playerVel.y * dt;
  player.x = Math.max(player.r, Math.min(VW - player.r, player.x));
  player.y = Math.max(player.r + 20, Math.min(VH - player.r, player.y));

  // Shooting
  shootTimer += dt;
  if (shootTimer >= stats.cooldown) { shootTimer = 0; shoot(); }

  // Regular spawn (rate accelerates over time)
  spawnTimer += dt;
  const dm = difficultyMul();
  const spawnRate = Math.max(0.45, 1.8 / dm);
  if (spawnTimer >= spawnRate) { spawnTimer = 0; spawnRegular(); }

  // Elite spawn at 20s
  if (gameTime >= 20) {
    eliteTimer += dt;
    if (eliteTimer >= 5) { eliteTimer = 0; spawnElite(); }
  }
  // Boss spawn at 45s (once)
  if (gameTime >= 45 && !bossSpawned) { bossSpawned = true; spawnBoss(); sfx.boss(); }

  // Move bullets
  for (const b of bullets) { b.x += b.vx * dt; b.y += b.vy * dt; }

  // Move enemies
  for (const e of enemies) {
    if (e.defeated) { e.defeatTimer -= dt; continue; }
    if (e.dizzy > 0) e.dizzy -= dt;
    if (e.hitFlash > 0) e.hitFlash -= dt;
    if (e.voiceBanner > 0) e.voiceBanner -= dt;

    // Re-home velocity toward player every frame for normal/boss; voice has wobble
    const dx = player.x - e.x, dy = player.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    let vx = dx/d * e.speed, vy = dy/d * e.speed;
    if (e.kind === 'voice') {
      e.wobble += dt * 8;
      const perpX = -dy/d, perpY = dx/d;
      vx += perpX * Math.sin(e.wobble) * 80;
      vy += perpY * Math.sin(e.wobble) * 80;
    }
    if (e.hitFlash > 0) {
      e.x += e.knockVx * dt;
      e.y += e.knockVy * dt;
      e.knockVx *= 0.85; e.knockVy *= 0.85;
    } else {
      e.x += vx * dt; e.y += vy * dt;
    }
  }

  // Bullet vs enemy
  for (const b of bullets) {
    for (const e of enemies) {
      if (e.defeated || b.hits.has(e)) continue;
      if (rectRectHit(b, e)) {
        b.hits.add(e);
        damageEnemy(e, 1, player.x, player.y, 1);
        b.pierce--;
        if (b.pierce < 0) { b._dead = true; break; }
      }
    }
  }

  // Shield: knock back + decay damage
  if (stats.shield) {
    stats.shieldTick += dt;
    const tick = stats.shieldTick >= 0.4;
    if (tick) stats.shieldTick = 0;
    for (const e of enemies) {
      if (e.defeated) continue;
      const dx = e.x - player.x, dy = e.y - player.y;
      const d = Math.hypot(dx, dy);
      if (d < stats.shieldRadius + Math.max(e.w, e.h) / 2) {
        if (tick) {
          damageEnemy(e, e.kind === 'boss' ? 1 : 1, player.x, player.y, 1.25);
          shieldHits.push({ x: e.x, y: e.y, life: 0.3 });
        }
        // continuous repel
        const nrm = d || 1;
        e.x += (dx/nrm) * 50 * dt;
        e.y += (dy/nrm) * 50 * dt;
      }
    }
  }
  for (const s of shieldHits) s.life -= dt;
  shieldHits = shieldHits.filter(s => s.life > 0);

  // Cleanup
  bullets = bullets.filter(b => !b._dead && b.x > -80 && b.x < VW + 80 && b.y > -80 && b.y < VH + 80);
  enemies = enemies.filter(e => !(e.defeated && e.defeatTimer <= 0));
  for (const o of floats) { o.life -= dt; o.y -= 30 * dt; }
  floats = floats.filter(o => o.life > 0);
  for (const s of smokes) {
    s.x += s.vx * dt; s.y += s.vy * dt;
    s.vx *= 0.92; s.vy *= 0.92; s.r += 18 * dt; s.life -= dt;
  }
  smokes = smokes.filter(s => s.life > 0);

  // Player collision
  for (const e of enemies) {
    if (e.defeated) continue;
    if (rectCircleHit(e.x, e.y, e.w, e.h, player.x, player.y, player.r)) {
      state = STATE.GAME_OVER; sfx.gameover(); break;
    }
  }
}

// ===== Draw helpers =====
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function textBubble(cx, cy, text, fontSize, padX, padY, fill, stroke, textColor) {
  ctx.font = `bold ${fontSize}px -apple-system, "PingFang SC", sans-serif`;
  const tw = ctx.measureText(text).width;
  const w = tw + padX * 2;
  const h = fontSize + padY * 2;
  ctx.fillStyle = fill;
  roundRect(cx - w/2, cy - h/2, w, h, h/2); ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.2; ctx.stroke(); }
  ctx.fillStyle = textColor;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy + 0.5);
}

// ===== Draw player =====
function drawPlayer(cx, cy) {
  const bob = Math.sin(time * 6) * 1;
  const y = cy + bob;
  const tier = level >= 8 ? 3 : (level >= 4 ? 2 : 1);

  // Tier 3: sweeping energy particles + pulsing aura
  if (tier === 3) {
    const pulseR = 28 + Math.sin(time * 5) * 4;
    const grad = ctx.createRadialGradient(cx, y, 6, cx, y, pulseR);
    grad.addColorStop(0, 'rgba(255,210,20,0.5)');
    grad.addColorStop(0.6, 'rgba(120,200,255,0.25)');
    grad.addColorStop(1, 'rgba(120,200,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(cx, y, pulseR, 0, Math.PI*2); ctx.fill();
    // orbiting energy particles
    for (let i = 0; i < 6; i++) {
      const a = time * 2.5 + i * (Math.PI * 2 / 6);
      const px = cx + Math.cos(a) * 22;
      const py = y + Math.sin(a) * 22;
      ctx.fillStyle = i % 2 ? '#FFD214' : '#6BD0FF';
      ctx.beginPath(); ctx.arc(px, py, 2.2, 0, Math.PI*2); ctx.fill();
    }
  }

  // Tier 2: blue DND halo above head
  if (tier === 2 || tier === 3) {
    const ha = 0.7 + Math.sin(time * 4) * 0.2;
    ctx.strokeStyle = `rgba(80,160,255,${ha})`;
    ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.ellipse(cx, y - 18, 9, 2.5, 0, 0, Math.PI*2); ctx.stroke();
    ctx.fillStyle = `rgba(80,160,255,${ha})`;
    ctx.font = 'bold 6px -apple-system, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('DND', cx, y - 18);
  }

  // Crazy Thursday aura
  if (stats.crazyThursday) {
    const pulse = 0.5 + Math.sin(time * 8) * 0.2;
    const grad = ctx.createRadialGradient(cx, y, 5, cx, y, 28);
    grad.addColorStop(0, `rgba(255,210,20,${0.5 * pulse})`);
    grad.addColorStop(1, 'rgba(255,210,20,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(cx, y, 28, 0, Math.PI*2); ctx.fill();
  }

  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.beginPath(); ctx.ellipse(cx, cy + 16, 11, 3, 0, 0, Math.PI*2); ctx.fill();

  // legs
  ctx.strokeStyle = '#3A2E20'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(cx - 3, y + 10); ctx.lineTo(cx - 4, y + 16); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx + 3, y + 10); ctx.lineTo(cx + 4, y + 16); ctx.stroke();

  // body (yellow hoodie, neon-yellow jacket from tier 2)
  const bodyColor = tier >= 2 ? '#F7FF1F' : '#FFD214';
  const trimColor = tier >= 2 ? '#00C3FF' : '#E0A800';
  ctx.fillStyle = bodyColor;
  roundRect(cx - 8, y - 1, 16, 13, 5); ctx.fill();
  ctx.strokeStyle = trimColor; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(cx - 5, y + 7); ctx.lineTo(cx + 5, y + 7); ctx.stroke();
  if (tier >= 2) {
    ctx.strokeStyle = trimColor; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(cx, y); ctx.lineTo(cx, y + 11); ctx.stroke();
  }

  // arms refusal pose
  ctx.strokeStyle = bodyColor; ctx.lineWidth = 4.5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(cx - 7, y + 2); ctx.lineTo(cx - 13, y + 4); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx + 7, y + 2); ctx.lineTo(cx + 13, y + 4); ctx.stroke();
  ctx.fillStyle = '#FFE0B0';
  ctx.beginPath(); ctx.arc(cx - 14, y + 4, 2.8, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 14, y + 4, 2.8, 0, Math.PI*2); ctx.fill();

  // head
  ctx.fillStyle = '#FFE0B0';
  ctx.beginPath(); ctx.arc(cx, y - 7, 7, 0, Math.PI*2); ctx.fill();

  // yellow cap
  ctx.fillStyle = '#FFD214';
  ctx.beginPath(); ctx.arc(cx, y - 8, 7.3, Math.PI, 0); ctx.closePath(); ctx.fill();
  ctx.fillRect(cx, y - 9, 9, 2);
  ctx.fillStyle = '#E0A800';
  ctx.beginPath(); ctx.arc(cx, y - 14.5, 1.2, 0, Math.PI*2); ctx.fill();

  // face
  ctx.fillStyle = '#222';
  ctx.beginPath(); ctx.arc(cx - 2.3, y - 6.5, 1, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 2.3, y - 6.5, 1, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#222'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(cx - 1.8, y - 3.5); ctx.lineTo(cx + 1.8, y - 3.5); ctx.stroke();

  // Shield pulse
  if (stats.shield) {
    const r = stats.shieldRadius + Math.sin(time * 4) * 4;
    const grad = ctx.createRadialGradient(cx, cy, r - 18, cx, cy, r);
    grad.addColorStop(0, 'rgba(100,180,255,0)');
    grad.addColorStop(0.7, 'rgba(100,180,255,0.12)');
    grad.addColorStop(1, 'rgba(100,180,255,0.35)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = 'rgba(120,190,255,0.7)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.stroke();
  }
}

// ===== Draw regular enemy =====
function drawEnemyBody(e, scaleMul = 1) {
  const cx = e.x, cy = e.y;
  const stride = Math.sin(time * 10 + e.phase);
  const s = scaleMul;

  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.beginPath(); ctx.ellipse(cx, cy + 18*s, 10*s, 3*s, 0, 0, Math.PI*2); ctx.fill();

  const bodyColor = e.kind === 'boss' ? '#5E3A8E' : '#FA5151';
  const darkColor = e.kind === 'boss' ? '#3A1F5C' : '#7A1010';

  // legs
  ctx.strokeStyle = darkColor; ctx.lineWidth = 3 * s; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(cx, cy + 8*s); ctx.lineTo(cx - (5 + stride * 3) * s, cy + 18*s); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, cy + 8*s); ctx.lineTo(cx + (5 + stride * 3) * s, cy + 18*s); ctx.stroke();
  ctx.fillStyle = '#222';
  ctx.beginPath(); ctx.arc(cx - (5 + stride * 3) * s, cy + 18*s, 2.2*s, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + (5 + stride * 3) * s, cy + 18*s, 2.2*s, 0, Math.PI*2); ctx.fill();

  // body
  ctx.fillStyle = bodyColor;
  roundRect(cx - 8*s, cy - 3*s, 16*s, 13*s, 4*s); ctx.fill();
  ctx.fillStyle = '#FFF';
  ctx.fillRect(cx - 8*s, cy + 1*s, 16*s, 1.5*s);

  // arms
  ctx.strokeStyle = bodyColor; ctx.lineWidth = 3.5 * s; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(cx - 7*s, cy - 1*s); ctx.lineTo(cx - 11*s, cy + (3 + stride * 4) * s); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx + 7*s, cy - 1*s); ctx.lineTo(cx + 11*s, cy + (3 - stride * 4) * s); ctx.stroke();
  ctx.fillStyle = '#FFE0B0';
  ctx.beginPath(); ctx.arc(cx - 11*s, cy + (3 + stride * 4) * s, 2*s, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 11*s, cy + (3 - stride * 4) * s, 2*s, 0, Math.PI*2); ctx.fill();

  // head
  ctx.fillStyle = '#FFE0B0';
  ctx.beginPath(); ctx.arc(cx, cy - 10*s, 7*s, 0, Math.PI*2); ctx.fill();
  // hair
  ctx.fillStyle = '#222';
  ctx.beginPath(); ctx.arc(cx, cy - 12*s, 7*s, Math.PI + 0.2, -0.2); ctx.fill();

  // face
  if (e.dizzy > 0) {
    ctx.strokeStyle = '#222'; ctx.lineWidth = 1 * s;
    for (const ex of [-2.5 * s, 2.5 * s]) {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = i * 0.6;
        const rr = i * 0.2 * s;
        const px = cx + ex + Math.cos(a) * rr;
        const py = cy - 10*s + Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx - 2.5 * s, cy - 6*s);
    ctx.lineTo(cx - 1*s, cy - 7*s);
    ctx.lineTo(cx + 1*s, cy - 6*s);
    ctx.lineTo(cx + 2.5 * s, cy - 7*s);
    ctx.stroke();
    // spiral above head
    ctx.strokeStyle = '#FFD214'; ctx.lineWidth = 1.2 * s;
    for (const ox of [-5*s, 5*s]) {
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = i * 0.6 + time * 6;
        const rr = i * 0.18 * s;
        const px = cx + ox + Math.cos(a) * rr;
        const py = cy - 22 * s + Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  } else {
    // manic eyes
    ctx.fillStyle = '#FFF';
    ctx.beginPath(); ctx.arc(cx - 2.5*s, cy - 10*s, 2*s, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 2.5*s, cy - 10*s, 2*s, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#222';
    ctx.beginPath(); ctx.arc(cx - 2.5*s, cy - 9.5*s, 1*s, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 2.5*s, cy - 9.5*s, 1*s, 0, Math.PI*2); ctx.fill();
    // open shouting mouth
    ctx.fillStyle = '#5A1010';
    ctx.beginPath(); ctx.ellipse(cx, cy - 5*s, 1.8*s, 2.2*s, 0, 0, Math.PI*2); ctx.fill();
  }
}

function drawEnemy(e) {
  if (e.kind === 'boss') {
    drawEnemyBody(e, 3);
    // boss text bubble overhead
    const bubY = e.y - 70;
    textBubble(e.x, bubY, e.inviteText, 11, 8, 4, '#3A1F5C', '#7A5BB0', '#FFF');
    // HP bar
    const w = 80, h = 6;
    ctx.fillStyle = '#222';
    roundRect(e.x - w/2, e.y - 90, w, h, 3); ctx.fill();
    ctx.fillStyle = '#FA5151';
    ctx.fillRect(e.x - w/2, e.y - 90, w * (e.hp / e.maxHp), h);
  } else {
    drawEnemyBody(e, e.kind === 'voice' ? 0.85 : 1);
    // invite text bubble overhead
    if (e.dizzy <= 0 && e.kind === 'normal') {
      textBubble(e.x, e.y - 30, e.inviteText, 10, 5, 3, '#FA5151', null, '#FFF');
    } else if (e.dizzy > 0) {
      textBubble(e.x, e.y - 30, "好吧…", 10, 5, 3, '#999', null, '#FFF');
    }
    if (e.kind === 'voice') {
      if (e.voiceBanner > 0) {
        textBubble(e.x, e.y - 30, e.inviteText, 10, 5, 3, '#1AAD19', null, '#FFF');
      } else {
        textBubble(e.x, e.y - 30, e.inviteText, 10, 5, 3, '#FA5151', null, '#FFF');
      }
    }
  }
}

// ===== Draw bullet =====
function drawBullet(b) {
  const w = b.w, h = b.h;
  // phone body (charcoal)
  ctx.fillStyle = '#2A2A2A';
  roundRect(b.x - w/2, b.y - h/2, w, h, 3); ctx.fill();
  ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
  roundRect(b.x - w/2, b.y - h/2, w, h, 3); ctx.stroke();
  // screen
  ctx.fillStyle = '#1A1A1A';
  roundRect(b.x - w/2 + 1.5, b.y - h/2 + 2.5, w - 3, h - 5, 1.5); ctx.fill();
  // bold red X
  ctx.strokeStyle = '#FF2D2D'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
  const pad = 2.5;
  ctx.beginPath();
  ctx.moveTo(b.x - w/2 + pad, b.y - h/2 + pad);
  ctx.lineTo(b.x + w/2 - pad, b.y + h/2 - pad);
  ctx.moveTo(b.x + w/2 - pad, b.y - h/2 + pad);
  ctx.lineTo(b.x - w/2 + pad, b.y + h/2 - pad);
  ctx.stroke();
}

function drawSmoke(s) {
  const a = Math.max(0, s.life / s.max);
  ctx.fillStyle = `rgba(180,180,180,${a * 0.7})`;
  ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI*2); ctx.fill();
}

// ===== Draw =====
function draw() {
  ctx.fillStyle = '#EFEFEF';
  ctx.fillRect(0, 0, VW, VH);

  if (state === STATE.MENU) { drawMenu(); return; }

  // Smoke first
  for (const s of smokes) drawSmoke(s);

  // Shield hit ripples
  for (const h of shieldHits) {
    const a = h.life / 0.3;
    ctx.strokeStyle = `rgba(100,180,255,${a})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(h.x, h.y, 14 * (1 - a) + 4, 0, Math.PI*2); ctx.stroke();
  }

  // Enemies sorted by y for depth
  const sorted = [...enemies].sort((a, b) => a.y - b.y);
  for (const e of sorted) if (!e.defeated) drawEnemy(e);

  // Bullets
  for (const b of bullets) drawBullet(b);

  // Player
  drawPlayer(player.x, player.y);

  // Floating texts
  for (const o of floats) {
    ctx.globalAlpha = Math.max(0, o.life);
    ctx.fillStyle = o.color || '#2BB673';
    ctx.font = 'bold 13px -apple-system, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(o.text, o.x, o.y);
    ctx.globalAlpha = 1;
  }

  // Virtual joystick
  if (joy.active) {
    ctx.strokeStyle = 'rgba(120,120,120,0.55)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(joy.baseX, joy.baseY, JOY_OUTER, 0, Math.PI*2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath(); ctx.arc(joy.knobX, joy.knobY, JOY_INNER, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = 'rgba(120,120,120,0.45)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(joy.knobX, joy.knobY, JOY_INNER, 0, Math.PI*2); ctx.stroke();
  }

  drawHUD();

  if (state === STATE.PAUSED) drawUpgrade();
  if (state === STATE.GAME_OVER) drawGameOver();
}

function drawHUD() {
  // XP bar
  ctx.fillStyle = '#D9D9D9';
  ctx.fillRect(0, 0, VW, 10);
  ctx.fillStyle = '#FFD214';
  ctx.fillRect(0, 0, Math.min(1, xp / xpNeed) * VW, 10);

  ctx.fillStyle = '#333';
  ctx.font = 'bold 16px -apple-system, sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(`Score: ${score}`, 12, 28);
  ctx.textAlign = 'right';
  ctx.fillText(`Lv. ${level}`, VW - 12, 28);
  ctx.textAlign = 'center';
  const mm = Math.floor(gameTime / 60), ss = Math.floor(gameTime % 60);
  ctx.fillText(`${mm}:${ss.toString().padStart(2,'0')}`, VW/2, 28);

  // Warning announcements
  if (gameTime >= 19 && gameTime < 24) {
    const a = 1 - Math.abs(21.5 - gameTime) / 2.5;
    ctx.globalAlpha = Math.max(0, a);
    ctx.fillStyle = '#FA5151';
    ctx.font = 'bold 22px -apple-system, "PingFang SC", sans-serif';
    ctx.fillText('⚠️ 语音轰炸来袭！', VW/2, 60);
    ctx.globalAlpha = 1;
  }
  if (gameTime >= 44 && gameTime < 49) {
    const a = 1 - Math.abs(46.5 - gameTime) / 2.5;
    ctx.globalAlpha = Math.max(0, a);
    ctx.fillStyle = '#5E3A8E';
    ctx.font = 'bold 22px -apple-system, "PingFang SC", sans-serif';
    ctx.fillText('🚨 楼下堵门小将出现！', VW/2, 60);
    ctx.globalAlpha = 1;
  }
}

// ===== Menu =====
function drawMenu() {
  ctx.fillStyle = '#333';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 32px -apple-system, "PingFang SC", sans-serif';
  ctx.fillText('大黄历险记', VW/2, 200);
  ctx.font = 'bold 22px -apple-system, "PingFang SC", sans-serif';
  ctx.fillText('小将别约啦！', VW/2, 240);

  drawPlayer(VW/2 - 45, 360);
  drawEnemyBody({ x: VW/2 + 45, y: 360, phase: 0, dizzy: 0, kind: 'normal' }, 1);
  drawBullet({ x: VW/2, y: 360, w: 14, h: 16 });

  // start button
  ctx.fillStyle = '#07C160';
  roundRect(VW/2 - 100, 520, 200, 60, 30); ctx.fill();
  ctx.fillStyle = '#FFF';
  ctx.font = 'bold 22px -apple-system, sans-serif';
  ctx.fillText('开始游戏', VW/2, 552);

  ctx.fillStyle = '#888';
  ctx.font = '13px -apple-system, sans-serif';
  ctx.fillText('左半屏按住生成摇杆，操控大黄走位', VW/2, 620);
  ctx.fillText('20秒语音轰炸 · 45秒堵门Boss', VW/2, 642);
}

function drawUpgrade() {
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, VW, VH);

  ctx.fillStyle = '#FFF';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 26px -apple-system, "PingFang SC", sans-serif';
  ctx.fillText('升级！选择一个被动', VW/2, 160);
  ctx.font = '14px -apple-system, sans-serif';
  ctx.fillStyle = '#CCC';
  ctx.fillText(`Lv. ${level} → Lv. ${level + 1}`, VW/2, 190);

  for (const c of upgradeChoices) {
    ctx.fillStyle = '#FFFFFF';
    roundRect(c.rect.x, c.rect.y, c.rect.w, c.rect.h, 16); ctx.fill();
    ctx.fillStyle = '#FFD214';
    roundRect(c.rect.x, c.rect.y, 6, c.rect.h, 3); ctx.fill();

    ctx.textAlign = 'left';
    ctx.fillStyle = '#222';
    ctx.font = 'bold 20px -apple-system, "PingFang SC", sans-serif';
    ctx.fillText(c.name, c.rect.x + 20, c.rect.y + 30);
    ctx.fillStyle = '#888';
    ctx.font = '12px -apple-system, sans-serif';
    ctx.fillText(c.sub, c.rect.x + 20, c.rect.y + 52);
    ctx.fillStyle = '#444';
    ctx.font = '14px -apple-system, "PingFang SC", sans-serif';
    ctx.fillText(c.desc, c.rect.x + 20, c.rect.y + 82);
  }
}

function drawGameOver() {
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, VW, VH);
  ctx.fillStyle = '#FFF';
  roundRect(40, 250, VW - 80, 320, 20); ctx.fill();

  ctx.fillStyle = '#FA5151';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 22px -apple-system, "PingFang SC", sans-serif';
  ctx.fillText('大黄防守失败！', VW/2, 300);
  ctx.fillText('被迫出门应酬！', VW/2, 332);

  ctx.fillStyle = '#333';
  ctx.font = '17px -apple-system, sans-serif';
  ctx.fillText(`最终得分: ${score}`, VW/2, 390);
  ctx.fillText(`等级: Lv. ${level}`, VW/2, 418);
  const mm = Math.floor(gameTime / 60), ss = Math.floor(gameTime % 60);
  ctx.fillText(`坚持时长: ${mm}:${ss.toString().padStart(2,'0')}`, VW/2, 446);

  ctx.fillStyle = '#07C160';
  roundRect(VW/2 - 90, 520, 180, 50, 25); ctx.fill();
  ctx.fillStyle = '#FFF';
  ctx.font = 'bold 20px -apple-system, sans-serif';
  ctx.fillText('再来一局', VW/2, 545);
}

// ===== Loop =====
let last = performance.now();
function loop(t) {
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

resize();
requestAnimationFrame(loop);
})();


// ====== 【专门对付 iOS/微信的终极全屏物理破冰】 ======
function iosAudioUnlock() {
  // 1. 如果音频环境还没创建，借用这个真·物理触摸事件立刻创建
  if (!audioCtx) {
    ensureAudio();
  }
  
  // 2. 如果已经创建了但被 iOS 挂起了 (suspended)，强行 resume 唤醒
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().then(() => {
      console.log("iOS Audio Context Unlocked via full screen touch!");
    }).catch(err => console.log(err));
  }

  // 3. 顺便把那段静音 MP3 在真正的触控栈里播一下，强行切换 iOS 媒体通道
  if (silentEl && silentEl.paused) {
    silentEl.play().catch(() => {});
  }

  // 4. 解锁成功后，立刻功成身退，移除全屏监听，绝不影响正常的摇杆操作
  window.removeEventListener('touchstart', iosAudioUnlock);
  window.removeEventListener('mousedown', iosAudioUnlock);
}

// 只要用户一碰屏幕任意地方（不管是点哪里），立刻触发解锁
window.addEventListener('touchstart', iosAudioUnlock, { passive: false });
window.addEventListener('mousedown', iosAudioUnlock);