/**
 * Chain Reaction Web Network Client
 * Handles real-time WebSockets for online rooms & LAN.
 */

class NetworkClient {
  constructor() {
    this.ws = null;
    this.serverUrl = '';
    this.roomCode = null;
    this.playerId = null;
    this.isHost = false;
    this.isConnected = false;
    this.pingInterval = null;
    this.callbacks = {};
  }

  on(event, handler) {
    this.callbacks[event] = handler;
  }

  emitEvent(event, data) {
    if (this.callbacks[event]) {
      this.callbacks[event](data);
    }
  }

  connect(serverUrl) {
    return new Promise((resolve, reject) => {
      this.disconnect();

      let url = serverUrl.trim();
      if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
        const isHttps = window.location.protocol === 'https:';
        url = (isHttps ? 'wss://' : 'ws://') + url;
      }

      this.serverUrl = url;

      try {
        this.ws = new WebSocket(url);
      } catch (err) {
        return reject(err);
      }

      const connectionTimeout = setTimeout(() => {
        if (!this.isConnected) {
          this.disconnect();
          reject(new Error('Connection timed out. Render free tier may be waking up (takes ~30s). Please try again!'));
        }
      }, 10000);

      this.ws.onopen = () => {
        clearTimeout(connectionTimeout);
        this.isConnected = true;
        this.startHeartbeat();
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleServerMessage(msg);
        } catch (e) {
          console.error('Error handling WebSocket message:', e);
        }
      };

      this.ws.onerror = (err) => {
        clearTimeout(connectionTimeout);
        this.emitEvent('error', { message: 'Network connection error. Server might be waking up.' });
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.stopHeartbeat();
        this.emitEvent('disconnected');
      };
    });
  }

  disconnect() {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.send({ action: 'PING' });
      }
    }, 20000);
  }

  stopHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  createRoom(playerName, options = {}) {
    this.send({
      action: 'CREATE_ROOM',
      playerName,
      gridSize: options.gridSize || { rows: 9, cols: 6 },
      maxPlayers: options.maxPlayers || 4,
      turnTimer: options.turnTimer || 20
    });
  }

  joinRoom(roomCode, playerName) {
    this.send({
      action: 'JOIN_ROOM',
      roomCode,
      playerName
    });
  }

  reconnect(roomCode, playerId) {
    this.send({
      action: 'RECONNECT',
      roomCode,
      playerId
    });
  }

  updateSettings(settings) {
    this.send({
      action: 'UPDATE_SETTINGS',
      ...settings
    });
  }

  selectColor(colorId) {
    this.send({
      action: 'SELECT_COLOR',
      colorId
    });
  }

  toggleReady() {
    this.send({
      action: 'TOGGLE_READY'
    });
  }

  startGame() {
    this.send({
      action: 'START_GAME'
    });
  }

  makeMove(row, col) {
    this.send({
      action: 'MAKE_MOVE',
      row,
      col
    });
  }

  restartGame() {
    this.send({
      action: 'RESTART_GAME'
    });
  }

  handleServerMessage(msg) {
    switch (msg.type) {
      case 'ROOM_CREATED':
        this.roomCode = msg.roomCode;
        this.playerId = msg.playerId;
        this.isHost = true;
        this.emitEvent('room_created', msg);
        break;
      case 'ROOM_JOINED':
        this.roomCode = msg.roomCode;
        this.playerId = msg.playerId;
        this.isHost = false;
        this.emitEvent('room_joined', msg);
        break;
      case 'RECONNECTED':
        this.roomCode = msg.roomCode;
        this.playerId = msg.playerId;
        this.emitEvent('reconnected', msg);
        break;
      case 'PLAYER_JOINED':
        this.emitEvent('player_joined', msg);
        break;
      case 'PLAYER_LEFT':
        this.emitEvent('player_left', msg);
        break;
      case 'SETTINGS_UPDATED':
        this.emitEvent('settings_updated', msg);
        break;
      case 'COLOR_CHANGED':
        this.emitEvent('color_changed', msg);
        break;
      case 'READY_CHANGED':
        this.emitEvent('ready_changed', msg);
        break;
      case 'GAME_STARTED':
        this.emitEvent('game_started', msg);
        break;
      case 'MOVE_RESULT':
        this.emitEvent('move_result', msg);
        break;
      case 'PLAYER_DISCONNECTED':
        this.emitEvent('player_disconnected', msg);
        break;
      case 'ERROR':
        this.emitEvent('error', msg);
        break;
    }
  }
}

window.networkClient = new NetworkClient();
