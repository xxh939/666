/* =========================================================================
 * 羽毛球 1V1 对战 —— 手机端网页小游戏(完整版)
 * - 超大场景 1500x860, 慢速飘球, 全屏背景延伸(黑边融入天空/场地)
 * - 虚拟摇杆移动(左下区域按住拖动), 电脑键盘也可操作
 * - 全游戏蓄力系统: 按住「挥拍」蓄力, 松开击球; 蓄力越久球越高越远
 *   (蓄力条: 白=近, 绿=中, 红=远); 发球也是按住挥拍蓄力松开发球
 * - 一键杀球(红「杀」按钮/S键): 自动起跳+满力重扣
 * - 赛前叫阵: 你的头像摇头晃脑嘲讽 AI
 * - 神龙之力: 你到 10 分时 AI 进化(金色光柱+属性暴涨)
 * - 输了结算: 你的大头像放大 + AI 摇头晃脑嘲讽
 * - 龙领先时头顶变怒气头像; 内置背景音乐; 手机强制横屏
 * 技术: HTML5 Canvas + JavaScript (无后端, 单文件)
 * ========================================================================= */
'use strict';

/* ---------------------------- 1. 工具函数 ---------------------------- */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const easeOut = t => 1 - (1 - t) * (1 - t);

/* 点到线段距离 */
function segPointDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / l2;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
}

/* 圆角矩形路径 */
function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/* ---------------------------- 2. 游戏配置 ---------------------------- */
const GAME_W = 1500;                 // 设计宽度
const GAME_H = 860;                  // 设计高度
const FONT = '"PingFang SC","Microsoft YaHei",sans-serif';

const CFG = {
  gravity: 2200,        // 羽毛球重力加速度 px/s^2(慢速飘球)
  charGravity: 2400,    // 角色跳跃重力加速度 px/s^2
  dragX: 0.55,           // 羽毛球水平空气阻力系数
  dragY: 0.30,          // 羽毛球垂直空气阻力系数
  groundFrac: 0.74,     // 地面所在高度比例
  netH: 260,            // 球网高度
  boundL: 70,           // 左侧底线
  boundR: 1430,         // 右侧底线
  shortServe: 220,      // 发球线离网距离
  winScore: 11,         // 先得 11 分获胜
  charH: 190,           // 火柴人身高
  headR: 27,            // 头部半径
  walkSpeed: 430,       // 玩家移动速度
  jumpVy: -1010,        // 跳跃初速度(向上)
  swingTime: 0.34,      // 挥拍持续时间(秒)
  swingRecover: 0.18,   // 挥拍回摆时间(秒)
  maxCharge: 1.0,       // 蓄力满值(秒)
  hitRadius: 88,        // 球拍击球判定半径
  smashRadius: 135,     // 杀球模式判定半径
  racketLen: 95,        // 球拍长度
  serveL: 340,          // 左侧发球位置
  serveR: 1160,         // 右侧发球位置
  readyL: 380,          // 左方接发球准备位
  readyR: 1120,         // 右方接发球准备位
  serveChoiceTime: 4.0, // 玩家蓄力发球的最长等待时间(秒)
  aiServeTime: 1.1,     // AI 发球准备时间(秒)
};

/* AI 难度参数(会被克隆, 神龙进化时倍率提升) */
const DIFFS = {
  easy:   { label: '简单', speed: 340, react: 0.26, err: 55, swingW: 70,  miss: 0.18 },
  normal: { label: '普通', speed: 395, react: 0.19, err: 40, swingW: 90,  miss: 0.08 },
  hard:   { label: '困难', speed: 470, react: 0.10, err: 18, swingW: 120, miss: 0.02 },
};
/* ---------------------------- 3. 音效 + 背景音乐 ---------------------------- */
class AudioFX {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.bgmOn = false;
    this.bgmGain = null;
    this.bgmTimer = null;
    this.bpm = 112;
    this.eighth = 60 / 112 / 2;
    this.nextT = 0;
    this.step = 0;
  }
  init() {
    if (this.ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    } catch (e) { this.ctx = null; }
    this.setupBgm();
  }
  beep(f0, f1, dur, type, vol, delay) {
    if (!this.enabled || !this.ctx) return;
    try {
      const t0 = this.ctx.currentTime + (delay || 0);
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type || 'triangle';
      o.frequency.setValueAtTime(f0, t0);
      if (f1) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
      g.gain.setValueAtTime(vol || 0.12, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g);
      g.connect(this.ctx.destination);
      o.start(t0);
      o.stop(t0 + dur + 0.03);
    } catch (e) { /* 忽略音频错误 */ }
  }
  /* 背景音乐: 内置合成的一段轻快原创小循环(C大调) */
  setupBgm() {
    if (!this.ctx || this.bgmOn) return;
    this.bgmOn = true;
    this.bgmGain = this.ctx.createGain();
    this.bgmGain.gain.value = 0.5;
    this.bgmGain.connect(this.ctx.destination);
    this.nextT = this.ctx.currentTime + 0.15;
    this.step = 0;
    const self = this;
    this.bgmTimer = setInterval(function () { self.scheduleBgm(); }, 60);
  }
  setBgmMuted(muted) {
    if (this.ctx && this.bgmGain) {
      this.bgmGain.gain.setValueAtTime(muted ? 0 : 0.5, this.ctx.currentTime);
    }
  }
  scheduleBgm() {
    if (!this.ctx || !this.bgmGain) return;
    if (!this.enabled) return;
    while (this.nextT < this.ctx.currentTime + 0.35) {
      this.playStep(this.step, this.nextT);
      this.nextT += this.eighth;
      this.step = (this.step + 1) % 64;
    }
  }
  playStep(step, t) {
    const bar = ((step / 8) | 0) % 4;   // 4 个和弦循环两遍, 共 8 小节
    const i = step % 8;
    const roots = [48, 43, 45, 41];
    const chords = [[48, 52, 55], [43, 47, 50], [45, 48, 52], [41, 45, 48]];
    const melody = [
      76, 79, 84, 79, 76, 79, 76, 74,
      72, 76, 79, 76, 72, 74, 76, 79,
      74, 79, 83, 79, 74, 76, 74, 71,
      74, 79, 83, 86, 83, 79, 74, 71,
      72, 76, 81, 76, 72, 74, 76, 81,
      72, 76, 81, 84, 81, 76, 72, 69,
      72, 77, 81, 77, 72, 76, 77, 81,
      72, 77, 81, 84, 81, 79, 77, 76,
    ];
    if (i === 0) {
      for (let k = 0; k < 3; k++) this.note(chords[bar][k], t, this.eighth * 7.8, 'triangle', 0.025, this.bgmGain);
    }
    if (i === 0 || i === 4) {
      const bn = roots[bar] + (i >= 4 ? 12 : 0);
      this.note(bn, t, this.eighth * 1.9, 'sine', 0.10, this.bgmGain);
    }
    const mn = melody[step];
    if (mn) this.note(mn, t, this.eighth * 1.8, 'triangle', 0.05, this.bgmGain);
  }
  note(midi, t, dur, type, vol, dest) {
    if (!this.ctx || !dest) return;
    try {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(440 * Math.pow(2, (midi - 69) / 12), t);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(dest);
      o.start(t);
      o.stop(t + dur + 0.02);
    } catch (e) { /* 忽略 */ }
  }
  hit()   { this.beep(330, 150, 0.09, 'square', 0.10); }
  laugh() {
    /* 嘲讽大笑: 哈!哈!哈! */
    for (let i = 0; i < 6; i++) {
      this.beep(540 - i * 45, 300, 0.1, 'square', 0.12, i * 0.1);
    }
  }
  smashHit() { this.beep(240, 90, 0.16, 'square', 0.15); }
  jump()  { this.beep(200, 340, 0.10, 'sine', 0.05); }
  net()   { this.beep(160, 120, 0.12, 'sine', 0.10); }
  score() { this.beep(523, 523, 0.12, 'triangle', 0.14); this.beep(784, 784, 0.18, 'triangle', 0.14, 0.10); }
  win()   { [523, 659, 784, 1047].forEach((f, i) => this.beep(f, f, 0.16, 'triangle', 0.14, i * 0.13)); }
  lose()  { this.beep(392, 196, 0.5, 'sawtooth', 0.08); }
  dragon() {
    this.beep(90, 420, 0.7, 'sawtooth', 0.16);
    [440, 554, 659, 880].forEach((f, i) => this.beep(f, f, 0.22, 'triangle', 0.12, 0.45 + i * 0.14));
  }
}

