/**
 * Chain Reaction Canvas 60FPS Renderer
 * Renders glowing grid, spinning 3D-shaded orbs, explosion particle bursts,
 * and projectile orbs with motion blur.
 */

class CanvasRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.engine = null;
    this.animationQueue = [];
    this.activeProjectiles = [];
    this.particles = [];
    this.rotations = {}; // cellKey -> current angle
    this.animating = false;
    this.onMoveComplete = null;

    this.cellWidth = 0;
    this.cellHeight = 0;
    this.gridOffsetX = 0;
    this.gridOffsetY = 0;
    this.orbRadius = 0;

    this.lastTime = performance.now();
    this.colorMap = {};
    for (const p of window.PLAYER_PALETTE) {
      this.colorMap[p.id] = p;
    }

    this.initCanvasSize();
    window.addEventListener('resize', () => this.initCanvasSize());
    this.startLoop();
  }

  setEngine(engine) {
    this.engine = engine;
    this.rotations = {};
    this.activeProjectiles = [];
    this.particles = [];
    this.animationQueue = [];
    this.initCanvasSize();
  }

  initCanvasSize() {
    if (!this.canvas) return;
    const parent = this.canvas.parentElement;
    if (!parent) return;

    const rect = parent.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    // Use available width and height
    const w = rect.width;
    const h = rect.height;

    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';

    this.ctx.scale(dpr, dpr);
    this.displayWidth = w;
    this.displayHeight = h;

    this.recalculateLayout();
  }

  recalculateLayout() {
    if (!this.engine) return;
    const { rows, cols } = this.engine;
    const padding = 12;

    const maxW = this.displayWidth - (padding * 2);
    const maxH = this.displayHeight - (padding * 2);

    const cellByW = maxW / cols;
    const cellByH = maxH / rows;

    // Maintain square cells
    const cellSize = Math.min(cellByW, cellByH);
    this.cellWidth = cellSize;
    this.cellHeight = cellSize;

    const totalGridW = cellSize * cols;
    const totalGridH = cellSize * rows;

    this.gridOffsetX = (this.displayWidth - totalGridW) / 2;
    this.gridOffsetY = (this.displayHeight - totalGridH) / 2;

    this.orbRadius = cellSize * 0.22;
  }

  getCellCoordinates(r, c) {
    const x = this.gridOffsetX + (c * this.cellWidth) + (this.cellWidth / 2);
    const y = this.gridOffsetY + (r * this.cellHeight) + (this.cellHeight / 2);
    return { x, y };
  }

  getCellFromScreen(screenX, screenY) {
    if (!this.engine) return null;
    const { rows, cols } = this.engine;

    const x = screenX - this.gridOffsetX;
    const y = screenY - this.gridOffsetY;

    if (x < 0 || y < 0) return null;

    const col = Math.floor(x / this.cellWidth);
    const row = Math.floor(y / this.cellHeight);

    if (row >= 0 && row < rows && col >= 0 && col < cols) {
      return { row, col };
    }
    return null;
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

  enqueueSteps(steps, onComplete = null) {
    this.onMoveComplete = onComplete;
    this.animationQueue = [...steps];
    this.animating = true;
    this.processNextStep();
  }

  processNextStep() {
    if (this.animationQueue.length === 0) {
      if (this.activeProjectiles.length === 0) {
        this.animating = false;
        if (this.onMoveComplete) {
          const cb = this.onMoveComplete;
          this.onMoveComplete = null;
          cb();
        }
      }
      return;
    }

    // Process a batch of steps (or sequential explosion wave)
    const step = this.animationQueue.shift();

    if (step.type === 'place') {
      window.soundManager.play('click');
      window.soundManager.vibrate(20);
      // Brief pause then next
      setTimeout(() => this.processNextStep(), 60);
    } else if (step.type === 'explode') {
      window.soundManager.play('pop');
      window.soundManager.vibrate(35);
      this.createExplosionParticles(step.r, step.c, step.owner);
      // Wait tiny fraction then fire next
      setTimeout(() => this.processNextStep(), 40);
    } else if (step.type === 'fly_orb') {
      const fromPos = this.getCellCoordinates(step.fromR, step.fromC);
      const toPos = this.getCellCoordinates(step.toR, step.toC);

      this.activeProjectiles.push({
        fromX: fromPos.x,
        fromY: fromPos.y,
        toX: toPos.x,
        toY: toPos.y,
        progress: 0,
        speed: 5.5, // completes in ~0.18s
        owner: step.owner,
        targetR: step.toR,
        targetC: step.toC,
        targetCount: step.count
      });

      // Continue queue
      setTimeout(() => this.processNextStep(), 25);
    }
  }

  createExplosionParticles(r, c, ownerId) {
    const pos = this.getCellCoordinates(r, c);
    const color = this.getPlayerColor(ownerId);
    const count = 16;

    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() * 0.4);
      const speed = 60 + Math.random() * 120;
      this.particles.push({
        x: pos.x,
        y: pos.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1.0,
        decay: 2.2 + Math.random() * 1.5,
        radius: 2 + Math.random() * 3,
        color: color.hex
      });
    }
  }

  getPlayerColor(ownerId) {
    if (this.engine) {
      const player = this.engine.players.find(p => p.id === ownerId);
      if (player && this.colorMap[player.colorId]) {
        return this.colorMap[player.colorId];
      }
    }
    return this.colorMap[0] || window.PLAYER_PALETTE[0];
  }

  update(dt) {
    // 1. Update Cell Orb Rotations
    if (this.engine) {
      const { rows, cols } = this.engine;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const key = `${r}_${c}`;
          if (!this.rotations[key]) {
            this.rotations[key] = Math.random() * Math.PI * 2;
          }
          const cell = this.engine.board[r][c];
          // Critical mass vibration multiplier: rotates faster when near explosion!
          const isCritical = (cell.count === cell.maxOrbs - 1);
          const speed = isCritical ? 4.5 : (1.2 + (cell.count * 0.6));
          this.rotations[key] += speed * dt;
        }
      }
    }

    // 2. Update Active Projectiles
    for (let i = this.activeProjectiles.length - 1; i >= 0; i--) {
      const p = this.activeProjectiles[i];
      p.progress += p.speed * dt;
      if (p.progress >= 1.0) {
        // Projectile arrived!
        this.activeProjectiles.splice(i, 1);
        if (this.animationQueue.length === 0 && this.activeProjectiles.length === 0 && this.animating) {
          this.animating = false;
          if (this.onMoveComplete) {
            const cb = this.onMoveComplete;
            this.onMoveComplete = null;
            cb();
          }
        }
      }
    }

    // 3. Update Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.life -= pt.decay * dt;
      if (pt.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.displayWidth, this.displayHeight);

    if (!this.engine) return;

    const { rows, cols } = this.engine;
    const current = this.engine.getCurrentPlayer();
    const currentColor = current ? (this.colorMap[current.colorId] || window.PLAYER_PALETTE[0]) : window.PLAYER_PALETTE[0];

    // 1. Draw Grid Lines with current player's tinted neon glow
    this.renderGrid(rows, cols, currentColor);

    // 2. Draw Orbs inside cells
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = this.engine.board[r][c];
        if (cell.count > 0 && cell.owner !== null) {
          const pos = this.getCellCoordinates(r, c);
          const color = this.getPlayerColor(cell.owner);
          const rotKey = `${r}_${c}`;
          const rot = this.rotations[rotKey] || 0;
          const isCritical = (cell.count >= cell.maxOrbs - 1);

          this.renderCellOrbs(pos.x, pos.y, cell.count, color, rot, isCritical);
        }
      }
    }

    // 3. Draw Flying Projectiles
    for (const p of this.activeProjectiles) {
      const curX = p.fromX + (p.toX - p.fromX) * p.progress;
      const curY = p.fromY + (p.toY - p.fromY) * p.progress;
      const color = this.getPlayerColor(p.owner);

      // Motion Trail
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(p.fromX, p.fromY);
      ctx.lineTo(curX, curY);
      ctx.strokeStyle = color.glow;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.stroke();

      // Traveling Orb
      this.draw3DSphere(curX, curY, this.orbRadius * 0.85, color);
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

  renderGrid(rows, cols, currentColor) {
    const ctx = this.ctx;
    const startX = this.gridOffsetX;
    const startY = this.gridOffsetY;
    const w = this.cellWidth;
    const h = this.cellHeight;
    const totalW = w * cols;
    const totalH = h * rows;

    ctx.save();

    // Dark grid background
    ctx.fillStyle = '#0f141d';
    ctx.fillRect(startX, startY, totalW, totalH);

    // Glowing outer border tinted with current player's color
    ctx.strokeStyle = currentColor.hex;
    ctx.shadowColor = currentColor.glow;
    ctx.shadowBlur = 12;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(startX, startY, totalW, totalH);

    // Interior grid lines
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;

    ctx.beginPath();
    for (let c = 1; c < cols; c++) {
      const x = startX + (c * w);
      ctx.moveTo(x, startY);
      ctx.lineTo(x, startY + totalH);
    }
    for (let r = 1; r < rows; r++) {
      const y = startY + (r * h);
      ctx.moveTo(startX, y);
      ctx.lineTo(startX + totalW, y);
    }
    ctx.stroke();

    ctx.restore();
  }

  renderCellOrbs(x, y, count, color, rot, isCritical) {
    const ctx = this.ctx;
    const r = this.orbRadius;

    ctx.save();

    // Pulsing halo if critical
    if (isCritical) {
      const pulse = 1 + (Math.sin(rot * 2) * 0.15);
      ctx.beginPath();
      ctx.arc(x, y, r * 1.7 * pulse, 0, Math.PI * 2);
      ctx.fillStyle = color.glow;
      ctx.globalAlpha = 0.35 + (Math.sin(rot * 2) * 0.15);
      ctx.fill();
      ctx.globalAlpha = 1.0;
    }

    if (count === 1) {
      // Single orb: vibrating floating center
      const wobbleX = isCritical ? Math.sin(rot * 3) * 2 : 0;
      const wobbleY = isCritical ? Math.cos(rot * 3) * 2 : 0;
      this.draw3DSphere(x + wobbleX, y + wobbleY, r, color);
    } else if (count === 2) {
      // Two orbs: revolving binary orbit
      const orbitR = r * 0.85;
      const x1 = x + Math.cos(rot) * orbitR;
      const y1 = y + Math.sin(rot) * orbitR;
      const x2 = x - Math.cos(rot) * orbitR;
      const y2 = y - Math.sin(rot) * orbitR;

      this.draw3DSphere(x1, y1, r * 0.9, color);
      this.draw3DSphere(x2, y2, r * 0.9, color);
    } else if (count >= 3) {
      // Three orbs: spinning equilateral triangle formation
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

    // Outer glow
    ctx.shadowColor = color.glow;
    ctx.shadowBlur = radius * 0.8;

    // 3D Spherical Radial Gradient
    // Light source offset to top-left
    const grad = ctx.createRadialGradient(
      x - radius * 0.32,
      y - radius * 0.32,
      radius * 0.1,
      x,
      y,
      radius
    );
    grad.addColorStop(0, '#ffffff'); // Glint/shine
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

window.CanvasRenderer = CanvasRenderer;
