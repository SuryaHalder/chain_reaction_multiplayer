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

// Authoritative Wave-Based Move Resolution
function resolveMoveWaves(board, row, col, playerId, rows, cols) {
  const waves = [];
  const directions = [[-1, 0], [0, 1], [1, 0], [0, -1]];

  // Wave 0: Initial Placement
  board[row][col].count += 1;
  board[row][col].owner = playerId;
  waves.push({
    waveNumber: 0,
    type: 'placement',
    row: row,
    col: col,
    count: board[row][col].count,
    owner: playerId
  });

  let waveNum = 1;
  const maxWaves = 500;

  while (waveNum <= maxWaves) {
    const explodingCells = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = board[r][c];
        if (cell.count >= cell.maxOrbs) {
          explodingCells.push({ r, c, maxOrbs: cell.maxOrbs, owner: cell.owner });
        }
      }
    }

    if (explodingCells.length === 0) break;

    const currentWave = {
      waveNumber: waveNum,
      type: 'explosion_wave',
      explosions: [],
      impacts: []
    };

    // Phase A: Cells explode and shed critical mass
    for (const exp of explodingCells) {
      const cell = board[exp.r][exp.c];
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
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
          const neighbor = board[nr][nc];
          neighbor.count += 1;
          neighbor.owner = playerId; // Captured by expanding player!
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

function advanceRoomTurn(room) {
  const n = room.players.length;
  for (let i = 1; i <= n; i++) {
    const nextIdx = (room.currentTurnIndex + i) % n;
    if (!room.players[nextIdx].isEliminated) {
      room.currentTurnIndex = nextIdx;
      return room.players[nextIdx];
    }
  }
  return null;
}

function checkRoomEliminations(room) {
  const counts = countPlayerOrbs(room.board, room.gridSize.rows, room.gridSize.cols);
  const newlyEliminated = [];

  for (const p of room.players) {
    if (!p.isEliminated && p.hasPlayedFirstTurn && (!counts[p.id] || counts[p.id] === 0)) {
      p.isEliminated = true;
      newlyEliminated.push(p.id);
    }
  }

  return newlyEliminated;
}

function checkRoomVictory(room) {
  const surviving = room.players.filter(p => !p.isEliminated);
  const startedCount = room.players.filter(p => p.hasPlayedFirstTurn).length;

  if (startedCount >= 2) {
    if (surviving.length === 1) {
      room.status = 'FINISHED';
      room.winner = surviving[0];
      return true;
    } else if (surviving.length === 0) {
      room.status = 'FINISHED';
      room.winner = null;
      return true;
    }
  }
  return false;
}

function stopServerTurnTimer(room) {
  if (room && room.turnTimeoutHandle) {
    clearTimeout(room.turnTimeoutHandle);
    room.turnTimeoutHandle = null;
  }
}

function startServerTurnTimer(roomCode) {
  const room = rooms.get(roomCode);
  if (!room || room.status !== 'PLAYING') return;

  stopServerTurnTimer(room);

  const seconds = parseInt(room.turnTimer, 10);
  if (!seconds || seconds <= 0) {
    return; // Unlimited time
  }

  // Grace buffer of 800ms for network latency
  const durationMs = (seconds * 1000) + 800;

  room.turnTimeoutHandle = setTimeout(() => {
    const r = rooms.get(roomCode);
    if (!r || r.status !== 'PLAYING') return;

    const timedOutPlayer = r.players[r.currentTurnIndex];
    if (!timedOutPlayer) return;

    // Advance turn to next surviving player
    const nextPlayer = advanceRoomTurn(r);

    broadcastToRoom(roomCode, {
      type: 'TURN_TIMEOUT',
      skippedPlayerId: timedOutPlayer.id,
      skippedPlayerName: timedOutPlayer.name,
      nextPlayerId: nextPlayer ? nextPlayer.id : null,
      turnTimer: r.turnTimer
    });

    if (r.status === 'PLAYING') {
      startServerTurnTimer(roomCode);
    }
  }, durationMs);
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
            turnTimer: parseInt(turnTimer, 10),
            turnTimeoutHandle: null,
            status: 'LOBBY', // LOBBY, PLAYING, FINISHED
            players: [hostPlayer],
            board: null,
            currentTurnIndex: 0,
            turnExpiresAt: null,
            winner: null,
            rematchVotes: new Set()
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
          startServerTurnTimer(playerRoomCode);
          break;
        }

        case 'MAKE_MOVE': {
          const room = rooms.get(playerRoomCode);
          if (!room || room.status !== 'PLAYING') return;

          const currentTurnPlayer = room.players[room.currentTurnIndex];

          if (!currentTurnPlayer || currentTurnPlayer.id !== playerId || currentTurnPlayer.isEliminated) {
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
          stopServerTurnTimer(room);

          // Execute wave-based cascade simulation
          const waves = resolveMoveWaves(room.board, r, c, playerId, rows, cols);

          // Check for eliminated players
          const newlyEliminated = checkRoomEliminations(room);

          // Check Victory Condition
          const isGameOver = checkRoomVictory(room);
          const winner = isGameOver ? room.winner : null;

          // Advance turn if game continues
          let nextPlayer = null;
          if (!isGameOver) {
            nextPlayer = advanceRoomTurn(room);
            startServerTurnTimer(playerRoomCode);
          } else {
            stopServerTurnTimer(room);
          }

          broadcastToRoom(playerRoomCode, {
            type: 'MOVE_RESULT',
            playerId,
            row: r,
            col: c,
            waves,
            steps: waves, // backward compatibility
            newlyEliminated,
            nextPlayerId: nextPlayer ? nextPlayer.id : null,
            isGameOver,
            winner: winner ? serializePlayer(winner) : null,
            board: room.board
          });
          break;
        }

        case 'REQUEST_REMATCH': {
          const room = rooms.get(playerRoomCode);
          if (!room || room.status !== 'FINISHED') return;

          if (!room.rematchVotes) {
            room.rematchVotes = new Set();
          }

          room.rematchVotes.add(playerId);

          const requestingPlayer = room.players.find(p => p.id === playerId);
          const connectedPlayers = room.players.filter(p => p.ws && p.ws.readyState === WebSocket.OPEN);
          const neededVotes = connectedPlayers.length;
          const currentVotes = connectedPlayers.filter(p => room.rematchVotes.has(p.id)).length;
          const readyPlayerIds = Array.from(room.rematchVotes);

          // Broadcast rematch update to all players
          broadcastToRoom(playerRoomCode, {
            type: 'REMATCH_UPDATE',
            playerId,
            playerName: requestingPlayer ? requestingPlayer.name : 'A player',
            currentVotes,
            neededVotes,
            readyPlayerIds
          });

          // If all connected players agree (minimum 2 players), start the rematch!
          if (currentVotes >= neededVotes && neededVotes >= 2) {
            room.status = 'PLAYING';
            room.board = createEmptyBoard(room.gridSize.rows, room.gridSize.cols);
            room.currentTurnIndex = 0;
            room.winner = null;
            room.rematchVotes.clear();

            for (const p of room.players) {
              p.isEliminated = false;
              p.hasPlayedFirstTurn = false;
            }

            broadcastToRoom(playerRoomCode, {
              type: 'GAME_STARTED',
              room: serializeRoom(room),
              isRematch: true
            });
            startServerTurnTimer(playerRoomCode);
          }
          break;
        }

        case 'RESTART_GAME': {
          const room = rooms.get(playerRoomCode);
          if (!room || room.hostId !== playerId) return;

          room.status = 'PLAYING';
          room.board = createEmptyBoard(room.gridSize.rows, room.gridSize.cols);
          room.currentTurnIndex = 0;
          room.winner = null;
          if (room.rematchVotes) room.rematchVotes.clear();

          for (const p of room.players) {
            p.isEliminated = false;
            p.hasPlayedFirstTurn = false;
          }

          broadcastToRoom(playerRoomCode, {
            type: 'GAME_STARTED',
            room: serializeRoom(room)
          });
          startServerTurnTimer(playerRoomCode);
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
            stopServerTurnTimer(room);
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
          const openPlayers = room.players.filter(p => p.ws && p.ws.readyState === WebSocket.OPEN && p.id !== playerId);
          if (openPlayers.length === 0) {
            stopServerTurnTimer(room);
            rooms.delete(playerRoomCode);
          }
          if (room.status === 'FINISHED' && room.rematchVotes) {
            room.rematchVotes.delete(playerId);
            const remaining = room.players.filter(p => p.ws && p.ws.readyState === WebSocket.OPEN && p.id !== playerId);
            broadcastToRoom(playerRoomCode, {
              type: 'REMATCH_UPDATE',
              playerId,
              playerName: 'A player disconnected',
              currentVotes: remaining.filter(p => room.rematchVotes.has(p.id)).length,
              neededVotes: remaining.length,
              readyPlayerIds: Array.from(room.rematchVotes),
              playerLeft: true
            });
          }
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
  const currentTurnPlayer = (room.players && room.players.length > 0) ? room.players[room.currentTurnIndex] : null;

  return {
    code: room.code,
    hostId: room.hostId,
    maxPlayers: room.maxPlayers,
    gridSize: room.gridSize,
    turnTimer: room.turnTimer,
    status: room.status,
    players: room.players.map(serializePlayer),
    currentTurnPlayerId: (currentTurnPlayer && !currentTurnPlayer.isEliminated) ? currentTurnPlayer.id : null,
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
