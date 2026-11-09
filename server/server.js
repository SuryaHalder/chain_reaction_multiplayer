/**
 * Chain Reaction Multiplayer WebSocket & HTTP Server
 * Supports:
 * 1. LAN Multiplayer (Local Wi-Fi / Hotspot with auto-discovery)
 * 2. Online Multiplayer (Rooms with unique 6-character room codes)
 * 3. Authoritative move validation & cascade calculation
 * 4. Disconnect/reconnect tolerance with state sync
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = process.env.PORT || 8080;
const CLIENT_DIR = path.join(__dirname, '..', 'client');

// Available Player Colors
const PLAYER_COLORS = [
  { id: 0, name: 'Red', hex: '#f44336', glow: 'rgba(244,67,54,0.6)' },
  { id: 1, name: 'Green', hex: '#4caf50', glow: 'rgba(76,175,80,0.6)' },
  { id: 2, name: 'Blue', hex: '#2196f3', glow: 'rgba(33,150,243,0.6)' },
  { id: 3, name: 'Yellow', hex: '#ffeb3b', glow: 'rgba(255,235,59,0.6)' },
  { id: 4, name: 'Orange', hex: '#ff9800', glow: 'rgba(255,152,0,0.6)' },
  { id: 5, name: 'Purple', hex: '#ab47bc', glow: 'rgba(171,71,188,0.6)' },
  { id: 6, name: 'Cyan', hex: '#00e5ff', glow: 'rgba(0,229,255,0.6)' },
  { id: 7, name: 'White', hex: '#ffffff', glow: 'rgba(255,255,255,0.6)' }
];

// Helper to get local network IP addresses (for LAN hosting)
function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

// In-Memory Rooms State
// roomCode -> { code, hostId, maxPlayers, gridSize, turnTimer, status, players, board, turnIndex, roundsPlayed }
const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return rooms.has(code) ? generateRoomCode() : code;
}

// MIME types for static server
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.svg': 'image/svg+xml'
};

// HTTP Server: Serves Web Client & LAN Discovery API
const server = http.createServer((req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // LAN Discovery endpoint
  if (req.url === '/api/lan/info' || req.url === '/api/info') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      service: 'chain-reaction-game-server',
      version: '1.0.0',
      activeRooms: rooms.size,
      localIps: getLocalIpAddresses(),
      port: PORT
    }));
    return;
  }

  // Health check endpoint (for Render / Railway)
  if (req.url === '/health' || req.url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
    return;
  }

  // Serve static files from client folder
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/' || reqPath === '') {
    reqPath = '/index.html';
  }

  const safePath = path.normalize(path.join(CLIENT_DIR, reqPath));
  if (!safePath.startsWith(CLIENT_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(safePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    const ext = path.extname(safePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(safePath).pipe(res);
  });
});

// WebSocket Server
const wss = new WebSocketServer({ server });

function broadcastToRoom(roomCode, message, excludeSocket = null) {
  const room = rooms.get(roomCode);
  if (!room) return;
  const data = JSON.stringify(message);
  for (const p of room.players) {
    if (p.ws && p.ws.readyState === WebSocket.OPEN && p.ws !== excludeSocket) {
      p.ws.send(data);
    }
  }
}

function sendTo(ws, message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

// Chain Reaction Game Board Logic on Server (Authoritative)
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
      row.push({ count: 0, owner: null, maxOrbs });
    }
    board.push(row);
  }
  return board;
}

// Process a move with full recursive chain explosions
function processMove(board, row, col, playerId, rows, cols) {
  const steps = []; // Animation steps for clients to reproduce exactly
  const queue = [{ r: row, c: col }];

  // Place initial orb
  board[row][col].count += 1;
  board[row][col].owner = playerId;
  steps.push({ type: 'place', r: row, c: col, count: board[row][col].count, owner: playerId });

  const maxIterations = 2000;
  let iterations = 0;

  while (queue.length > 0 && iterations < maxIterations) {
    iterations++;
    const current = queue.shift();
    const cell = board[current.r][current.c];

    if (cell.count >= cell.maxOrbs) {
      // Cell explodes!
      cell.count -= cell.maxOrbs;
      if (cell.count === 0) {
        cell.owner = null;
      }

      steps.push({
        type: 'explode',
        r: current.r,
        c: current.c,
        remainingCount: cell.count,
        owner: cell.owner
      });

      // Orthogonal neighbors: [Up, Right, Down, Left]
      const deltas = [[-1, 0], [0, 1], [1, 0], [0, -1]];
      for (const [dr, dc] of deltas) {
        const nr = current.r + dr;
        const nc = current.c + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
          const neighbor = board[nr][nc];
          neighbor.count += 1;
          neighbor.owner = playerId; // Captured by expanding player!
          steps.push({
            type: 'expand',
            fromR: current.r,
            fromC: current.c,
            toR: nr,
            toC: nc,
            count: neighbor.count,
            owner: playerId
          });

          if (neighbor.count >= neighbor.maxOrbs) {
            queue.push({ r: nr, c: nc });
          }
        }
      }
    }
  }

  return steps;
}

// Count orbs for each player on board
function countPlayerOrbs(board, rows, cols) {
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

wss.on('connection', (ws) => {
  let playerRoomCode = null;
  let playerId = null;

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw);
      const action = data.action;

      switch (action) {
        case 'CREATE_ROOM': {
          const code = generateRoomCode();
          const pName = (data.playerName || 'Player 1').trim().slice(0, 16);
          playerId = 'p_' + Math.random().toString(36).substring(2, 9);
          playerRoomCode = code;

          const rows = data.gridSize?.rows || 9;
          const cols = data.gridSize?.cols || 6;
          const maxPlayers = Math.min(8, Math.max(2, data.maxPlayers || 4));
          const turnTimer = data.turnTimer !== undefined ? data.turnTimer : 20;

          const hostPlayer = {
            id: playerId,
            name: pName,
            colorId: 0,
            isHost: true,
            isReady: true,
            isEliminated: false,
            hasPlayedFirstTurn: false,
            ws: ws
          };

          const room = {
            code,
            hostId: playerId,
            maxPlayers,
            gridSize: { rows, cols },
            turnTimer,
            status: 'LOBBY', // LOBBY, PLAYING, FINISHED
            players: [hostPlayer],
            board: null,
            currentTurnIndex: 0,
            turnExpiresAt: null,
            winner: null
          };

          rooms.set(code, room);

          sendTo(ws, {
            type: 'ROOM_CREATED',
            roomCode: code,
            playerId,
            room: serializeRoom(room)
          });
          break;
        }

        case 'JOIN_ROOM': {
          const code = (data.roomCode || '').toUpperCase().trim();
          const room = rooms.get(code);

          if (!room) {
            sendTo(ws, { type: 'ERROR', message: `Room "${code}" not found.` });
            return;
          }

          if (room.status !== 'LOBBY') {
            sendTo(ws, { type: 'ERROR', message: 'Game has already started in this room.' });
            return;
          }

          if (room.players.length >= room.maxPlayers) {
            sendTo(ws, { type: 'ERROR', message: 'Room is full (max ' + room.maxPlayers + ' players).' });
            return;
          }

          playerId = 'p_' + Math.random().toString(36).substring(2, 9);
          playerRoomCode = code;
          const pName = (data.playerName || ('Player ' + (room.players.length + 1))).trim().slice(0, 16);

          // Find first available color
          const takenColors = new Set(room.players.map(p => p.colorId));
          let availableColor = 0;
          for (let i = 0; i < 8; i++) {
            if (!takenColors.has(i)) {
              availableColor = i;
              break;
            }
          }

          const newPlayer = {
            id: playerId,
            name: pName,
            colorId: availableColor,
            isHost: false,
            isReady: false,
            isEliminated: false,
            hasPlayedFirstTurn: false,
            ws: ws
          };

          room.players.push(newPlayer);

          sendTo(ws, {
            type: 'ROOM_JOINED',
            roomCode: code,
            playerId,
            room: serializeRoom(room)
          });

          broadcastToRoom(code, {
            type: 'PLAYER_JOINED',
            player: serializePlayer(newPlayer),
            room: serializeRoom(room)
          }, ws);
          break;
        }

        case 'RECONNECT': {
          const code = (data.roomCode || '').toUpperCase().trim();
          const rId = data.playerId;
          const room = rooms.get(code);

          if (!room) {
            sendTo(ws, { type: 'ERROR', message: 'Room no longer exists.' });
            return;
          }

          const existingPlayer = room.players.find(p => p.id === rId);
          if (!existingPlayer) {
            sendTo(ws, { type: 'ERROR', message: 'Player not found in room.' });
            return;
          }

          existingPlayer.ws = ws;
          playerId = rId;
          playerRoomCode = code;

          sendTo(ws, {
            type: 'RECONNECTED',
            roomCode: code,
            playerId: rId,
            room: serializeRoom(room)
          });

          broadcastToRoom(code, {
            type: 'PLAYER_RECONNECTED',
            playerId: rId,
            playerName: existingPlayer.name
          }, ws);
          break;
        }

        case 'UPDATE_SETTINGS': {
          const room = rooms.get(playerRoomCode);
          if (!room || room.hostId !== playerId || room.status !== 'LOBBY') return;

          if (data.gridSize) {
            room.gridSize.rows = Math.min(16, Math.max(6, data.gridSize.rows || 9));
            room.gridSize.cols = Math.min(12, Math.max(4, data.gridSize.cols || 6));
          }
          if (data.maxPlayers) {
            room.maxPlayers = Math.min(8, Math.max(room.players.length, data.maxPlayers));
          }
          if (data.turnTimer !== undefined) {
            room.turnTimer = Math.max(0, Math.min(60, data.turnTimer));
          }

          broadcastToRoom(playerRoomCode, {
            type: 'SETTINGS_UPDATED',
            gridSize: room.gridSize,
            maxPlayers: room.maxPlayers,
            turnTimer: room.turnTimer
          });
          break;
        }

        case 'SELECT_COLOR': {
          const room = rooms.get(playerRoomCode);
          if (!room || room.status !== 'LOBBY') return;
          const chosenColorId = parseInt(data.colorId, 10);
          if (chosenColorId < 0 || chosenColorId >= 8) return;

          // Check if taken
          const isTaken = room.players.some(p => p.id !== playerId && p.colorId === chosenColorId);
          if (isTaken) {
            sendTo(ws, { type: 'ERROR', message: 'This color is already taken by another player.' });
            return;
          }

          const player = room.players.find(p => p.id === playerId);
          if (player) {
            player.colorId = chosenColorId;
            broadcastToRoom(playerRoomCode, {
              type: 'COLOR_CHANGED',
              playerId,
              colorId: chosenColorId
            });
          }
          break;
        }

        case 'TOGGLE_READY': {
          const room = rooms.get(playerRoomCode);
          if (!room || room.status !== 'LOBBY') return;
          const player = room.players.find(p => p.id === playerId);
          if (player) {
            player.isReady = !player.isReady;
            broadcastToRoom(playerRoomCode, {
              type: 'READY_CHANGED',
              playerId,
              isReady: player.isReady
            });
          }
          break;
        }

        case 'START_GAME': {
          const room = rooms.get(playerRoomCode);
          if (!room || room.hostId !== playerId || room.status !== 'LOBBY') return;

          if (room.players.length < 2) {
            sendTo(ws, { type: 'ERROR', message: 'Need at least 2 players to start the game!' });
            return;
          }

          // Check if all non-host players are ready
          const unready = room.players.filter(p => !p.isReady && !p.isHost);
          if (unready.length > 0) {
            sendTo(ws, { type: 'ERROR', message: 'Waiting for all players to click Ready!' });
            return;
          }

          room.status = 'PLAYING';
          room.board = createEmptyBoard(room.gridSize.rows, room.gridSize.cols);
          room.currentTurnIndex = 0;
          room.winner = null;

          for (const p of room.players) {
            p.isEliminated = false;
            p.hasPlayedFirstTurn = false;
          }

          broadcastToRoom(playerRoomCode, {
            type: 'GAME_STARTED',
            room: serializeRoom(room)
          });
          break;
        }

        case 'MAKE_MOVE': {
          const room = rooms.get(playerRoomCode);
          if (!room || room.status !== 'PLAYING') return;

          const activePlayers = room.players.filter(p => !p.isEliminated);
          const currentTurnPlayer = activePlayers[room.currentTurnIndex % activePlayers.length];

          if (!currentTurnPlayer || currentTurnPlayer.id !== playerId) {
            sendTo(ws, { type: 'ERROR', message: 'Not your turn!' });
            return;
          }

          const r = parseInt(data.row, 10);
          const c = parseInt(data.col, 10);
          const { rows, cols } = room.gridSize;

          if (r < 0 || r >= rows || c < 0 || c >= cols) {
            sendTo(ws, { type: 'ERROR', message: 'Move out of bounds.' });
            return;
          }

          const cell = room.board[r][c];
          if (cell.owner !== null && cell.owner !== playerId) {
            sendTo(ws, { type: 'ERROR', message: 'You can only place orbs on empty cells or cells you own!' });
            return;
          }

          // Mark that this player has made at least one turn
          currentTurnPlayer.hasPlayedFirstTurn = true;

          // Execute move on authoritative board
          const steps = processMove(room.board, r, c, playerId, rows, cols);

          // Check for eliminated players
          const orbCounts = countPlayerOrbs(room.board, rows, cols);
          const newlyEliminated = [];

          // A player can only be eliminated if ALL active players have played their first turn!
          const allStarted = room.players.every(p => p.hasPlayedFirstTurn || p.isEliminated);
          if (allStarted) {
            for (const p of room.players) {
              if (!p.isEliminated && (!orbCounts[p.id] || orbCounts[p.id] === 0)) {
                p.isEliminated = true;
                newlyEliminated.push(p.id);
              }
            }
          }

          // Check Victory Condition
          const surviving = room.players.filter(p => !p.isEliminated);
          let isGameOver = false;
          let winner = null;

          if (allStarted && surviving.length === 1) {
            isGameOver = true;
            winner = surviving[0];
            room.status = 'FINISHED';
            room.winner = serializePlayer(winner);
          } else if (surviving.length === 0) {
            // Draw
            isGameOver = true;
            room.status = 'FINISHED';
          }

          // Advance turn to next surviving player
          if (!isGameOver) {
            const nextSurviving = room.players.filter(p => !p.isEliminated);
            const prevIndex = nextSurviving.findIndex(p => p.id === playerId);
            room.currentTurnIndex = (prevIndex + 1) % nextSurviving.length;
          }

          const nextPlayer = isGameOver ? null : room.players.filter(p => !p.isEliminated)[room.currentTurnIndex];

          broadcastToRoom(playerRoomCode, {
            type: 'MOVE_RESULT',
            playerId,
            row: r,
            col: c,
            steps,
            newlyEliminated,
            nextPlayerId: nextPlayer ? nextPlayer.id : null,
            isGameOver,
            winner: winner ? serializePlayer(winner) : null,
            board: room.board
          });
          break;
        }

        case 'RESTART_GAME': {
          const room = rooms.get(playerRoomCode);
          if (!room || room.hostId !== playerId) return;

          room.status = 'PLAYING';
          room.board = createEmptyBoard(room.gridSize.rows, room.gridSize.cols);
          room.currentTurnIndex = 0;
          room.winner = null;

          for (const p of room.players) {
            p.isEliminated = false;
            p.hasPlayedFirstTurn = false;
          }

          broadcastToRoom(playerRoomCode, {
            type: 'GAME_STARTED',
            room: serializeRoom(room)
          });
          break;
        }

        case 'PING': {
          sendTo(ws, { type: 'PONG' });
          break;
        }

        case 'CHAT': {
          const room = rooms.get(playerRoomCode);
          if (!room) return;
          const player = room.players.find(p => p.id === playerId);
          const text = (data.text || '').trim().slice(0, 100);
          if (text && player) {
            broadcastToRoom(playerRoomCode, {
              type: 'CHAT_MESSAGE',
              playerId,
              playerName: player.name,
              colorId: player.colorId,
              text
            });
          }
          break;
        }
      }
    } catch (err) {
      console.error('WebSocket message parsing error:', err);
    }
  });

  ws.on('close', () => {
    if (playerRoomCode && playerId) {
      const room = rooms.get(playerRoomCode);
      if (room) {
        if (room.status === 'LOBBY') {
          // Remove player from lobby
          room.players = room.players.filter(p => p.id !== playerId);
          if (room.players.length === 0) {
            rooms.delete(playerRoomCode);
          } else {
            // Reassign host if host left
            if (room.hostId === playerId) {
              room.hostId = room.players[0].id;
              room.players[0].isHost = true;
            }
            broadcastToRoom(playerRoomCode, {
              type: 'PLAYER_LEFT',
              playerId,
              room: serializeRoom(room)
            });
          }
        } else {
          // In game: mark disconnected
          broadcastToRoom(playerRoomCode, {
            type: 'PLAYER_DISCONNECTED',
            playerId
          });
        }
      }
    }
  });
});

// Helper serializers (exclude ws reference)
function serializePlayer(p) {
  return {
    id: p.id,
    name: p.name,
    colorId: p.colorId,
    color: PLAYER_COLORS[p.colorId] || PLAYER_COLORS[0],
    isHost: p.isHost,
    isReady: p.isReady,
    isEliminated: p.isEliminated
  };
}

function serializeRoom(room) {
  const activePlayers = room.players.filter(p => !p.isEliminated);
  const currentTurnPlayer = activePlayers[room.currentTurnIndex % Math.max(1, activePlayers.length)];

  return {
    code: room.code,
    hostId: room.hostId,
    maxPlayers: room.maxPlayers,
    gridSize: room.gridSize,
    turnTimer: room.turnTimer,
    status: room.status,
    players: room.players.map(serializePlayer),
    currentTurnPlayerId: currentTurnPlayer ? currentTurnPlayer.id : null,
    winner: room.winner,
    board: room.board
  };
}

// Start Server
server.listen(PORT, '0.0.0.0', () => {
  const ips = getLocalIpAddresses();
  console.log('====================================================');
  console.log('   CHAIN REACTION MULTIPLAYER SERVER RUNNING        ');
  console.log('====================================================');
  console.log(`Port: ${PORT}`);
  console.log(`Local Access: http://localhost:${PORT}`);
  console.log('LAN Addresses (for local network play):');
  ips.forEach(ip => console.log(`  http://${ip}:${PORT}`));
  console.log('WebSocket Server ready for LAN & Online games!');
  console.log('====================================================');
});
