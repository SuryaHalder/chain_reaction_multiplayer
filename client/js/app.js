/**
 * Chain Reaction Application Coordinator
 * Handles UI screens, button clicks, game loop orchestration,
 * LAN & Online multiplayer flows, and toast alerts.
 */

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const screens = {
    menu: document.getElementById('screen-menu'),
    setupLocal: document.getElementById('screen-setup-local'),
    setupAi: document.getElementById('screen-setup-ai'),
    setupLan: document.getElementById('screen-setup-lan'),
    setupOnline: document.getElementById('screen-setup-online'),
    lobby: document.getElementById('screen-lobby'),
    game: document.getElementById('screen-game'),
    settings: document.getElementById('modal-settings')
  };

  const canvas = document.getElementById('game-canvas');
  const renderer = new CanvasRenderer(canvas);
  let engine = null;
  let aiOpponent = null;

  // State
  let gameMode = 'LOCAL'; // LOCAL, AI, LAN, ONLINE
  const LIVE_RENDER_URL = 'wss://chain-reaction-server-qq7p.onrender.com';
  let defaultUrl = LIVE_RENDER_URL;
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    defaultUrl = 'ws://' + window.location.host;
  }
  let currentServerUrl = localStorage.getItem('cr_server_url') || defaultUrl;

  let turnTimerId = null;
  let remainingSeconds = 0;
  let myPlayerId = null;

  // Sound manager unlock on first interaction
  document.body.addEventListener('pointerdown', () => {
    window.soundManager.init();
    window.soundManager.unlock();
  }, { once: true });

  // Navigation helpers
  function showScreen(name) {
    Object.keys(screens).forEach(k => {
      if (screens[k]) screens[k].classList.remove('active');
    });
    if (screens[name]) {
      screens[name].classList.add('active');
    }
    if (name === 'game') {
      renderer.initCanvasSize();
    }
  }

  function showToast(text, duration = 3000) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerText = text;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 400);
    }, duration);
  }

  // --- MENU NAVIGATION ---
  document.getElementById('btn-mode-local').onclick = () => showScreen('setupLocal');
  document.getElementById('btn-mode-ai').onclick = () => showScreen('setupAi');
  document.getElementById('btn-mode-lan').onclick = () => {
    // Show current LAN IPs if available from server
    fetchLanInfo();
    showScreen('setupLan');
  };
  document.getElementById('btn-mode-online').onclick = () => showScreen('setupOnline');
  document.getElementById('btn-settings').onclick = () => screens.settings.classList.add('active');

  // Back buttons
  document.querySelectorAll('.btn-back').forEach(btn => {
    btn.onclick = () => {
      window.soundManager.play('click');
      window.networkClient.disconnect();
      showScreen('menu');
    };
  });

  // Settings Modal Close & Save
  document.getElementById('btn-close-settings').onclick = () => {
    const urlInput = document.getElementById('setting-server-url').value.trim();
    if (urlInput) {
      currentServerUrl = urlInput;
      localStorage.setItem('cr_server_url', currentServerUrl);
    }
    screens.settings.classList.remove('active');
  };

  const toggleSound = document.getElementById('toggle-sound');
  toggleSound.checked = window.soundManager.enabled;
  toggleSound.onchange = () => {
    window.soundManager.enabled = toggleSound.checked;
  };

  // Populate server URL input
  document.getElementById('setting-server-url').value = currentServerUrl;

  // --- 1. LOCAL PASS & PLAY SETUP ---
  document.getElementById('btn-start-local').onclick = () => {
    window.soundManager.play('click');
    gameMode = 'LOCAL';

    const playerCount = parseInt(document.getElementById('local-player-count').value, 10);
    const gridVal = document.getElementById('local-grid-size').value.split('x');
    const rows = parseInt(gridVal[0], 10);
    const cols = parseInt(gridVal[1], 10);

    const players = [];
    for (let i = 0; i < playerCount; i++) {
      players.push({
        id: 'p_' + i,
        name: `Player ${i + 1}`,
        colorId: i,
        isAI: false,
        isEliminated: false,
        hasPlayedFirstTurn: false
      });
    }

    startOfflineGame(rows, cols, players);
  };

  // --- 2. PLAY VS AI SETUP ---
  document.getElementById('btn-start-ai').onclick = () => {
    window.soundManager.play('click');
    gameMode = 'AI';

    const aiCount = parseInt(document.getElementById('ai-bot-count').value, 10);
    const difficulty = document.getElementById('ai-difficulty').value;
    const gridVal = document.getElementById('ai-grid-size').value.split('x');
    const rows = parseInt(gridVal[0], 10);
    const cols = parseInt(gridVal[1], 10);

    aiOpponent = new ChainReactionAI(difficulty);

    const players = [
      { id: 'human', name: 'You', colorId: 0, isAI: false, isEliminated: false, hasPlayedFirstTurn: false }
    ];

    for (let i = 0; i < aiCount; i++) {
      players.push({
        id: 'ai_' + i,
        name: `Bot ${i + 1} (${difficulty.toUpperCase()})`,
        colorId: i + 1,
        isAI: true,
        isEliminated: false,
        hasPlayedFirstTurn: false
      });
    }

    startOfflineGame(rows, cols, players);
  };

  function startOfflineGame(rows, cols, players) {
    engine = new ChainReactionEngine(rows, cols, players);
    renderer.setEngine(engine);
    myPlayerId = null; // in offline mode, any current player can tap

    document.getElementById('btn-undo').style.display = (gameMode === 'LOCAL' ? 'inline-block' : 'none');
    showScreen('game');
    updateHud();
    checkAiTurn();
  }

  // --- 3. LAN MULTIPLAYER SETUP ---
  async function fetchLanInfo() {
    try {
      const resp = await fetch('/api/lan/info');
      if (resp.ok) {
        const info = await resp.json();
        const infoDiv = document.getElementById('lan-ip-display');
        if (info.localIps && info.localIps.length > 0) {
          infoDiv.innerHTML = `Your Host IP: <strong>${info.localIps[0]}:${info.port}</strong>`;
        }
      }
    } catch (e) {}
  }

  document.getElementById('btn-lan-create').onclick = async () => {
    const name = document.getElementById('lan-player-name').value || 'Host';
    const hostPort = document.getElementById('lan-host-port').value || '8080';
    let hostUrl = currentServerUrl;

    // If on LAN, connect to the local IP / current host
    await connectAndCreateRoom(hostUrl, name, 'LAN');
  };

  document.getElementById('btn-lan-join').onclick = async () => {
    const name = document.getElementById('lan-player-name').value || 'Player';
    const targetIp = document.getElementById('lan-join-ip').value.trim();
    const code = document.getElementById('lan-room-code').value.trim().toUpperCase();

    if (!code) {
      showToast('Please enter Room Code!');
      return;
    }

    let serverUrl = currentServerUrl;
    if (targetIp) {
      serverUrl = `ws://${targetIp}`;
      if (!targetIp.includes(':')) {
        serverUrl += ':8080';
      }
    }

    await connectAndJoinRoom(serverUrl, code, name, 'LAN');
  };

  // --- 4. ONLINE MULTIPLAYER SETUP ---
  document.getElementById('btn-online-create').onclick = async () => {
    const name = document.getElementById('online-player-name').value || 'Player 1';
    await connectAndCreateRoom(currentServerUrl, name, 'ONLINE');
  };

  document.getElementById('btn-online-join').onclick = async () => {
    const name = document.getElementById('online-player-name').value || 'Player';
    const code = document.getElementById('online-room-code').value.trim().toUpperCase();

    if (!code) {
      showToast('Please enter the 6-character Room Code!');
      return;
    }

    await connectAndJoinRoom(currentServerUrl, code, name, 'ONLINE');
  };

  async function connectAndCreateRoom(url, playerName, mode) {
    gameMode = mode;
    try {
      showToast('Connecting to server...');
      await window.networkClient.connect(url);
      window.networkClient.createRoom(playerName, {
        gridSize: { rows: 9, cols: 6 },
        maxPlayers: 4,
        turnTimer: 20
      });
    } catch (err) {
      showToast('Failed to connect: ' + err.message);
    }
  }

  async function connectAndJoinRoom(url, roomCode, playerName, mode) {
    gameMode = mode;
    try {
      showToast('Connecting to server...');
      await window.networkClient.connect(url);
      window.networkClient.joinRoom(roomCode, playerName);
    } catch (err) {
      showToast('Failed to connect: ' + err.message);
    }
  }

  // --- MULTIPLAYER LOBBY HANDLERS ---
  window.networkClient.on('room_created', (data) => {
    myPlayerId = data.playerId;
    setupLobbyUI(data.room, true);
    showScreen('lobby');
    showToast(`Room Created! Code: ${data.roomCode}`);
  });

  window.networkClient.on('room_joined', (data) => {
    myPlayerId = data.playerId;
    setupLobbyUI(data.room, false);
    showScreen('lobby');
    showToast(`Joined Room: ${data.roomCode}!`);
  });

  window.networkClient.on('player_joined', (data) => {
    window.soundManager.play('beep');
    setupLobbyUI(data.room, window.networkClient.isHost);
    showToast(`${data.player.name} joined!`);
  });

  window.networkClient.on('player_left', (data) => {
    setupLobbyUI(data.room, window.networkClient.isHost);
    showToast('A player left the room.');
  });

  window.networkClient.on('settings_updated', (data) => {
    document.getElementById('lobby-grid-size').value = `${data.gridSize.rows}x${data.gridSize.cols}`;
  });

  window.networkClient.on('color_changed', (data) => {
    // re-render player list
    const playerEl = document.querySelector(`[data-player-id="${data.playerId}"]`);
    if (playerEl) {
      const col = window.PLAYER_PALETTE[data.colorId];
      playerEl.style.borderLeftColor = col.hex;
    }
  });

  window.networkClient.on('ready_changed', (data) => {
    const readyBadge = document.querySelector(`[data-player-id="${data.playerId}"] .badge-ready`);
    if (readyBadge) {
      readyBadge.innerText = data.isReady ? 'READY' : 'WAITING';
      readyBadge.className = 'badge-ready ' + (data.isReady ? 'ready' : '');
    }
  });

  window.networkClient.on('game_started', (data) => {
    window.soundManager.play('laser');
    const room = data.room;
    engine = new ChainReactionEngine(room.gridSize.rows, room.gridSize.cols, room.players);
    renderer.setEngine(engine);

    document.getElementById('btn-undo').style.display = 'none'; // No undo in online
    showScreen('game');
    updateHud();
    startTurnTimer(room.turnTimer);
  });

  window.networkClient.on('move_result', (data) => {
    // Execute incoming move animation
    renderer.enqueueSteps(data.steps, () => {
      // Update board state
      engine.board = data.board;
      if (data.isGameOver) {
        showGameOver(data.winner);
      } else {
        const nextPlayer = engine.players.find(p => p.id === data.nextPlayerId);
        if (nextPlayer) {
          const surviving = engine.getActivePlayers();
          engine.currentTurnIndex = surviving.findIndex(p => p.id === nextPlayer.id);
        }
        updateHud();
        startTurnTimer(20);
      }
    });
  });

  window.networkClient.on('error', (err) => {
    showToast(err.message);
  });

  window.networkClient.on('disconnected', () => {
    showToast('Disconnected from server.');
  });

  function setupLobbyUI(room, isHost) {
    document.getElementById('lobby-room-code').innerText = room.code;
    const playerList = document.getElementById('lobby-players-list');
    playerList.innerHTML = '';

    room.players.forEach(p => {
      const item = document.createElement('div');
      item.className = 'lobby-player-item';
      item.dataset.playerId = p.id;
      item.style.borderLeft = `5px solid ${p.color.hex}`;

      item.innerHTML = `
        <div class="player-info">
          <span class="player-name">${p.name} ${p.id === myPlayerId ? '(You)' : ''}</span>
          ${p.isHost ? '<span class="badge-host">HOST</span>' : ''}
        </div>
        <span class="badge-ready ${p.isReady ? 'ready' : ''}">${p.isReady ? 'READY' : 'WAITING'}</span>
      `;
      playerList.appendChild(item);
    });

    // Render Color Picker
    const colorPicker = document.getElementById('lobby-color-picker');
    colorPicker.innerHTML = '';
    window.PLAYER_PALETTE.forEach(c => {
      const btn = document.createElement('button');
      btn.className = 'color-btn';
      btn.style.backgroundColor = c.hex;
      btn.title = c.name;

      const isTaken = room.players.some(p => p.colorId === c.id && p.id !== myPlayerId);
      if (isTaken) {
        btn.classList.add('disabled');
      }

      btn.onclick = () => {
        if (!isTaken) {
          window.soundManager.play('click');
          window.networkClient.selectColor(c.id);
        }
      };
      colorPicker.appendChild(btn);
    });

    // Host controls vs Ready button
    const hostControls = document.getElementById('lobby-host-controls');
    const btnStart = document.getElementById('btn-lobby-start');
    const btnReady = document.getElementById('btn-lobby-ready');

    if (isHost) {
      hostControls.style.display = 'block';
      btnStart.style.display = 'inline-block';
      btnReady.style.display = 'none';

      document.getElementById('lobby-grid-size').onchange = (e) => {
        const parts = e.target.value.split('x');
        window.networkClient.updateSettings({
          gridSize: { rows: parseInt(parts[0], 10), cols: parseInt(parts[1], 10) }
        });
      };

      btnStart.onclick = () => {
        window.networkClient.startGame();
      };
    } else {
      hostControls.style.display = 'none';
      btnStart.style.display = 'none';
      btnReady.style.display = 'inline-block';

      btnReady.onclick = () => {
        window.soundManager.play('click');
        window.networkClient.toggleReady();
      };
    }

    // Copy room code button
    document.getElementById('btn-copy-code').onclick = () => {
      navigator.clipboard.writeText(room.code);
      showToast('Room Code copied to clipboard!');
    };

    // Share room button (WhatsApp / System Share)
    document.getElementById('btn-share-room').onclick = () => {
      const shareText = `Join my Chain Reaction room! Code: ${room.code}\nPlay online: ${window.location.href}`;
      if (navigator.share) {
        navigator.share({ title: 'Chain Reaction Game', text: shareText });
      } else {
        navigator.clipboard.writeText(shareText);
        showToast('Invite text copied to clipboard!');
      }
    };
  }

  // --- CANVAS INTERACTION (MAKING A MOVE) ---
  canvas.addEventListener('pointerdown', (e) => {
    if (!engine || engine.isGameOver || renderer.animating) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const cell = renderer.getCellFromScreen(x, y);
    if (!cell) return;

    const currentPlayer = engine.getCurrentPlayer();
    if (!currentPlayer) return;

    if (gameMode === 'LOCAL') {
      executeLocalMove(cell.row, cell.col);
    } else if (gameMode === 'AI') {
      if (!currentPlayer.isAI) {
        executeLocalMove(cell.row, cell.col);
      }
    } else if (gameMode === 'LAN' || gameMode === 'ONLINE') {
      if (currentPlayer.id === myPlayerId) {
        if (engine.isValidMove(cell.row, cell.col, myPlayerId)) {
          window.soundManager.play('click');
          window.networkClient.makeMove(cell.row, cell.col);
        } else {
          showToast('Invalid cell!');
        }
      } else {
        showToast("Wait for your turn!");
      }
    }
  });

  function executeLocalMove(r, c) {
    const result = engine.makeMove(r, c);
    if (!result) {
      window.soundManager.play('beep', { pitch: 0.5 });
      return;
    }

    renderer.enqueueSteps(result.steps, () => {
      if (result.isGameOver) {
        showGameOver(result.winner);
      } else {
        updateHud();
        checkAiTurn();
      }
    });
  }

  function checkAiTurn() {
    if (gameMode !== 'AI' || engine.isGameOver) return;
    const cur = engine.getCurrentPlayer();
    if (cur && cur.isAI) {
      setTimeout(() => {
        if (!engine.isGameOver && !renderer.animating) {
          const move = aiOpponent.getBestMove(engine, cur.id);
          if (move) {
            executeLocalMove(move.r, move.c);
          }
        }
      }, 500);
    }
  }

  // --- HUD & TIMER ---
  function updateHud() {
    if (!engine) return;
    const current = engine.getCurrentPlayer();
    if (!current) return;

    const color = window.PLAYER_PALETTE[current.colorId] || window.PLAYER_PALETTE[0];
    const turnIndicator = document.getElementById('hud-current-turn');
    turnIndicator.innerText = `${current.name}'s Turn`;
    turnIndicator.style.color = color.hex;
    turnIndicator.style.textShadow = `0 0 12px ${color.glow}`;

    // Scoreboard orbs count
    const counts = engine.countOrbs();
    const scoreContainer = document.getElementById('hud-player-scores');
    scoreContainer.innerHTML = '';

    engine.players.forEach(p => {
      const pColor = window.PLAYER_PALETTE[p.colorId];
      const count = counts[p.id] || 0;

      const badge = document.createElement('div');
      badge.className = `player-badge ${p.isEliminated ? 'eliminated' : ''} ${p.id === current.id ? 'active' : ''}`;
      badge.style.borderColor = pColor.hex;
      badge.innerHTML = `
        <span class="badge-dot" style="background-color: ${pColor.hex}"></span>
        <span class="badge-name">${p.name}</span>
        <span class="badge-count">${count}</span>
      `;
      scoreContainer.appendChild(badge);
    });
  }

  function startTurnTimer(seconds) {
    clearInterval(turnTimerId);
    if (!seconds || seconds <= 0) {
      document.getElementById('hud-timer-bar').style.width = '0%';
      return;
    }

    remainingSeconds = seconds;
    const timerBar = document.getElementById('hud-timer-bar');

    turnTimerId = setInterval(() => {
      remainingSeconds--;
      const pct = (remainingSeconds / seconds) * 100;
      timerBar.style.width = pct + '%';

      if (remainingSeconds <= 3 && remainingSeconds > 0) {
        window.soundManager.play('beep');
      }

      if (remainingSeconds <= 0) {
        clearInterval(turnTimerId);
        // Time expired
      }
    }, 1000);
  }

  // --- GAME OVER MODAL ---
  function showGameOver(winner) {
    clearInterval(turnTimerId);
    window.soundManager.play('laser2');
    window.soundManager.vibrate(200);

    const modal = document.getElementById('modal-gameover');
    const winnerText = document.getElementById('gameover-winner-text');
    const winnerColor = winner ? window.PLAYER_PALETTE[winner.colorId] : null;

    if (winner && winnerColor) {
      winnerText.innerText = `${winner.name} WINS!`;
      winnerText.style.color = winnerColor.hex;
      winnerText.style.textShadow = `0 0 20px ${winnerColor.glow}`;
    } else {
      winnerText.innerText = "IT'S A DRAW!";
      winnerText.style.color = '#ffffff';
    }

    modal.classList.add('active');
  }

  document.getElementById('btn-play-again').onclick = () => {
    document.getElementById('modal-gameover').classList.remove('active');
    if (gameMode === 'ONLINE' || gameMode === 'LAN') {
      if (window.networkClient.isHost) {
        window.networkClient.restartGame();
      } else {
        showToast('Waiting for host to restart...');
      }
    } else {
      engine.initBoard();
      renderer.setEngine(engine);
      updateHud();
      checkAiTurn();
    }
  };

  document.getElementById('btn-gameover-menu').onclick = () => {
    document.getElementById('modal-gameover').classList.remove('active');
    window.networkClient.disconnect();
    showScreen('menu');
  };

  // In-Game Menu Button
  document.getElementById('btn-game-menu').onclick = () => {
    if (confirm('Leave current game?')) {
      clearInterval(turnTimerId);
      window.networkClient.disconnect();
      showScreen('menu');
    }
  };

  // Undo button (Local mode only)
  document.getElementById('btn-undo').onclick = () => {
    if (gameMode === 'LOCAL' && engine) {
      if (engine.undo()) {
        window.soundManager.play('click');
        renderer.setEngine(engine);
        updateHud();
      }
    }
  };
});
