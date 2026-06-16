/*
 * ボムレイン・ディフェンス (BOMB RAIN DEFENSE)
 * --------------------------------------------------
 * 空から降るボム兵をパチンコで撃ち落として花ばたけを守るドット絵アクション。
 *
 * ・低解像度バッファに描画し、ニアレストネイバーで拡大してドット絵風に。
 * ・操作: パチンコの玉をドラッグで引いて離すと発射。玉は貫通する。
 */

(() => {
  "use strict";

  const view = document.getElementById("game");
  const vctx = view.getContext("2d");

  // ---- 解像度: 論理(ドット)空間 W×H をSCALE倍で表示 ----
  const W = 160;
  const H = 214;

  // オフスクリーン(ドット)バッファ
  const buf = document.createElement("canvas");
  buf.width = W;
  buf.height = H;
  const ctx = buf.getContext("2d");
  vctx.imageSmoothingEnabled = false;

  // ---- UI要素 ----
  const overlay = document.getElementById("overlay");
  const gameoverScreen = document.getElementById("gameover");
  const startBtn = document.getElementById("startBtn");
  const retryBtn = document.getElementById("retryBtn");
  const finalScoreEl = document.getElementById("finalScore");
  const bestScoreEl = document.getElementById("bestScore");

  // ---- 定数(ドット空間) ----
  const GROUND_Y = H - 30;
  const ANCHOR = { x: W / 2, y: GROUND_Y - 8 }; // 地面の上に立つ高さ
  const MAX_PULL = 36;
  const LAUNCH_POWER = 0.2;
  const GRAVITY = 0.085;
  const BALL_R = 3;
  const FLOWER_COUNT = 4;
  const BEST_KEY = "bombRainBest";

  const COL = {
    black: "#1c1c1c",
    blue: "#3aa0ff",
    metal: "#9aa6bd",
    metalDk: "#5c6a85",
    gold: "#ffd23e",
    goldDk: "#b8851a",
    pink: "#ff5fa2",
    cyan: "#7ef0ff",
    orange: "#ff7a1a",
    white: "#ffffff",
    red: "#e94f4f",
  };

  // 敵の定義(アイテムなし)
  const TYPES = {
    bomb:  { hp: 1, score: 100, r: 6, color: COL.black, chute: COL.red },
    fast:  { hp: 1, score: 150, r: 5, color: COL.blue,  chute: COL.cyan },
    armor: { hp: 2, score: 300, r: 7, color: COL.metal, chute: COL.metalDk },
    gold:  { hp: 1, score: 500, r: 6, color: COL.gold,  chute: COL.white },
  };

  // ============================================================
  // 効果音 (Web Audio / アセット不要のシンセ)
  // ============================================================
  const Sound = (() => {
    let ac = null;
    function init() {
      if (!ac) {
        try {
          ac = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) { ac = null; }
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
      hit() { noise(0.18, 0.22, 1200); tone(160, 0.12, "square", 0.1, 70); },
      armor() { tone(340, 0.05, "square", 0.16, 240); tone(520, 0.05, "square", 0.1, null, 0.04); },
      gold() {
        tone(660, 0.07, "square", 0.14);
        tone(880, 0.07, "square", 0.14, null, 0.07);
        tone(1320, 0.12, "square", 0.14, null, 0.14);
      },
      flower() { noise(0.25, 0.2, 800); tone(200, 0.3, "sawtooth", 0.16, 60); },
      over() {
        tone(440, 0.2, "square", 0.16, null, 0);
        tone(330, 0.2, "square", 0.16, null, 0.2);
        tone(220, 0.45, "square", 0.16, 110, 0.4);
      },
    };
  })();

  // ---- 状態 ----
  let state = "menu";
  let score = 0;
  let best = Number(localStorage.getItem(BEST_KEY) || 0);
  let elapsed = 0;
  let spawnTimer = 0;
  let fallers = [];
  let balls = [];
  let particles = [];
  let floats = [];
  let flowers = [];
  let ballId = 1;
  let shake = 0;

  // ---- 照準 ----
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

    flowers = [];
    const margin = 24;
    const gap = (W - margin * 2) / (FLOWER_COUNT - 1);
    for (let i = 0; i < FLOWER_COUNT; i++) {
      flowers.push({ x: Math.round(margin + gap * i), alive: true });
    }
  }

  // ============================================================
  // スポーン
  // ============================================================
  function pickType() {
    const diff = Math.min(elapsed / 3600, 1);
    const r = Math.random();
    if (r < 0.08) return "gold";
    if (r < 0.08 + 0.27 * diff) return "armor";
    if (r < 0.5 + 0.2 * diff) return "fast";
    return "bomb";
  }

  function spawn() {
    const type = pickType();
    const def = TYPES[type];
    const x = 16 + Math.random() * (W - 32);
    const diff = Math.min(elapsed / 3600, 1);
    let speed = 0.28 + diff * 0.6 + Math.random() * 0.18;
    if (type === "fast") speed *= 1.7;
    if (type === "armor") speed *= 0.8;
    fallers.push({
      type, def,
      hp: def.hp,
      x, baseX: x,
      y: -12,
      vy: speed,
      r: def.r,
      sway: Math.random() * Math.PI * 2,
      swaySpeed: 0.025 + Math.random() * 0.02,
      swayAmp: (type === "gold" ? 22 : 10) + Math.random() * 8,
      fuse: Math.random() * Math.PI,
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
      x: ANCHOR.x + pull.x * 0.3,
      y: ANCHOR.y + pull.y * 0.3,
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

  // ============================================================
  // 更新
  // ============================================================
  function update() {
    if (state !== "playing") return;
    elapsed++;
    if (shake > 0) shake--;

    // スポーン
    spawnTimer--;
    const diff = Math.min(elapsed / 3600, 1);
    const interval = Math.max(28, 80 - diff * 50);
    if (spawnTimer <= 0) {
      spawn();
      spawnTimer = interval + Math.random() * 24;
    }

    // 落下物
    for (const f of fallers) {
      f.y += f.vy;
      f.sway += f.swaySpeed;
      f.x = f.baseX + Math.sin(f.sway) * f.swayAmp;
      f.x = Math.max(8, Math.min(W - 8, f.x));
      f.fuse += 0.15;

      if (f.y >= GROUND_Y) {
        // 一番近い生きた花を枯らす
        let target = null, bd = 999;
        for (const fl of flowers) {
          if (!fl.alive) continue;
          const d = Math.abs(fl.x - f.x);
          if (d < bd) { bd = d; target = fl; }
        }
        if (target && bd < 22) {
          target.alive = false;
          burst(target.x, GROUND_Y, COL.red, 20, 3);
          shake = 6;
          Sound.flower();
        }
        burst(f.x, GROUND_Y, COL.black, 10, 2);
        f.dead = true;
      }
    }
    fallers = fallers.filter((f) => !f.dead);

    // 玉(常時貫通)
    for (const ball of balls) {
      ball.vy += GRAVITY;
      ball.x += ball.vx;
      ball.y += ball.vy;

      for (const f of fallers) {
        if (f.dead || f.hitBy.has(ball.id)) continue;
        const d = Math.hypot(ball.x - f.x, ball.y - f.y);
        if (d < f.r + ball.r) {
          f.hitBy.add(ball.id);
          f.hp -= 1;
          if (f.hp <= 0) {
            f.dead = true;
            ball.kills++;
            const mult = Math.min(ball.kills, 5);
            const gained = f.def.score * mult;
            score += gained;
            addFloat(f.x, f.y, "+" + gained + (mult > 1 ? " x" + mult : ""),
              f.type === "gold" ? COL.gold : COL.white);
            burst(f.x, f.y, f.type === "gold" ? COL.gold : COL.orange, 14, 2.6);
            if (f.type === "gold") Sound.gold(); else Sound.hit();
          } else {
            burst(f.x, f.y, COL.metalDk, 6, 1.8);
            Sound.armor();
          }
        }
      }
      fallers = fallers.filter((f) => !f.dead);

      if (ball.y > H + 12 || ball.x < -12 || ball.x > W + 12) ball.dead = true;
    }
    balls = balls.filter((b) => !b.dead);

    // パーティクル
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.08;
      p.life--;
    }
    particles = particles.filter((p) => p.life > 0);

    // フロート
    for (const t of floats) {
      t.y -= 0.5;
      t.life--;
    }
    floats = floats.filter((t) => t.life > 0);

    // ゲームオーバー
    if (!flowers.some((f) => f.alive)) endGame();
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

    // 地面
    ctx.fillStyle = "#5fae34";
    ctx.fillRect(0, GROUND_Y + 4, W, H - GROUND_Y);
    ctx.fillStyle = "#7bd047";
    ctx.fillRect(0, GROUND_Y + 4, W, 3);
    ctx.fillStyle = "#3d7322";
    for (let x = 0; x < W; x += 6) {
      ctx.fillRect(x + ((x / 6) % 2), GROUND_Y + 10, 2, 2);
    }

    for (const fl of flowers) drawFlower(fl);
    for (const f of fallers) drawFaller(f);
    for (const ball of balls) drawBall(ball);
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect((p.x - p.r) | 0, (p.y - p.r) | 0, p.r * 2, p.r * 2);
    }
    ctx.globalAlpha = 1;

    drawSlingshot();

    // フロートテキスト
    ctx.font = "8px 'DotGothic16', monospace";
    ctx.textAlign = "center";
    for (const t of floats) {
      ctx.globalAlpha = Math.min(1, t.life / 24);
      pixelText(t.text, t.x | 0, t.y | 0, t.color, "#000");
    }
    ctx.globalAlpha = 1;

    ctx.restore();

    drawHUD();

    // バッファを拡大表示
    vctx.imageSmoothingEnabled = false;
    vctx.clearRect(0, 0, view.width, view.height);
    vctx.drawImage(buf, 0, 0, W, H, 0, 0, view.width, view.height);
  }

  function drawSky() {
    const bands = ["#4db4e6", "#6cc4ee", "#8ad4f2", "#aee2f3", "#d6f2e0"];
    const h = Math.ceil(GROUND_Y / bands.length);
    for (let i = 0; i < bands.length; i++) {
      ctx.fillStyle = bands[i];
      ctx.fillRect(0, i * h, W, h + 1);
    }
  }

  function drawClouds() {
    ctx.fillStyle = "rgba(255,255,255,0.9)";
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

  function drawFaller(f) {
    const x = f.x, y = f.y;
    // パラシュート
    ctx.fillStyle = f.def.chute;
    ctx.beginPath();
    ctx.arc(x, y - f.r - 9, f.r + 3, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - f.r - 2, y - f.r - 9); ctx.lineTo(x - f.r * 0.5, y - f.r);
    ctx.moveTo(x + f.r + 2, y - f.r - 9); ctx.lineTo(x + f.r * 0.5, y - f.r);
    ctx.stroke();

    // 本体(球)
    disc(x, y, f.r, f.def.color);
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.fillRect((x - f.r * 0.5) | 0, (y - f.r * 0.5) | 0, 2, 2);
    if (f.type === "armor") {
      ctx.fillStyle = f.def.chute;
      ctx.fillRect((x - 1) | 0, (y - f.r + 1) | 0, 2, 2);
      ctx.fillRect((x - f.r + 1) | 0, (y - 1) | 0, 2, 2);
      ctx.fillRect((x + f.r - 3) | 0, (y - 1) | 0, 2, 2);
      if (f.hp < f.def.hp) {
        ctx.strokeStyle = "#2b323f";
        ctx.beginPath();
        ctx.moveTo(x - 2, y - 3); ctx.lineTo(x + 1, y); ctx.lineTo(x - 1, y + 3);
        ctx.stroke();
      }
    }
    // 目
    ctx.fillStyle = "#fff";
    ctx.fillRect((x - 3) | 0, (y - 2) | 0, 2, 3);
    ctx.fillRect((x + 1) | 0, (y - 2) | 0, 2, 3);
    ctx.fillStyle = "#000";
    ctx.fillRect((x - 2) | 0, (y - 1) | 0, 1, 2);
    ctx.fillRect((x + 2) | 0, (y - 1) | 0, 1, 2);
    // 導火線・火花
    ctx.fillStyle = COL.goldDk;
    ctx.fillRect((x - 1) | 0, (y - f.r - 2) | 0, 2, 2);
    const sp = 1 + Math.sin(f.fuse);
    ctx.fillStyle = COL.gold;
    ctx.fillRect((x - 1) | 0, (y - f.r - 4 - sp) | 0, 2, 2);
  }

  function drawBall(b) {
    disc(b.x, b.y, b.r, "#161616");
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillRect((b.x - b.r * 0.4) | 0, (b.y - b.r * 0.4) | 0, 1, 1);
  }

  function drawFlower(f) {
    const x = f.x;
    if (!f.alive) {
      ctx.strokeStyle = "#4a7a26";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, GROUND_Y + 6);
      ctx.lineTo(x + 3, GROUND_Y + 1);
      ctx.stroke();
      return;
    }
    ctx.strokeStyle = "#2f8f22";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, GROUND_Y + 6);
    ctx.lineTo(x, GROUND_Y - 4);
    ctx.stroke();
    const cy = GROUND_Y - 7;
    ctx.fillStyle = COL.pink;
    ctx.fillRect(x - 4, cy - 1, 3, 3);
    ctx.fillRect(x + 2, cy - 1, 3, 3);
    ctx.fillRect(x - 1, cy - 4, 3, 3);
    ctx.fillRect(x - 1, cy + 2, 3, 3);
    ctx.fillStyle = COL.gold;
    ctx.fillRect(x - 1, cy - 1, 3, 3);
  }

  function drawSlingshot() {
    const A = ANCHOR;
    const L = { x: A.x - 6, y: A.y - 6 };
    const R = { x: A.x + 6, y: A.y - 6 };
    ctx.strokeStyle = "#7a4a22";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(A.x, A.y + 12);
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

  // 軌道予測: 背景に埋もれないよう黒縁+黄ドットで描く
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
    const alive = flowers.filter((f) => f.alive).length;
    pixelTextRight("FLOWER " + alive + "/" + FLOWER_COUNT, W - 4, 9,
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
    if (state !== "playing") return;
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
  // 状態遷移
  // ============================================================
  function startGame() {
    Sound.init();
    resetGame();
    state = "playing";
    overlay.classList.add("hidden");
    gameoverScreen.classList.add("hidden");
  }
  function endGame() {
    state = "gameover";
    Sound.over();
    if (score > best) {
      best = score;
      localStorage.setItem(BEST_KEY, String(best));
    }
    finalScoreEl.textContent = score;
    bestScoreEl.textContent = best;
    gameoverScreen.classList.remove("hidden");
  }

  startBtn.addEventListener("click", startGame);
  retryBtn.addEventListener("click", startGame);
  bestScoreEl.textContent = best;

  loop();
})();