/* ---------------------------- 4. 粒子特效 ---------------------------- */
class Particles {
  constructor() { this.list = []; }
  emit(x, y, dir, n, color) {
    for (let i = 0; i < n; i++) {
      this.list.push({
        x: x, y: y,
        vx: rand(-70, 70) + dir * rand(60, 220),
        vy: rand(-280, -60),
        t: rand(0.3, 0.6),
        r: rand(2, 5.5),
        color: color || 'rgba(255,255,255,0.95)',
      });
    }
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += 620 * dt;
      p.t -= dt;
      if (p.t <= 0) this.list.splice(i, 1);
    }
  }
  draw(ctx) {
    for (const p of this.list) {
      ctx.globalAlpha = Math.max(0, p.t / 0.6);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
/* ---------------------------- 5. 羽毛球 ---------------------------- */
class Shuttle {
  constructor(x, y, vx, vy, owner) {
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.owner = owner;
    this.grounded = false;
    this.cooldown = 0;
    this.prevX = x; this.prevY = y;
    this.trail = [];
  }
  groundY() { return GAME_H * CFG.groundFrac; }
  update(dt) {
    this.prevX = this.x; this.prevY = this.y;
    this.trail.push({ x: this.x, y: this.y, t: 1 });
    if (this.trail.length > 14) this.trail.shift();
    for (const p of this.trail) p.t -= dt * 3;
    this.vx *= Math.exp(-CFG.dragX * dt);
    this.vy *= Math.exp(-CFG.dragY * dt);
    this.vy += CFG.gravity * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (this.y >= this.groundY()) { this.y = this.groundY(); this.grounded = true; }
  }
  predict(maxT) {
    maxT = maxT || 3.2;
    let x = this.x, y = this.y, vx = this.vx, vy = this.vy;
    const gy = this.groundY(), dt = 1 / 120;
    for (let t = 0; t < maxT; t += dt) {
      vx *= Math.exp(-CFG.dragX * dt);
      vy *= Math.exp(-CFG.dragY * dt);
      vy += CFG.gravity * dt;
      x += vx * dt; y += vy * dt;
      if (y >= gy) return { x: x, t: t, grounded: true, out: (x < CFG.boundL || x > CFG.boundR) };
      if (x < CFG.boundL - 40 || x > CFG.boundR + 40) return { x: x, t: t, grounded: false, out: true };
    }
    return { x: x, t: maxT, grounded: false, out: false };
  }
}

/* ---------------------------- 6. 火柴人角色 ---------------------------- */
class Character {
  constructor(side, opt) {
    this.side = side;
    this.dir = side === 'left' ? 1 : -1;
    this.x = side === 'left' ? CFG.readyL : CFG.readyR;
    this.vx = 0;
    this.oy = 0;        // 离地高度(向上为正)
    this.vy = 0;        // 竖直速度(向下为正)
    this.grounded = true;
    this.swingT = 0;
    this.seg = null;
    this.prevRack = null;
    this.walkPhase = 0;
    this.smashMode = 0;
    this.smashCd = 0;
    this.recoverT = 0;
    this.landT = 0;
    this.rackTrail = [];
    this.chargeT = 0;       // 当前蓄力时间
    this.swingPower = 0.5;  // 本次挥拍力度(0~1)
    this.pendingPower = null; // 蓄力后待消费力度(发球用)
    this.tauntT = 0;        // 龙得分跳舞计时
    this.tauntPhase = 0;
    this.tauntMsg = '';
    this.color = opt.color;
    this.avatar = opt.avatar || null;
    this.speed = opt.speed || CFG.walkSpeed;
  }
  groundY() { return GAME_H * CFG.groundFrac; }
  headPos() { return { x: this.x, y: this.groundY() - this.oy - (CFG.charH - CFG.headR) }; }
  pivot()   { return { x: this.x + this.dir * 26, y: this.groundY() - this.oy - 118 }; }
  racketAngle() {
    if (this.chargeT > 0 && this.swingT <= 0) {
      const p = this.chargeT / CFG.maxCharge;
      const idle = this.dir > 0 ? -0.55 : Math.PI + 0.55;
      const back = this.dir > 0 ? -2.5 : Math.PI + 2.5;
      return lerp(idle, back, easeOut(p));
    }
    if (this.swingT > 0) {
      const p = 1 - this.swingT / CFG.swingTime;
      const a = lerp(-2.5, 0.35, easeOut(p));
      return this.dir > 0 ? a : Math.PI - a;
    }
    if (this.recoverT > 0) {
      const p = 1 - this.recoverT / CFG.swingRecover;
      const from = this.dir > 0 ? 0.35 : Math.PI - 0.35;
      const idle = this.dir > 0 ? -0.55 : Math.PI + 0.55;
      return lerp(from, idle, p * p);
    }
    return this.dir > 0 ? -0.55 : Math.PI + 0.55;
  }
  racketHead() {
    const pv = this.pivot(), a = this.racketAngle();
    return { x: pv.x + Math.cos(a) * CFG.racketLen, y: pv.y - Math.sin(a) * CFG.racketLen };
  }
  update(dt, input) {
    let tx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (tx === 0 && typeof input.stickX === 'number' && Math.abs(input.stickX) > 0.12) tx = input.stickX;
    this.vx = lerp(this.vx, tx * this.speed, Math.min(1, dt * 8));
    const _netX = GAME_W / 2;
    const _xMin = this.side === 'left' ? CFG.boundL + 55 : _netX + 55;
    const _xMax = this.side === 'left' ? _netX - 55 : CFG.boundR - 55;
    this.x = clamp(this.x + this.vx * dt, _xMin, _xMax);
    this.walkPhase += Math.abs(this.vx) * dt * 0.045;
    /* 跳跃 */
    if (input.jump && this.grounded) { this.vy = CFG.jumpVy; this.grounded = false; }
    const wasAir = !this.grounded;
    this.vy += CFG.charGravity * dt;
    this.oy -= this.vy * dt;
    if (this.oy <= 0 && this.vy > 0) {
      if (wasAir) this.landT = 0.18;
      this.oy = 0; this.vy = 0; this.grounded = true;
    }
    if (this.landT > 0) this.landT -= dt;
    /* 蓄力挥拍: 按住蓄力, 松开击球; 蓄力越久球越远越高 */
    if (this.swingT > 0 || this.recoverT > 0) {
      this.chargeT = 0;
    } else if (input.swing) {
      this.chargeT = Math.min(CFG.maxCharge, this.chargeT + dt);
    } else if (this.chargeT > 0) {
      this.swingPower = this.chargeT / CFG.maxCharge;
      this.pendingPower = this.swingPower;
      this.swingT = CFG.swingTime;
      this.prevRack = null;
      this.chargeT = 0;
    }
    if (this.swingT > 0) {
      const hp = this.racketHead();
      this.seg = this.prevRack
        ? { x1: this.prevRack.x, y1: this.prevRack.y, x2: hp.x, y2: hp.y }
        : null;
      this.prevRack = hp;
      this.swingT -= dt;
      if (this.swingT <= 0) { this.seg = null; this.recoverT = CFG.swingRecover; }
    } else {
      this.seg = null; this.prevRack = null;
    }
    if (this.recoverT > 0) this.recoverT -= dt;
    if (this.tauntT > 0) { this.tauntT -= dt; this.tauntPhase += dt * 9; }
    /* 一键杀球: 自动起跳 + 满力重扣 */
    if (input.smash && this.smashCd <= 0 && this.smashMode <= 0) {
      this.smashMode = 0.9;
      this.smashCd = 1.6;
      if (this.grounded) { this.vy = CFG.jumpVy; this.grounded = false; }
      this.swingT = CFG.swingTime;
      this.prevRack = null;
      this.swingPower = 1;
      this.pendingPower = 1;
    }
    if (this.smashMode > 0) this.smashMode -= dt;
    if (this.smashCd > 0) this.smashCd -= dt;
  }
  distToRacket(x, y) {
    const s = this.seg;
    if (!s) return Infinity;
    return segPointDist(x, y, s.x1, s.y1, s.x2, s.y2);
  }
}
/* ---------------------------- 7. 电脑AI ---------------------------- */
class AIController {
  constructor(char, diff) {
    this.char = char;
    this.diff = diff;
    this.params = Object.assign({}, DIFFS[diff]);   // 克隆, 避免污染全局难度
    this.dragon = false;
    this.decideT = 0;
    this.targetX = char.x;
    this.errX = 0;
    this.jumpHold = 0;
    this.armed = false;
    this.willMiss = false;
    this.charging = false;
    this.input = { left: false, right: false, jump: false, swing: false, smash: false };
  }
  /* AI 进化(神龙之力): 属性大幅提升 */
  activateDragon() {
    this.dragon = true;
    const p = this.params;
    p.speed = Math.round(p.speed * 1.35);
    p.react = p.react * 0.45;
    p.err = Math.max(6, Math.round(p.err * 0.4));
    p.swingW = p.swingW + 50;
    p.miss = 0;
    this.char.speed = p.speed;
  }
  update(dt, engine) {
    const inp = this.input;
    inp.left = inp.right = inp.jump = inp.swing = inp.smash = false;
    this.decideT -= dt;
    if (this.jumpHold > 0) this.jumpHold -= dt;
    const s = engine.shuttle;
    if (engine.state === 'rally' && s) {
      if (this.decideT <= 0) { this.decide(engine); this.decideT = this.params.react; }
      this.swingCheck(engine);          // 击球/蓄力判断每帧执行
    } else {
      this.targetX = this.char.side === 'right' ? CFG.readyR : CFG.readyL;
      this.errX = 0;
      this.armed = false;
      this.charging = false;
    }
    const dx = this.targetX - this.char.x;
    if (Math.abs(dx) > 10) { if (dx > 0) inp.right = true; else inp.left = true; }
    if (this.jumpHold > 0) inp.jump = true;
  }
  /* 移动决策(带反应延迟) */
  decide(engine) {
    const s = engine.shuttle, c = this.char, netX = GAME_W / 2;
    const right = c.side === 'right';
    const tMin = right ? netX + 55 : CFG.boundL + 40;
    const tMax = right ? CFG.boundR - 40 : netX - 55;
    const land = s.predict();
    const landMine = right ? land.x > netX - 40 : land.x < netX + 40;
    const onMySide = right ? s.x > netX - 40 : s.x < netX + 40;
    if (!landMine && !onMySide) {
      this.targetX = right ? CFG.readyR : CFG.readyL;
      return;
    }
    if (landMine && !land.out) {
      this.errX = rand(-this.params.err, this.params.err);
      /* 让球拍对准来球: 身体站到落点后方一个球拍身位 */
      this.targetX = clamp(land.x - c.dir * 107 + this.errX, tMin, tMax);
    } else {
      this.targetX = clamp(s.x - c.dir * 107, tMin, tMax);
    }
  }
  /* 击球/起跳: 每帧判断, 蓄力出拍 */
  swingCheck(engine) {
    const s = engine.shuttle, c = this.char, netX = GAME_W / 2;
    const right = c.side === 'right';
    const onMySide = right ? s.x > netX - 40 : s.x < netX + 40;
    if (!onMySide || !s) { this.armed = false; this.charging = false; return; }
    const falling = s.vy > -60;
    const approach = s.y < 520 && s.x > 20 && s.x < GAME_W - 20;
    if (approach && (falling || c.oy > 50)) {
      if (!this.armed) {
        this.armed = true;
        this.willMiss = Math.random() < this.params.miss;
      }
      if (!this.willMiss) {
        this.charging = true;
        this.input.swing = true;        // 按住蓄力
      }
    } else {
      this.armed = false;
      this.charging = false;
    }
    /* 时机成熟: 松开击球(按待机角度估算球拍位置) */
    const idleAngle = c.dir > 0 ? -0.55 : Math.PI + 0.55;
    const pv = c.pivot();
    const rkx = pv.x + Math.cos(idleAngle) * CFG.racketLen;
    const rky = pv.y - Math.sin(idleAngle) * CFG.racketLen;
    const ddx = Math.abs(s.x - rkx);
    const ddy = s.y - rky;
    const hitZone = ddx < this.params.swingW + 70 && ddy > -230 && ddy < 170 && s.y < 480;
    if (this.charging) {
      if ((hitZone && c.chargeT > 0.35) || c.chargeT >= CFG.maxCharge) {
        this.charging = false;
        this.armed = false;
        this.input.swing = false;       // 松开 -> 击球
      } else if (s.y > 450 && c.chargeT > 0.12) {
        this.charging = false;
        this.armed = false;
        this.input.swing = false;       // 球快落地, 紧急出拍
      }
    }
    /* 起跳: 高球下落时提前起跳 */
    const lead = engine.score && engine.score.ai > engine.score.player;
    const netTop = c.groundY() - CFG.netH;
    const jumpHigh = (lead || this.dragon) ? netTop + 110 : netTop + 40;
    const mine = right ? s.x > netX - 40 : s.x < netX + 40;
    if (s.y < jumpHigh && s.vy > -40 && c.grounded && Math.abs(s.x - c.x) < 200 && mine) {
      this.jumpHold = 0.10;
    }
  }
}
/* ---------------------------- 8. 游戏引擎(规则/物理/计分) ---------------------------- */
class Engine {
  constructor() {
    this.state = 'menu';        // menu | intro | serving | rally | point | gameover
    this.stateT = 0;
    this.difficulty = 'normal';
    this.score = { player: 0, ai: 0 };
    this.server = 'player';
    this.shuttle = null;
    this.rallyHits = 0;
    this.rallyTime = 0;
    this.lastWinner = null;
    this.pointText = '';
    this.win = false;
    this.lastPoint = null;
    this.time = 0;
    this.introText = '听说你小子最近挺牛逼克拉斯呀！我要打爆你';
    this.introChars = 0;
    this.introT = 0;
    this.dragonMode = false;
    this.dragonT = 0;
    this.player = null;
    this.ai = null;
    this.aiCtrl = null;
    this.audio = new AudioFX();
    this.particles = new Particles();
  }
  groundY() { return GAME_H * CFG.groundFrac; }
  netTop()  { return this.groundY() - CFG.netH; }

  startGame(diff, aiAvatar, playerAvatar) {
    this.difficulty = diff;
    this.score = { player: 0, ai: 0 };
    this.server = 'player';
    this.lastWinner = null;
    this.state = 'serving';
    this.stateT = CFG.serveChoiceTime;
    this.win = false;
    this.shuttle = null;
    this.rallyTime = 0;
    this.lastPoint = null;
    this.dragonMode = false;
    this.dragonT = 0;
    this.particles.list.length = 0;
    this.player = new Character('left', { color: '#2f7bff', avatar: playerAvatar || null, speed: CFG.walkSpeed });
    this.ai = new Character('right', { color: '#ff5a3c', avatar: aiAvatar || null, speed: DIFFS[diff].speed });
    this.aiCtrl = new AIController(this.ai, diff);
    this.player.x = CFG.serveL; this.ai.x = CFG.readyR;
  }

  /* 赛前叫阵 */
  beginIntro(aiAvatar, playerAvatar) {
    this.startGame(this.difficulty, aiAvatar, playerAvatar);
    this.state = 'intro';
    this.introT = 0;
    this.introChars = 0;
  }

  update(dt, playerInput) {
    this.time += dt;
    if (this.dragonT > 0) this.dragonT -= dt;
    if (this.state === 'intro') {
      this.introT += dt;
      this.introChars = Math.min(this.introText.length, Math.floor(this.introT * 12));
      this.particles.update(dt);
      return;
    }
    if (this.state === 'menu' || this.state === 'gameover') {
      this.particles.update(dt);
      return;
    }
    if (this.aiCtrl) this.aiCtrl.update(dt, this);
    if (this.player) this.player.update(dt, playerInput);
    if (this.ai) this.ai.update(dt, this.aiCtrl ? this.aiCtrl.input : { left: false, right: false, jump: false, swing: false, smash: false });

    if (this.state === 'serving') {
      this.stateT -= dt;
      const pp = this.player ? this.player.pendingPower : null;
      if (this.server === 'player' && pp !== null) {
        this.player.pendingPower = null;
        this.doServe(pp);
      } else if (this.stateT <= 0) {
        this.doServe(this.server === 'ai' ? rand(0.35, 0.85) : 0.5);
      }
    } else if (this.state === 'rally') {
      this.rallyTime += dt;
      this.updateRally(dt);
      if (this.rallyTime > 18) {
        const w = (this.shuttle && this.shuttle.owner === 'player') ? 'ai' : 'player';
        this.scorePoint(w);
      }
    } else if (this.state === 'point') {
      this.stateT -= dt;
      if (this.stateT <= 0) this.nextServe();
    }
    this.particles.update(dt);
  }

  /* 初速度猜测(蓄力力度 0~1) */
  guessShot(x, y, dir, type, err, power) {
    err = err || 0;
    power = power == null ? 1 : clamp(power, 0, 1);
    const netX = GAME_W / 2, netTop = this.netTop();
    let target, vy0;
    if (type === 'serve_short' || type === 'serve' || type === 'serve_deep' || type === 'serve_fast') {
      /* 蓄力发球: 力度越大越深越高 */
      target = netX + dir * (CFG.shortServe + 40 + 290 * power + rand(-45, 45));
      vy0 = lerp(-820, -1150, power);
    } else if (type === 'smash') {
      target = netX + dir * (70 + 290 * power + rand(-35, 35));
      vy0 = rand(140, 260);
    } else if (type === 'drop') {
      target = netX + dir * (70 + 130 * power + rand(-25, 25));
      const rb = Math.max(800, Math.sqrt(2 * CFG.gravity * Math.max(25, y - (netTop - 25))));
      const rise = Math.max(rb * (0.8 + 0.25 * power), rb * 0.85);
      vy0 = -rise * rand(1.05, 1.18);
    } else {
      target = netX + dir * (70 + 290 * power + rand(-35, 35));
      const rb = Math.max(800, Math.sqrt(2 * CFG.gravity * Math.max(25, y - (netTop - 25))));
      const rise = Math.max(rb * (0.8 + 0.25 * power), rb * 0.85);
      vy0 = -rise * rand(1.06, 1.2);
    }
    target = clamp(target + err, CFG.boundL + 30, CFG.boundR - 30);
    return { target: target, vy0: vy0 };
  }
  computeVx(x, y, target, vy0, minVx) {
    const t = this.timeToLand(y, vy0);
    const k = CFG.dragX;
    return clamp(Math.abs(target - x) * k / (1 - Math.exp(-k * t)), minVx || 340, 1400);
  }
  simShot(x, y, vx, vy) {
    const netX = GAME_W / 2, netTop = this.netTop(), gy = this.groundY();
    const dt = 1 / 120;
    let px = x, py = y, minY = y;
    for (let t = 0; t < 6; t += dt) {
      vx *= Math.exp(-CFG.dragX * dt);
      vy *= Math.exp(-CFG.dragY * dt);
      vy += CFG.gravity * dt;
      px = x; py = y;
      x += vx * dt; y += vy * dt;
      if (y < minY) minY = y;
      if ((px <= netX && x >= netX) || (px >= netX && x <= netX)) {
        const tt = (netX - px) / ((x - px) || 1e-9);
        const yAt = py + (y - py) * tt;
        if (yAt > netTop - 6 && yAt < gy) return { net: true, minY: minY };
      }
      if (y >= gy) return { net: false, land: x, minY: minY };
      if (x < 10 || x > GAME_W - 10) return { net: false, out: true, land: x, minY: minY };
    }
    return { net: false, float: true, minY: minY };
  }
  /* 求解能过网且落在界内的初速度 */
  solveShot(x, y, dir, type, err, power) {
    err = err || 0;
    power = power == null ? 1 : clamp(power, 0, 1);
    const netX = GAME_W / 2;
    const isServe = type.indexOf('serve') === 0;
    const g = this.guessShot(x, y, dir, type, err, power);
    let target = g.target;
    let vy0 = g.vy0;
    let vx0 = this.computeVx(x, y, target, vy0);
    const smash = type === 'smash';
    if (smash) vx0 = vx0 * (0.75 + 0.25 * power);
    for (let i = 0; i < 10; i++) {
      const r = this.simShot(x, y, dir * vx0, vy0);
      if (!r.net && !r.out && !r.float && r.minY > 30) break;
      if (smash) { vy0 -= 90; if (vy0 < -60) vy0 = -60; }
      else if (r.out) { target -= dir * 30; }
      else if (r.net) {
        vy0 *= 1.16; if (vy0 < -1250) vy0 = -1250;
        if (!isServe) target -= dir * 30;
      } else if (r.minY <= 30) {
        vy0 *= 0.94;                  // ????: ??
      }
      target = clamp(target, dir > 0 ? netX + 60 : CFG.boundL + 30, dir > 0 ? CFG.boundR - 30 : netX - 60);
      vx0 = this.computeVx(x, y, target, vy0);
    }
    if (this.simShot(x, y, dir * vx0, vy0).net) {
      vy0 = -1050;
      target = isServe ? netX + dir * (CFG.shortServe + 170) : netX + dir * 110;
      vx0 = this.computeVx(x, y, target, vy0, isServe ? 340 : 120);
      if (this.simShot(x, y, dir * vx0, vy0).minY <= 30) {
        vy0 = -950;
        vx0 = this.computeVx(x, y, target, vy0, isServe ? 340 : 120);
      }
    }
    return { vx: dir * vx0, vy: vy0 };
  }
  timeToLand(y, vy0) {
    let yy = y, vv = vy0, t = 0;
    const gy = this.groundY(), dt = 1 / 120;
    for (let i = 0; i < 600; i++) {
      vv *= Math.exp(-CFG.dragY * dt);
      vv += CFG.gravity * dt;
      yy += vv * dt;
      t += dt;
      if (yy >= gy) return t;
    }
    return 1.2;
  }

  /* 蓄力发球: 力度越大球越高越远 */
  doServe(power) {
    power = power == null ? 0.5 : clamp(power, 0, 1);
    const dir = this.server === 'player' ? 1 : -1;
    const netX = GAME_W / 2;
    const ch = this.server === 'player' ? this.player : this.ai;
    let fx = ch ? ch.x + ch.dir * 60 : (this.server === 'player' ? CFG.serveL : CFG.serveR);
    if (ch) fx = ch.dir > 0 ? Math.min(fx, netX - 40) : Math.max(fx, netX + 40);
    const fy = this.groundY() - (ch ? ch.oy + 105 : 150);
    const aim = this.solveShot(fx, fy, dir, 'serve', 0, power);
    this.shuttle = new Shuttle(fx, fy, aim.vx, aim.vy, this.server);
    this.state = 'rally';
    this.rallyTime = 0;
    this.rallyHits = 1;
    const sc = this.server === 'player' ? this.player : this.ai;
    sc.swingT = CFG.swingTime;
    sc.prevRack = null;
    this.audio.hit();
  }

  updateRally(dt) {
    const s = this.shuttle;
    if (!s) return;
    s.update(dt);
    if (s.cooldown > 0) s.cooldown -= dt;
    this.netCollide(s);
    if (s.x < CFG.boundL - 25 || s.x > CFG.boundR + 25) {
      this.lastPoint = { reason: 'out', x: s.x, y: s.y };
      this.scorePoint(s.owner === 'player' ? 'ai' : 'player');
      return;
    }
    if (s.grounded) {
      const out = s.x < CFG.boundL || s.x > CFG.boundR;
      this.lastPoint = { reason: out ? 'out' : 'in', x: s.x, y: s.y };
      const winner = out ? (s.owner === 'player' ? 'ai' : 'player') : (s.x < GAME_W / 2 ? 'ai' : 'player');
      this.scorePoint(winner);
      return;
    }
    if (s.cooldown <= 0) {
      const pSmash = this.player && this.player.smashMode > 0;
      const pRadius = pSmash ? CFG.smashRadius : CFG.hitRadius;
      if (this.player && this.player.distToRacket(s.x, s.y) < pRadius && s.x < GAME_W / 2 + 20) {
        this.handleHit(this.player, pSmash ? 'smash' : null);
      } else if (this.ai && this.ai.distToRacket(s.x, s.y) < CFG.hitRadius && s.x > GAME_W / 2 - 20) {
        this.handleHit(this.ai, null);
      }
    }
  }

  netCollide(s) {
    const netX = GAME_W / 2, netTop = this.netTop(), gy = this.groundY();
    const crossed = (s.prevX <= netX && s.x >= netX) || (s.prevX >= netX && s.x <= netX);
    if (!crossed) return;
    const denom = s.x - s.prevX;
    const t = denom !== 0 ? (netX - s.prevX) / denom : 0.5;
    const yAt = lerp(s.prevY, s.y, t);
    if (yAt > netTop && yAt < gy) {
      s.x = netX + (s.x >= netX ? -3 : 3);
      s.vx = -s.vx * 0.22;
      s.vy = Math.abs(s.vy) * 0.3 + 60;
      s.cooldown = 0.1;
      this.particles.emit(netX, yAt, 0, 8, 'rgba(255,255,255,0.9)');
      this.audio.net();
    }
  }

  handleHit(ch, forcedType) {
    const s = this.shuttle;
    if (!s) return;
    const netTop = this.netTop();
    const smashH = (ch === this.ai && (this.score.ai > this.score.player || this.dragonMode)) ? 100 : 30;
    const smash = forcedType === 'smash' || s.y < netTop + smashH;
    const type = smash ? 'smash' : (s.y < netTop + 60 ? 'drop' : 'clear');
    const err = (ch === this.ai && this.aiCtrl) ? this.aiCtrl.params.err : 0;
    const power = clamp(ch.swingPower == null ? 0.5 : ch.swingPower, 0, 1);
    const aim = this.solveShot(s.x, s.y, ch.dir, type, err, power);
    s.vx = aim.vx;
    s.vy = aim.vy;
    s.owner = ch.side;
    s.cooldown = 0.12;
    s.grounded = false;
    s.trail.length = 0;
    this.rallyHits++;
    if (smash) {
      this.particles.emit(s.x, s.y, ch.dir, 22, '#ffd94a');
      this.audio.smashHit();
    } else {
      this.particles.emit(s.x, s.y, ch.dir, 14);
      this.audio.hit();
    }
  }

  scorePoint(winner) {
    this.score[winner]++;
    if (winner === 'player' && this.score.player === CFG.winScore - 1 && !this.dragonMode) {
      this.activateDragon();
    }
    this.lastWinner = winner;
    this.pointText = winner === 'player' ? '你得分！' : '对方得分！';
    this.state = 'point';
    this.stateT = 1.7;
    if (winner === 'ai' && this.ai) {
      const taunts = ['😂 哈哈哈！', '🤣 就这？', '😝 你行不行啊～', '😎 神龙在此！'];
      this.ai.tauntT = 2.6;
      this.ai.tauntPhase = 0;
      this.ai.tauntMsg = taunts[Math.floor(Math.random() * taunts.length)];
      this.audio.laugh();
    }
    this.audio.score();
    const sx = this.shuttle ? this.shuttle.x : GAME_W / 2;
    const sy = this.shuttle ? this.shuttle.y : this.groundY() - 40;
    this.particles.emit(sx, sy, 0, 20, '#ffd94a');
    if (this.score[winner] >= CFG.winScore) {
      this.state = 'gameover';
      this.win = winner === 'player';
      if (this.win) this.audio.win(); else this.audio.lose();
    }
  }

  /* 神龙之力: 玩家到赛点时 AI 当场进化 */
  activateDragon() {
    this.dragonMode = true;
    this.dragonT = 2.4;
    if (this.aiCtrl) this.aiCtrl.activateDragon();
    const ax = this.ai ? this.ai.x : GAME_W / 2;
    const ay = this.ai ? this.ai.groundY() - 150 : GAME_H / 2;
    this.particles.emit(ax, ay, 0, 36, '#ffd94a');
    this.particles.emit(ax, ay, 0, 24, '#ff9f1a');
    this.audio.dragon();
  }

  nextServe() {
    this.server = this.lastWinner || 'player';
    this.state = 'serving';
    this.stateT = this.server === 'player' ? CFG.serveChoiceTime : CFG.aiServeTime;
    this.shuttle = null;
    const p = this.player, a = this.ai;
    if (p) { p.x = this.server === 'player' ? CFG.serveL : CFG.readyL; p.oy = 0; p.vy = 0; p.vx = 0; p.swingT = 0; p.seg = null; p.recoverT = 0; p.landT = 0; p.chargeT = 0; p.pendingPower = null; }
    if (a) { a.x = this.server === 'ai' ? CFG.serveR : CFG.readyR; a.oy = 0; a.vy = 0; a.vx = 0; a.swingT = 0; a.seg = null; a.recoverT = 0; a.landT = 0; a.chargeT = 0; a.pendingPower = null; }
    if (this.aiCtrl) { this.aiCtrl.jumpHold = 0; this.aiCtrl.charging = false; }
  }
}
/* ---------------------------- 9. 输入(触摸/摇杆/键盘) ---------------------------- */
class InputManager {
  constructor(canvas, getButtons, onAction) {
    this.canvas = canvas;
    this.getButtons = getButtons;
    this.onAction = onAction;
    this.buttons = { left: false, right: false, jump: false, swing: false, smash: false };
    this.edge = { jump: false, swing: false, smash: false };
    this.pointerButtons = new Map();
    this.offset = { sx: 1, ox: 0, oy: 0 };
    this.joystick = { active: false, id: null, ax: 0, ay: 0, kx: 0, ky: 0, maxR: 55 };
    this.stickX = 0;
    this.stickUp = false;
    this.bind();
  }
  setTransform(sx, ox, oy) { this.offset = { sx: sx, ox: ox, oy: oy }; }
  toGame(clientX, clientY) {
    return {
      x: (clientX - this.offset.ox) / this.offset.sx,
      y: (clientY - this.offset.oy) / this.offset.sx,
    };
  }
  bind() {
    const c = this.canvas;
    /* 触摸(手机): 多点触控 + 摇杆拖动 */
    c.addEventListener('touchstart', e => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        this.downAt(t.clientX, t.clientY, 't' + t.identifier);
      }
    }, { passive: false });
    c.addEventListener('touchmove', e => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        this.moveJoystick(t.clientX, t.clientY, 't' + t.identifier);
      }
    }, { passive: false });
    c.addEventListener('touchend', e => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        this.upId('t' + e.changedTouches[i].identifier);
      }
    });
    c.addEventListener('touchcancel', e => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        this.upId('t' + e.changedTouches[i].identifier);
      }
    });
    /* 鼠标(电脑): 点击按钮 + 拖动摇杆 */
    c.addEventListener('mousedown', e => this.downAt(e.clientX, e.clientY, 'mouse'));
    c.addEventListener('mousemove', e => this.moveJoystick(e.clientX, e.clientY, 'mouse'));
    window.addEventListener('mouseup', () => this.upId('mouse'));
    /* 键盘(电脑) */
    window.addEventListener('keydown', e => this.keyEvent(e, true));
    window.addEventListener('keyup', e => this.keyEvent(e, false));
  }
  downAt(clientX, clientY, id) {
    const p = this.toGame(clientX, clientY);
    const btns = this.getButtons();
    for (const b of btns) {
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
        this.pointerButtons.set(id, b.id);
        this.press(b.id, true);
        return;
      }
    }
    /* 虚拟摇杆: 左下场地区域按住拖动 */
    const inGame = btns.some(b => b.id === 'jump');
    const gy = GAME_H * CFG.groundFrac;
    if (inGame && p.x < GAME_W * 0.4 && p.y > gy - 30) {
      this.joystick.active = true;
      this.joystick.id = id;
      this.joystick.ax = p.x; this.joystick.ay = p.y;
      this.joystick.kx = p.x; this.joystick.ky = p.y;
      return;
    }
  }
  moveJoystick(clientX, clientY, id) {
    if (!this.joystick.active || id !== this.joystick.id) return;
    const p = this.toGame(clientX, clientY);
    const dx = p.x - this.joystick.ax;
    const dy = p.y - this.joystick.ay;
    const dist = Math.hypot(dx, dy);
    const maxR = this.joystick.maxR;
    const cl = dist > maxR ? maxR / dist : 1;
    this.joystick.kx = this.joystick.ax + dx * cl;
    this.joystick.ky = this.joystick.ay + dy * cl;
    this.stickX = clamp((dx * cl) / maxR, -1, 1);
    /* ???? = ??(????, ???????) */
    const up = -dy > 24;
    if (up && !this.stickUp) this.edge.jump = true;
    this.stickUp = up;
  }
  upId(id) {
    if (this.joystick.active && id === this.joystick.id) {
      this.joystick.active = false;
      this.stickX = 0;
      this.stickUp = false;
    }
    const bid = this.pointerButtons.get(id);
    if (bid) {
      this.pointerButtons.delete(id);
      this.press(bid, false);
    }
  }
  press(bid, down) {
    if (bid === 'left' || bid === 'right' || bid === 'jump' || bid === 'swing' || bid === 'smash') {
      this.buttons[bid] = down;
      if (down && (bid === 'jump' || bid === 'swing' || bid === 'smash')) this.edge[bid] = true;
    } else if (down) {
      this.onAction(bid);
    }
  }
  keyEvent(e, down) {
    const map = {
      ArrowLeft: 'left', KeyA: 'left',
      ArrowRight: 'right', KeyD: 'right',
      ArrowUp: 'jump', KeyW: 'jump', Space: 'jump',
      KeyJ: 'swing', KeyF: 'swing', KeyX: 'swing', KeyK: 'swing',
      KeyS: 'smash',
    };
    const id = map[e.code];
    if (id) {
      e.preventDefault();
      this.buttons[id] = down;
      if (down && (id === 'jump' || id === 'swing' || id === 'smash')) this.edge[id] = true;
      return;
    }
    if (down && (e.code === 'Enter' || e.code === 'Space')) {
      const b = this.getButtons().find(x => x.actionKey);
      if (b) this.onAction(b.id);
    }
  }
  getPlayerInput() {
    return {
      left: this.buttons.left,
      right: this.buttons.right,
      stickX: this.stickX,
      jump: this.buttons.jump || this.edge.jump,
      swing: this.buttons.swing || this.edge.swing,
      smash: this.buttons.smash || this.edge.smash,
    };
  }
  clearEdges() {
    this.edge.jump = false;
    this.edge.swing = false;
    this.edge.smash = false;
  }
}
/* ---------------------------- 10. 渲染 ---------------------------- */
const Renderer = {
  draw(ctx, game) {
    const e = game.engine;
    this.drawBackground(ctx, game);
    this.drawCourt(ctx);
    this.drawNet(ctx);
    if (e.state !== 'menu') {
      if (e.shuttle) this.drawShuttle(ctx, e.shuttle);
      if (e.player) this.drawCharacter(ctx, e.player, game);
      if (e.ai) this.drawCharacter(ctx, e.ai, game);
      this.drawParticles(ctx, e.particles);
      if (e.state === 'serving' || e.state === 'rally' || e.state === 'point') this.drawHUD(ctx, game);
      this.drawButtons(ctx, game);
      if (e.state === 'serving' || e.state === 'rally' || e.state === 'point') {
        this.drawJoystick(ctx, game);
        this.drawChargeBar(ctx, game);
      }
    } else {
      this.drawParticles(ctx, e.particles);
    }
    if (e.state === 'serving') {
      const msg = e.server === 'player' ? '先移动到你想要的位置，按住「挥拍」蓄力，松开发球！蓄力越久越远' : '龙 发球准备…';
      this.centerText(ctx, msg, GAME_H / 2 - 150, 26, 'rgba(255,255,255,0.95)');
    }
    if (e.state === 'point') {
      const a = clamp(e.stateT, 0, 1);
      this.centerText(ctx, e.pointText, GAME_H / 2 - 60, 62, 'rgba(255,255,255,' + a + ')');
    }
    if (e.state === 'intro') this.drawIntro(ctx, game);
    if (e.state === 'menu') this.drawMenu(ctx, game);
    if (e.state === 'gameover') this.drawGameOver(ctx, game);
    if (e.dragonT > 0) this.drawDragon(ctx, game);
  },
  centerText(ctx, text, y, size, color) {
    ctx.fillStyle = color;
    ctx.font = 'bold ' + size + 'px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, GAME_W / 2, y);
  },
  drawBackground(ctx, game) {
    const g = ctx.createLinearGradient(0, 0, 0, GAME_H);
    g.addColorStop(0, '#6ec6ff');
    g.addColorStop(0.65, '#bfe9ff');
    g.addColorStop(1, '#eaf8ff');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, GAME_W, GAME_H);
    /* 头像太阳: 用龙头图片代替太阳 */
    const sunPulse = 0.5 + 0.5 * Math.sin(game.engine.time * 2.2);
    ctx.fillStyle = 'rgba(255,220,120,' + (0.30 + 0.18 * sunPulse) + ')';
    ctx.beginPath(); ctx.arc(1330, 110, 82 + 8 * sunPulse, 0, Math.PI * 2); ctx.fill();
    const sunImg = game.sunImg;
    if (sunImg && sunImg.width) {
      ctx.save();
      ctx.beginPath(); ctx.arc(1330, 110, 56, 0, Math.PI * 2); ctx.clip();
      const _s = Math.max(112 / sunImg.width, 112 / sunImg.height);
      const _sw = sunImg.width * _s, _sh = sunImg.height * _s;
      ctx.drawImage(sunImg, 1330 - _sw / 2, 110 - _sh / 2, _sw, _sh);
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,230,150,0.85)';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(1330, 110, 56, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(255,235,150,0.9)';
      ctx.beginPath(); ctx.arc(1330, 110, 46, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath(); ctx.ellipse(210, 100, 84, 30, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(270, 118, 56, 23, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(980, 80, 66, 24, 0, 0, Math.PI * 2); ctx.fill();
    /* 顶部彩旗 */
    const flags = ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#ff9f43', '#a66bff'];
    for (let i = 0; i < Math.ceil((GAME_W - 120) / 80); i++) {
      const fx = 60 + i * 80;
      ctx.fillStyle = flags[i % flags.length];
      ctx.beginPath();
      ctx.moveTo(fx, 8); ctx.lineTo(fx + 34, 20); ctx.lineTo(fx, 34); ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(80,80,80,0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(fx, 8); ctx.lineTo(fx, 42); ctx.stroke();
    }
    /* 两侧横幅 */
    ctx.fillStyle = 'rgba(30,60,110,0.75)';
    roundRectPath(ctx, 24, 14, 240, 56, 10); ctx.fill();
    roundRectPath(ctx, GAME_W - 264, 14, 240, 56, 10); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🏸 暴打神龙', 144, 42);
    ctx.fillText('1V1 对战', GAME_W - 144, 42);
  },
  drawCourt(ctx) {
    const gy = GAME_H * CFG.groundFrac;
    const g = ctx.createLinearGradient(0, gy, 0, GAME_H);
    g.addColorStop(0, '#3aa05e');
    g.addColorStop(1, '#2c7d49');
    ctx.fillStyle = g;
    ctx.fillRect(0, gy, GAME_W, GAME_H - gy);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(CFG.boundL, gy); ctx.lineTo(CFG.boundL, gy + 30); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(CFG.boundR, gy); ctx.lineTo(CFG.boundR, gy + 30); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(GAME_W / 2 - CFG.shortServe, gy); ctx.lineTo(GAME_W / 2 - CFG.shortServe, gy + 18); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(GAME_W / 2 + CFG.shortServe, gy); ctx.lineTo(GAME_W / 2 + CFG.shortServe, gy + 18); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(GAME_W / 2, gy + 16); ctx.lineTo(GAME_W / 2, gy + 40); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 2;
    for (let i = 1; i < 12; i++) {
      const lx = CFG.boundL + i * (GAME_W - CFG.boundL - CFG.boundR) / 12;
      ctx.beginPath(); ctx.moveTo(lx, gy + 10); ctx.lineTo(lx - 14, GAME_H - 14); ctx.stroke();
    }
  },
  drawNet(ctx) {
    const netX = GAME_W / 2, netTop = GAME_H * CFG.groundFrac - CFG.netH, gy = GAME_H * CFG.groundFrac;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.5;
    for (let i = 1; i < 10; i++) {
      const y = lerp(netTop, gy, i / 10);
      ctx.beginPath(); ctx.moveTo(netX - 16, y); ctx.lineTo(netX + 16, y); ctx.stroke();
    }
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath(); ctx.moveTo(netX + i * 6, netTop); ctx.lineTo(netX + i * 6, gy); ctx.stroke();
    }
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(netX, netTop); ctx.lineTo(netX, gy); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fillRect(netX - 17, netTop - 5, 34, 9);
    ctx.fillStyle = '#d9d9d9';
    ctx.fillRect(netX - 4, netTop - 3, 8, 12);
  },
  drawShuttle(ctx, s) {
    for (const p of s.trail) {
      ctx.fillStyle = 'rgba(255,255,255,' + Math.max(0, p.t) * 0.35 + ')';
      ctx.beginPath(); ctx.arc(p.x, p.y, 3 + p.t * 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(Math.atan2(s.vy, s.vx));
    ctx.strokeStyle = '#f4f4f4';
    ctx.lineWidth = 3;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath(); ctx.moveTo(2, 0); ctx.lineTo(-14, i * 7); ctx.stroke();
    }
    ctx.fillStyle = '#e8b46a';
    ctx.beginPath(); ctx.arc(3, 0, 6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  },
  drawCharacter(ctx, ch, game) {
    const gy = ch.groundY();
    const footY = gy - ch.oy - (ch.tauntT > 0 ? Math.abs(Math.sin(ch.tauntPhase)) * 30 : 0);
    const x = ch.x;
    const leading = ch.side === 'right' && game.engine.score.ai > game.engine.score.player;
    const dragon = ch.side === 'right' && game.engine.dragonMode;
    const t = game.engine.time;
    const speed01 = Math.min(1, Math.abs(ch.vx) / (ch.speed || 1));
    const ss = Math.max(0.3, 1 - ch.oy / 420);
    const air = ch.oy > 4;
    const taunting = ch.tauntT > 0;
    /* 影子 */
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.beginPath(); ctx.ellipse(x, gy + 5, 44 * ss, 8 * ss, 0, 0, Math.PI * 2); ctx.fill();
    if (dragon) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 10);
      ctx.fillStyle = 'rgba(255,190,40,' + (0.12 + 0.10 * pulse) + ')';
      ctx.beginPath(); ctx.arc(x, footY - 95, 95 + 10 * pulse, 0, Math.PI * 2); ctx.fill();
    }
    /* 杀球红光 */
    if (ch.smashMode > 0) {
      ctx.fillStyle = 'rgba(255,60,40,' + (0.25 + 0.15 * Math.sin(t * 20)) + ')';
      ctx.beginPath(); ctx.arc(x, footY - 100, 78, 0, Math.PI * 2); ctx.fill();
    }
    const step = speed01 > 0.03;
    const legPhase = taunting ? Math.sin(ch.tauntPhase * 1.4) : Math.sin(ch.walkPhase);
    const footA = 15 + 10 * speed01 + (taunting ? 24 : 0);
    const liftA = step ? Math.max(0, Math.sin(ch.walkPhase * 2)) * 9 * speed01 : 0;
    const liftB = step ? Math.max(0, Math.sin(ch.walkPhase * 2 + Math.PI)) * 9 * speed01 : 0;
    const hipBob = air ? 0 : ((taunting ? Math.abs(Math.sin(ch.tauntPhase * 2)) * 12 : Math.abs(Math.sin(ch.walkPhase * 2)) * 3 * speed01) + (step ? 0 : Math.sin(t * 2.4) * 1.8));
    let squash = 0;
    if (ch.landT > 0) squash = Math.sin(Math.PI * (1 - ch.landT / 0.18)) * 0.06;
    if (air && ch.vy < 0) squash = -0.03;
    const tuck = air ? Math.min(1, Math.abs(ch.vy) / 1300) : 0;
    const hipY = footY - 82 - hipBob;
    /* 腿: 世界坐标, 膝盖二次曲线弯曲 */
    ctx.strokeStyle = dragon ? '#ffb020' : ch.color;
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (air) {
      const k = footY + 14 * tuck;
      ctx.moveTo(x, hipY);
      ctx.quadraticCurveTo(x - 12 - tuck * 6, hipY + 30, x - 13 - tuck * 10, k);
      ctx.moveTo(x, hipY);
      ctx.quadraticCurveTo(x + 12 + tuck * 6, hipY + 30, x + 13 + tuck * 10, k);
    } else {
      const l1 = legPhase * footA * 0.9;
      const l2 = -legPhase * footA * 0.9;
      ctx.moveTo(x, hipY);
      ctx.quadraticCurveTo(x - footA * 0.5 - l1 * 0.4, hipY + 40, x - l1, footY - liftA);
      ctx.moveTo(x, hipY);
      ctx.quadraticCurveTo(x + footA * 0.5 - l2 * 0.4, hipY + 40, x - l2, footY - liftB);
    }
    ctx.stroke();
    /* 上半身: 绕髋部旋转 */
    ctx.save();
    ctx.translate(x, hipY);
    const lean = air
      ? Math.max(-0.09, Math.min(0.12, -ch.vy / 1500))
      : speed01 * 0.06 * (ch.vx >= 0 ? 1 : -1) + (taunting ? Math.sin(ch.tauntPhase) * 0.16 : 0);
    const swingRot = ch.swingT > 0 ? Math.sin(Math.PI * (1 - ch.swingT / CFG.swingTime)) * 0.14 * ch.dir : 0;
    ctx.rotate(lean + swingRot);
    const shY = -70;
    const hdY = -81;
    ctx.strokeStyle = dragon ? '#ffb020' : ch.color;
    ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, shY); ctx.stroke();
    ctx.lineWidth = 6;
    const armSwing = (step ? Math.sin(ch.walkPhase) * 8 : 0) + (taunting ? Math.sin(ch.tauntPhase * 2) * 14 : 0);
    ctx.beginPath();
    ctx.moveTo(0, shY + 6);
    ctx.lineTo(-ch.dir * 26, shY + 36 + armSwing);
    ctx.stroke();
    /* 持拍臂 + 球拍 */
    const pv = { x: ch.dir * 26, y: -36 };
    const a = ch.racketAngle();
    const hand = { x: pv.x + Math.cos(a) * 40, y: pv.y - Math.sin(a) * 40 };
    ctx.beginPath(); ctx.moveTo(0, shY + 8); ctx.lineTo(hand.x, hand.y); ctx.stroke();
    const hp = { x: pv.x + Math.cos(a) * CFG.racketLen, y: pv.y - Math.sin(a) * CFG.racketLen };
    ctx.strokeStyle = '#7a4a21';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(hand.x, hand.y); ctx.lineTo(hp.x, hp.y); ctx.stroke();
    ctx.save();
    ctx.translate(hp.x, hp.y);
    ctx.rotate(a);
    ctx.strokeStyle = '#eeeeee';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(0, 0, 30, 13, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-30, 0); ctx.lineTo(30, 0); ctx.stroke();
    ctx.restore();
    /* 挥拍残影 */
    if (ch.swingT > 0 || ch.recoverT > 0) {
      ch.rackTrail.push({ x: hp.x, y: hp.y });
      if (ch.rackTrail.length > 9) ch.rackTrail.shift();
    } else {
      ch.rackTrail.length = 0;
    }
    if (ch.rackTrail.length > 1) {
      ctx.lineWidth = 6;
      for (let i = 1; i < ch.rackTrail.length; i++) {
        ctx.globalAlpha = 0.45 * i / ch.rackTrail.length;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath();
        ctx.moveTo(ch.rackTrail[i - 1].x, ch.rackTrail[i - 1].y);
        ctx.lineTo(ch.rackTrail[i].x, ch.rackTrail[i].y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    /* 头(头像) */
    const headRot = (step ? Math.sin(ch.walkPhase) * 0.04 : Math.sin(t * 2.4) * 0.02)
      + (air ? Math.max(-0.08, Math.min(0.1, -ch.vy / 1600)) : 0)
      + (taunting ? Math.sin(ch.tauntPhase * 1.3) * 0.22 : 0);
    ctx.save();
    ctx.translate(0, hdY);
    ctx.rotate(headRot);
    ctx.beginPath(); ctx.arc(0, 0, CFG.headR + 3, 0, Math.PI * 2); ctx.clip();
    let tex = ch.avatar;
    if (leading && game.aiLeadAvatar) tex = game.aiLeadAvatar;
    if (tex && tex.width) {
      ctx.drawImage(tex, -(CFG.headR + 3), -(CFG.headR + 3), (CFG.headR + 3) * 2, (CFG.headR + 3) * 2);
    } else {
      ctx.fillStyle = '#ffe3c2';
      ctx.fillRect(-(CFG.headR + 3), -(CFG.headR + 3), (CFG.headR + 3) * 2, (CFG.headR + 3) * 2);
      ctx.fillStyle = '#222222';
      ctx.beginPath(); ctx.arc(-9, -4, 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(9, -4, 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#222222';
      ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.arc(0, 6, 9, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
    }
    ctx.restore();
    if (dragon) {
      ctx.strokeStyle = 'rgba(255,200,40,0.95)';
    } else if (leading) {
      ctx.strokeStyle = 'rgba(255,60,40,0.9)';
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    }
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, hdY, CFG.headR + 3, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    /* 龙得分: 跳舞嘲讽大笑气泡 */
    if (taunting) {
      const tmsg = ch.tauntMsg || '哈哈哈！';
      const hd = ch.headPos();
      const bx = hd.x + ch.dir * 6, by = hd.y - 64 + Math.sin(ch.tauntPhase) * 6;
      ctx.save();
      ctx.font = 'bold 25px ' + FONT;
      const tw = (ctx.measureText ? ctx.measureText(tmsg).width : 160) + 38;
      const bh = 46;
      ctx.fillStyle = 'rgba(255,255,255,0.96)';
      roundRectPath(ctx, bx - tw / 2, by - bh / 2, tw, bh, 16);
      ctx.fill();
      ctx.strokeStyle = 'rgba(60,40,10,0.35)';
      ctx.lineWidth = 2.5;
      roundRectPath(ctx, bx - tw / 2, by - bh / 2, tw, bh, 16);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(bx - 12, by + bh / 2 - 4);
      ctx.lineTo(bx + 8, by + bh / 2 + 16);
      ctx.lineTo(bx + 16, by + bh / 2 - 4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#3a2505';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tmsg, bx, by + 1);
      ctx.restore();
    }
  },
  drawParticles(ctx, ps) { ps.draw(ctx); },
  drawMiniAvatar(ctx, cx, cy, r, ch, game) {
    const leading = ch && ch.side === 'right' && game.engine.score.ai > game.engine.score.player;
    let tex = ch ? ch.avatar : null;
    if (leading && game.aiLeadAvatar) tex = game.aiLeadAvatar;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    if (tex && tex.width) {
      ctx.drawImage(tex, cx - r, cy - r, r * 2, r * 2);
    } else {
      ctx.fillStyle = '#ffe3c2';
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      ctx.fillStyle = '#333333';
      ctx.beginPath(); ctx.arc(cx - r * 0.35, cy - r * 0.15, r * 0.13, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + r * 0.35, cy - r * 0.15, r * 0.13, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#333333';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, cy + r * 0.3, r * 0.35, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = leading ? 'rgba(255,60,40,0.9)' : 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  },
  drawHUD(ctx, game) {
    const e = game.engine;
    const cx = GAME_W / 2, bw = 260, bh = 56;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    roundRectPath(ctx, cx - bw / 2, 12, bw, bh, 14);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    roundRectPath(ctx, cx - bw / 2, 12, bw, bh, 14);
    ctx.stroke();
    this.drawMiniAvatar(ctx, cx - bw / 2 + 40, 40, 18, e.player, game);
    this.drawMiniAvatar(ctx, cx + bw / 2 - 40, 40, 18, e.ai, game);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 30px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(e.score.player + ' : ' + e.score.ai, cx, 42);
    ctx.font = '15px ' + FONT;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText(e.server === 'player' ? '你发球' : '龙发球', cx, 90);
    ctx.font = 'bold 18px ' + FONT;
    if (e.score.ai > e.score.player) {
      ctx.fillStyle = '#ff6b5e';
      ctx.fillText('🔥 龙领先', cx, 125);
    } else if (e.score.player > e.score.ai) {
      ctx.fillStyle = '#ffd94a';
      ctx.fillText('⭐ 你领先', cx, 125);
    }
  },
  drawButtons(ctx, game) {
    const btns = game.uiButtons();
    for (const b of btns) {
      if (b.id === 'sound' || b.id === 'fullscreen') continue;
      const pressed = !!game.input.buttons[b.id];
      const isSmash = b.id === 'smash';
      ctx.fillStyle = isSmash
        ? (pressed ? 'rgba(255,90,60,0.85)' : 'rgba(200,50,40,0.65)')
        : (pressed ? 'rgba(120,160,255,0.75)' : 'rgba(40,70,120,0.55)');
      roundRectPath(ctx, b.x, b.y, b.w, b.h, 18);
      ctx.fill();
      ctx.strokeStyle = pressed ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 3;
      roundRectPath(ctx, b.x, b.y, b.w, b.h, 18);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = (b.w > 140 ? 'bold 30px ' : 'bold 34px ') + FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 2);
    }
    const smalls = [btns.find(x => x.id === 'fullscreen'), btns.find(x => x.id === 'sound')];
    for (const sb of smalls) {
      if (!sb) continue;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      roundRectPath(ctx, sb.x, sb.y, sb.w, sb.h, 12);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = (sb.id === 'fullscreen' ? 'bold 17px ' : 'bold 22px ') + FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(sb.label, sb.x + sb.w / 2, sb.y + sb.h / 2 + 1);
    }
  },
  drawJoystick(ctx, game) {
    const j = game.input.joystick;
    const bx = 105, by = GAME_H - 92;
    const active = j.active;
    const ax = active ? j.ax : bx, ay = active ? j.ay : by;
    const kx = active ? j.kx : bx, ky = active ? j.ky : by;
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.beginPath(); ctx.arc(ax, ay, 52, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(ax, ay, 52, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = active ? 'rgba(140,190,255,0.55)' : 'rgba(255,255,255,0.38)';
    ctx.beginPath(); ctx.arc(kx, ky, 25, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(kx, ky, 25, 0, Math.PI * 2); ctx.stroke();
    ctx.font = '13px ' + FONT;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('↑跳', bx, by - 46);
  },
  drawChargeBar(ctx, game) {
    const p = game.engine.player;
    if (!p) return;
    const frac = clamp(p.chargeT / CFG.maxCharge, 0, 1);
    const bx = 1310, by = 622, bw = 120, bh = 15;
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    roundRectPath(ctx, bx, by, bw, bh, 7);
    ctx.fill();
    const seg = bw / 3;
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    roundRectPath(ctx, bx + 2, by + 2, seg - 3, bh - 4, 5); ctx.fill();
    ctx.fillStyle = 'rgba(110,255,110,0.5)';
    roundRectPath(ctx, bx + seg + 1, by + 2, seg - 3, bh - 4, 5); ctx.fill();
    ctx.fillStyle = 'rgba(255,95,70,0.5)';
    roundRectPath(ctx, bx + seg * 2 + 1, by + 2, seg - 3, bh - 4, 5); ctx.fill();
    if (frac > 0.02) {
      const g2 = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      g2.addColorStop(0, '#ffffff');
      g2.addColorStop(0.5, '#7dff7d');
      g2.addColorStop(1, '#ff5a40');
      ctx.fillStyle = g2;
      roundRectPath(ctx, bx + 2, by + 2, (bw - 4) * frac, bh - 4, 5);
      ctx.fill();
    }
    ctx.font = '12px ' + FONT;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('近', bx + seg / 2, by + bh + 11);
    ctx.fillText('中', bx + bw / 2, by + bh + 11);
    ctx.fillText('远', bx + bw - seg / 2, by + bh + 11);
    if (frac > 0.02) {
      ctx.font = 'bold 15px ' + FONT;
      ctx.fillStyle = frac > 0.66 ? '#ff5a40' : (frac > 0.33 ? '#6fe06f' : '#ffffff');
      ctx.fillText('蓄力 ' + Math.round(frac * 100) + '%', bx + bw / 2, by - 12);
    }
  },
  drawMenu(ctx, game) {
    /* 主视觉大图: 全屏铺满 */
    const bg = game.menuBg;
    if (bg && bg.width) {
      const _sc = Math.max(GAME_W / bg.width, GAME_H / bg.height);
      const _dw = bg.width * _sc, _dh = bg.height * _sc;
      ctx.save();
      ctx.drawImage(bg, (GAME_W - _dw) / 2, (GAME_H - _dh) / 2, _dw, _dh);
      ctx.restore();
    }
    /* 渐变遮罩: 右半(菜单区)偏暗保证可读 */
    const _mg = ctx.createLinearGradient(0, 0, GAME_W, 0);
    _mg.addColorStop(0, 'rgba(8,24,40,0.42)');
    _mg.addColorStop(0.5, 'rgba(8,24,40,0.28)');
    _mg.addColorStop(1, 'rgba(8,24,40,0.85)');
    ctx.fillStyle = _mg;
    ctx.fillRect(0, 0, GAME_W, GAME_H);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 54px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🏸 暴打神龙 1V1 对战', 930, 150);
    ctx.font = '22px ' + FONT;
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText('超大场地 · 先得 ' + CFG.winScore + ' 分获胜', 930, 210);
    ctx.font = '19px ' + FONT;
    ctx.fillText('选择难度', 930, 290);
    for (const b of game.uiButtons()) {
      if (b.id.indexOf('diff_') !== 0) continue;
      const sel = b.id === 'diff_' + game.diff;
      ctx.fillStyle = sel ? 'rgba(255,200,60,0.9)' : 'rgba(255,255,255,0.16)';
      roundRectPath(ctx, b.x, b.y, b.w, b.h, 16);
      ctx.fill();
      ctx.strokeStyle = sel ? '#ffe08a' : 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 2.5;
      roundRectPath(ctx, b.x, b.y, b.w, b.h, 16);
      ctx.stroke();
      ctx.fillStyle = sel ? '#3a2a00' : '#ffffff';
      ctx.font = 'bold 28px ' + FONT;
      ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 2);
    }
    const st = game.uiButtons().find(x => x.id === 'start');
    if (st) {
      ctx.fillStyle = '#3ddc84';
      roundRectPath(ctx, st.x, st.y, st.w, st.h, 20);
      ctx.fill();
      ctx.fillStyle = '#06371e';
      ctx.font = 'bold 34px ' + FONT;
      ctx.fillText(st.label, st.x + st.w / 2, st.y + st.h / 2 + 2);
    }
    ctx.font = '17px ' + FONT;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText('📱 手机：左下摇杆（上推=跳）· 右下 杀球/挥拍', GAME_W / 2, 646);
    ctx.fillText('⌨️ 电脑：←→ 移动 · ↑/空格 跳 · J/F 挥拍 · S 杀球', GAME_W / 2, 678);
    ctx.fillText('🏸 按住挥拍蓄力发球/击球，蓄力越久球越远越高', GAME_W / 2, 710);
    ctx.fillText('🎯 龙领先时会变成怒气头像，扣杀更凶', GAME_W / 2, 742);
  },
  drawIntro(ctx, game) {
    const e = game.engine;
    ctx.fillStyle = 'rgba(6,16,30,0.55)';
    ctx.fillRect(0, 0, GAME_W, GAME_H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 30px ' + FONT;
    ctx.fillStyle = '#ffffff';
    ctx.fillText('赛前叫阵', GAME_W / 2, 70);
    const bx = 70, by = 500, bw = GAME_W - 140, bh = 210;
    ctx.fillStyle = 'rgba(10,25,45,0.92)';
    roundRectPath(ctx, bx, by, bw, bh, 22);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 3;
    roundRectPath(ctx, bx, by, bw, bh, 22);
    ctx.stroke();
    const img = game.playerAvatar;
    const t = e.time;
    const wob = Math.sin(t * 7) * 0.14;
    const bob = Math.sin(t * 7) * 7;
    const cx = bx + 135, cy = by + 100;
    ctx.save();
    ctx.translate(cx, cy + bob);
    ctx.rotate(wob);
    ctx.beginPath();
    ctx.arc(0, 0, 76, 0, Math.PI * 2);
    ctx.clip();
    if (img && img.width) {
      ctx.drawImage(img, -76, -76, 152, 152);
    } else {
      ctx.fillStyle = '#ffe3c2';
      ctx.fillRect(-76, -76, 152, 152);
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,220,90,0.95)';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(cx, cy + bob, 76, 0, Math.PI * 2); ctx.stroke();
    ctx.font = 'bold 26px ' + FONT;
    ctx.fillStyle = '#ffd94a';
    ctx.fillText('你', cx, by + 188);
    const shown = e.introText.slice(0, e.introChars);
    ctx.font = 'bold 30px ' + FONT;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.fillText(shown, bx + 250, by + 105);
    const aimg = game.aiAvatar;
    const ax = bx + bw - 130, ay = by + 100;
    ctx.save();
    ctx.beginPath();
    ctx.arc(ax, ay, 60, 0, Math.PI * 2);
    ctx.clip();
    if (aimg && aimg.width) ctx.drawImage(aimg, ax - 60, ay - 60, 120, 120);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,120,90,0.9)';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(ax, ay, 60, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#ff9a86';
    ctx.font = 'bold 22px ' + FONT;
    ctx.textAlign = 'center';
    ctx.fillText('龙', ax, by + 180);
  },
  drawGameOver(ctx, game) {
    const e = game.engine;
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(0, 0, GAME_W, GAME_H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (e.win) {
      ctx.font = 'bold 64px ' + FONT;
      ctx.fillStyle = '#ffd94a';
      ctx.fillText('🎉 你赢了！', GAME_W / 2, 300);
      ctx.font = 'bold 38px ' + FONT;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(e.score.player + ' : ' + e.score.ai, GAME_W / 2, 410);
    } else {
      /* 输了: 放大显示玩家头像图片 */
      const img = game.playerAvatar;
      const cx = GAME_W / 2, cy = 330, r = 150;
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, r + 16, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,60,40,0.22)';
      ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();
      if (img && img.width) {
        ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
      } else {
        ctx.fillStyle = '#ffe3c2';
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
        ctx.fillStyle = '#222222';
        ctx.beginPath(); ctx.arc(cx - r * 0.35, cy - r * 0.1, r * 0.16, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + r * 0.35, cy - r * 0.1, r * 0.16, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#222222';
        ctx.lineWidth = 10;
        ctx.beginPath(); ctx.arc(cx, cy + r * 0.35, r * 0.45, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
      }
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,80,60,0.95)';
      ctx.lineWidth = 8;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      /* AI 摇头晃脑嘲讽 */
      const aimg = game.aiAvatar;
      const ax2 = GAME_W / 2 - 390, ay2 = 160;
      const wob2 = Math.sin(e.time * 7) * 0.14;
      const bob2 = Math.sin(e.time * 7) * 7;
      ctx.save();
      ctx.translate(ax2, ay2 + bob2);
      ctx.rotate(wob2);
      ctx.beginPath(); ctx.arc(0, 0, 62, 0, Math.PI * 2); ctx.clip();
      if (aimg && aimg.width) {
        ctx.drawImage(aimg, -62, -62, 124, 124);
      } else {
        ctx.fillStyle = '#ffb0a0';
        ctx.fillRect(-62, -62, 124, 124);
      }
      ctx.restore();
      ctx.strokeStyle = e.dragonMode ? 'rgba(255,200,40,0.95)' : 'rgba(255,120,90,0.9)';
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(ax2, ay2 + bob2, 62, 0, Math.PI * 2); ctx.stroke();
      if (e.dragonMode) {
        ctx.font = '30px ' + FONT;
        ctx.fillText('🐉', ax2, ay2 - 82 + bob2);
      }
      const bx2 = ax2 + 88, by2 = 70, bw2 = 540, bh2 = 108;
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      roundRectPath(ctx, bx2, by2, bw2, bh2, 18);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(bx2 + 42, by2 + bh2 - 12);
      ctx.lineTo(ax2 + 42, ay2 + 42 + bob2);
      ctx.lineTo(bx2 + 98, by2 + bh2 - 12);
      ctx.closePath();
      ctx.fill();
      ctx.font = 'bold 28px ' + FONT;
      ctx.fillStyle = '#222222';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('凡人你是打不过神龙之力的', bx2 + bw2 / 2, by2 + bh2 / 2 + 2);
      ctx.font = 'bold 46px ' + FONT;
      ctx.fillStyle = '#ff7a6a';
      ctx.fillText('😢 你输了', GAME_W / 2, 540);
      ctx.font = 'bold 36px ' + FONT;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(e.score.player + ' : ' + e.score.ai, GAME_W / 2, 595);
    }
    ctx.font = '20px ' + FONT;
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText('难度：' + DIFFS[e.difficulty].label + ' · 回车/空格 再来一局', GAME_W / 2, 650);
    this.drawButtons(ctx, game);
  },
  drawDragon(ctx, game) {
    const e = game.engine;
    const a = Math.min(1, e.dragonT);
    const ax = e.ai ? e.ai.x : GAME_W / 2;
    const gy = GAME_H * CFG.groundFrac;
    const g = ctx.createLinearGradient(ax, gy, ax, gy - 340);
    g.addColorStop(0, 'rgba(255,200,60,' + (0.40 * a) + ')');
    g.addColorStop(1, 'rgba(255,220,120,0)');
    ctx.fillStyle = g;
    ctx.fillRect(ax - 55, gy - 340, 110, 340);
    ctx.fillStyle = 'rgba(255,220,90,' + (0.5 * a) + ')';
    ctx.beginPath(); ctx.arc(ax, gy - 340, 34 + 8 * Math.sin(e.time * 12), 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.shadowColor = '#ffd94a';
    ctx.shadowBlur = 26;
    ctx.font = 'bold 76px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffe066';
    ctx.fillText('神龙之力！', GAME_W / 2, GAME_H / 2 - 70);
    ctx.restore();
    ctx.font = 'bold 24px ' + FONT;
    ctx.fillStyle = 'rgba(255,220,130,0.95)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('龙觉醒 · 爆发出超强力量', GAME_W / 2, GAME_H / 2 - 20);
  },
};
/* ---------------------------- 11. 手机横屏锁定 ---------------------------- */
const IS_MOBILE = typeof navigator !== 'undefined' && (
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '') ||
  (typeof window !== 'undefined' && ('ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0))
);
function updateRotateOverlay() {
  const el = document.getElementById('rotate-overlay');
  if (!el || !el.classList) return;
  const portrait = window.innerHeight > window.innerWidth;
  if (IS_MOBILE && portrait) el.classList.add('show');
  else el.classList.remove('show');
}
function showFsTip() {
  const tip = document.getElementById('fs-tip');
  if (!tip) return;
  const wechat = typeof navigator !== 'undefined' && /MicroMessenger/i.test(navigator.userAgent || '');
  tip.textContent = wechat
    ? '当前浏览器不支持全屏：请点右上角「···」→「在浏览器中打开」，再旋转手机横屏'
    : '未能自动全屏：请手动旋转手机横屏，或用浏览器菜单的全屏功能';
  tip.style.display = 'block';
}
function hideFsTip() {
  const tip = document.getElementById('fs-tip');
  if (tip) tip.style.display = 'none';
}
function tryLockLandscape() {
  if (!IS_MOBILE) return;
  try {
    const doc = document;
    const de = doc.documentElement;
    const cands = [de, doc.body, doc.getElementById('game')];
    const fsNames = ['requestFullscreen', 'webkitRequestFullscreen', 'mozRequestFullScreen', 'msRequestFullscreen'];
    let fsFn = null, fsEl = null;
    for (let i = 0; i < cands.length; i++) {
      const el = cands[i];
      if (!el) continue;
      for (let j = 0; j < fsNames.length; j++) {
        if (typeof el[fsNames[j]] === 'function') { fsFn = el[fsNames[j]]; fsEl = el; break; }
      }
      if (fsFn) break;
    }
    const isFs = function () {
      return !!(doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement);
    };
    const doLock = function () {
      const so = window.screen && window.screen.orientation;
      if (so && so.lock) {
        try {
          const r = so.lock('landscape');
          if (r && r.catch) r.catch(function () {});
        } catch (e) { /* ignore */ }
      }
    };
    if (fsFn && !isFs()) {
      let done = false;
      const onOk = function () { if (!done) { done = true; hideFsTip(); doLock(); } };
      const onFail = function () { if (!done) { done = true; showFsTip(); } };
      let p = null;
      try { p = fsFn.call(fsEl); } catch (e) { onFail(); return; }
      if (p && p.then) p.then(onOk, onFail);
      else {
        onOk();
        setTimeout(function () { if (!isFs()) onFail(); }, 600);
      }
    } else if (fsFn && isFs()) {
      doLock();
      hideFsTip();
    } else {
      doLock();
      setTimeout(function () { if (!isFs()) showFsTip(); }, 400);
    }
  } catch (e) { showFsTip(); }
}

/* ---------------------------- 12. 游戏装配与启动 ---------------------------- */
function loadImage(src, cb) {
  const img = new Image();
  img.onload = function () { cb(img); };
  img.onerror = function () { cb(null); };
  img.src = src;
}

function createGame() {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const engine = new Engine();
  const game = {
    canvas: canvas, ctx: ctx, engine: engine,
    diff: 'normal',
    aiAvatar: null,
    aiLeadAvatar: null,
    playerAvatar: null,
    menuBg: null,
    sunImg: null,
    w: 0, h: 0, sx: 1, ox: 0, oy: 0, dpr: 1,
    lastTime: 0,
    raf: 0,

    resize() {
      const w = window.innerWidth, h = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.w = w; this.h = h; this.dpr = dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      this.sx = Math.min(w / GAME_W, h / GAME_H);
      this.ox = (w - GAME_W * this.sx) / 2;
      this.oy = (h - GAME_H * this.sx) / 2;
      if (this.input) this.input.setTransform(this.sx, this.ox, this.oy);
    },

    uiButtons() {
      const s = this.engine.state;
      const list = [];
      if (s === 'menu') {
        list.push({ id: 'diff_easy', x: 670, y: 330, w: 160, h: 70, label: '简单' });
        list.push({ id: 'diff_normal', x: 850, y: 330, w: 160, h: 70, label: '普通' });
        list.push({ id: 'diff_hard', x: 1030, y: 330, w: 160, h: 70, label: '困难' });
        list.push({ id: 'start', x: 770, y: 460, w: 320, h: 92, label: '开始游戏', actionKey: true });
      } else {
        if (s === 'intro') {
          list.push({ id: 'intro_start', x: 620, y: 726, w: 260, h: 66, label: '开始比赛', actionKey: true });
        }
        if (s === 'serving' || s === 'rally' || s === 'point') {
          list.push({ id: 'jump', x: 1030, y: 664, w: 120, h: 120, label: '跳' });
          list.push({ id: 'smash', x: 1170, y: 664, w: 120, h: 120, label: '杀' });
          list.push({ id: 'swing', x: 1310, y: 664, w: 120, h: 120, label: '挥拍' });
        }
        list.push({ id: 'fullscreen', x: 1290, y: 14, w: 80, h: 44, label: '⛶' });
        list.push({ id: 'sound', x: 1390, y: 14, w: 80, h: 44, label: this.audio.enabled ? '♪' : '✕' });
        if (s === 'gameover') {
          list.push({ id: 'restart', x: 520, y: 700, w: 200, h: 84, label: '再来一局', actionKey: true });
          list.push({ id: 'menu', x: 800, y: 700, w: 200, h: 84, label: '主菜单' });
        }
      }
      return list;
    },

    onAction(id) {
      const e = this.engine;
      if (id === 'diff_easy' || id === 'diff_normal' || id === 'diff_hard') {
        this.diff = id.slice(5);
        return;
      }
      if (id === 'start' || id === 'restart') {
        this.audio.init();
        if (id === 'start') e.difficulty = this.diff;
        e.beginIntro(this.aiAvatar, this.playerAvatar);
        return;
      }
      if (id === 'intro_start') {
        e.state = 'serving';
        e.stateT = e.server === 'player' ? CFG.serveChoiceTime : CFG.aiServeTime;
        return;
      }
      if (id === 'menu') { e.state = 'menu'; return; }
      if (id === 'fullscreen') { tryLockLandscape(); return; }
      if (id === 'sound') {
        this.audio.enabled = !this.audio.enabled;
        this.audio.setBgmMuted(!this.audio.enabled);
        return;
      }
    },

    tick(now) {
      const dt = this.lastTime ? Math.min(0.05, Math.max(0.001, (now - this.lastTime) / 1000)) : 1 / 60;
      this.lastTime = now;
      if (document.hidden) return;
      this.engine.update(dt, this.input.getPlayerInput());
      this.input.clearEdges();
      this.render();
    },

    render() {
      const dpr = this.dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      /* 全屏底色: 上方天空、下方场地延伸, 黑边融入场景 */
      const sky = this.ctx.createLinearGradient(0, 0, 0, this.h);
      sky.addColorStop(0, '#6ec6ff');
      sky.addColorStop(0.72, '#bfe9ff');
      sky.addColorStop(1, '#eaf8ff');
      this.ctx.fillStyle = sky;
      this.ctx.fillRect(0, 0, this.w, this.h);
      const gyS = this.oy + GAME_H * CFG.groundFrac * this.sx;
      const gr = this.ctx.createLinearGradient(0, gyS, 0, this.h);
      gr.addColorStop(0, '#3aa05e');
      gr.addColorStop(1, '#2c7d49');
      this.ctx.fillStyle = gr;
      this.ctx.fillRect(0, gyS, this.w, this.h - gyS);
      this.ctx.setTransform(dpr * this.sx, 0, 0, dpr * this.sx, dpr * this.ox, dpr * this.oy);
      Renderer.draw(this.ctx, this);
    },

    loop(t) {
      this.tick(t);
      this.raf = requestAnimationFrame(this.loop.bind(this));
    },
  };

  game.audio = engine.audio;
  game.input = new InputManager(canvas, function () { return game.uiButtons(); }, function (id) { game.onAction(id); });
  loadImage('assets/ai_head.png', function (img) { game.aiAvatar = img; });
  loadImage('assets/ai_lead.png', function (img) { game.aiLeadAvatar = img; });
  loadImage('assets/player_head.png', function (img) { game.playerAvatar = img; });
  loadImage('assets/menu_bg.jpg', function (img) { game.menuBg = img; });
  loadImage('assets/dragon_sun.jpg', function (img) { game.sunImg = img; });
  window.addEventListener('resize', function () { game.resize(); updateRotateOverlay(); });
  window.addEventListener('orientationchange', function () { setTimeout(function () { game.resize(); updateRotateOverlay(); }, 200); });
  game.resize();
  updateRotateOverlay();
  document.addEventListener('touchstart', function () { tryLockLandscape(); }, { once: true, passive: true });
  const fsBtn = document.getElementById('fullscreen-btn');
  if (fsBtn && fsBtn.addEventListener) fsBtn.addEventListener('click', function () { tryLockLandscape(); });
  document.addEventListener('fullscreenchange', function () { setTimeout(function () { tryLockLandscape(); }, 150); });
  document.addEventListener('webkitfullscreenchange', function () { setTimeout(function () { tryLockLandscape(); }, 150); });
  document.addEventListener('mozfullscreenchange', function () { setTimeout(function () { tryLockLandscape(); }, 150); });
  return game;
}

/* 启动 */
function boot() {
  const game = createGame();
  game.loop(performance.now());
  if (typeof window !== 'undefined') {
    window.__game = game;
    window.__config = { CFG: CFG, GAME_W: GAME_W, GAME_H: GAME_H };
  }
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
