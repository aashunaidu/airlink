# 🚀 AirLink Web — Local, Private, Cross‑Device File Transfer (LAN Only)

**AirLink Web** turns any one of your devices into a **local hub** for instant, private file transfers between **Windows, macOS, Linux, Android, and iPhone/iPad** — all in your own Wi‑Fi or hotspot (no internet required). It feels like AirDrop, but **cross‑platform**, **offline**, and **yours**.

> Works great as a hub on Windows PC **or** on a rooted/non‑root Android phone using **Termux**. Other devices just open the hub’s URL in a browser (Chrome, Edge, Safari, Firefox).

---

## ✨ Features

- **Cross‑platform**: Send files between Windows, macOS, Linux, Android, iPhone/iPad.
- **No cloud**: All traffic stays **inside your LAN** / hotspot. Nothing leaves your network.
- **Zero setup for clients**: Open the hub URL or scan a **QR code** — done.
- **Live progress** on both sender & receiver with **% / MB/s / ETA**.
- **Pause / Resume / Cancel** during receive; cancel upload while sending.
- **Auto‑accept trusted senders** (optional).
- **No disk cache on server** (streamed in memory). No transfer history stored.
- **Device discovery** via WebSocket + HTTP fallback — so iPhone shows peers reliably.
- **Works offline** (no internet).

> Tech stack: Python + Flask + Socket.IO (eventlet), vanilla HTML/CSS/JS on the client.

---

## 🧱 How it works (in 20 seconds)

1. Start the hub on one device (PC or Android/Termux).  
2. It prints a LAN URL like `http://192.168.1.69:8080` and shows the same as a **QR**.  
3. Other devices open the URL (or scan the QR), appear in **Available Devices**.  
4. Pick a device → **drag & drop** files → transfer streams **directly over your Wi‑Fi**.  
5. Nothing is uploaded to the internet. Files are not saved on the hub’s disk.

---

## 📦 Requirements

- **Python 3.11+** (Windows/macOS/Linux/Termux).  
- Wi‑Fi or a phone **hotspot** that all devices join (same LAN).  
- Modern browser on clients (Chrome/Edge/Firefox/Safari; iOS 15+ recommended).

---

## ⚡ Quick Start (Desktop Hub)

> If you downloaded a release ZIP (e.g., `airlink_web_v3_3.zip`), unzip it and `cd` into the folder first.

```bash
# 1) Install deps
pip install -r requirements.txt

# 2) Run the hub
python server.py
```

You’ll see something like:
```
AirLink Web v3.x: http://192.168.1.69:8080
 * Running on http://0.0.0.0:8080
```

Open that `http://192.168.1.69:8080` on your **other devices** (or scan the QR in the page).  
Pick a device → drop files → watch the **single clean progress bar** with % / MB/s / ETA.

### Windows tips
- If Windows Firewall prompts, **Allow access** for **Private networks**.
- To run without a console window: `pythonw app.py` (if you use the optional Tk app).
- Autostart: create a shortcut to `pythonw app.py` in *Startup* or use the in‑app toggle (if provided).

### macOS tips
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python server.py
```
If Safari caches old JS, hold **⌘+R** or open a Private window.

### Linux tips
- Same as macOS. If binding to port 80: `sudo python server.py` (or set `PORT=80`).  
- Ensure your firewall (ufw/iptables/nftables) allows the chosen port (default **8080**).

---

## 📱 Run the Hub on Android (Termux)

This turns your Android phone into the **hub** so every device connects to it.

1) Install Termux (F‑Droid recommended), then run:
```bash
pkg update && pkg upgrade -y
pkg install python git -y
pip install -U pip
```

2) Copy the project into Termux
- **Option A – via Downloads:**
  ```bash
  termux-setup-storage    # grant storage
  # copy ZIP (airlink.zip) to Download using the Files app or USB
  cd ~/storage/downloads
  unzip airlink.zip -d ~/airlink
  cd ~/airlink
  ```
- **Option B – via Git:**
  ```bash
  git clone https://github.com/aashunaidu/airlink.git
  cd airlink_web
  ```

3) Install requirements, run:
```bash
pip install -r requirements.txt
python server.py
```

4) Choose your network mode
- **Phone Hotspot** (recommended for portability): other devices join your hotspot. Phone’s IP is often **192.168.43.1** → open `http://192.168.43.1:8080`.
- **Same Wi‑Fi**: find your phone’s IP with `ifconfig wlan0` (look for `inet 192.168.x.x`).

