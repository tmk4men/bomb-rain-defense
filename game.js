/*
 * ボムレイン・ディフェンス (BOMB RAIN DEFENSE)
 * --------------------------------------------------
 * 空から襲来する UFO をパチンコで撃ち落として人々を守るドット絵アクション。
 *
 * ・低解像度バッファに描画し、ニアレストネイバーで拡大してドット絵風に。
 * ・操作: パチンコの玉をドラッグで引いて離すと発射。玉は貫通する。
 */

(() => {
  "use strict";

  const view = document.getElementById("game");
  const vctx = view.getContext("2d");

  // ---- 解像度: 論理(ドット)空間 W×H。画面サイズに応じて可変(レスポンシブ) ----
  let W = 160;
  let H = 214;
  const TARGET_H = 240; // 論理の縦解像度の目安。横は画面比に合わせて変化させる

  const buf = document.createElement("canvas");
  buf.width = W;
  buf.height = H;
  const ctx = buf.getContext("2d");
  vctx.imageSmoothingEnabled = false;

  // ---- UI要素 ----
  const stage = document.getElementById("stage");
  const homeScreen = document.getElementById("home");
  const menuScreen = document.getElementById("menu");
  const gameoverScreen = document.getElementById("gameover");
  const menuBtn = document.getElementById("menuBtn");
  const startBtn = document.getElementById("startBtn");
  const retryBtn = document.getElementById("retryBtn");
  const resumeBtn = document.getElementById("resumeBtn");
  const fsBtn = document.getElementById("fsBtn");
  const homeBtn = document.getElementById("homeBtn");
  const toHomeBtn = document.getElementById("toHomeBtn");
  const finalScoreEl = document.getElementById("finalScore");
  const homeRanksEl = document.getElementById("homeRanks");
  const goRanksEl = document.getElementById("goRanks");

  // ---- 定数(ドット空間) ----
  let GROUND_Y = H - 30;
  const ANCHOR = { x: W / 2, y: GROUND_Y - 22 };
  const MAX_PULL = 36;
  const LAUNCH_POWER = 0.2;
  const GRAVITY = 0.085;
  const BALL_R = 3;
  const PEOPLE_COUNT = 4;
  const SCORE_KEY = "bombRainScores";

  const COL = {
    blue: "#3aa0ff",
    metal: "#c2cad8",
    gold: "#ffd23e",
    pink: "#ff5fa2",
    cyan: "#7ef0ff",
    white: "#ffffff",
    red: "#e94f4f",
  };

  // 敵(UFO) — ノーマルとスピードの2種
  const TYPES = {
    ufo:  { score: 100, r: 6, color: COL.metal, accent: COL.cyan },
    fast: { score: 150, r: 5, color: COL.blue,  accent: COL.white },
  };

  // ============================================================
  // ハイスコア(上位3件)
  // ============================================================
  let scores = loadScores();
  function loadScores() {
    try {
      const a = JSON.parse(localStorage.getItem(SCORE_KEY) || "[]");
      if (Array.isArray(a)) return a.filter((n) => typeof n === "number").sort((x, y) => y - x).slice(0, 3);
    } catch (e) {}
    return [];
  }
  function saveScore(s) {
    scores.push(s);
    scores.sort((a, b) => b - a);
    scores = scores.slice(0, 3);
    try { localStorage.setItem(SCORE_KEY, JSON.stringify(scores)); } catch (e) {}
  }
  function renderRanks(el, highlight) {
    if (!el) return;
    const labels = ["1ST", "2ND", "3RD"];
    let hlUsed = false;
    el.innerHTML = "";
    for (let i = 0; i < 3; i++) {
      const v = scores[i];
      const li = document.createElement("li");
      if (!hlUsed && highlight != null && v === highlight) {
        li.className = "hl";
        hlUsed = true;
      }
      li.innerHTML =
        '<span class="rk">' + labels[i] + "</span>" +
        '<span class="sc">' + (v != null ? v : "----") + "</span>";
      el.appendChild(li);
    }
  }

  // ============================================================
  // 効果音 (Web Audio)
  // ============================================================
  const Sound = (() => {
    let ac = null;
    function init() {
      if (!ac) {
        try { ac = new (window.AudioContext || window.webkitAudioContext)(); }
        catch (e) { ac = null; }
      }
      if (ac && ac.state === "suspended") ac.resume();
    }
    function tone(freq, dur, type, vol, slideTo, delay) {
      if (!ac) return;
      const t = ac.currentTime + (delay || 0);
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type || "square";
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(ac.destination);
      o.start(t); o.stop(t + dur + 0.02);
    }
    function noise(dur, vol, cutoff) {
      if (!ac) return;
      const t = ac.currentTime;
      const n = Math.floor(ac.sampleRate * dur);
      const b = ac.createBuffer(1, n, ac.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const s = ac.createBufferSource(); s.buffer = b;
      const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = cutoff || 1400;
      const g = ac.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(ac.destination);
      s.start(t); s.stop(t + dur);
    }
    return {
      init,
      shoot() { tone(680, 0.12, "square", 0.12, 220); },
      hit() { noise(0.18, 0.22, 1600); tone(420, 0.14, "square", 0.1, 120); },
      lost() { noise(0.25, 0.2, 800); tone(200, 0.3, "sawtooth", 0.16, 60); },
      over() {
        tone(440, 0.2, "square", 0.16, null, 0);
        tone(330, 0.2, "square", 0.16, null, 0.2);
        tone(220, 0.45, "square", 0.16, 110, 0.4);
      },
    };
  })();

  // ---- 状態 ----
  let state = "home"; // home | playing | gameover
  let menuOpen = false;
  let didAutoFs = false; // 起動後の最初のSTARTで一度だけ全画面
  let score = 0;
  let elapsed = 0;
  let spawnTimer = 0;
  let fallers = [];
  let balls = [];
  let particles = [];
  let floats = [];
  let people = [];
  let ballId = 1;
  let shake = 0;

  let aiming = false;
  let pull = { x: 0, y: 0 };

  // ============================================================
  function resetGame() {
    score = 0;
    elapsed = 0;
    spawnTimer = 50;
    fallers = [];
    balls = [];
    particles = [];
    floats = [];
    shake = 0;
    aiming = false;
    pull = { x: 0, y: 0 };

    people = [];
    for (let i = 0; i < PEOPLE_COUNT; i++) people.push({ x: 0, alive: true });
    reflowPeople();
  }

  // 画面サイズに応じてレイアウトを再計算(レスポンシブ)
  function reflowPeople() {
    if (!people.length) return;
    const margin = Math.round(W * 0.14);
    const span = Math.max(1, W - margin * 2);
    const gap = span / (PEOPLE_COUNT - 1);
    for (let i = 0; i < PEOPLE_COUNT; i++) people[i].x = Math.round(margin + gap * i);
  }
  function layout() {
    GROUND_Y = H - Math.round(H * 0.14);
    ANCHOR.x = W / 2;
    ANCHOR.y = GROUND_Y - Math.round(H * 0.10);
    reflowPeople();
  }
  function resize() {
    const cssW = Math.max(1, stage.clientWidth || window.innerWidth);
    const cssH = Math.max(1, stage.clientHeight || window.innerHeight);
    const scale = cssH / TARGET_H;       // CSS px / 論理px
    H = Math.max(180, Math.round(cssH / scale));
    W = Math.max(120, Math.round(cssW / scale));
    buf.width = W;
    buf.height = H;
    view.width = cssW;
    view.height = cssH;
    vctx.imageSmoothingEnabled = false;
    layout();
  }

  // ============================================================
  // スポーン
  // ============================================================
  function pickType() {
    const diff = Math.min(elapsed / 3600, 1);
    return Math.random() < 0.45 + 0.25 * diff ? "fast" : "ufo";
  }

  function spawn() {
    const type = pickType();
    const def = TYPES[type];
    const x = 16 + Math.random() * (W - 32);
    const diff = Math.min(elapsed / 3600, 1);
    let speed = 0.17 + diff * 0.4 + Math.random() * 0.11; // ゆっくりめ
    if (type === "fast") speed *= 1.6;
    fallers.push({
      type, def,
      x, baseX: x,
      y: -12,
      vy: speed,
      r: def.r,
      sway: Math.random() * Math.PI * 2,
      swaySpeed: 0.025 + Math.random() * 0.02,
      swayAmp: 12 + Math.random() * 8,
      blink: Math.random() * Math.PI,
      hitBy: new Set(),
    });
  }

  // ============================================================
  // 発射
  // ============================================================
  function fireBall() {
    const len = Math.hypot(pull.x, pull.y);
    if (len < 4) return;
    balls.push({
      id: ballId++,
      x: ANCHOR.x + pull.x, // 手放した瞬間の位置から発射
      y: ANCHOR.y + pull.y,
      vx: -pull.x * LAUNCH_POWER,
      vy: -pull.y * LAUNCH_POWER,
      r: BALL_R,
      kills: 0,
    });
    Sound.shoot();
  }

  // ============================================================
  // エフェクト
  // ============================================================
  function burst(x, y, color, n = 12, power = 2.6) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.6 + Math.random() * power;
      particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 0.5,
        life: 18 + Math.random() * 16,
        max: 34,
        r: 1 + Math.floor(Math.random() * 2),
        color,
      });
    }
  }

  function addFloat(x, y, text, color) {
    floats.push({ x, y, text, color: color || COL.white, life: 50 });
  }

  // 線分と点の最短距離 <= rad ?（スイープ当たり判定）
  function segHit(ax, ay, bx, by, cx, cy, rad) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((cx - ax) * dx + (cy - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const px = ax + t * dx, py = ay + t * dy;
    const ddx = cx - px, ddy = cy - py;
    return ddx * ddx + ddy * ddy <= rad * rad;
  }

  // ============================================================
  // 更新
  // ============================================================
  function update() {
    if (state !== "playing" || menuOpen) return;
    elapsed++;
    if (shake > 0) shake--;

    spawnTimer--;
    const diff = Math.min(elapsed / 3600, 1);
    const interval = Math.max(28, 80 - diff * 50);
    if (spawnTimer <= 0) {
      spawn();
      spawnTimer = interval + Math.random() * 24;
    }

    // UFO
    for (const f of fallers) {
      f.y += f.vy;
      f.sway += f.swaySpeed;
      f.x = f.baseX + Math.sin(f.sway) * f.swayAmp;
      f.x = Math.max(8, Math.min(W - 8, f.x));
      f.blink += 0.2;

      if (f.y >= GROUND_Y) {
        let target = null, bd = 999;
        for (const p of people) {
          if (!p.alive) continue;
          const d = Math.abs(p.x - f.x);
          if (d < bd) { bd = d; target = p; }
        }
        if (target && bd < 22) {
          target.alive = false;
          burst(target.x, GROUND_Y, COL.red, 20, 3);
          shake = 6;
          Sound.lost();
        }
        burst(f.x, GROUND_Y, f.def.accent, 10, 2);
        f.dead = true;
      }
    }
    fallers = fallers.filter((f) => !f.dead);

    // 玉(常時貫通)
    for (const ball of balls) {
      const x0 = ball.x, y0 = ball.y;
      ball.vy += GRAVITY;
      ball.x += ball.vx;
      ball.y += ball.vy;

      for (const f of fallers) {
        if (f.dead || f.hitBy.has(ball.id)) continue;
        if (segHit(x0, y0, ball.x, ball.y, f.x, f.y, f.r + ball.r)) {
          f.hitBy.add(ball.id);
          f.dead = true;
          ball.kills++;
          const mult = Math.min(ball.kills, 5);
          const gained = f.def.score * mult;
          score += gained;
          addFloat(f.x, f.y, "+" + gained + (mult > 1 ? " x" + mult : ""), COL.white);
          burst(f.x, f.y, COL.cyan, 14, 2.6);
          Sound.hit();
        }
      }
      fallers = fallers.filter((f) => !f.dead);

      if (ball.y > H + 12 || ball.x < -12 || ball.x > W + 12) ball.dead = true;
    }
    balls = balls.filter((b) => !b.dead);

    for (const p of particles) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.08; p.life--;
    }
    particles = particles.filter((p) => p.life > 0);

    for (const t of floats) { t.y -= 0.5; t.life--; }
    floats = floats.filter((t) => t.life > 0);

    if (!people.some((p) => p.alive)) endGame();
  }

  // ============================================================
  // 描画
  // ============================================================
  function draw() {
    let ox = 0, oy = 0;
    if (shake > 0) {
      ox = (Math.sin(elapsed * 2.3) * shake) | 0;
      oy = (Math.cos(elapsed * 1.9) * shake * 0.6) | 0;
    }

    drawSky();
    drawClouds();

    ctx.save();
    ctx.translate(ox, oy);

    ctx.fillStyle = "#5fae34";
    ctx.fillRect(0, GROUND_Y + 4, W, H - GROUND_Y);
    ctx.fillStyle = "#7bd047";
    ctx.fillRect(0, GROUND_Y + 4, W, 3);
    ctx.fillStyle = "#3d7322";
    for (let x = 0; x < W; x += 6) {
      ctx.fillRect(x + ((x / 6) % 2), GROUND_Y + 10, 2, 2);
    }

    for (const p of people) drawPerson(p);
    for (const f of fallers) drawUFO(f);
    for (const ball of balls) drawBall(ball);
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect((p.x - p.r) | 0, (p.y - p.r) | 0, p.r * 2, p.r * 2);
    }
    ctx.globalAlpha = 1;

    drawSlingshot();

    ctx.font = "8px 'DotGothic16', monospace";
    ctx.textAlign = "center";
    for (const t of floats) {
      ctx.globalAlpha = Math.min(1, t.life / 24);
      pixelText(t.text, t.x | 0, t.y | 0, t.color, "#000");
    }
    ctx.globalAlpha = 1;

    ctx.restore();

    if (state === "playing") drawHUD();

    vctx.imageSmoothingEnabled = false;
    vctx.clearRect(0, 0, view.width, view.height);
    vctx.drawImage(buf, 0, 0, W, H, 0, 0, view.width, view.height);
  }

  function drawSky() {
    const bands = ["#243b6b", "#33538f", "#4a72b0", "#7aa3d0", "#bfe0ef"];
    const h = Math.ceil(GROUND_Y / bands.length);
    for (let i = 0; i < bands.length; i++) {
      ctx.fillStyle = bands[i];
      ctx.fillRect(0, i * h, W, h + 1);
    }
  }

  function drawClouds() {
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    const t = elapsed * 0.08;
    const cs = [
      { x: 24, y: 26, s: 1 },
      { x: 110, y: 46, s: 1.3 },
      { x: 70, y: 16, s: 0.8 },
    ];
    for (const c of cs) {
      const cx = ((c.x + t) % (W + 50)) - 25;
      blob(cx, c.y, 8 * c.s);
      blob(cx + 8 * c.s, c.y + 2, 6 * c.s);
      blob(cx - 7 * c.s, c.y + 3, 5 * c.s);
    }
  }
  function blob(x, y, r) {
    ctx.fillRect((x - r) | 0, (y - r * 0.7) | 0, (r * 2) | 0, (r * 1.4) | 0);
    ctx.fillRect((x - r * 0.7) | 0, (y - r) | 0, (r * 1.4) | 0, (r * 2) | 0);
  }

  function disc(x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawUFO(f) {
    const x = f.x, y = f.y;
    const w = f.r * 2.0;
    // ドーム
    ctx.fillStyle = f.def.accent;
    ctx.beginPath();
    ctx.arc(x, y - 1, f.r * 0.75, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillRect((x - f.r * 0.4) | 0, (y - f.r * 0.7) | 0, 1, 1);
    // 円盤本体
    ctx.fillStyle = f.def.color;
    ctx.beginPath();
    ctx.ellipse(x, y, w, f.r * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.beginPath();
    ctx.ellipse(x, y + f.r * 0.25, w, f.r * 0.35, 0, 0, Math.PI);
    ctx.fill();
    // 底のライト(点滅)
    const on = Math.sin(f.blink) > 0;
    ctx.fillStyle = on ? COL.gold : COL.pink;
    ctx.fillRect((x - w * 0.7) | 0, (y + 1) | 0, 2, 2);
    ctx.fillStyle = on ? COL.cyan : COL.gold;
    ctx.fillRect((x - 1) | 0, (y + 2) | 0, 2, 2);
    ctx.fillStyle = on ? COL.pink : COL.cyan;
    ctx.fillRect((x + w * 0.7 - 2) | 0, (y + 1) | 0, 2, 2);
  }

  function drawBall(b) {
    disc(b.x, b.y, b.r, "#161616");
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillRect((b.x - b.r * 0.4) | 0, (b.y - b.r * 0.4) | 0, 1, 1);
  }

  function drawPerson(p) {
    const x = p.x;
    if (!p.alive) {
      ctx.fillStyle = "#9aa0a6";
      ctx.fillRect(x - 1, GROUND_Y - 5, 3, 11);
      ctx.fillRect(x - 3, GROUND_Y - 2, 7, 2);
      return;
    }
    const baseY = GROUND_Y + 6;
    ctx.fillStyle = "#2f3a6b";
    ctx.fillRect(x - 2, baseY - 4, 2, 4);
    ctx.fillRect(x + 1, baseY - 4, 2, 4);
    ctx.fillStyle = COL.red;
    ctx.fillRect(x - 3, baseY - 9, 6, 6);
    const wave = Math.sin(elapsed * 0.15 + x) > 0 ? -1 : 0;
    ctx.fillRect(x - 4, baseY - 9, 1, 4);
    ctx.fillRect(x + 3, baseY - 9 + wave, 1, 4);
    ctx.fillStyle = "#ffcf9e";
    ctx.fillRect(x - 2, baseY - 14, 5, 5);
    ctx.fillStyle = "#5a3a1a";
    ctx.fillRect(x - 2, baseY - 15, 5, 2);
    ctx.fillStyle = "#000";
    ctx.fillRect(x - 1, baseY - 12, 1, 1);
    ctx.fillRect(x + 1, baseY - 12, 1, 1);
  }

  function drawSlingshot() {
    const A = ANCHOR;
    const L = { x: A.x - 6, y: A.y - 6 };
    const R = { x: A.x + 6, y: A.y - 6 };
    ctx.strokeStyle = "#7a4a22";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(A.x, GROUND_Y + 10);
    ctx.lineTo(A.x, A.y);
    ctx.lineTo(L.x, L.y);
    ctx.moveTo(A.x, A.y);
    ctx.lineTo(R.x, R.y);
    ctx.stroke();
    ctx.lineCap = "butt";

    if (aiming) {
      const px = A.x + pull.x;
      const py = A.y + pull.y;
      ctx.strokeStyle = "#52301a";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(L.x, L.y); ctx.lineTo(px, py); ctx.lineTo(R.x, R.y);
      ctx.stroke();
      disc(px, py, BALL_R, "#161616");
      drawTrajectory(px, py);
    } else {
      ctx.strokeStyle = "#52301a";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(L.x, L.y); ctx.lineTo(R.x, R.y);
      ctx.stroke();
    }
  }

  function drawTrajectory(px, py) {
    let x = px, y = py;
    let vx = -pull.x * LAUNCH_POWER;
    let vy = -pull.y * LAUNCH_POWER;
    for (let i = 0; i < 64; i++) {
      vy += GRAVITY; x += vx; y += vy;
      if (y > H || x < 0 || x > W) break;
      if (i % 5 === 0) {
        const ix = x | 0, iy = y | 0;
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(ix - 1, iy - 1, 3, 3);
        ctx.fillStyle = COL.gold;
        ctx.fillRect(ix, iy, 1, 1);
      }
    }
  }

  function drawHUD() {
    ctx.font = "8px 'DotGothic16', monospace";
    ctx.textAlign = "left";
    pixelText("SCORE " + score, 4, 9, COL.white, "#000");
    ctx.textAlign = "right";
    const alive = people.filter((p) => p.alive).length;
    pixelTextRight("HUMAN " + alive + "/" + PEOPLE_COUNT, W - 4, 9,
      alive <= 1 ? COL.red : COL.white, "#000");
  }

  function pixelText(text, x, y, color, outline) {
    ctx.fillStyle = outline;
    ctx.fillText(text, x - 1, y);
    ctx.fillText(text, x + 1, y);
    ctx.fillText(text, x, y - 1);
    ctx.fillText(text, x, y + 1);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }
  function pixelTextRight(text, x, y, color, outline) {
    ctx.textAlign = "right";
    ctx.fillStyle = outline;
    ctx.fillText(text, x - 1, y);
    ctx.fillText(text, x + 1, y);
    ctx.fillText(text, x, y - 1);
    ctx.fillText(text, x, y + 1);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  // ============================================================
  // ループ
  // ============================================================
  function loop() {
    update();
    draw();
    requestAnimationFrame(loop);
  }

  // ============================================================
  // 入力
  // ============================================================
  function pointerPos(e) {
    const rect = view.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const cy = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
    return { x: (cx / rect.width) * W, y: (cy / rect.height) * H };
  }
  function onDown(e) {
    if (state !== "playing" || menuOpen) return;
    e.preventDefault();
    Sound.init();
    aiming = true;
    updatePull(pointerPos(e));
  }
  function onMove(e) {
    if (!aiming) return;
    e.preventDefault();
    updatePull(pointerPos(e));
  }
  function onUp(e) {
    if (!aiming) return;
    e.preventDefault();
    aiming = false;
    fireBall();
    pull = { x: 0, y: 0 };
  }
  function updatePull(p) {
    let dx = p.x - ANCHOR.x;
    let dy = p.y - ANCHOR.y;
    const len = Math.hypot(dx, dy);
    if (len > MAX_PULL) { dx = (dx / len) * MAX_PULL; dy = (dy / len) * MAX_PULL; }
    pull = { x: dx, y: dy };
  }

  view.addEventListener("mousedown", onDown);
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  view.addEventListener("touchstart", onDown, { passive: false });
  view.addEventListener("touchmove", onMove, { passive: false });
  view.addEventListener("touchend", onUp, { passive: false });

  // ============================================================
  // フルスクリーン
  // ============================================================
  function enterFullscreen() {
    const req = stage.requestFullscreen || stage.webkitRequestFullscreen;
    if (req) { try { req.call(stage); } catch (e) {} }
  }
  function toggleFullscreen() {
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (!fsEl) enterFullscreen();
    else {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) exit.call(document);
    }
  }

  // ============================================================
  // 画面遷移
  // ============================================================
  function startGame() {
    Sound.init();
    resetGame();
    state = "playing";
    menuOpen = false;
    homeScreen.classList.add("hidden");
    menuScreen.classList.add("hidden");
    gameoverScreen.classList.add("hidden");
    menuBtn.classList.remove("hidden");
    if (!didAutoFs) { didAutoFs = true; enterFullscreen(); } // 起動後の最初だけ
  }
  function goHome() {
    state = "home";
    menuOpen = false;
    menuScreen.classList.add("hidden");
    gameoverScreen.classList.add("hidden");
    menuBtn.classList.add("hidden");
    renderRanks(homeRanksEl);
    homeScreen.classList.remove("hidden");
  }
  function openMenu() {
    if (state !== "playing") return;
    menuOpen = true;
    menuScreen.classList.remove("hidden");
  }
  function closeMenu() {
    menuOpen = false;
    menuScreen.classList.add("hidden");
  }
  function endGame() {
    state = "gameover";
    Sound.over();
    saveScore(score);
    finalScoreEl.textContent = score;
    renderRanks(goRanksEl, score);
    menuBtn.classList.add("hidden");
    gameoverScreen.classList.remove("hidden");
  }

  startBtn.addEventListener("click", startGame);
  retryBtn.addEventListener("click", startGame);
  resumeBtn.addEventListener("click", closeMenu);
  homeBtn.addEventListener("click", goHome);
  toHomeBtn.addEventListener("click", goHome);
  fsBtn.addEventListener("click", toggleFullscreen);
  menuBtn.addEventListener("click", () => (menuOpen ? closeMenu() : openMenu()));

  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", resize);
  document.addEventListener("fullscreenchange", resize);
  document.addEventListener("webkitfullscreenchange", resize);

  renderRanks(homeRanksEl);
  resize();
  loop();
})();
