/**
 * Chain Reaction Game Engine
 * Core board rules, critical mass, wave-based cascading explosion generator,
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
    this.players = players;
    this.board = [];
    this.currentPlayerIndex = 0;
    this.roundsPlayed = 0;
    this.isGameOver = false;
    this.winner = null;
    this.history = [];
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
    this.currentPlayerIndex = 0;
    this.roundsPlayed = 0;
    this.history = [];

    for (const p of this.players) {
      p.isEliminated = false;
      p.hasPlayedFirstTurn = false;
    }
  }

  getActivePlayers() {
    return this.players.filter(p => !p.isEliminated);
  }

  getCurrentPlayer() {
    if (this.players.length === 0) return null;
    const p = this.players[this.currentPlayerIndex];
    if (p && !p.isEliminated) return p;
    // Advance to next active if current is somehow eliminated
    return this.advanceTurn();
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
      currentPlayerIndex: this.currentPlayerIndex,
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
    this.currentPlayerIndex = prev.currentPlayerIndex;
    this.roundsPlayed = prev.roundsPlayed;
    this.isGameOver = prev.isGameOver;
    this.winner = prev.winner;
    return true;
  }

  /**
   * Authoritative Wave-Based Move Execution
   * Returns: { waves, finalBoard, newlyEliminated, isGameOver, winner, nextPlayer }
   */
  makeMove(r, c, playerId = null) {
    if (!this.isValidMove(r, c, playerId)) return null;

    this.history.push(this.saveSnapshot());

    const player = playerId ? this.players.find(p => p.id === playerId) : this.getCurrentPlayer();
    player.hasPlayedFirstTurn = true;

    const waves = [];
    const directions = [[-1, 0], [0, 1], [1, 0], [0, -1]];

    // Wave 0: Initial Placement
    const initialCell = this.board[r][c];
    initialCell.count += 1;
    initialCell.owner = player.id;

    waves.push({
      waveNumber: 0,
      type: 'placement',
      row: r,
      col: c,
      count: initialCell.count,
      owner: player.id
    });

    let waveNum = 1;
    const maxWaves = 500;

    while (waveNum <= maxWaves) {
      // Find all cells that meet critical mass in this wave
      const explodingCells = [];
      for (let rowIdx = 0; rowIdx < this.rows; rowIdx++) {
        for (let colIdx = 0; colIdx < this.cols; colIdx++) {
          const cell = this.board[rowIdx][colIdx];
          if (cell.count >= cell.maxOrbs) {
            explodingCells.push({
              r: rowIdx,
              c: colIdx,
              maxOrbs: cell.maxOrbs,
              owner: cell.owner
            });
          }
        }
      }

      if (explodingCells.length === 0) {
        break; // Stabilized
      }

      const currentWave = {
        waveNumber: waveNum,
        type: 'explosion_wave',
        explosions: [],
        impacts: []
      };

      // Phase A: Cells explode and shed critical mass
      for (const exp of explodingCells) {
        const cell = this.board[exp.r][exp.c];
        cell.count -= exp.maxOrbs;
        if (cell.count === 0) {
          cell.owner = null;
        }
        currentWave.explosions.push({
          r: exp.r,
          c: exp.c,
          remainingCount: cell.count,
          owner: cell.owner
        });
      }

      // Phase B: Orbs travel orthogonally to neighbor cells
      for (const exp of explodingCells) {
        for (const [dr, dc] of directions) {
          const nr = exp.r + dr;
          const nc = exp.c + dc;
          if (nr >= 0 && nr < this.rows && nc >= 0 && nc < this.cols) {
            const neighbor = this.board[nr][nc];
            neighbor.count += 1;
            neighbor.owner = player.id; // Cell captured by exploding player!

            currentWave.impacts.push({
              fromR: exp.r,
              fromC: exp.c,
              toR: nr,
              toC: nc,
              newCount: neighbor.count,
              newOwner: player.id
            });
          }
        }
      }

      waves.push(currentWave);
      waveNum++;
    }

    // Check Eliminations
    const newlyEliminated = this.checkEliminations();

    // Check Victory
    this.checkVictory();

    // Advance Turn if game continues
    let nextPlayer = null;
    if (!this.isGameOver) {
      nextPlayer = this.advanceTurn();
      this.roundsPlayed++;
    }

    return {
      waves,
      newlyEliminated,
      isGameOver: this.isGameOver,
      winner: this.winner,
      nextPlayer,
      board: this.board
    };
  }

  advanceTurn() {
    const n = this.players.length;
    for (let i = 1; i <= n; i++) {
      const nextIdx = (this.currentPlayerIndex + i) % n;
      if (!this.players[nextIdx].isEliminated) {
        this.currentPlayerIndex = nextIdx;
        return this.players[nextIdx];
      }
    }
    return null;
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
    const counts = this.countOrbs();
    const eliminated = [];

    for (const p of this.players) {
      if (!p.isEliminated && p.hasPlayedFirstTurn && (!counts[p.id] || counts[p.id] === 0)) {
        p.isEliminated = true;
        eliminated.push(p);
      }
    }

    return eliminated;
  }

  checkVictory() {
    const surviving = this.getActivePlayers();
    const startedCount = this.players.filter(p => p.hasPlayedFirstTurn).length;

    if (startedCount >= 2) {
      if (surviving.length === 1) {
        this.isGameOver = true;
        this.winner = surviving[0];
        return true;
      } else if (surviving.length === 0) {
        this.isGameOver = true;
        this.winner = null; // Draw
        return true;
      }
    }
    return false;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ChainReactionEngine, PLAYER_PALETTE };
}
if (typeof window !== 'undefined') {
  window.ChainReactionEngine = ChainReactionEngine;
  window.PLAYER_PALETTE = PLAYER_PALETTE;
}
