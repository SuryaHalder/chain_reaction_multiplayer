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
    rules: document.getElementById('screen-rules'),
    lobby: document.getElementById('screen-lobby'),
    game: document.getElementById('screen-game'),
    settings: document.getElementById('modal-settings')
  };

  const canvas = document.getElementById('game-canvas');
  const renderer = new CanvasRenderer(canvas);
  let engine = null;
  let aiOpponent = null;
  let rulesDemo = null;
  if (window.RulesDemoController) {
    rulesDemo = new RulesDemoController('rules-demo-canvas');
  }

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
  let currentTurnTimer = 20;
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
      setTimeout(() => {
        renderer.initCanvasSize();
      }, 50);
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

  // --- SESSION PERSISTENCE (SURVIVE BROWSER REFRESH / RELOAD) ---
  function saveSession() {
    try {
      if (gameMode === 'LOCAL' || gameMode === 'AI') {
        if (engine && !engine.isGameOver) {
          const session = {
            mode: gameMode,
            turnTimer: currentTurnTimer,
            aiDifficulty: aiOpponent ? aiOpponent.difficulty : 'medium',
            engineState: {
              rows: engine.rows,
              cols: engine.cols,
              players: engine.players,
              board: engine.board,
              currentPlayerIndex: engine.currentPlayerIndex,
              roundsPlayed: engine.roundsPlayed,
              isGameOver: engine.isGameOver,
              winner: engine.winner
            }
          };
          sessionStorage.setItem('cr_active_session', JSON.stringify(session));
        }
      } else if (gameMode === 'ONLINE' || gameMode === 'LAN') {
        if (window.networkClient && window.networkClient.roomCode && myPlayerId) {
          const session = {
            mode: gameMode,
            roomCode: window.networkClient.roomCode,
            playerId: myPlayerId,
            serverUrl: currentServerUrl,
            turnTimer: currentTurnTimer
          };
          sessionStorage.setItem('cr_active_session', JSON.stringify(session));
        }
      }
    } catch (e) {
      console.warn('Failed to save session:', e);
    }
  }

  function clearSession() {
    try {
      sessionStorage.removeItem('cr_active_session');
    } catch (e) {}
  }

  async function restoreActiveSession() {
    const raw = sessionStorage.getItem('cr_active_session');
    if (!raw) return;

    try {
      const saved = JSON.parse(raw);
      if (!saved || !saved.mode) return;

      if (saved.mode === 'LOCAL' || saved.mode === 'AI') {
        const s = saved.engineState;
        if (!s || s.isGameOver) {
          clearSession();
          return;
        }

        gameMode = saved.mode;
        currentTurnTimer = saved.turnTimer !== undefined ? saved.turnTimer : 20;

        if (gameMode === 'AI') {
          aiOpponent = new ChainReactionAI(saved.aiDifficulty || 'medium');
        }

        engine = new ChainReactionEngine(s.rows, s.cols, s.players);
        engine.board = s.board;
        engine.currentPlayerIndex = s.currentPlayerIndex;
        engine.roundsPlayed = s.roundsPlayed;
        engine.isGameOver = s.isGameOver;
        engine.winner = s.winner;

        renderer.setEngine(engine);
        myPlayerId = null;
        document.getElementById('btn-undo').style.display = (gameMode === 'LOCAL' ? 'inline-block' : 'none');

        showScreen('game');
        updateHud();
        startTurnTimer(currentTurnTimer);
        showToast('Resumed active game.');
        checkAiTurn();
      } else if (saved.mode === 'ONLINE' || saved.mode === 'LAN') {
        if (!saved.roomCode || !saved.playerId) {
          clearSession();
          return;
        }

        gameMode = saved.mode;
        myPlayerId = saved.playerId;
        currentTurnTimer = saved.turnTimer !== undefined ? saved.turnTimer : 20;
        const targetUrl = saved.serverUrl || currentServerUrl;

        const recModal = document.getElementById('modal-reconnecting');
        const recText = document.getElementById('reconnect-status-text');
        if (recModal) recModal.classList.add('active');
        if (recText) recText.innerText = `Rejoining Room ${saved.roomCode}... Restoring your match...`;

        const btnRecCancel = document.getElementById('btn-reconnect-cancel');
        if (btnRecCancel) {
          btnRecCancel.onclick = () => {
            if (recModal) recModal.classList.remove('active');
            clearSession();
            if (window.networkClient && window.networkClient.isConnected) {
              window.networkClient.leaveRoom();
            }
            window.networkClient.disconnect();
            showScreen('menu');
          };
        }

        showToast(`Reconnecting to room (${saved.roomCode})...`, 4000);

        try {
          await window.networkClient.connect(targetUrl);
          window.networkClient.reconnect(saved.roomCode, saved.playerId);
        } catch (err) {
          console.warn('Auto-reconnect failed:', err);
          if (recModal) recModal.classList.remove('active');
          clearSession();
          showToast('Could not reconnect to previous room.');
          showScreen('menu');
        }
      }
    } catch (e) {
      console.error('Failed to restore session:', e);
      clearSession();
    }
  }

  // --- MENU NAVIGATION ---
  document.getElementById('btn-mode-local').onclick = () => showScreen('setupLocal');
  document.getElementById('btn-mode-ai').onclick = () => showScreen('setupAi');
  document.getElementById('btn-mode-lan').onclick = () => {
    fetchLanInfo();
    showScreen('setupLan');
  };
  document.getElementById('btn-mode-online').onclick = () => showScreen('setupOnline');
  document.getElementById('btn-settings').onclick = () => screens.settings.classList.add('active');

  // Rules screen
  document.getElementById('btn-rules').onclick = () => {
    window.soundManager.play('click');
    showScreen('rules');
    if (rulesDemo) {
      setTimeout(() => {
        rulesDemo.initCanvas();
        rulesDemo.playScenario('corner');
      }, 50);
    }
  };

  // Rules interactive demo tab switches
  const demoTabCorner = document.getElementById('btn-demo-corner');
  const demoTabEdge = document.getElementById('btn-demo-edge');
  const demoTabCascade = document.getElementById('btn-demo-cascade');
  const btnReplay = document.getElementById('btn-replay-demo');

  function setDemoTab(tab, scenario) {
    [demoTabCorner, demoTabEdge, demoTabCascade].forEach(t => t && t.classList.remove('active'));
    if (tab) tab.classList.add('active');
    if (rulesDemo) rulesDemo.playScenario(scenario);
  }

  if (demoTabCorner) demoTabCorner.onclick = () => setDemoTab(demoTabCorner, 'corner');
  if (demoTabEdge) demoTabEdge.onclick = () => setDemoTab(demoTabEdge, 'edge');
  if (demoTabCascade) demoTabCascade.onclick = () => setDemoTab(demoTabCascade, 'cascade');
  if (btnReplay) btnReplay.onclick = () => {
    if (rulesDemo) rulesDemo.playScenario(rulesDemo.currentScenario);
  };

  // Local player count pill selector
  document.querySelectorAll('#local-player-pills .pill-btn').forEach(btn => {
    btn.onclick = () => {
      window.soundManager.play('click');
      document.querySelectorAll('#local-player-pills .pill-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('local-player-count').value = btn.dataset.val;
    };
  });

  // Back buttons
  document.querySelectorAll('.btn-back').forEach(btn => {
    btn.onclick = () => {
      window.soundManager.play('click');
      clearSession();
      if (window.networkClient && window.networkClient.isConnected) {
        window.networkClient.leaveRoom();
      }
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
    const turnTimer = parseInt(document.getElementById('local-turn-timer').value, 10);

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

    startOfflineGame(rows, cols, players, turnTimer);
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
    const turnTimer = parseInt(document.getElementById('ai-turn-timer').value, 10);

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

    startOfflineGame(rows, cols, players, turnTimer);
  };

  function startOfflineGame(rows, cols, players, turnTimer = 20) {
    currentTurnTimer = (turnTimer !== undefined) ? turnTimer : 20;
    engine = new ChainReactionEngine(rows, cols, players);
    renderer.setEngine(engine);
    myPlayerId = null; // in offline mode, any current player can tap

    document.getElementById('btn-undo').style.display = (gameMode === 'LOCAL' ? 'inline-block' : 'none');
    showScreen('game');
    updateHud();
    startTurnTimer(currentTurnTimer);
    checkAiTurn();
    saveSession();
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
    const turnTimer = parseInt(document.getElementById('lan-turn-timer').value, 10);
    let hostUrl = currentServerUrl;

    // If on LAN, connect to the local IP / current host
    await connectAndCreateRoom(hostUrl, name, 'LAN', turnTimer);
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
    const turnTimer = parseInt(document.getElementById('online-turn-timer').value, 10);
    await connectAndCreateRoom(currentServerUrl, name, 'ONLINE', turnTimer);
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

  async function connectAndCreateRoom(url, playerName, mode, turnTimer = 20) {
    gameMode = mode;
    currentTurnTimer = turnTimer;
    try {
      showToast('Connecting to server...');
      await window.networkClient.connect(url);
      window.networkClient.createRoom(playerName, {
        gridSize: { rows: 9, cols: 6 },
        maxPlayers: 4,
        turnTimer: turnTimer
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
    saveSession();
  });

  window.networkClient.on('room_joined', (data) => {
    myPlayerId = data.playerId;
    setupLobbyUI(data.room, false);
    showScreen('lobby');
    showToast(`Joined Room: ${data.roomCode}!`);
    saveSession();
  });

  window.networkClient.on('reconnected', (data) => {
    myPlayerId = data.playerId;
    const room = data.room;
    if (!room) return;

    const recModal = document.getElementById('modal-reconnecting');
    if (recModal) recModal.classList.remove('active');

    const banner = document.getElementById('hud-reconnect-banner');
    const otherDisconnected = (room.players || []).find(p => p.id !== myPlayerId && p.isDisconnected);
    if (banner) {
      if (otherDisconnected) {
        banner.className = 'hud-alert-banner';
        const msg = document.getElementById('hud-reconnect-msg');
        if (msg) msg.innerText = `⚠️ ${otherDisconnected.name} left, waiting for rejoin...`;
        banner.style.display = 'flex';
      } else {
        banner.style.display = 'none';
      }
    }

    saveSession();

    if (room.status === 'LOBBY') {
      setupLobbyUI(room, room.hostId === myPlayerId);
      showScreen('lobby');
      showToast(`Reconnected to Lobby (${room.code})!`);
    } else if (room.status === 'PLAYING') {
      engine = new ChainReactionEngine(room.gridSize.rows, room.gridSize.cols, room.players);
      engine.board = room.board;
      if (room.currentTurnPlayerId) {
        const idx = engine.players.findIndex(p => p.id === room.currentTurnPlayerId);
        if (idx !== -1) engine.currentPlayerIndex = idx;
      }
      renderer.setEngine(engine);
      document.getElementById('btn-undo').style.display = 'none';
      currentTurnTimer = room.turnTimer !== undefined ? room.turnTimer : 20;
      showScreen('game');
      updateHud();
      startTurnTimer(currentTurnTimer);
      showToast(`Reconnected to Match (${room.code})!`);
    } else if (room.status === 'FINISHED') {
      engine = new ChainReactionEngine(room.gridSize.rows, room.gridSize.cols, room.players);
      engine.board = room.board;
      renderer.setEngine(engine);
      showScreen('game');
      updateHud();
      showGameOver(room.winner);
    }
  });

  window.networkClient.on('player_joined', (data) => {
    window.soundManager.play('beep');
    setupLobbyUI(data.room, window.networkClient.isHost);
    showToast(`${data.player.name} joined!`);
  });

  window.networkClient.on('player_left', (data) => {
    window.soundManager.play('beep', { pitch: 0.4 });
    window.soundManager.vibrate([100, 50, 100]);

    const banner = document.getElementById('hud-reconnect-banner');
    if (banner) banner.style.display = 'none';

    if (data.isForfeit && data.winner) {
      showToast(`🚪 ${data.playerName || 'Opponent'} left the game! ${data.winner.name} wins by forfeit!`, 5000);
      showGameOver(data.winner);
    } else {
      showToast(`🚪 ${data.playerName || 'A player'} has left the game.`, 4000);

      if (engine && data.playerId) {
        const leaving = engine.players.find(p => p.id === data.playerId);
        if (leaving) leaving.isEliminated = true;
      }

      if (data.nextPlayerId && engine) {
        const idx = engine.players.findIndex(p => p.id === data.nextPlayerId);
        if (idx !== -1) engine.currentPlayerIndex = idx;
        updateHud();
        startTurnTimer(currentTurnTimer);
      } else if (engine) {
        updateHud();
      }
    }

    if (data.room && data.room.status === 'LOBBY') {
      setupLobbyUI(data.room, window.networkClient.isHost);
    }
  });

  window.networkClient.on('player_disconnected', (data) => {
    // If this disconnect event is for the local player, ignore it
    if (data.playerId === myPlayerId) return;

    window.soundManager.play('beep', { pitch: 0.5 });
    const pName = data.playerName || 'Player';
    showToast(`⚠️ ${pName} left, waiting for rejoin...`, 5000);

    const banner = document.getElementById('hud-reconnect-banner');
    const msg = document.getElementById('hud-reconnect-msg');
    if (banner && msg) {
      banner.className = 'hud-alert-banner';
      msg.innerText = `⚠️ ${pName} left, waiting for rejoin...`;
      banner.style.display = 'flex';
    }

    if (engine && data.playerId) {
      const p = engine.players.find(pl => pl.id === data.playerId);
      if (p) p.isDisconnected = true;
      updateHud();
    }
  });

  window.networkClient.on('player_reconnected', (data) => {
    if (data.playerId === myPlayerId) {
      const banner = document.getElementById('hud-reconnect-banner');
      if (banner) banner.style.display = 'none';
      return;
    }

    window.soundManager.play('beep', { pitch: 1.2 });
    const pName = data.playerName || 'Player';
    showToast(`🟢 ${pName} rejoined the match!`, 3000);

    const banner = document.getElementById('hud-reconnect-banner');
    const msg = document.getElementById('hud-reconnect-msg');
    if (banner && msg) {
      banner.className = 'hud-alert-banner success';
      msg.innerText = `🟢 ${pName} rejoined the match!`;
      banner.style.display = 'flex';
      setTimeout(() => {
        banner.style.display = 'none';
      }, 3000);
    }

    if (engine && data.playerId) {
      const p = engine.players.find(pl => pl.id === data.playerId);
      if (p) p.isDisconnected = false;
      updateHud();
    }
  });

  window.networkClient.on('settings_updated', (data) => {
    if (data.gridSize) {
      const gridEl = document.getElementById('lobby-grid-size');
      if (gridEl) gridEl.value = `${data.gridSize.rows}x${data.gridSize.cols}`;
    }
    if (data.turnTimer !== undefined) {
      currentTurnTimer = data.turnTimer;
      const timerEl = document.getElementById('lobby-turn-timer');
      if (timerEl) timerEl.value = data.turnTimer;
    }
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
    document.getElementById('modal-gameover').classList.remove('active');
    hasRequestedRematch = false;
    window.soundManager.play('laser');
    const room = data.room;
    if (room.turnTimer !== undefined) {
      currentTurnTimer = room.turnTimer;
    }
    engine = new ChainReactionEngine(room.gridSize.rows, room.gridSize.cols, room.players);
    renderer.setEngine(engine);

    document.getElementById('btn-undo').style.display = 'none'; // No undo in online
    showScreen('game');
    updateHud();
    startTurnTimer(currentTurnTimer);
    saveSession();
  });

  window.networkClient.on('move_result', (data) => {
    // Dismiss any reconnect banner once a move occurs
    const banner = document.getElementById('hud-reconnect-banner');
    if (banner) banner.style.display = 'none';

    // Execute incoming move animation wave-by-wave
    const waves = data.waves || data.steps || [];
    renderer.enqueueWaves(waves, data.board, () => {
      // Update board state & player eliminations
      engine.board = data.board;
      if (data.newlyEliminated && data.newlyEliminated.length > 0) {
        data.newlyEliminated.forEach(elimId => {
          const p = engine.players.find(pl => pl.id === elimId);
          if (p) {
            p.isEliminated = true;
            showToast(`${p.name} eliminated!`);
          }
        });
      }

      if (data.isGameOver) {
        showGameOver(data.winner);
      } else {
        if (data.nextPlayerId) {
          const nextIdx = engine.players.findIndex(p => p.id === data.nextPlayerId);
          if (nextIdx !== -1) {
            engine.currentPlayerIndex = nextIdx;
          }
        }
        updateHud();
        startTurnTimer(currentTurnTimer);
        saveSession();
      }
    });
  });

  window.networkClient.on('turn_timeout', (data) => {
    window.soundManager.play('beep', { pitch: 0.35 });
    window.soundManager.vibrate([100, 50, 100]);
    showToast(`${data.skippedPlayerName}'s time ran out! Turn skipped.`);

    if (data.nextPlayerId && engine) {
      const nextIdx = engine.players.findIndex(p => p.id === data.nextPlayerId);
      if (nextIdx !== -1) {
        engine.currentPlayerIndex = nextIdx;
      }
    } else if (engine) {
      engine.advanceTurn();
    }
    updateHud();
    startTurnTimer(currentTurnTimer);
    saveSession();
  });

  window.networkClient.on('error', (err) => {
    if (err.message && (err.message.includes('Room no longer exists') || err.message.includes('Player not found'))) {
      clearSession();
      showScreen('menu');
    }
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
    const lobbyTimerSel = document.getElementById('lobby-turn-timer');

    if (lobbyTimerSel && room.turnTimer !== undefined) {
      lobbyTimerSel.value = room.turnTimer;
      currentTurnTimer = room.turnTimer;
    }

    if (isHost) {
      hostControls.style.display = 'block';
      btnStart.style.display = 'inline-block';
      btnReady.style.display = 'none';
      if (lobbyTimerSel) lobbyTimerSel.disabled = false;

      document.getElementById('lobby-grid-size').onchange = (e) => {
        const parts = e.target.value.split('x');
        window.networkClient.updateSettings({
          gridSize: { rows: parseInt(parts[0], 10), cols: parseInt(parts[1], 10) }
        });
      };

      if (lobbyTimerSel) {
        lobbyTimerSel.onchange = (e) => {
          const t = parseInt(e.target.value, 10);
          currentTurnTimer = t;
          window.networkClient.updateSettings({ turnTimer: t });
        };
      }

      btnStart.onclick = () => {
        window.networkClient.startGame();
      };
    } else {
      hostControls.style.display = 'none';
      btnStart.style.display = 'none';
      btnReady.style.display = 'inline-block';
      if (lobbyTimerSel) lobbyTimerSel.disabled = true;

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
          clearInterval(turnTimerId);
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
    if (!engine || engine.isGameOver || renderer.animating) return;
    const result = engine.makeMove(r, c);
    if (!result) {
      window.soundManager.play('beep', { pitch: 0.5 });
      return;
    }

    clearInterval(turnTimerId);

    if (result.newlyEliminated && result.newlyEliminated.length > 0) {
      result.newlyEliminated.forEach(p => {
        showToast(`${p.name} eliminated!`);
      });
    }

    renderer.enqueueWaves(result.waves, result.board, () => {
      if (result.isGameOver) {
        showGameOver(result.winner);
      } else {
        updateHud();
        startTurnTimer(currentTurnTimer);
        checkAiTurn();
        saveSession();
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

    // In-Game Room Code Tag & Mode Pill on Top
    const roomPill = document.getElementById('hud-room-code-tag');
    const roomVal = document.getElementById('hud-room-code-val');
    const modePill = document.getElementById('hud-match-mode-tag');

    if (gameMode === 'ONLINE' || gameMode === 'LAN') {
      if (roomPill) roomPill.style.display = 'inline-flex';
      if (roomVal) roomVal.innerText = (window.networkClient && window.networkClient.roomCode) ? window.networkClient.roomCode : '------';
      if (modePill) modePill.innerText = (gameMode === 'ONLINE' ? 'ONLINE MULTIPLAYER' : 'LAN MULTIPLAYER');
    } else {
      if (roomPill) roomPill.style.display = 'none';
      if (modePill) modePill.innerText = (gameMode === 'LOCAL' ? 'PASS & PLAY' : 'PLAY VS AI');
    }

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
      badge.className = `player-badge ${p.isEliminated ? 'eliminated' : ''} ${p.isDisconnected ? 'disconnected' : ''} ${p.id === current.id ? 'active' : ''}`;
      badge.style.borderColor = pColor.hex;
      badge.innerHTML = `
        <span class="badge-dot" style="background-color: ${pColor.hex}"></span>
        <span class="badge-name">${p.name}${p.isDisconnected ? ' (Offline)' : ''}</span>
        <span class="badge-count">${count}</span>
      `;
      scoreContainer.appendChild(badge);
    });
  }

  function startTurnTimer(seconds) {
    clearInterval(turnTimerId);
    const timerBar = document.getElementById('hud-timer-bar');
    const timerSec = document.getElementById('hud-timer-sec');
    const timerLabel = document.getElementById('hud-timer-label');

    if (timerBar) timerBar.style.background = 'var(--accent-cyan)';
    if (timerSec) timerSec.style.color = '#ffffff';

    if (!seconds || seconds <= 0) {
      if (timerBar) timerBar.style.width = '100%';
      if (timerSec) timerSec.innerText = '∞';
      if (timerLabel) timerLabel.innerText = 'NO TIMER';
      return;
    }

    if (timerLabel) timerLabel.innerText = 'TIME REMAINING';
    remainingSeconds = seconds;
    if (timerSec) timerSec.innerText = `${remainingSeconds}s`;
    if (timerBar) timerBar.style.width = '100%';

    turnTimerId = setInterval(() => {
      remainingSeconds--;
      const pct = Math.max(0, (remainingSeconds / seconds) * 100);
      if (timerBar) timerBar.style.width = `${pct}%`;
      if (timerSec) timerSec.innerText = `${Math.max(0, remainingSeconds)}s`;

      if (remainingSeconds <= 3 && remainingSeconds > 0) {
        window.soundManager.play('beep', { pitch: 1.4 });
        if (timerBar) timerBar.style.background = '#ff4757';
        if (timerSec) timerSec.style.color = '#ff4757';
      }

      if (remainingSeconds <= 0) {
        clearInterval(turnTimerId);
        if (gameMode === 'LOCAL' || gameMode === 'AI') {
          onLocalTurnTimeout();
        }
      }
    }, 1000);
  }

  function onLocalTurnTimeout() {
    if (!engine || engine.isGameOver || renderer.animating) return;

    const timedOutPlayer = engine.getCurrentPlayer();
    if (!timedOutPlayer) return;

    window.soundManager.play('beep', { pitch: 0.35 });
    window.soundManager.vibrate([100, 50, 100]);
    showToast(`${timedOutPlayer.name}'s time ran out! Turn skipped.`);

    const nextPlayer = engine.advanceTurn();
    updateHud();

    if (nextPlayer && !engine.isGameOver) {
      startTurnTimer(currentTurnTimer);
      checkAiTurn();
    }
  }

  let hasRequestedRematch = false;

  function renderRematchChips(readyPlayerIds = []) {
    const list = document.getElementById('rematch-players-list');
    if (!list || !engine) return;
    list.innerHTML = '';

    engine.players.forEach(p => {
      const isReady = (readyPlayerIds || []).includes(p.id);
      const chip = document.createElement('div');
      chip.className = `rematch-chip ${isReady ? 'agreed' : 'waiting'}`;
      chip.innerHTML = `
        <span>${p.name} ${p.id === myPlayerId ? '(You)' : ''}</span>
        <span>${isReady ? '🟢 Agreed' : '⏳ Waiting...'}</span>
      `;
      list.appendChild(chip);
    });
  }

  // --- GAME OVER MODAL ---
  function showGameOver(winner) {
    clearInterval(turnTimerId);
    clearSession();
    window.soundManager.play('laser2');
    window.soundManager.vibrate(200);
    hasRequestedRematch = false;

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

    const rematchBox = document.getElementById('rematch-status-box');
    const btnPlayAgain = document.getElementById('btn-play-again');
    btnPlayAgain.disabled = false;
    btnPlayAgain.style.opacity = '1';

    if (gameMode === 'ONLINE' || gameMode === 'LAN') {
      rematchBox.style.display = 'block';
      btnPlayAgain.innerText = 'Agree to Rematch';
      renderRematchChips([]);
      const connectedCount = engine ? engine.players.length : 2;
      document.getElementById('rematch-count').innerText = `0/${connectedCount} Agreed`;
    } else {
      rematchBox.style.display = 'none';
      btnPlayAgain.innerText = 'Play Again';
    }

    modal.classList.add('active');
  }

  document.getElementById('btn-play-again').onclick = () => {
    window.soundManager.play('click');
    if (gameMode === 'ONLINE' || gameMode === 'LAN') {
      if (!hasRequestedRematch) {
        hasRequestedRematch = true;
        window.networkClient.requestRematch();
        const btn = document.getElementById('btn-play-again');
        btn.innerText = 'Waiting for Opponent... ⏳';
        btn.style.opacity = '0.7';
        btn.disabled = true;
      }
    } else {
      document.getElementById('modal-gameover').classList.remove('active');
      engine.initBoard();
      renderer.setEngine(engine);
      updateHud();
      startTurnTimer(currentTurnTimer);
      checkAiTurn();
      saveSession();
    }
  };

  window.networkClient.on('rematch_update', (data) => {
    const counter = document.getElementById('rematch-count');
    if (counter) {
      counter.innerText = `${data.currentVotes}/${data.neededVotes} Agreed`;
    }
    renderRematchChips(data.readyPlayerIds);

    if (data.playerId !== myPlayerId && !hasRequestedRematch) {
      showToast(`${data.playerName} wants a rematch! Click Agree to play.`);
      window.soundManager.play('beep');
    }

    if (data.playerLeft) {
      showToast('A player left the room.');
    }
  });

  document.getElementById('btn-gameover-menu').onclick = () => {
    document.getElementById('modal-gameover').classList.remove('active');
    clearSession();
    if (gameMode === 'ONLINE' || gameMode === 'LAN') {
      window.networkClient.leaveRoom();
    }
    window.networkClient.disconnect();
    showScreen('menu');
  };

  // Quit Game Modal & Handlers
  const quitModal = document.getElementById('modal-quit');
  const btnQuitCancel = document.getElementById('btn-quit-cancel');
  const btnQuitConfirm = document.getElementById('btn-quit-confirm');

  function openQuitModal() {
    window.soundManager.play('click');
    if (quitModal) quitModal.classList.add('active');
  }

  function closeQuitModal() {
    window.soundManager.play('click');
    if (quitModal) quitModal.classList.remove('active');
  }

  function quitCurrentGame() {
    window.soundManager.play('click');
    if (quitModal) quitModal.classList.remove('active');
    clearInterval(turnTimerId);
    clearSession();
    if (gameMode === 'ONLINE' || gameMode === 'LAN') {
      window.networkClient.leaveRoom();
    }
    window.networkClient.disconnect();
    if (engine) {
      engine.isGameOver = true;
    }
    showScreen('menu');
    showToast('Returned to Main Menu.');
  }

  if (btnQuitCancel) btnQuitCancel.onclick = closeQuitModal;
  if (btnQuitConfirm) btnQuitConfirm.onclick = quitCurrentGame;

  // In-Game Top Bar Quit & Settings Buttons
  const btnQuitHud = document.getElementById('btn-quit-hud');
  if (btnQuitHud) btnQuitHud.onclick = openQuitModal;

  const btnSidebarQuit = document.getElementById('btn-sidebar-quit');
  if (btnSidebarQuit) btnSidebarQuit.onclick = openQuitModal;

  const btnSettingsHud = document.getElementById('btn-settings-hud');
  if (btnSettingsHud) {
    btnSettingsHud.onclick = () => {
      window.soundManager.play('click');
      const settingsModal = document.getElementById('modal-settings');
      if (settingsModal) settingsModal.classList.add('active');
    };
  }

  // Copy Room Code Button on In-Game Top Bar
  const btnHudCopyRoom = document.getElementById('btn-hud-copy-room');
  if (btnHudCopyRoom) {
    btnHudCopyRoom.onclick = () => {
      const code = (window.networkClient && window.networkClient.roomCode) ? window.networkClient.roomCode : null;
      if (code) {
        navigator.clipboard.writeText(code);
        showToast(`Room Code ${code} copied to clipboard!`);
      }
    };
  }

  // Undo button (Local mode only)
  document.getElementById('btn-undo').onclick = () => {
    if (gameMode === 'LOCAL' && engine) {
      if (engine.undo()) {
        window.soundManager.play('click');
        renderer.setEngine(engine);
        updateHud();
        startTurnTimer(currentTurnTimer);
        saveSession();
      }
    }
  };

  // Desktop keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.key === 'u' || e.key === 'U') {
      const btnUndo = document.getElementById('btn-undo');
      if (btnUndo && btnUndo.style.display !== 'none' && gameMode === 'LOCAL' && engine) {
        if (engine.undo()) {
          window.soundManager.play('click');
          renderer.setEngine(engine);
          updateHud();
          startTurnTimer(currentTurnTimer);
          saveSession();
        }
      }
    } else if (e.key === 'Escape' || e.key === 'q' || e.key === 'Q') {
      if (quitModal && quitModal.classList.contains('active')) {
        closeQuitModal();
        return;
      }
      const settingsModal = document.getElementById('modal-settings');
      if (settingsModal && settingsModal.classList.contains('active')) {
        settingsModal.classList.remove('active');
        return;
      }
      const gameScreen = document.getElementById('screen-game');
      if (gameScreen && gameScreen.classList.contains('active')) {
        openQuitModal();
      }
    }
  });

  // Restore active session if page was refreshed
  restoreActiveSession();
});
