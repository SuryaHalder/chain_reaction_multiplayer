/**
 * Server WebSocket Integration Test
 * Verifies Room Creation, Joining, Starting, Move Resolution, and Wave Payloads.
 */

const http = require('http');
const { WebSocket } = require('../server/node_modules/ws');

// Spawn server on test port 9999
process.env.PORT = '9999';
require('../server/server.js');

function wait(ms) {
  return new Promise(res => setTimeout(res, ms));
}

async function runTest() {
  console.log('Testing Server WebSocket API on port 9999...');
  await wait(1000);

  const ws1 = new WebSocket('ws://127.0.0.1:9999');
  let roomCode = null;
  let p1Id = null;

  const p1Messages = [];
  ws1.on('message', data => p1Messages.push(JSON.parse(data.toString())));

  await new Promise(res => ws1.on('open', res));
  console.log('  Player 1 connected');

  // Create room
  ws1.send(JSON.stringify({
    action: 'CREATE_ROOM',
    playerName: 'Alice',
    gridSize: { rows: 5, cols: 5 },
    maxPlayers: 2
  }));

  await wait(200);
  const createdMsg = p1Messages.find(m => m.type === 'ROOM_CREATED');
  if (!createdMsg) throw new Error('ROOM_CREATED not received');
  roomCode = createdMsg.roomCode;
  p1Id = createdMsg.playerId;
  console.log(`  Room created: ${roomCode}, Host ID: ${p1Id}`);

  // Connect Player 2
  const ws2 = new WebSocket('ws://127.0.0.1:9999');
  const p2Messages = [];
  ws2.on('message', data => p2Messages.push(JSON.parse(data.toString())));

  await new Promise(res => ws2.on('open', res));
  console.log('  Player 2 connected');

  ws2.send(JSON.stringify({
    action: 'JOIN_ROOM',
    roomCode: roomCode,
    playerName: 'Bob'
  }));

  await wait(200);
  const joinedMsg = p2Messages.find(m => m.type === 'ROOM_JOINED');
  if (!joinedMsg) throw new Error('ROOM_JOINED not received');
  const p2Id = joinedMsg.playerId;
  console.log(`  Player 2 joined with ID: ${p2Id}`);

  // Player 2 ready
  ws2.send(JSON.stringify({ action: 'TOGGLE_READY' }));
  await wait(100);

  // Player 1 start game
  ws1.send(JSON.stringify({ action: 'START_GAME' }));
  await wait(200);

  const startedMsg = p1Messages.find(m => m.type === 'GAME_STARTED');
  if (!startedMsg) throw new Error('GAME_STARTED not received');
  console.log('  Game started successfully!');

  // Player 1 makes a move at (0, 0) - corner cell
  ws1.send(JSON.stringify({
    action: 'MAKE_MOVE',
    row: 0,
    col: 0
  }));

  await wait(200);
  const move1 = p1Messages.find(m => m.type === 'MOVE_RESULT');
  if (!move1) throw new Error('MOVE_RESULT not received for move 1');
  if (move1.waves.length !== 1 || move1.waves[0].type !== 'placement') {
    throw new Error('Expected placement wave for first corner move');
  }
  if (move1.nextPlayerId !== p2Id) {
    throw new Error(`Expected next player to be Player 2 (${p2Id}), got ${move1.nextPlayerId}`);
  }
  console.log('  Move 1 verified: Wave 0 placement received, turn advanced to Player 2');

  // Player 2 makes a move at (0, 4) - opposite corner
  ws2.send(JSON.stringify({
    action: 'MAKE_MOVE',
    row: 0,
    col: 4
  }));

  await wait(200);
  const move2 = p2Messages.filter(m => m.type === 'MOVE_RESULT').pop();
  if (!move2 || move2.nextPlayerId !== p1Id) {
    throw new Error('Expected next player to be Player 1');
  }
  console.log('  Move 2 verified: turn returned to Player 1');

  // Player 1 triggers corner explosion at (0, 0)
  ws1.send(JSON.stringify({
    action: 'MAKE_MOVE',
    row: 0,
    col: 0
  }));

  await wait(200);
  const move3 = p1Messages.filter(m => m.type === 'MOVE_RESULT').pop();
  if (!move3) throw new Error('MOVE_RESULT not received for explosion move');
  if (move3.waves.length < 2) {
    throw new Error(`Expected at least 2 waves (placement + explosion), got ${move3.waves.length}`);
  }
  const expWave = move3.waves.find(w => w.type === 'explosion_wave');
  if (!expWave || expWave.explosions.length !== 1 || expWave.impacts.length !== 2) {
    throw new Error('Expected corner explosion with 2 impacts to (0,1) and (1,0)');
  }
  console.log('  Move 3 verified: Corner explosion wave with 2 orthogonal impacts correctly generated!');

  // Test Invalid Move 1: Out of turn move
  ws1.send(JSON.stringify({
    action: 'MAKE_MOVE',
    row: 2,
    col: 2
  }));
  await wait(200);
  const outOfTurnErr = p1Messages.filter(m => m.type === 'ERROR').pop();
  if (!outOfTurnErr || !outOfTurnErr.message.includes('turn')) {
    throw new Error('Expected out of turn error');
  }
  console.log('  Turn protection verified: Out-of-turn move successfully rejected');

  // Test Invalid Move 2: Tapping opponent cell
  // It's Player 2's turn now. Player 1 owns (0, 1) and (1, 0) from the explosion.
  ws2.send(JSON.stringify({
    action: 'MAKE_MOVE',
    row: 0,
    col: 1
  }));
  await wait(200);
  const opponentCellErr = p2Messages.filter(m => m.type === 'ERROR').pop();
  if (!opponentCellErr || !opponentCellErr.message.includes('only place orbs on empty')) {
    throw new Error('Expected opponent cell placement rejection error');
  }
  console.log('  Cell ownership verified: Placing on opponent cell successfully rejected');

  // Player 2 places on their own cell at (0, 4) to reach 2 orbs (corner explosion!)
  ws2.send(JSON.stringify({
    action: 'MAKE_MOVE',
    row: 0,
    col: 4
  }));
  await wait(200);
  const move4 = p2Messages.filter(m => m.type === 'MOVE_RESULT').pop();
  if (!move4 || move4.waves.length < 2) {
    throw new Error('Expected Player 2 corner explosion');
  }
  console.log('  Move 4 verified: Player 2 corner explosion resolved');

  ws1.close();
  ws2.close();
  console.log('\n>>> ALL SERVER INTEGRATION TESTS PASSED PERFECTLY! <<<');
  process.exit(0);
}

runTest().catch(err => {
  console.error('\nTEST FAILED:', err);
  process.exit(1);
});
