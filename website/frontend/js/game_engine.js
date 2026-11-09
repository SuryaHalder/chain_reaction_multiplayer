/**
 * Chain Reaction Game Engine
 * Core board rules, critical mass, cascading explosion generator,
 * elimination and victory conditions.
 */

const PLAYER_PALETTE = [
  { id: 0, name: 'Red', hex: '#f44336', glow: 'rgba(244,67,54,0.7)', light: '#ff7961', dark: '#ba000d' },
  { id: 1, name: 'Green', hex: '#4caf50', glow: 'rgba(76,175,80,0.7)', light: '#80e27e', dark: '#087f23' },
  { id: 2, name: 'Blue', hex: '#2196f3', glow: 'rgba(33,150,243,0.7)', light: '#6ec6ff', dark: '#0069c0' },
  { id: 3, name: 'Yellow', hex: '#ffeb3b', glow: 'rgba(255,235,59,0.7)', light: '#ffff72', dark: '#c8b900' },
  { id: 4, name: 'Orange', hex: '#ff9800', glow: 'rgba(255,152,0,0.7)', light: '#ffc947', dark: '#c66900' },
  { id: 5, name: 'Purple', hex: '#ab47bc', glow: 'rgba(171,71,188,0.7)', light: '#df78ef', dark: '#790e8b' },
  { id: 6, name: 'Cyan', hex: '#00e5ff', glow: 'rgba(0,229,255,0.7)', light: '#6effff', dark: '#00b2cc' },
  { id: 7, name: 'White', hex: '#f5f5f5', glow: 'rgba(255,255,255,0.7)', light: '#ffffff', dark: '#cccccc' }
];

class ChainReactionEngine {
  constructor(rows = 9, cols = 6, players = []) {
    this.rows = rows;
    this.cols = cols;
    this.players = players; // array of { id, name, colorId, isAI, isEliminated, hasPlayedFirstTurn }
    this.board = [];
    this.currentTurnIndex = 0;
    this.roundsPlayed = 0;
    this.isGameOver = false;
    this.winner = null;
    this.history = []; // for offline undo
    this.initBoard();
  }

  initBoard() {
    this.board = [];
    for (let r = 0; r < this.rows; r++) {
      const row = [];
      for (let c = 0; c < this.cols; c++) {
        let maxOrbs = 4;
        const isTopBottom = (r === 0 || r === this.rows - 1);
        const isLeftRight = (c === 0 || c === this.cols - 1);
        if (isTopBottom && isLeftRight) {
          maxOrbs = 2; // Corner
        } else if (isTopBottom || isLeftRight) {
          maxOrbs = 3; // Edge
        }
        row.push({
          row: r,
          col: c,
          count: 0,
          owner: null,
          maxOrbs: maxOrbs
        });
      }
      this.board.push(row);
    }
    this.isGameOver = false;
    this.winner = null;
    this.currentTurnIndex = 0;
    this.roundsPlayed = 0;
    this.history = [];
  }

  getActivePlayers() {
    return this.players.filter(p => !p.isEliminated);
  }

  getCurrentPlayer() {
    const active = this.getActivePlayers();
    if (active.length === 0) return null;
    return active[this.currentTurnIndex % active.length];
  }

  isValidMove(r, c, playerId = null) {
    if (this.isGameOver) return false;
    if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return false;
    const current = playerId ? this.players.find(p => p.id === playerId) : this.getCurrentPlayer();
    if (!current || current.isEliminated) return false;

    const cell = this.board[r][c];
    // Cell is valid if empty OR already owned by current player
    return (cell.count === 0 || cell.owner === current.id);
  }

  saveSnapshot() {
    return {
      board: this.board.map(row => row.map(cell => ({ ...cell }))),
      players: this.players.map(p => ({ ...p })),
      currentTurnIndex: this.currentTurnIndex,
      roundsPlayed: this.roundsPlayed,
      isGameOver: this.isGameOver,
      winner: this.winner
    };
  }

  undo() {
    if (this.history.length === 0) return false;
    const prev = this.history.pop();
    this.board = prev.board;
    this.players = prev.players;
    this.currentTurnIndex = prev.currentTurnIndex;
    this.roundsPlayed = prev.roundsPlayed;
    this.isGameOver = prev.isGameOver;
    this.winner = prev.winner;
    return true;
  }

