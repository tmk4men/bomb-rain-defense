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
  const bgm = document.getElementById("bgm");
  const bgmBtn = document.getElementById("bgmBtn");
  const shareBtn = document.getElementById("shareBtn");
  const finalScoreEl = document.getElementById("finalScore");
  const homeRanksEl = document.getElementById("homeRanks");
  const goRanksEl = document.getElementById("goRanks");
  const newBestEl = document.getElementById("newBest");

  // ---- 定数(ドット空間) ----
  let GROUND_Y = H - 30;
  const ANCHOR = { x: W / 2, y: GROUND_Y - 22 };
  const MAX_PULL_X = 64; // 左右に大きく引ける
  const MAX_PULL_Y = 46;
  const MAX_ASPECT = 1.7; // 横長になりすぎないよう論理アスペクト比を制限
  // 表示(レターボックス)用
  let dispX = 0, dispY = 0, dispW = 0, dispH = 0;
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

  // ---- 中毒性まわりの調整値 ----
  const COMBO_WINDOW = 150; // この間に撃墜しないとコンボ途切れ(約2.5秒)
  const FEVER_TIME = 360;   // フィーバー継続フレーム
  const FEVER_GAIN = 0.05;  // 1撃でフィーバーゲージ加算
  function comboMult(c) { return Math.min(1 + Math.floor(c / 3), 9); }
  function comboColor(c) {
    if (c >= 20) return "#ff5fa2";
    if (c >= 10) return "#ff7a1a";
    if (c >= 5) return "#ffd23e";
    return "#7ef0ff";
  }

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
      hit(step) { // コンボでピッチ上昇
        step = step || 0;
        noise(0.14, 0.2, 1600);
        tone(380 + step * 45, 0.12, "square", 0.12, 130 + step * 30);
      },
      milestone() { tone(880, 0.09, "square", 0.16); tone(1320, 0.12, "square", 0.16, null, 0.09); },
      fever() {
        tone(523, 0.1, "square", 0.16, null, 0);
        tone(659, 0.1, "square", 0.16, null, 0.1);
        tone(784, 0.1, "square", 0.16, null, 0.2);
        tone(1047, 0.2, "square", 0.16, null, 0.3);
      },
      best() {
        tone(659, 0.12, "square", 0.16, null, 0);
        tone(784, 0.12, "square", 0.16, null, 0.12);
        tone(1047, 0.25, "square", 0.16, null, 0.24);
      },
      lost() { noise(0.25, 0.2, 800); tone(200, 0.3, "sawtooth", 0.16, 60); },
      over() {
        tone(440, 0.2, "square", 0.16, null, 0);
        tone(330, 0.2, "square", 0.16, null, 0.2);
        tone(220, 0.45, "square", 0.16, 110, 0.4);
      },
    };
  })();

  // ============================================================
  // BGM
  // ============================================================
  const BGM_KEY = "bombRainBgm";
  let bgmOn = localStorage.getItem(BGM_KEY) !== "0";
  if (bgm) bgm.volume = 0.4;
  function updateBgmBtn() {
    if (bgmBtn) bgmBtn.textContent = "BGM: " + (bgmOn ? "ON" : "OFF");
  }
  function playBgm() {
    if (!bgm || !bgmOn) return;
    const p = bgm.play();
    if (p && p.catch) p.catch(() => {});
  }
  function toggleBgm() {
    bgmOn = !bgmOn;
    try { localStorage.setItem(BGM_KEY, bgmOn ? "1" : "0"); } catch (e) {}
    if (bgmOn) playBgm();
    else if (bgm) bgm.pause();
    updateBgmBtn();
  }

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
  let nightFactor = 0; // 0=昼, 1=夜（難易度で上昇）
  let skyFactor = 0;   // 実際に描画に使う係数（ホームは常に1）
  // 中毒性まわり
  let combo = 0, comboTimer = 0, comboPop = 0;
  let feverGauge = 0, fever = false, feverTime = 0;
  let hitStop = 0, alarm = 0, dangerActive = false;
  let milestone = { text: "", life: 0 };
  let isNewBest = false;

  let aiming = false;
  let pull = { x: 0, y: 0 };

  // ---- ホーム画面の背景演出 ----
  const reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  let tick = 0; // 状態に関わらず毎フレーム進むアニメ用カウンタ
  const stars = [];
  const homeUfos = [];
  function initHomeDecor() {
    stars.length = 0;
    for (let i = 0; i < 60; i++) {
      stars.push({
        nx: Math.random(),
        ny: Math.random() * 0.82,
        ph: Math.random() * Math.PI * 2,
        s: Math.random() < 0.25 ? 2 : 1,
      });
    }
    homeUfos.length = 0;
    const defs = [
      { def: TYPES.ufo, r: 8, ny: 0.20, speed: 0.10, start: 0.10 },
      { def: TYPES.fast, r: 6, ny: 0.36, speed: 0.16, start: 0.50 },
      { def: TYPES.ufo, r: 7, ny: 0.14, speed: 0.07, start: 0.82 },
    ];
    for (const d of defs) homeUfos.push({ def: d.def, r: d.r, ny: d.ny, speed: d.speed, start: d.start, x: 0, y: 0, blink: 0 });
  }

  // ============================================================
  function resetGame() {
    score = 0;
    elapsed = 0;
    nightFactor = 0;
    combo = 0; comboTimer = 0; comboPop = 0;
    feverGauge = 0; fever = false; feverTime = 0;
    hitStop = 0; alarm = 0; dangerActive = false;
    milestone = { text: "", life: 0 };
    isNewBest = false;
    spawnTimer = 90; // 開始直後は少し待ってから
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
    let w = Math.round(cssW / scale);
    w = Math.min(w, Math.round(H * MAX_ASPECT)); // 横長すぎを制限
    W = Math.max(120, w);
    buf.width = W;
    buf.height = H;
    view.width = cssW;
    view.height = cssH;
    vctx.imageSmoothingEnabled = false;
    // アスペクト維持のレターボックス
    const sc = Math.min(view.width / W, view.height / H);
    dispW = Math.round(W * sc);
    dispH = Math.round(H * sc);
    dispX = Math.floor((view.width - dispW) / 2);
    dispY = Math.floor((view.height - dispH) / 2);
    layout();
  }

  // ============================================================
  // スポーン
  // ============================================================
  // 難易度: 約120秒かけて少しずつ最大へ
  function difficulty() {
    return Math.min(elapsed / 7200, 1);
  }

  function pickType() {
    return Math.random() < 0.30 + 0.30 * difficulty() ? "fast" : "ufo";
  }

  function spawn() {
    const type = pickType();
    const def = TYPES[type];
    const x = 16 + Math.random() * (W - 32);
    const diff = difficulty();
    let speed = 0.15 + diff * 0.4 + Math.random() * 0.09; // 序盤はゆっくり
    if (type === "fast") speed *= 1.55;
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

  function setMilestone(t) { milestone = { text: t, life: 64 }; }
  function checkMilestone(c) {
    const m = { 5: "NICE!", 10: "GREAT!", 20: "AWESOME!", 30: "INSANE!", 50: "GODLIKE!" };
    if (m[c]) { setMilestone(m[c]); Sound.milestone(); }
  }
  function startFever() {
    fever = true; feverTime = FEVER_TIME; feverGauge = 1;
    setMilestone("FEVER!!"); shake = Math.max(shake, 6); Sound.fever();
  }

  // UFO撃墜時の処理（コンボ/フィーバー/手応え）
  function onKill(f) {
    combo++;
    comboTimer = COMBO_WINDOW;
    comboPop = 1;
    const mult = comboMult(combo);
    const fm = fever ? 2 : 1;
    const gained = f.def.score * mult * fm;
    score += gained;
    addFloat(f.x, f.y, "+" + gained, fever ? COL.gold : COL.white);
    burst(f.x, f.y, fever ? COL.gold : COL.cyan, fever ? 20 : 14, 2.6 + mult * 0.2);
    hitStop = 2; // 一瞬停止
    shake = Math.max(shake, Math.min(2 + mult * 0.6, 7));
    Sound.hit(Math.min(combo, 12));
    if (!fever) { feverGauge += FEVER_GAIN; if (feverGauge >= 1) startFever(); }
    checkMilestone(combo);
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
    if (hitStop > 0) { hitStop--; return; } // 命中時の一瞬停止(手応え)
    elapsed++;
    if (shake > 0) shake--;
    if (comboPop > 0) comboPop -= 0.08;
    if (alarm > 0) alarm--;
    if (milestone.life > 0) milestone.life--;
    nightFactor = difficulty(); // 難易度に合わせて夜へ

    // コンボ持続
    if (comboTimer > 0) { comboTimer--; if (comboTimer === 0) combo = 0; }
    // フィーバー
    if (fever) { feverTime--; if (feverTime <= 0) { fever = false; feverGauge = 0; } }
    else if (feverGauge > 0) feverGauge = Math.max(0, feverGauge - 0.0015);

    spawnTimer--;
    const diff = difficulty();
    const interval = Math.max(34, 120 - diff * 86); // 序盤は間隔広め→徐々に短く
    if (spawnTimer <= 0) {
      spawn();
      spawnTimer = interval + Math.random() * 26;
    }

    // UFO
    dangerActive = false;
    for (const f of fallers) {
      f.y += f.vy;
      f.sway += f.swaySpeed;
      f.x = f.baseX + Math.sin(f.sway) * f.swayAmp;
      f.x = Math.max(8, Math.min(W - 8, f.x));
      f.blink += 0.2;

      // 地上に迫ったら危険演出
      if (f.y > GROUND_Y - 30) dangerActive = true;

      if (f.y >= GROUND_Y) {
        let target = null, bd = 999;
        for (const p of people) {
          if (!p.alive) continue;
          const d = Math.abs(p.x - f.x);
          if (d < bd) { bd = d; target = p; }
        }
        if (target && bd < 22) {
          target.alive = false;
          burst(target.x, GROUND_Y, COL.red, 22, 3.4);
          shake = 7;
          alarm = 22;
          combo = 0; comboTimer = 0; // 被弾でコンボ途切れ
          feverGauge = Math.max(0, feverGauge - 0.34);
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
          onKill(f);
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
    tick++;
    const home = state === "home";
    skyFactor = home ? 1 : nightFactor; // 難易度で昼→夜

    let ox = 0, oy = 0;
    if (shake > 0) {
      ox = (Math.sin(elapsed * 2.3) * shake) | 0;
      oy = (Math.cos(elapsed * 1.9) * shake * 0.6) | 0;
    }

    drawSky(skyFactor);
    drawClouds();
    if (skyFactor > 0.04) drawStarsMoon(skyFactor);

    ctx.save();
    ctx.translate(ox, oy);

    ctx.fillStyle = lerpColor("#5fae34", "#34532b", skyFactor);
    ctx.fillRect(0, GROUND_Y + 4, W, H - GROUND_Y);
    ctx.fillStyle = lerpColor("#7bd047", "#4a7a38", skyFactor);
    ctx.fillRect(0, GROUND_Y + 4, W, 3);
    ctx.fillStyle = "#2c5a1c";
    for (let x = 0; x < W; x += 6) {
      ctx.fillRect(x + ((x / 6) % 2), GROUND_Y + 10, 2, 2);
    }

    if (home) {
      drawHomeUfos();
      drawDecorPeople();
    } else {
      for (const p of people) drawPerson(p);
      for (const f of fallers) drawUFO(f);
    }
    for (const ball of balls) drawBall(ball);
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect((p.x - p.r) | 0, (p.y - p.r) | 0, p.r * 2, p.r * 2);
    }
    ctx.globalAlpha = 1;

    drawSlingshot();
    ctx.restore();

    // バッファ(ドット絵)を拡大表示
    vctx.imageSmoothingEnabled = false;
    vctx.fillStyle = "#000";
    vctx.fillRect(0, 0, view.width, view.height);
    vctx.drawImage(buf, 0, 0, W, H, dispX, dispY, dispW, dispH);

    // 文字は高解像度(表示キャンバス)に直接描いて読みやすく
    if (state === "playing") drawEffectsView();
    drawFloatsView();
    if (state === "playing") drawHUDView();
  }

  // コンボ/フィーバー/危険などの演出(高解像度)
  function drawEffectsView() {
    const cw = view.width, ch = view.height;

    // 危険/被弾ビネット(赤い縁)
    const dlevel = Math.max(alarm / 22, dangerActive ? 0.5 : 0);
    if (dlevel > 0.01) {
      const pulse = reduceMotion ? 0.8 : 0.6 + 0.4 * Math.sin(tick * 0.4);
      const a = (alarm > 0 ? 0.55 : 0.3) * dlevel * pulse;
      const t = Math.max(8, Math.round(ch * 0.035));
      vctx.fillStyle = "rgba(233,79,79," + a.toFixed(2) + ")";
      vctx.fillRect(0, 0, cw, t);
      vctx.fillRect(0, ch - t, cw, t);
      vctx.fillRect(0, 0, t, ch);
      vctx.fillRect(cw - t, 0, t, ch);
    }

    // フィーバー全体タント
    if (fever) {
      const a = reduceMotion ? 0.1 : 0.08 + 0.05 * Math.sin(tick * 0.3);
      vctx.fillStyle = "rgba(255,210,62," + a.toFixed(2) + ")";
      vctx.fillRect(0, 0, cw, ch);
      const fs = Math.max(18, Math.round(ch * 0.05));
      vctx.font = "700 " + fs + "px 'DotGothic16',sans-serif";
      vctx.textAlign = "center"; vctx.textBaseline = "top";
      viewText("FEVER!! x2", cw / 2, ch * 0.05, "#ffd23e", fs);
    }

    // コンボ表示
    const mult = comboMult(combo);
    if (combo >= 2) {
      const fs = Math.max(22, Math.round(ch * 0.058));
      const pop = 1 + Math.max(0, comboPop) * 0.5;
      vctx.save();
      vctx.translate(cw / 2, ch * 0.2);
      vctx.scale(pop, pop);
      vctx.textAlign = "center"; vctx.textBaseline = "middle";
      vctx.font = "700 " + fs + "px 'DotGothic16',sans-serif";
      viewText("x" + mult, 0, 0, fever ? "#ffd23e" : comboColor(combo), fs);
      const fs2 = Math.round(fs * 0.42);
      vctx.font = "700 " + fs2 + "px 'DotGothic16',sans-serif";
      viewText(combo + " COMBO", 0, fs * 0.72, "#ffffff", fs2);
      vctx.restore();
    }

    // マイルストーン
    if (milestone.life > 0) {
      const fs = Math.max(22, Math.round(ch * 0.07));
      vctx.font = "700 " + fs + "px 'DotGothic16',sans-serif";
      vctx.textAlign = "center"; vctx.textBaseline = "middle";
      vctx.globalAlpha = Math.min(1, milestone.life / 20);
      viewText(milestone.text, cw / 2, ch * 0.36, "#ffd23e", fs);
      vctx.globalAlpha = 1;
    }

    // フィーバーゲージ(非フィーバー時、HUDの下)
    if (!fever && feverGauge > 0.02) {
      const m = Math.round(ch * 0.012) + 6;
      const fsH = Math.max(13, Math.round(ch * 0.026));
      const bx = dispX + m, by = dispY + m + fsH * 2 + 16;
      const bw = Math.round(cw * 0.3), bh = Math.max(6, Math.round(ch * 0.013));
      vctx.fillStyle = "rgba(0,0,0,0.5)";
      vctx.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
      vctx.fillStyle = "#7ef0ff";
      vctx.fillRect(bx, by, Math.round(bw * feverGauge), bh);
    }
  }

  // 表示キャンバス用の縁取りテキスト
  function viewText(text, x, y, color, fs) {
    vctx.lineJoin = "round";
    vctx.lineWidth = Math.max(2, fs * 0.2);
    vctx.strokeStyle = "rgba(0,0,0,0.9)";
    vctx.strokeText(text, x, y);
    vctx.fillStyle = color;
    vctx.fillText(text, x, y);
  }

  function drawHUDView() {
    const fs = Math.max(13, Math.round(view.height * 0.026));
    vctx.font = "700 " + fs + "px 'DotGothic16','Hiragino Kaku Gothic ProN',sans-serif";
    vctx.textBaseline = "top";
    vctx.textAlign = "left";
    const alive = people.filter((p) => p.alive).length;
    const s1 = "SCORE " + score;
    const s2 = "HUMAN " + alive + "/" + PEOPLE_COUNT;
    const m = Math.round(view.height * 0.012) + 6;
    const x = dispX + m;
    const y = dispY + m;
    const w = Math.max(vctx.measureText(s1).width, vctx.measureText(s2).width);
    vctx.fillStyle = "rgba(0,0,0,0.45)";
    vctx.fillRect(x - 5, y - 4, w + 12, fs * 2 + 14);
    viewText(s1, x, y, "#ffffff", fs);
    viewText(s2, x, y + fs + 6, alive <= 1 ? "#ff6a5a" : "#ffffff", fs);
  }

  function drawFloatsView() {
    if (!floats.length) return;
    const fs = Math.max(12, Math.round(view.height * 0.026));
    vctx.font = "700 " + fs + "px 'DotGothic16','Hiragino Kaku Gothic ProN',sans-serif";
    vctx.textBaseline = "alphabetic";
    vctx.textAlign = "center";
    for (const t of floats) {
      const vx = dispX + (t.x / W) * dispW;
      const vy = dispY + (t.y / H) * dispH;
      vctx.globalAlpha = Math.min(1, t.life / 24);
      viewText(t.text, vx, vy, t.color, fs);
    }
    vctx.globalAlpha = 1;
  }

  // 昼(day)→夜(night)を係数fで補間
  const DAY_BANDS = ["#243b6b", "#33538f", "#4a72b0", "#7aa3d0", "#bfe0ef"];
  const NIGHT_BANDS = ["#0a1430", "#11214a", "#1c3160", "#27406e", "#34527f"];
  function drawSky(f) {
    const h = Math.ceil(GROUND_Y / DAY_BANDS.length);
    for (let i = 0; i < DAY_BANDS.length; i++) {
      ctx.fillStyle = lerpColor(DAY_BANDS[i], NIGHT_BANDS[i], f);
      ctx.fillRect(0, i * h, W, h + 1);
    }
  }

  // 星と月（fが大きいほどはっきり見える）
  function drawStarsMoon(f) {
    for (const s of stars) {
      const tw = reduceMotion ? 0.8 : 0.45 + 0.55 * Math.sin(tick * 0.05 + s.ph);
      ctx.globalAlpha = Math.max(0.15, tw) * f;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect((s.nx * W) | 0, (s.ny * GROUND_Y) | 0, s.s, s.s);
    }
    ctx.globalAlpha = f;
    const mx = (W * 0.82) | 0, my = (GROUND_Y * 0.2) | 0, mr = Math.max(7, (H * 0.05) | 0);
    disc(mx, my, mr, "#f3eeb6");
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    ctx.fillRect(mx - 2, my - 1, 2, 2);
    ctx.fillRect(mx + 1, my + 2, 2, 2);
    ctx.fillRect(mx - 3, my + 2, 1, 1);
    ctx.globalAlpha = 1;
  }

  // ホーム背景: 漂うUFO(ビーム付き)
  function drawHomeUfos() {
    const range = W + 80;
    const tk = reduceMotion ? 0 : tick;
    for (const u of homeUfos) {
      u.x = ((u.start * range + tk * u.speed) % range) - 40;
      u.y = u.ny * GROUND_Y;
      u.blink = reduceMotion ? 1 : tick * 0.2;
      const w = u.r * 2.0;
      ctx.fillStyle = "rgba(126,240,255,0.12)";
      ctx.beginPath();
      ctx.moveTo(u.x - w * 0.5, u.y);
      ctx.lineTo(u.x + w * 0.5, u.y);
      ctx.lineTo(u.x + w * 1.1, GROUND_Y + 4);
      ctx.lineTo(u.x - w * 1.1, GROUND_Y + 4);
      ctx.closePath();
      ctx.fill();
      drawUFO(u);
    }
  }

  // ホーム背景: 手を振る人々
  function drawDecorPeople() {
    const margin = Math.round(W * 0.14);
    const span = Math.max(1, W - margin * 2);
    const gap = span / (PEOPLE_COUNT - 1);
    for (let i = 0; i < PEOPLE_COUNT; i++) {
      drawPerson({ x: Math.round(margin + gap * i), alive: true });
    }
  }

  function drawClouds() {
    const a = 0.85 * (1 - skyFactor * 0.7); // 夜は雲を薄く
    if (a <= 0.02) return;
    ctx.fillStyle = "rgba(255,255,255," + a.toFixed(2) + ")";
    const t = (reduceMotion ? 0 : tick) * 0.08;
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

  // 2色を t(0..1) で線形補間
  function lerpColor(a, b, t) {
    const ah = parseInt(a.slice(1), 16), bh = parseInt(b.slice(1), 16);
    const ar = (ah >> 16) & 255, ag = (ah >> 8) & 255, ab = ah & 255;
    const br = (bh >> 16) & 255, bg = (bh >> 8) & 255, bb = bh & 255;
    const r = Math.round(ar + (br - ar) * t);
    const g = Math.round(ag + (bg - ag) * t);
    const bl = Math.round(ab + (bb - ab) * t);
    return "rgb(" + r + "," + g + "," + bl + ")";
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
    const wave = Math.sin(tick * 0.15 + x) > 0 ? -1 : 0;
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
    // CSS表示サイズ→backing(=cssと同じ)→レターボックス補正→論理座標
    const sx = view.width / rect.width;
    const sy = view.height / rect.height;
    const cx = ((e.touches ? e.touches[0].clientX : e.clientX) - rect.left) * sx;
    const cy = ((e.touches ? e.touches[0].clientY : e.clientY) - rect.top) * sy;
    return {
      x: (cx - dispX) / Math.max(1, dispW) * W,
      y: (cy - dispY) / Math.max(1, dispH) * H,
    };
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
    // 左右と上下で別々に制限(横に大きく引ける)
    dx = Math.max(-MAX_PULL_X, Math.min(MAX_PULL_X, dx));
    dy = Math.max(-MAX_PULL_Y, Math.min(MAX_PULL_Y, dy));
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
    playBgm();
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
    menuBtn.classList.remove("hidden"); // ホームでもメニューを出す
    renderRanks(homeRanksEl);
    homeScreen.classList.remove("hidden");
  }
  function openMenu() {
    if (state === "gameover") return;
    menuOpen = true;
    if (homeBtn) homeBtn.style.display = state === "playing" ? "" : "none"; // ホームでは「ホームへ」を隠す
    menuScreen.classList.remove("hidden");
    menuBtn.setAttribute("aria-expanded", "true");
  }
  function closeMenu() {
    menuOpen = false;
    menuScreen.classList.add("hidden");
    menuBtn.setAttribute("aria-expanded", "false");
  }
  function endGame() {
    state = "gameover";
    const prevBest = scores[0] || 0;
    saveScore(score);
    isNewBest = score > 0 && score > prevBest;
    if (isNewBest) Sound.best(); else Sound.over();
    finalScoreEl.textContent = score;
    renderRanks(goRanksEl, score);
    if (newBestEl) newBestEl.classList.toggle("hidden", !isNewBest);
    menuBtn.classList.add("hidden");
    gameoverScreen.classList.remove("hidden");
  }

  // スコア共有(URLは含めない)
  function shareScore() {
    const text = "UFOスマッシュ！でスコア " + score + "点を出した！🛸";
    if (navigator.share) {
      navigator.share({ text }).catch(() => {});
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        if (!shareBtn) return;
        const o = shareBtn.textContent;
        shareBtn.textContent = "コピーしました！";
        setTimeout(() => { shareBtn.textContent = o; }, 1400);
      }).catch(() => fallbackShare(text));
    } else {
      fallbackShare(text);
    }
  }
  function fallbackShare(text) {
    try { window.prompt("コピーしてシェアしてね", text); } catch (e) {}
  }

  startBtn.addEventListener("click", startGame);
  retryBtn.addEventListener("click", startGame);
  if (shareBtn) shareBtn.addEventListener("click", shareScore);
  resumeBtn.addEventListener("click", closeMenu);
  homeBtn.addEventListener("click", goHome);
  toHomeBtn.addEventListener("click", goHome);
  fsBtn.addEventListener("click", toggleFullscreen);
  menuBtn.addEventListener("click", () => (menuOpen ? closeMenu() : openMenu()));
  if (bgmBtn) bgmBtn.addEventListener("click", toggleBgm);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && menuOpen) closeMenu(); });

  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", resize);
  document.addEventListener("fullscreenchange", resize);
  document.addEventListener("webkitfullscreenchange", resize);

  updateBgmBtn();
  renderRanks(homeRanksEl);
  initHomeDecor();
  resize();
  loop();
})();
