/**
 * Chain Reaction Comprehensive Gameplay Test Suite
 * Tests all core mechanics, critical mass rules, cascading explosion waves,
 * multi-cell captures, player eliminations, victory checks, and turn rotations.
 */

const assert = require('assert');

// Core Engine Logic for Testing
function createEmptyBoard(rows, cols) {
  const board = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      let maxOrbs = 4;
      const isTopBottom = (r === 0 || r === rows - 1);
      const isLeftRight = (c === 0 || c === cols - 1);
      if (isTopBottom && isLeftRight) {
        maxOrbs = 2; // Corner
      } else if (isTopBottom || isLeftRight) {
        maxOrbs = 3; // Edge
      }
      row.push({ row: r, col: c, count: 0, owner: null, maxOrbs });
    }
    board.push(row);
  }
  return board;
}

/**
 * Wave-Based Cascade Resolution Engine
 * Processes chain reactions in discrete, simultaneous explosion waves.
 */
function resolveMoveWaves(board, row, col, playerId, rows, cols) {
  const waves = [];

  // 1. Initial placement
  const cell = board[row][col];
  cell.count += 1;
  cell.owner = playerId;

  waves.push({
    waveNumber: 0,
    type: 'placement',
    row,
    col,
    count: cell.count,
    owner: playerId
  });

  const directions = [[-1, 0], [0, 1], [1, 0], [0, -1]];
  let waveNum = 1;
  const maxWaves = 500; // Loop guard

  while (waveNum <= maxWaves) {
    // Find all cells that meet or exceed critical mass in this wave
    const explodingCells = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (board[r][c].count >= board[r][c].maxOrbs) {
          explodingCells.push({ r, c, maxOrbs: board[r][c].maxOrbs, owner: board[r][c].owner });
        }
      }
    }

    if (explodingCells.length === 0) {
      break; // Quiescent state reached
    }

    const currentWave = {
      waveNumber: waveNum,
      type: 'explosion_wave',
      explosions: [],
      impacts: []
    };

    // Phase A: Cells explode and deduct critical mass
    for (const exp of explodingCells) {
      const c = board[exp.r][exp.c];
      c.count -= exp.maxOrbs;
      if (c.count === 0) {
        c.owner = null;
      }
      currentWave.explosions.push({
        r: exp.r,
        c: exp.c,
        remainingCount: c.count,
        owner: c.owner
      });
    }

    // Phase B: Orbs travel to neighbors and capture them
    for (const exp of explodingCells) {
      for (const [dr, dc] of directions) {
        const nr = exp.r + dr;
        const nc = exp.c + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
          const neighbor = board[nr][nc];
          neighbor.count += 1;
          neighbor.owner = playerId; // Captured by current player!

          currentWave.impacts.push({
            fromR: exp.r,
            fromC: exp.c,
            toR: nr,
            toC: nc,
            newCount: neighbor.count,
            newOwner: playerId
          });
        }
      }
    }

    waves.push(currentWave);
    waveNum++;
  }

  return waves;
}

function countOrbs(board, rows, cols) {
  const counts = {};
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = board[r][c];
      if (cell.owner !== null && cell.count > 0) {
        counts[cell.owner] = (counts[cell.owner] || 0) + cell.count;
      }
    }
  }
  return counts;
}

// -------------------------------------------------------------
// TEST SUITE
// -------------------------------------------------------------

