# 🌐 Chain Reaction Multiplayer Website

A full web-based multiplayer implementation of **Chain Reaction**, configured out-of-the-box to connect to your live backend server:
👉 **`wss://chain-reaction-server-qq7p.onrender.com`**

Playable seamlessly on **desktop browsers** (Chrome, Firefox, Safari, Edge) and **mobile browsers** (Android Chrome, iOS Safari)!

---

## 📂 Folder Structure

```
website/
├── frontend/                     # Web Game Client
│   ├── index.html                # Responsive web app & screens
│   ├── style.css                 # Sleek arcade cyberpunk theme
│   ├── js/                       # Audio, Engine, Renderer, AI, Network, App
│   ├── assets/                   # Authentic extracted sounds & icons
│   └── vercel.json               # 1-click Vercel routing config
├── backend/                      # WebSocket & Static Server
│   ├── server.js                 # WebSocket room & move coordinator
│   ├── package.json              # Dependencies (ws)
│   ├── Dockerfile                # Container deployment
│   └── render.yaml               # Render service configuration
├── package.json                  # Root npm start runner
└── netlify.toml                  # Netlify deployment configuration
```

---

## 🚀 How to Deploy the Website

Choose whichever platform you prefer:

### Option 1: Deploy Frontend on Vercel (Fastest & Best Performance)
*Vercel gives you instant global CDN, free SSL, custom domain support, and zero cold starts.*

1. Push your repository to **GitHub**.
2. Go to [**vercel.com**](https://vercel.com) and log in with GitHub.
3. Click **Add New...** ➔ **Project**.
4. Import your `chain_reaction` repository.
5. In the configuration screen:
   * **Root Directory**: Click *Edit* and select **`website/frontend`**.
   * Leave Build Command & Output Directory default.
6. Click **Deploy**!
7. In ~20 seconds, Vercel gives you a live link like `https://chain-reaction-xxx.vercel.app`.
8. Friends can now open that URL on their phones or laptops and play with you in real time!

---

### Option 2: Deploy Frontend on Netlify
1. Go to [**netlify.com**](https://netlify.com) and log in.
2. Click **Add new site** ➔ **Import an existing project** (from GitHub).
3. Select your repository.
4. Set:
   * **Base directory**: `website/frontend`
   * **Publish directory**: `website/frontend`
5. Click **Deploy site**!

---

### Option 3: Deploy Frontend on GitHub Pages (100% Free, Built-in)
1. In your GitHub repository, go to **Settings** ➔ **Pages**.
2. Under **Build and deployment**:
   * Source: **Deploy from a branch**.
   * Select `main` branch and `/website/frontend` folder (or copy `frontend` files to a `docs/` folder or `gh-pages` branch).
3. Your site will be live at `https://<your-username>.github.io/chain_reaction/`!

---

### Option 4: All-in-One on Render (Frontend + Backend on Same URL)
Your backend (`website/backend/server.js`) is already configured to automatically serve the frontend on `GET /`!

If you want your existing Render URL (`https://chain-reaction-server-qq7p.onrender.com`) to serve both the game website AND the WebSockets:
1. In your Render Dashboard, go to your existing **`chain-reaction-server`** service.
2. Go to **Settings**:
   * Change **Root Directory** from `server` to `website/backend`.
3. Click **Save Changes** and click **Manual Deploy** ➔ **Deploy latest commit**.
4. Now visiting `https://chain-reaction-server-qq7p.onrender.com` in your browser directly loads the full game!

---

## 💻 Running the Website Locally on Your PC

To test or play locally:
```powershell
cd website
npm install
npm start
```
Then open `http://localhost:8080` in your browser!