> Works without root. Root just makes extras easier (port 80, boot scripts).

**Run in background** on Termux:
```bash
nohup python server.py > airlink.log 2>&1 &
disown
```

**Autostart on boot**: install the Termux:Boot app and create a small `~/../.termux/boot/airlink.sh` that runs the command above.

---

## 🍎 iPhone / iPad (Client)

- Open Safari (or Chrome) to the hub URL (or scan the on‑page QR).  
- iOS saves the incoming file via browser’s download prompt to **Files**.  
- Progress mirrors on sender & receiver. Auto‑accept trusted senders is supported.

---

## 🛠️ Controls & UX

- **Device list**: your device is shown with a green dot; others in blue. You can **Select/Unselect** a target. Your last target is remembered by IP.
- **Drag & drop** or **Browse…** to pick files. If a target is selected, **sending starts immediately** (no extra button).
- **Progress**: a **single line** per transfer with `% • MB/s • ETA`. Sender mirrors receiver’s progress.
- **Pause/Resume/Cancel**: available during **download** streaming. Upload cancel aborts the in‑flight POST.
- **Auto‑accept**: toggle on top to trust senders and skip manual accept.

---

## 🔐 Privacy & Security

- AirLink is **LAN‑only** by default. No external servers.  
- The hub does **not** persist received files to disk; it streams from memory (spooled) to the receiver and discards.  
- No transfer history is stored.  
- For shared/home networks, consider adding a **PIN** or allowlist (planned feature), or run on a separate hotspot.

---

## 📈 Real‑world Speed Expectations

Actual speed depends on Wi‑Fi standard, distance, interference, and device radios. Typical **real** throughput (not theoretical):

| Wi‑Fi | Realistic Throughput | MB/s (approx) |
|------:|----------------------:|--------------:|
| 802.11n (2.4 GHz) | 40–90 Mbps   | 5–11 MB/s |
| 802.11ac / Wi‑Fi 5 (5 GHz) | 200–500 Mbps | 25–60 MB/s |
| 802.11ax / Wi‑Fi 6 (5 GHz) | 400–900 Mbps | 50–110 MB/s |
| Phone Hotspot (good 5 GHz) | 150–350 Mbps | 18–45 MB/s |

> The UI shows **MB/s** and **ETA** live. For best speeds: use **5 GHz**, be near the hub, disable battery saver/low power modes.

---

## 🧪 Troubleshooting

- **I don’t see other devices**  
  - Ensure **all devices are on the same LAN / hotspot** (no VPN/Private Relay).  
  - On Windows: allow Python in **Firewall (Private networks)**.  
  - Hard refresh the page (**Ctrl+F5**, on iOS open a Private tab).

- **iPhone downloads but doesn’t auto‑save**  
  - iOS saves via the browser’s download sheet to **Files**. Check the Downloads folder in the Files app.

- **WebSocket 500 / “write() before start_response”**  
  - The build uses **eventlet** for real websockets. Ensure requirements installed correctly:  
    `pip install -r requirements.txt`

- **Slow speeds**  
  - Switch to **5 GHz** Wi‑Fi, move closer, avoid crowded channels, keep devices on AC power.

---

## ⚙️ Advanced

**Environment overrides**:
```bash
# example: custom host/port
HOST=192.168.1.50 PORT=9090 python server.py
```

**Production**: On a dedicated server you can still run with eventlet:
```bash
python server.py  # uses socketio.run(..., async_mode="eventlet")
```
(If you prefer gevent, adapt `async_mode` accordingly.)

---

## 🗺️ Roadmap (ideas we can add next)

- **AirLink Drive**: browse folders, preview, stream, and upload (a local Google Drive).  
- **Trusted device pairing via QR** + per‑pair encryption.  
- **Shared LAN Board**: clipboard/chat/links for the whole LAN.  
- **WebRTC P2P**: direct peer transfers after pairing (server coordinates only).  
- **Local AI** (Ollama/Whisper) served from the hub for all devices.

Open an issue with what you want — we’ll build it.

---

## 📜 License

MIT — do whatever you want, just don’t blame me if your cat unplugs the router. 😄
