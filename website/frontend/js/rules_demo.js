/**
 * Chain Reaction Rules & Case Animations Controller
 * Drives the interactive mini-simulation canvas demonstrating:
 * 1. Corner cell explosion (Critical Mass = 2)
 * 2. Edge cell explosion (Critical Mass = 3)
 * 3. Opponent capture & cascading chain reactions
 */

class RulesDemoController {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.currentScenario = 'corner';
    this.animating = false;
    this.animationTimer = null;
    this.lastTime = performance.now();

    this.rows = 3;
    this.cols = 3;
    this.board = [];
    this.projectiles = [];
    this.particles = [];
    this.rotations = {};
    this.colorMap = {
      0: { id: 0, name: 'Red', hex: '#f44336', glow: 'rgba(244,67,54,0.7)', light: '#ff7961', dark: '#ba000d' },
      1: { id: 1, name: 'Green', hex: '#4caf50', glow: 'rgba(76,175,80,0.7)', light: '#80e27e', dark: '#087f23' },
      2: { id: 2, name: 'Blue', hex: '#2196f3', glow: 'rgba(33,150,243,0.7)', light: '#6ec6ff', dark: '#0069c0' }
    };

    this.initCanvas();
    window.addEventListener('resize', () => this.initCanvas());
    this.startLoop();
  }

  initCanvas() {
    if (!this.canvas) return;
    const parent = this.canvas.parentElement;
    if (!parent) return;

    const rect = parent.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.min(360, rect.width > 0 ? rect.width : 340);
    const h = w; // Square 3x3

    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';

    this.ctx.scale(dpr, dpr);
    this.width = w;
    this.height = h;

    this.cellSize = (w - 16) / 3;
    this.offsetX = 8;
    this.offsetY = 8;
    this.orbRadius = this.cellSize * 0.22;
  }

  startLoop() {
    const loop = (now) => {
      const dt = Math.min(0.1, (now - this.lastTime) / 1000);
      this.lastTime = now;
      this.update(dt);
      this.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  createEmptyBoard() {
    const b = [];
    for (let r = 0; r < 3; r++) {
      const row = [];
      for (let c = 0; c < 3; c++) {
        let maxOrbs = 4;
        const isTB = (r === 0 || r === 2);
        const isLR = (c === 0 || c === 2);
        if (isTB && isLR) maxOrbs = 2;
        else if (isTB || isLR) maxOrbs = 3;
        row.push({ count: 0, owner: null, maxOrbs });
      }
      b.push(row);
    }
    return b;
  }

  getCellCoords(r, c) {
    return {
      x: this.offsetX + (c * this.cellSize) + (this.cellSize / 2),
      y: this.offsetY + (r * this.cellSize) + (this.cellSize / 2)
    };
  }

  playScenario(type) {
    this.currentScenario = type;
    if (this.animationTimer) clearTimeout(this.animationTimer);
    this.projectiles = [];
    this.particles = [];
    this.board = this.createEmptyBoard();

    const descEl = document.getElementById('rules-scenario-desc');

    if (type === 'corner') {
      if (descEl) {
        descEl.innerHTML = `<strong>Corner Explosion (Critical Mass = 2):</strong> Corner cells have only 2 orthogonal neighbors. When the 2nd orb is added, the cell bursts, shooting orbs horizontally and vertically!`;
      }
      this.setupCornerScenario();
    } else if (type === 'edge') {
      if (descEl) {
        descEl.innerHTML = `<strong>Edge Explosion (Critical Mass = 3):</strong> Border cells have 3 neighbors. Upon reaching 3 orbs, the cell bursts and fires orbs in 3 directions!`;
      }
      this.setupEdgeScenario();
    } else if (type === 'cascade') {
      if (descEl) {
        descEl.innerHTML = `<strong>Capturing &amp; Cascade Reactions:</strong> When your expanding orbs hit opponent cells, you capture them instantly! If that pushes them to critical mass, they explode too, setting off an unstoppable chain reaction!`;
      }
      this.setupCascadeScenario();
    }
  }

  setupCornerScenario() {
    // Cell (0,0) starts with 1 Red orb
    this.board[0][0] = { count: 1, owner: 0, maxOrbs: 2 };

    // After 800ms, place 2nd orb on (0,0)
    this.animationTimer = setTimeout(() => {
      this.board[0][0].count = 2;
      this.createParticles(0, 0, 0);

      // Explosive burst
      setTimeout(() => {
        this.board[0][0].count = 0;
        this.board[0][0].owner = null;
        this.launchProjectile(0, 0, 0, 1, 0, 1);
        this.launchProjectile(0, 0, 1, 0, 0, 1);

        // Landing
        setTimeout(() => {
          this.board[0][1] = { count: 1, owner: 0, maxOrbs: 3 };
          this.board[1][0] = { count: 1, owner: 0, maxOrbs: 3 };
        }, 300);
      }, 150);
    }, 800);
  }

  setupEdgeScenario() {
    // Cell (0,1) starts with 2 Blue orbs (critical mass is 3)
    this.board[0][1] = { count: 2, owner: 2, maxOrbs: 3 };

    this.animationTimer = setTimeout(() => {
      this.board[0][1].count = 3;
      this.createParticles(0, 1, 2);

      // Explodes in 3 directions: left (0,0), right (0,2), down (1,1)
      setTimeout(() => {
        this.board[0][1].count = 0;
        this.board[0][1].owner = null;
        this.launchProjectile(0, 1, 0, 0, 2, 1);
        this.launchProjectile(0, 1, 0, 2, 2, 1);
        this.launchProjectile(0, 1, 1, 1, 2, 1);

        setTimeout(() => {
          this.board[0][0] = { count: 1, owner: 2, maxOrbs: 2 };
          this.board[0][2] = { count: 1, owner: 2, maxOrbs: 2 };
          this.board[1][1] = { count: 1, owner: 2, maxOrbs: 4 };
        }, 300);
      }, 150);
    }, 800);
  }

  setupCascadeScenario() {
    // Red center (1,1) has 3 orbs (critical!)
    this.board[1][1] = { count: 3, owner: 0, maxOrbs: 4 };
    // Green neighbor (1,0) has 2 orbs (critical edge!)
    this.board[1][0] = { count: 2, owner: 1, maxOrbs: 3 };
    // Green neighbor (0,1) has 1 orb
    this.board[0][1] = { count: 1, owner: 1, maxOrbs: 3 };

    this.animationTimer = setTimeout(() => {
      // Red places 4th orb on (1,1)
      this.board[1][1].count = 4;
      this.createParticles(1, 1, 0);

      // Wave 1: Center cell explodes outward into 4 directions
      setTimeout(() => {
        this.board[1][1].count = 0;
        this.board[1][1].owner = null;

        this.launchProjectile(1, 1, 1, 0, 0, 3); // Hits Green cell at (1,0)
        this.launchProjectile(1, 1, 0, 1, 0, 2); // Hits Green cell at (0,1)
        this.launchProjectile(1, 1, 1, 2, 0, 1); // Hits Empty (1,2)
        this.launchProjectile(1, 1, 2, 1, 0, 1); // Hits Empty (2,1)

        // Wave 1 impacts: Green at (1,0) becomes Red and has 3 orbs!
        setTimeout(() => {
          this.board[1][2] = { count: 1, owner: 0, maxOrbs: 3 };
          this.board[2][1] = { count: 1, owner: 0, maxOrbs: 3 };
          this.board[0][1] = { count: 2, owner: 0, maxOrbs: 3 }; // Captured!

          this.board[1][0] = { count: 3, owner: 0, maxOrbs: 3 }; // Captured & CRITICAL!
          this.createParticles(1, 0, 0);

          // Wave 2: Cascading explosion from (1,0)!
          setTimeout(() => {
            this.board[1][0].count = 0;
            this.board[1][0].owner = null;

            this.launchProjectile(1, 0, 0, 0, 0, 1); // hits (0,0)
            this.launchProjectile(1, 0, 2, 0, 0, 1); // hits (2,0)
            this.launchProjectile(1, 0, 1, 1, 0, 1); // returns to (1,1)

            setTimeout(() => {
              this.board[0][0] = { count: 1, owner: 0, maxOrbs: 2 };
              this.board[2][0] = { count: 1, owner: 0, maxOrbs: 2 };
              this.board[1][1] = { count: 1, owner: 0, maxOrbs: 4 };
            }, 300);
          }, 250);

        }, 300);
      }, 150);
    }, 800);
  }

  launchProjectile(fromR, fromC, toR, toC, owner, newCount) {
    const from = this.getCellCoords(fromR, fromC);
    const to = this.getCellCoords(toR, toC);
    this.projectiles.push({
      fromX: from.x,
      fromY: from.y,
      toX: to.x,
      toY: to.y,
      progress: 0,
      speed: 4.5,
      owner,
      targetR: toR,
      targetC: toC,
      newCount
    });
  }

  createParticles(r, c, owner) {
    const pos = this.getCellCoords(r, c);
    const col = this.colorMap[owner] || this.colorMap[0];
    for (let i = 0; i < 12; i++) {
      const angle = (Math.PI * 2 * i) / 12;
      const speed = 40 + Math.random() * 60;
      this.particles.push({
        x: pos.x,
        y: pos.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.8,
        decay: 2.2,
        radius: 2,
        color: col.hex
      });
    }
  }

  update(dt) {
    // Projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.progress += p.speed * dt;
      if (p.progress >= 1.0) {
        this.projectiles.splice(i, 1);
      }
    }

    // Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.life -= pt.decay * dt;
      if (pt.life <= 0) {
        this.particles.splice(i, 1);
      }
    }

    // Rotations
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const k = `${r}_${c}`;
        this.rotations[k] = (this.rotations[k] || 0) + 2.5 * dt;
      }
    }
  }

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    // 1. Draw Grid
    const startX = this.offsetX;
    const startY = this.offsetY;
    const totalW = this.cellSize * 3;
    const totalH = this.cellSize * 3;

    ctx.save();
    ctx.fillStyle = '#0c111a';
    ctx.fillRect(startX, startY, totalW, totalH);

    ctx.strokeStyle = '#00e5ff';
    ctx.shadowColor = 'rgba(0, 229, 255, 0.4)';
    ctx.shadowBlur = 10;
    ctx.lineWidth = 2;
    ctx.strokeRect(startX, startY, totalW, totalH);

    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 1; c < 3; c++) {
      const x = startX + c * this.cellSize;
      ctx.moveTo(x, startY);
      ctx.lineTo(x, startY + totalH);
    }
    for (let r = 1; r < 3; r++) {
      const y = startY + r * this.cellSize;
      ctx.moveTo(startX, y);
      ctx.lineTo(startX + totalW, y);
    }
    ctx.stroke();
    ctx.restore();

    // 2. Draw Orbs
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const cell = this.board[r] ? this.board[r][c] : null;
        if (cell && cell.count > 0 && cell.owner !== null) {
          const pos = this.getCellCoords(r, c);
          const col = this.colorMap[cell.owner] || this.colorMap[0];
          const rot = this.rotations[`${r}_${c}`] || 0;
          this.renderCellOrbs(pos.x, pos.y, cell.count, col, rot, cell.count >= cell.maxOrbs - 1);
        }
      }
    }

    // 3. Draw Projectiles
    for (const p of this.projectiles) {
      const curX = p.fromX + (p.toX - p.fromX) * p.progress;
      const curY = p.fromY + (p.toY - p.fromY) * p.progress;
      const col = this.colorMap[p.owner] || this.colorMap[0];

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(p.fromX, p.fromY);
      ctx.lineTo(curX, curY);
      ctx.strokeStyle = col.glow;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.stroke();

      this.draw3DSphere(curX, curY, this.orbRadius * 0.8, col);
      ctx.restore();
    }

    // 4. Draw Particles
    for (const pt of this.particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, pt.life);
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  renderCellOrbs(x, y, count, color, rot, isCritical) {
    const ctx = this.ctx;
    const r = this.orbRadius;

    ctx.save();
    if (isCritical) {
      ctx.beginPath();
      ctx.arc(x, y, r * 1.6, 0, Math.PI * 2);
      ctx.fillStyle = color.glow;
      ctx.globalAlpha = 0.35 + (Math.sin(rot * 2) * 0.15);
      ctx.fill();
      ctx.globalAlpha = 1.0;
    }

    if (count === 1) {
      this.draw3DSphere(x, y, r, color);
    } else if (count === 2) {
      const orbitR = r * 0.85;
      const x1 = x + Math.cos(rot) * orbitR;
      const y1 = y + Math.sin(rot) * orbitR;
      const x2 = x - Math.cos(rot) * orbitR;
      const y2 = y - Math.sin(rot) * orbitR;
      this.draw3DSphere(x1, y1, r * 0.9, color);
      this.draw3DSphere(x2, y2, r * 0.9, color);
    } else if (count >= 3) {
      const orbitR = r * 1.0;
      for (let i = 0; i < 3; i++) {
        const angle = rot + (i * (Math.PI * 2 / 3));
        const ox = x + Math.cos(angle) * orbitR;
        const oy = y + Math.sin(angle) * orbitR;
        this.draw3DSphere(ox, oy, r * 0.82, color);
      }
    }
    ctx.restore();
  }

  draw3DSphere(x, y, radius, color) {
    const ctx = this.ctx;
    ctx.save();
    ctx.shadowColor = color.glow;
    ctx.shadowBlur = radius * 0.8;

    const grad = ctx.createRadialGradient(
      x - radius * 0.3,
      y - radius * 0.3,
      radius * 0.1,
      x,
      y,
      radius
    );
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.25, color.light || color.hex);
    grad.addColorStop(0.7, color.hex);
    grad.addColorStop(1, color.dark || '#000000');

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  }
}

if (typeof window !== 'undefined') {
  window.RulesDemoController = RulesDemoController;
}
