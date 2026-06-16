/*
 * ボムレイン・ディフェンス (BOMB RAIN DEFENSE)
 * --------------------------------------------------
 * 『スーパーマリオ64DS』のミニゲーム「ボムへいたいさくせん」に
 * 着想を得たオリジナルのドット絵アクション。
 *
 * ・低解像度バッファに描画し、ニアレストネイバーで拡大してドット絵風に。
 * ・操作: パチンコの玉をドラッグで引いて離すと発射。
 * ・ボムへいを撃ち落として花ばたけを守る。敵・アイテムは多種。
 */

(() => {
  "use strict";

  const view = document.getElementById("game");
  const vctx = view.getContext("2d");

  // ---- 解像度: 論理(ドット)空間 W×H をSCALE倍で表示 ----
  const W = 160;
  const H = 214;
  const SCALE = 3; // 160*3=480, 214*3=642

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
  const ANCHOR = { x: W / 2, y: H - 12 };
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
    green: "#3fbf3a",
    red: "#e94f4f",
  };

  // 敵・アイテム定義
  const TYPES = {
    bomb:   { kind: "enemy", hp: 1, score: 100, r: 6, color: COL.black,  chute: COL.red },
    fast:   { kind: "enemy", hp: 1, score: 150, r: 5, color: COL.blue,   chute: COL.cyan },
    armor:  { kind: "enemy", hp: 2, score: 300, r: 7, color: COL.metal,  chute: COL.metalDk },
    gold:   { kind: "enemy", hp: 1, score: 500, r: 6, color: COL.gold,   chute: COL.white },
    heart:  { kind: "item",  hp: 1, score: 50,  r: 6, color: COL.pink,   chute: COL.white },
    star:   { kind: "item",  hp: 1, score: 50,  r: 6, color: COL.gold,   chute: COL.white },
    freeze: { kind: "item",  hp: 1, score: 50,  r: 6, color: COL.cyan,   chute: COL.white },
    nuke:   { kind: "item",  hp: 1, score: 50,  r: 6, color: COL.orange, chute: COL.white },
  };

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

  // パワーアップ・演出
  let slowTimer = 0;   // フリーズ
  let bigTimer = 0;    // スター(玉強化)
  let shake = 0;       // 画面シェイク
  let flash = 0;       // 全体フラッシュ(ドカン)

  // ---- 照準 ----
  let aiming = false;
  let pull = { x: 0, y: 0 };

  // 時間のゆらぎ用シード(Math.randomの代替ではなく演出用)
  // ============================================================
  function resetGame() {
    score = 0;
    elapsed = 0;
    spawnTimer = 50;
    fallers = [];
    balls = [];
    particles = [];
    floats = [];
    slowTimer = 0;
    bigTimer = 0;
    shake = 0;
    flash = 0;
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
    // アイテムは控えめ(約12%)
    if (r < 0.04) return "heart";
    if (r < 0.07) return "star";
    if (r < 0.10) return "freeze";
    if (r < 0.12) return "nuke";
    if (r < 0.15) return "gold";
    // 難易度が上がると硬い・速い敵が増える
    if (r < 0.15 + 0.25 * diff) return "armor";
    if (r < 0.55 + 0.2 * diff) return "fast";
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
      type,
      def,
      hp: def.hp,
      x,
      baseX: x,
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
    const big = bigTimer > 0;
    balls.push({
      id: ballId++,
      x: ANCHOR.x + pull.x * 0.3,
      y: ANCHOR.y + pull.y * 0.3,
      vx: -pull.x * LAUNCH_POWER,
      vy: -pull.y * LAUNCH_POWER,
      r: big ? BALL_R + 3 : BALL_R,
      pierce: big ? 4 : 1, // 貫通できるHP量
      kills: 0,
    });
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
  // アイテム効果
  // ============================================================
  function applyItem(type, x, y) {
    if (type === "heart") {
      const dead = flowers.filter((f) => !f.alive);
      if (dead.length) {
        dead[Math.floor(Math.random() * dead.length)].alive = true;
        addFloat(x, y, "FLOWER+", COL.pink);
        burst(x, y, COL.pink, 16, 3);
      } else {
        score += 300;
        addFloat(x, y, "+300", COL.pink);
      }
    } else if (type === "star") {
      bigTimer = 360;
      addFloat(x, y, "POWER!", COL.gold);
      burst(x, y, COL.gold, 18, 3);
    } else if (type === "freeze") {
      slowTimer = 300;
      addFloat(x, y, "SLOW!", COL.cyan);
      burst(x, y, COL.cyan, 18, 3);
    } else if (type === "nuke") {
      let cleared = 0;
      for (const f of fallers) {
        if (f.def.kind === "enemy" && !f.dead) {
          burst(f.x, f.y, COL.orange, 8, 2);
          f.dead = true;
          cleared++;
        }
      }
      const gained = cleared * 100;
      score += gained;
      flash = 12;
      shake = 8;
      addFloat(W / 2, 60, "BOOM! +" + gained, COL.orange);
      burst(x, y, COL.orange, 24, 4);
    }
  }

  // ============================================================
  // 更新
  // ============================================================
  function update() {
    if (state !== "playing") return;
    elapsed++;
    if (slowTimer > 0) slowTimer--;
    if (bigTimer > 0) bigTimer--;
    if (shake > 0) shake--;
    if (flash > 0) flash--;

    const slow = slowTimer > 0 ? 0.4 : 1;

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
      f.y += f.vy * slow;
      f.sway += f.swaySpeed * slow;
      f.x = f.baseX + Math.sin(f.sway) * f.swayAmp;
      f.x = Math.max(8, Math.min(W - 8, f.x));
      f.fuse += 0.15;

      if (f.y >= GROUND_Y) {
        if (f.def.kind === "enemy") {
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
          }
          burst(f.x, GROUND_Y, COL.black, 10, 2);
        }
        f.dead = true;
      }
    }
    fallers = fallers.filter((f) => !f.dead);

    // 玉
    for (const ball of balls) {
      ball.vy += GRAVITY;
      ball.x += ball.vx;
      ball.y += ball.vy;

      for (const f of fallers) {
        if (f.dead || ball.pierce <= 0) continue;
        if (f.hitBy.has(ball.id)) continue;
        const d = Math.hypot(ball.x - f.x, ball.y - f.y);
        if (d < f.r + ball.r) {
          f.hitBy.add(ball.id);
          if (f.def.kind === "item") {
            applyItem(f.type, f.x, f.y);
            f.dead = true;
            ball.pierce -= 1;
          } else {
            f.hp -= 1;
            ball.pierce -= 1;
            if (f.hp <= 0) {
              f.dead = true;
              ball.kills++;
              const mult = Math.min(ball.kills, 5);
              const gained = f.def.score * mult;
              score += gained;
              addFloat(
                f.x, f.y,
                "+" + gained + (mult > 1 ? " x" + mult : ""),
                f.type === "gold" ? COL.gold : COL.white
              );
              burst(f.x, f.y, f.type === "gold" ? COL.gold : COL.orange, 14, 2.6);
            } else {
              // てつ甲: ひびエフェクト
              burst(f.x, f.y, COL.metalDk, 6, 1.8);
            }
          }
        }
      }
      fallers = fallers.filter((f) => !f.dead);

      if (ball.pierce <= 0) ball.dead = true;
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

    // 空(ドット風グラデを帯で)
    drawSky();
    drawClouds();

    ctx.save();
    ctx.translate(ox, oy);

    // 地面
    ctx.fillStyle = "#5fae34";
    ctx.fillRect(0, GROUND_Y + 4, W, H - GROUND_Y);
    ctx.fillStyle = "#7bd047";
    ctx.fillRect(0, GROUND_Y + 4, W, 3);
    // 土のドット
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

    // パワーアップ枠演出
    if (slowTimer > 0) frameTint("rgba(126,240,255,0.12)");
    if (flash > 0) {
      ctx.fillStyle = "rgba(255,200,120," + (flash / 12) * 0.5 + ")";
      ctx.fillRect(0, 0, W, H);
    }

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

    if (f.def.kind === "enemy") {
      // 本体(球)
      disc(x, y, f.r, f.def.color);
      // ハイライト
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.fillRect((x - f.r * 0.5) | 0, (y - f.r * 0.5) | 0, 2, 2);
      if (f.type === "armor") {
        // リベット
        ctx.fillStyle = f.def.chute;
        ctx.fillRect((x - 1) | 0, (y - f.r + 1) | 0, 2, 2);
        ctx.fillRect((x - f.r + 1) | 0, (y - 1) | 0, 2, 2);
        ctx.fillRect((x + f.r - 3) | 0, (y - 1) | 0, 2, 2);
        if (f.hp < f.def.hp) { // ひび
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
    } else {
      // アイテム
      drawItemIcon(f.type, x, y, f.r);
    }
  }

  function drawItemIcon(type, x, y, r) {
    disc(x, y, r, "rgba(0,0,0,0.15)");
    if (type === "heart") {
      ctx.fillStyle = COL.pink;
      ctx.fillRect(x - 3, y - 2, 2, 3);
      ctx.fillRect(x + 1, y - 2, 2, 3);
      ctx.fillRect(x - 3, y - 3, 6, 2);
      ctx.fillRect(x - 2, y, 4, 2);
      ctx.fillRect(x - 1, y + 2, 2, 1);
    } else if (type === "star") {
      star(x, y, r, COL.gold);
    } else if (type === "freeze") {
      ctx.fillStyle = COL.cyan;
      ctx.fillRect(x - 1, y - r, 2, r * 2);
      ctx.fillRect(x - r, y - 1, r * 2, 2);
      ctx.fillRect(x - 3, y - 3, 2, 2);
      ctx.fillRect(x + 1, y - 3, 2, 2);
      ctx.fillRect(x - 3, y + 1, 2, 2);
      ctx.fillRect(x + 1, y + 1, 2, 2);
    } else if (type === "nuke") {
      disc(x, y, r - 1, COL.orange);
      ctx.fillStyle = COL.gold;
      ctx.fillRect(x - 1, y - r + 1, 2, 2);
      ctx.fillStyle = "#000";
      ctx.fillRect(x - 2, y - 1, 4, 1);
      ctx.fillRect(x - 1, y - 2, 2, 3);
    }
  }

  function star(cx, cy, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const ang = (Math.PI / 5) * i - Math.PI / 2;
      const rad = i % 2 === 0 ? r : r * 0.45;
      const px = cx + Math.cos(ang) * rad;
      const py = cy + Math.sin(ang) * rad;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }

  function drawBall(b) {
    disc(b.x, b.y, b.r, "#161616");
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillRect((b.x - b.r * 0.4) | 0, (b.y - b.r * 0.4) | 0, 1, 1);
    if (b.pierce > 1 || b.r > BALL_R) {
      // 強化玉のオーラ
      ctx.strokeStyle = COL.gold;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r + 1, 0, Math.PI * 2);
      ctx.stroke();
    }
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
    // 茎
    ctx.strokeStyle = "#2f8f22";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, GROUND_Y + 6);
    ctx.lineTo(x, GROUND_Y - 4);
    ctx.stroke();
    // 花びら(十字+斜め)
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
    // Y字
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
      disc(px, py, bigTimer > 0 ? BALL_R + 2 : BALL_R, "#161616");
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
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    for (let i = 0; i < 50; i++) {
      vy += GRAVITY; x += vx; y += vy;
      if (i % 4 === 0) ctx.fillRect(x | 0, y | 0, 1, 1);
      if (y > H || x < 0 || x > W) break;
    }
  }

  function drawHUD() {
    ctx.font = "8px 'DotGothic16', monospace";
    ctx.textAlign = "left";
    pixelText("SCORE " + score, 4, 9, COL.white, "#000");

    // 残り花
    ctx.textAlign = "right";
    const alive = flowers.filter((f) => f.alive).length;
    pixelTextRight("FLOWER " + alive + "/" + FLOWER_COUNT, W - 4, 9,
      alive <= 1 ? COL.red : COL.white, "#000");

    // パワーアップ残量バー
    let by = 18;
    if (bigTimer > 0) { powerBar(4, by, "POWER", bigTimer / 360, COL.gold); by += 8; }
    if (slowTimer > 0) { powerBar(4, by, "SLOW", slowTimer / 300, COL.cyan); by += 8; }
  }

  function powerBar(x, y, label, ratio, color) {
    ctx.font = "7px 'DotGothic16', monospace";
    ctx.textAlign = "left";
    pixelText(label, x, y, color, "#000");
    const bx = x + 34, bw = 40;
    ctx.fillStyle = "#000";
    ctx.fillRect(bx - 1, y - 5, bw + 2, 5);
    ctx.fillStyle = color;
    ctx.fillRect(bx, y - 4, Math.max(0, bw * ratio) | 0, 3);
  }

  // 縁取り付きテキスト(ドット風)
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

  function frameTint(color) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, W, H);
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
    resetGame();
    state = "playing";
    overlay.classList.add("hidden");
    gameoverScreen.classList.add("hidden");
  }
  function endGame() {
    state = "gameover";
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
