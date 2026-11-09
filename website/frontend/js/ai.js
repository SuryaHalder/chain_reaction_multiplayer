/**
 * Chain Reaction AI Engine
 * Heuristic tactical bot supporting Easy, Medium, and Hard difficulty levels.
 */

class ChainReactionAI {
  constructor(difficulty = 'medium') {
    this.difficulty = difficulty;
  }

  getBestMove(engine, playerId) {
    const validMoves = [];
    const { rows, cols } = engine;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (engine.isValidMove(r, c, playerId)) {
          validMoves.push({ r, c });
        }
      }
    }

    if (validMoves.length === 0) return null;

    if (this.difficulty === 'easy') {
      // 80% random, 20% corners
      const corners = validMoves.filter(m => 
        (m.r === 0 || m.r === rows - 1) && (m.c === 0 || m.c === cols - 1)
      );
      if (corners.length > 0 && Math.random() < 0.4) {
        return corners[Math.floor(Math.random() * corners.length)];
      }
      return validMoves[Math.floor(Math.random() * validMoves.length)];
    }

    // Medium & Hard: Score each possible move
    let bestScore = -Infinity;
    let bestMoves = [];

    for (const move of validMoves) {
      const score = this.evaluateMove(engine, move.r, move.c, playerId);
      if (score > bestScore) {
        bestScore = score;
        bestMoves = [move];
      } else if (score === bestScore) {
        bestMoves.push(move);
      }
    }

    return bestMoves[Math.floor(Math.random() * bestMoves.length)];
  }

  evaluateMove(engine, r, c, playerId) {
    const cell = engine.board[r][c];
    const { rows, cols } = engine;
    let score = 0;

    const isCorner = (r === 0 || r === rows - 1) && (c === 0 || c === cols - 1);
    const isEdge = (r === 0 || r === rows - 1) || (c === 0 || c === cols - 1);

    // 1. Positional bias: Corners > Edges > Center
    if (isCorner) score += 25;
    else if (isEdge) score += 12;
    else score += 5;

    // 2. Will this move cause an explosion?
    const willExplode = (cell.count + 1 >= cell.maxOrbs);
    if (willExplode) {
      score += 30; // Explosions trigger cascades and claim territory
    }

    // 3. Inspect orthogonal neighbors
    const deltas = [[-1, 0], [0, 1], [1, 0], [0, -1]];
    let dangerousOpponentNear = false;
    let opponentOrbsCaptured = 0;

    for (const [dr, dc] of deltas) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
        const neighbor = engine.board[nr][nc];

        if (neighbor.owner !== null && neighbor.owner !== playerId) {
          // Opponent neighbor!
          const neighborCritical = (neighbor.count >= neighbor.maxOrbs - 1);

          if (willExplode) {
            // We capture their orbs!
            opponentOrbsCaptured += neighbor.count * 15;
          } else if (neighborCritical) {
            // Neighbor is ready to explode and wipe our cell!
            dangerousOpponentNear = true;
          }
        } else if (neighbor.owner === playerId) {
          // Friendly neighbor: potential cascade chain!
          if (willExplode && neighbor.count + 1 >= neighbor.maxOrbs) {
            score += 40; // Double cascade!
          }
        }
      }
    }

    score += opponentOrbsCaptured;

    if (dangerousOpponentNear && !willExplode) {
      // Placing an orb next to an explosive opponent cell is dangerous
      score -= (this.difficulty === 'hard' ? 45 : 20);
    }

    // Hard difficulty: chain reaction simulation depth
    if (this.difficulty === 'hard' && willExplode) {
      score += 15;
    }

    return score;
  }
}

window.ChainReactionAI = ChainReactionAI;