  /**
   * Applies a move at (r, c)
   * Returns a sequence of atomic animation steps so the renderer can animate them smoothly!
   */
  makeMove(r, c, playerId = null) {
    if (!this.isValidMove(r, c, playerId)) return null;

    this.history.push(this.saveSnapshot());

    const player = playerId ? this.players.find(p => p.id === playerId) : this.getCurrentPlayer();
    player.hasPlayedFirstTurn = true;

    const animationSteps = [];
    const queue = [{ r, c }];

    // Initial placement
    this.board[r][c].count += 1;
    this.board[r][c].owner = player.id;
    animationSteps.push({
      type: 'place',
      r,
      c,
      count: this.board[r][c].count,
      owner: player.id
    });

    let iterations = 0;
    const maxIterations = 2000;

    while (queue.length > 0 && iterations < maxIterations) {
      iterations++;
      const curr = queue.shift();
      const cell = this.board[curr.r][curr.c];

      if (cell.count >= cell.maxOrbs) {
        // Critical mass reached: Explode!
        cell.count -= cell.maxOrbs;
        if (cell.count === 0) {
          cell.owner = null;
        }

        animationSteps.push({
          type: 'explode',
          r: curr.r,
          c: curr.c,
          remainingCount: cell.count,
          owner: cell.owner
        });

        // 4 orthogonal directions: Up, Right, Down, Left
        const directions = [[-1, 0], [0, 1], [1, 0], [0, -1]];
        for (const [dr, dc] of directions) {
          const nr = curr.r + dr;
          const nc = curr.c + dc;
          if (nr >= 0 && nr < this.rows && nc >= 0 && nc < this.cols) {
            const neighbor = this.board[nr][nc];
            neighbor.count += 1;
            neighbor.owner = player.id; // Cell captured!

            animationSteps.push({
              type: 'fly_orb',
              fromR: curr.r,
              fromC: curr.c,
              toR: nr,
              toC: nc,
              count: neighbor.count,
              owner: player.id
            });

            if (neighbor.count >= neighbor.maxOrbs) {
              queue.push({ r: nr, c: nc });
            }
          }
        }
      }
    }

    // Check player eliminations
    this.checkEliminations();

    // Check game over
    this.checkVictory();

    // Advance turn if game continues
    if (!this.isGameOver) {
      const surviving = this.getActivePlayers();
      const prevIdx = surviving.findIndex(p => p.id === player.id);
      this.currentTurnIndex = (prevIdx + 1) % surviving.length;
      this.roundsPlayed++;
    }

    return {
      steps: animationSteps,
      isGameOver: this.isGameOver,
      winner: this.winner,
      nextPlayer: this.getCurrentPlayer()
    };
  }

  countOrbs() {
    const counts = {};
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.board[r][c];
        if (cell.owner !== null && cell.count > 0) {
          counts[cell.owner] = (counts[cell.owner] || 0) + cell.count;
        }
      }
    }
    return counts;
  }

  checkEliminations() {
    // Only eliminate players once all players have completed their first placement!
    const allStarted = this.players.every(p => p.hasPlayedFirstTurn || p.isEliminated);
    if (!allStarted) return [];

    const counts = this.countOrbs();
    const eliminated = [];

    for (const p of this.players) {
      if (!p.isEliminated && (!counts[p.id] || counts[p.id] === 0)) {
        p.isEliminated = true;
        eliminated.push(p);
      }
    }

    return eliminated;
  }

  checkVictory() {
    const allStarted = this.players.every(p => p.hasPlayedFirstTurn || p.isEliminated);
    if (!allStarted) return false;

    const surviving = this.getActivePlayers();
    if (surviving.length === 1) {
      this.isGameOver = true;
      this.winner = surviving[0];
      return true;
    } else if (surviving.length === 0) {
      this.isGameOver = true;
      this.winner = null; // Draw
      return true;
    }
    return false;
  }
}

window.ChainReactionEngine = ChainReactionEngine;
window.PLAYER_PALETTE = PLAYER_PALETTE;
