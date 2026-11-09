# ⚛️ Chain Reaction Multiplayer (LAN & Online)

An enhanced, modern reverse-engineered recreation of the legendary mobile board game **Chain Reaction Pro**, featuring real-time **LAN Multiplayer** (hotspot/Wi-Fi, as seen in Harkirat Singh's Mini Militia video) and **Global Online Multiplayer** with 6-character Room Codes!

---

## 🚀 Quick Start: Where is the APK?

The fully compiled and signed Android APK is located right in this directory:
```
c:\Users\hsury\Desktop\Projects\chain_reaction\chain-reaction-multiplayer.apk
```

### How to Install on Android:
1. Connect your Android phone to your PC via USB or transfer `chain-reaction-multiplayer.apk` via WhatsApp, Google Drive, or Bluetooth.
2. Tap on the APK file on your Android phone.
3. If prompted, enable **"Install unknown apps"** for your file manager or browser.
4. Tap **Install** and open **Chain Reaction**!

---

## 🎮 Game Modes

### 1. 📡 LAN Multiplayer (Wi-Fi / Mobile Hotspot)
*Inspired by Mini Militia's classic LAN multiplayer mechanics referenced in Harkirat's video.*
* **Scenario**: You and your friends are sitting in the same room, classroom, hostel, or train with no internet.
* **How to Play**:
  1. One friend turns on their phone's **Mobile Hotspot**.
  2. All other friends connect their Wi-Fi to that hotspot (or all connect to the same Wi-Fi router).
  3. The Host taps **"LAN Multiplayer"** ➔ **"Create LAN Room"**. The room code and host IP (e.g. `192.168.43.1:8080`) are displayed.
  4. Other players tap **"LAN Multiplayer"**, enter the Host's IP (or auto-discover), enter the Room Code, and tap **"Join LAN"**!
  5. Everyone selects their favorite color in the lobby, Host taps **"Start Game"**, and you play with **0ms latency**!

### 2. 🌐 Online Multiplayer (Worldwide Room ID)
*Play in real time with friends in other cities or countries.*
* **Scenario**: Your friend lives in another city, state, or country.
* **How to Play**:
  1. Tap **"Online Multiplayer"** ➔ **"Create New Online Room"**.
  2. A unique 6-character Room Code is generated (e.g., `CR-8942`).
  3. Share the code with your friend via WhatsApp, Telegram, or Discord.
  4. Your friend opens the app, taps **"Online Multiplayer"**, enters the 6-character Room Code, and taps **"Enter Room"**!
  5. Both players pick their orb colors, toggle **Ready**, and start playing in real time!

### 3. 🎮 Pass & Play (Local Offline)
*The original classic offline mode.*
* 2 to 8 players on a single device passing the phone around.
* Full undo move support, sound effects, vibration, and customizable grid sizes (Standard 9×6, Large 10×8).

### 4. 🤖 Play vs Tactical AI
*Single player practice against a heuristic AI.*
* 3 difficulty levels: Easy, Medium, Hard.
* Play 1 vs 1, 1 vs 2, or up to 1 vs 7 bots simultaneously!

---

## 🛠️ Online Multiplayer Server Setup (Deploy for Free)

The game includes a dedicated, ultra-lightweight Node.js WebSocket backend located in `server/`.

### Option A: Free 1-Click Hosting on Render.com (Recommended)
1. Fork or push this repository to your **GitHub** account.
2. Sign up for free at [Render.com](https://render.com).
3. Click **New +** ➔ **Web Service**.
4. Connect your GitHub repository.
5. Render will automatically detect `render.yaml` or you can enter:
   - **Root Directory**: `server`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Instance Type**: Free
6. Click **Deploy Web Service**!
7. Render gives you a free HTTPS/WSS URL (e.g. `https://chain-reaction-server.onrender.com`).
8. In the Chain Reaction app, go to **Settings ⚙️** ➔ set **Multiplayer Server URL** to `wss://chain-reaction-server.onrender.com`. That's it!

### Option B: Free Hosting on Railway / Fly.io / Glitch
A production-ready `Dockerfile` is included in `server/Dockerfile`. Simply deploy the `server/` directory to Railway, Fly.io, or Koyeb.

### Option C: Run Server Locally on your PC
To host games from your own PC on LAN or local network:
```powershell
cd server
npm install
npm start
```
The server will start on port `8080` and print your local network IP (e.g., `http://192.168.1.50:8080`).

---

## 📂 Project Architecture

```
chain_reaction/
├── chain-reaction-multiplayer.apk   # Ready-to-install Android APK
├── build_apk.py                     # Automated standalone APK builder script
├── client/                          # Responsive 60FPS Game Client
│   ├── index.html                   # Mobile UI & Screens
│   ├── style.css                    # Cyberpunk-arcade theme
│   ├── js/
│   │   ├── audio.js                 # Web Audio API with original sounds
│   │   ├── game_engine.js           # Critical mass & chain reaction cascade
│   │   ├── renderer.js              # 60FPS canvas orb & particle animations
│   │   ├── ai.js                    # Easy/Medium/Hard tactical bot
│   │   ├── network.js               # WebSocket client (LAN & Online)
│   │   └── app.js                   # UI coordinator & event router
│   └── assets/                      # Authentic extracted audio & icons
├── server/                          # Real-Time WebSocket Server
│   ├── server.js                    # Room coordinator & move validator
│   ├── package.json                 # Minimal dependencies (ws)
│   ├── Dockerfile                   # Cloud container deployment
│   └── render.yaml                  # 1-click Render.com deployment
├── android_src/                     # Native Android project files
│   ├── AndroidManifest.xml          # Package, permissions & activity
│   ├── res/                         # App icon, styles, strings
│   └── src/                         # Fullscreen hardware-accelerated WebView
├── extracted_assets/                # Raw assets extracted from original APK
└── tools/                           # Standalone compilation toolchain
    ├── jdk/                         # Portable OpenJDK 21 (javac, java, keytool)
    └── android/                     # AAPT2, Android.jar, D8 compiler
```

---

## 🔁 Re-building the APK

If you make any changes to the client, UI, sounds, or game engine, you can regenerate the signed APK with one command:
```powershell
python build_apk.py
```
This runs the full compilation pipeline:
`AAPT2 (Resource Compile & Link)` ➔ `javac` ➔ `D8 Dexer` ➔ `ZIP Packaging` ➔ `Keytool & Jarsigner`.