function runTests() {
  console.log('====================================================');
  console.log('   RUNNING CHAIN REACTION GAMEPLAY TEST SUITE       ');
  console.log('====================================================');

  const rows = 9;
  const cols = 6;

  // TEST 1: Critical Mass Values
  console.log('Test 1: Critical Mass on Grid (Corners, Edges, Center)...');
  const b1 = createEmptyBoard(rows, cols);
  assert.strictEqual(b1[0][0].maxOrbs, 2, 'Top-Left corner must be 2');
  assert.strictEqual(b1[0][cols-1].maxOrbs, 2, 'Top-Right corner must be 2');
  assert.strictEqual(b1[rows-1][0].maxOrbs, 2, 'Bottom-Left corner must be 2');
  assert.strictEqual(b1[rows-1][cols-1].maxOrbs, 2, 'Bottom-Right corner must be 2');
  assert.strictEqual(b1[0][1].maxOrbs, 3, 'Top edge must be 3');
  assert.strictEqual(b1[1][0].maxOrbs, 3, 'Left edge must be 3');
  assert.strictEqual(b1[1][1].maxOrbs, 4, 'Interior cell must be 4');
  console.log('  PASSED: Critical mass values are accurate.');

  // TEST 2: Single Placement
  console.log('Test 2: Single Orb Placement...');
  const b2 = createEmptyBoard(rows, cols);
  const w2 = resolveMoveWaves(b2, 0, 0, 'p1', rows, cols);
  assert.strictEqual(b2[0][0].count, 1);
  assert.strictEqual(b2[0][0].owner, 'p1');
  assert.strictEqual(w2.length, 1, 'Non-exploding placement must produce 1 wave');
  console.log('  PASSED: Single placement works.');

  // TEST 3: Corner Explosion
  console.log('Test 3: Corner Explosion (Critical Mass = 2)...');
  const b3 = createEmptyBoard(rows, cols);
  resolveMoveWaves(b3, 0, 0, 'p1', rows, cols); // count = 1
  const w3 = resolveMoveWaves(b3, 0, 0, 'p1', rows, cols); // count reaches 2 -> explodes!
  assert.strictEqual(b3[0][0].count, 0, 'Corner must be empty after exploding');
  assert.strictEqual(b3[0][0].owner, null, 'Corner owner must be null');
  assert.strictEqual(b3[0][1].count, 1, 'Right neighbor must receive 1 orb');
  assert.strictEqual(b3[0][1].owner, 'p1');
  assert.strictEqual(b3[1][0].count, 1, 'Bottom neighbor must receive 1 orb');
  assert.strictEqual(b3[1][0].owner, 'p1');
  assert.strictEqual(w3.length, 2, 'Explosion move must produce 2 waves (placement + explosion)');
  console.log('  PASSED: Corner explosion correctly distributes 2 orbs.');

  // TEST 4: Edge Explosion (Critical Mass = 3)
  console.log('Test 4: Edge Explosion (Critical Mass = 3)...');
  const b4 = createEmptyBoard(rows, cols);
  resolveMoveWaves(b4, 0, 1, 'p1', rows, cols); // 1
  resolveMoveWaves(b4, 0, 1, 'p1', rows, cols); // 2
  const w4 = resolveMoveWaves(b4, 0, 1, 'p1', rows, cols); // 3 -> explodes!
  assert.strictEqual(b4[0][1].count, 0, 'Edge cell must be empty');
  assert.strictEqual(b4[0][0].count, 1, 'Left neighbor (corner) must receive orb');
  assert.strictEqual(b4[0][2].count, 1, 'Right neighbor must receive orb');
  assert.strictEqual(b4[1][1].count, 1, 'Down neighbor must receive orb');
  assert.strictEqual(b4[0][0].owner, 'p1');
  assert.strictEqual(b4[0][2].owner, 'p1');
  assert.strictEqual(b4[1][1].owner, 'p1');
  console.log('  PASSED: Edge explosion distributes 3 orbs orthogonally.');

  // TEST 5: Interior Explosion (Critical Mass = 4)
  console.log('Test 5: Interior Explosion (Critical Mass = 4)...');
  const b5 = createEmptyBoard(rows, cols);
  for (let i = 0; i < 4; i++) {
    resolveMoveWaves(b5, 2, 2, 'p1', rows, cols);
  }
  assert.strictEqual(b5[2][2].count, 0, 'Center cell must be empty');
  assert.strictEqual(b5[1][2].count, 1, 'Up neighbor receives 1 orb');
  assert.strictEqual(b5[2][3].count, 1, 'Right neighbor receives 1 orb');
  assert.strictEqual(b5[3][2].count, 1, 'Down neighbor receives 1 orb');
  assert.strictEqual(b5[2][1].count, 1, 'Left neighbor receives 1 orb');
  console.log('  PASSED: Interior explosion distributes 4 orbs orthogonally.');

  // TEST 6: Opponent Orb Capture in Chain Reaction
  console.log('Test 6: Capturing Opponent Cells during Explosion...');
  const b6 = createEmptyBoard(rows, cols);
  // P2 places on (0, 1) - count 1
  resolveMoveWaves(b6, 0, 1, 'p2', rows, cols);
  assert.strictEqual(b6[0][1].owner, 'p2');

  // P1 places twice on (0, 0) -> explodes into (0, 1) and (1, 0)
  resolveMoveWaves(b6, 0, 0, 'p1', rows, cols);
  resolveMoveWaves(b6, 0, 0, 'p1', rows, cols);

  // (0, 1) should now have count 2 AND be captured by P1!
  assert.strictEqual(b6[0][1].count, 2, '(0, 1) should now have 2 orbs');
  assert.strictEqual(b6[0][1].owner, 'p1', '(0, 1) must be converted to P1');
  console.log('  PASSED: Opponent cell captured and converted successfully.');

  // TEST 7: Cascading Multi-Wave Chain Reaction
  console.log('Test 7: Cascading Chain Reaction across multiple waves...');
  const b7 = createEmptyBoard(rows, cols);
  // Setup:
  // (0, 1) is at 2 orbs (needs 1 to explode)
  resolveMoveWaves(b7, 0, 1, 'p2', rows, cols);
  resolveMoveWaves(b7, 0, 1, 'p2', rows, cols);

  // (0, 0) is at 1 orb (needs 1 to explode)
  resolveMoveWaves(b7, 0, 0, 'p1', rows, cols);

  // Now P1 places 2nd orb on (0, 0) -> triggers cascade!
  // Wave 1: (0, 0) explodes -> sends orb to (0, 1).
  // Wave 2: (0, 1) now has 3 orbs (critical mass 3) -> explodes!
  const w7 = resolveMoveWaves(b7, 0, 0, 'p1', rows, cols);

  assert.strictEqual(b7[0][0].count, 1, '(0, 0) receives rebound orb from (0, 1)');
  assert.strictEqual(b7[0][0].owner, 'p1');
  assert.strictEqual(b7[0][1].count, 0, '(0, 1) exploded and is now empty');
  assert.strictEqual(b7[0][2].count, 1, '(0, 2) received orb from (0, 1)');
  assert.strictEqual(b7[0][2].owner, 'p1');
  assert.strictEqual(b7[1][1].count, 1, '(1, 1) received orb from (0, 1)');
  assert.strictEqual(b7[1][1].owner, 'p1');
  assert.strictEqual(w7.length, 3, 'Must have 3 waves: placement, wave 1 explosion, wave 2 explosion');
  console.log('  PASSED: Multi-wave cascading chain reaction resolved cleanly.');

  // TEST 8: Surplus Orbs Retention (> Critical Mass)
  console.log('Test 8: Surplus Orbs Retention (> Critical Mass)...');
  const b8 = createEmptyBoard(rows, cols);
  // Interior cell (1, 1) needs 4. Pre-fill with 3 orbs.
  for (let i = 0; i < 3; i++) resolveMoveWaves(b8, 1, 1, 'p1', rows, cols);

  // Directly simulate 2 simultaneous neighbor explosions that add 2 orbs to (1, 1) -> count becomes 5!
  b8[1][1].count = 5;
  // Exploding (1, 1) should shed 4 orbs and keep 1 orb!
  const w8 = resolveMoveWaves(b8, 1, 1, 'p1', rows, cols);
  // (1, 1) was at 5 + 1 = 6 orbs. Exploded 4 orbs -> 2 remain!
  assert.strictEqual(b8[1][1].count, 2, 'Surplus orbs must remain in cell');
  assert.strictEqual(b8[1][1].owner, 'p1');
  console.log('  PASSED: Surplus orbs (> critical mass) correctly preserved.');

  // TEST 9: Player Elimination Rules
  console.log('Test 9: Player Elimination Rules (Round 1 vs Later)...');
  const players = [
    { id: 'p1', name: 'Player 1', hasPlayedFirstTurn: false, isEliminated: false },
    { id: 'p2', name: 'Player 2', hasPlayedFirstTurn: false, isEliminated: false },
    { id: 'p3', name: 'Player 3', hasPlayedFirstTurn: false, isEliminated: false }
  ];

  const b9 = createEmptyBoard(rows, cols);

  // P1 moves
  resolveMoveWaves(b9, 0, 0, 'p1', rows, cols);
  players[0].hasPlayedFirstTurn = true;

  // Verify: P2 and P3 have 0 orbs, but have NOT played yet, so NOT eliminated!
  let counts = countOrbs(b9, rows, cols);
  for (const p of players) {
    if (p.hasPlayedFirstTurn && (!counts[p.id] || counts[p.id] === 0)) {
      p.isEliminated = true;
    }
  }
  assert.strictEqual(players[1].isEliminated, false, 'P2 must NOT be eliminated before move 1');
  assert.strictEqual(players[2].isEliminated, false, 'P3 must NOT be eliminated before move 1');

  // P2 moves on (0, 1)
  resolveMoveWaves(b9, 0, 1, 'p2', rows, cols);
  players[1].hasPlayedFirstTurn = true;

  // P3 moves on (8, 5)
  resolveMoveWaves(b9, 8, 5, 'p3', rows, cols);
  players[2].hasPlayedFirstTurn = true;

  // Now all 3 have played first turn.
  // P1 detonates (0, 0) and captures P2's only cell (0, 1)!
  resolveMoveWaves(b9, 0, 0, 'p1', rows, cols);

  counts = countOrbs(b9, rows, cols);
  for (const p of players) {
    if (p.hasPlayedFirstTurn && (!counts[p.id] || counts[p.id] === 0)) {
      p.isEliminated = true;
    }
  }

  assert.strictEqual(players[1].isEliminated, true, 'P2 MUST be eliminated after all orbs captured');
  assert.strictEqual(players[0].isEliminated, false, 'P1 is active');
  assert.strictEqual(players[2].isEliminated, false, 'P3 is active');
  console.log('  PASSED: Elimination rules verified without false positives.');

  // TEST 10: Turn Rotation with Eliminated Players
  console.log('Test 10: Turn Rotation Skipping Eliminated Players...');
  function getNextTurn(currIdx, playerList) {
    const n = playerList.length;
    for (let i = 1; i <= n; i++) {
      const nextIdx = (currIdx + i) % n;
      if (!playerList[nextIdx].isEliminated) {
        return nextIdx;
      }
    }
    return -1;
  }

  // Players [P1, P2 (eliminated), P3]
  // Current turn is P1 (index 0). Next must be P3 (index 2)!
  assert.strictEqual(getNextTurn(0, players), 2, 'Turn must skip eliminated P2 and go to P3');
  // Current turn is P3 (index 2). Next must be P1 (index 0)!
  assert.strictEqual(getNextTurn(2, players), 0, 'Turn must wrap around to P1');
  console.log('  PASSED: Turn rotation seamlessly skips eliminated players.');

  // TEST 11: Victory Condition
  console.log('Test 11: Victory Condition...');
  // P1 now detonates on (8, 4) and captures P3's only cell (8, 5)!
  // Set (8, 5) to P1
  b9[8][5].owner = 'p1';
  counts = countOrbs(b9, rows, cols);
  for (const p of players) {
    if (p.hasPlayedFirstTurn && (!counts[p.id] || counts[p.id] === 0)) {
      p.isEliminated = true;
    }
  }

  const surviving = players.filter(p => !p.isEliminated);
  const startedCount = players.filter(p => p.hasPlayedFirstTurn).length;
  const isGameOver = startedCount >= 2 && surviving.length === 1;
  assert.strictEqual(isGameOver, true, 'Game must be over');
  assert.strictEqual(surviving[0].id, 'p1', 'P1 must be the winner');
  console.log('  PASSED: Victory correctly awarded to sole survivor.');

  console.log('\n====================================================');
  console.log(' ALL 11 TEST SUITES PASSED FLAWLESSLY!               ');
  console.log('====================================================');
}

runTests();
