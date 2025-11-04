# AirLink Web v3.3
# - Eventlet websockets
# - Device polling fallback
# - Streamed transfers with pause/resume/cancel
# - iOS download fallback

import os, time, uuid, secrets, socket
from datetime import datetime
from tempfile import SpooledTemporaryFile
from pathlib import Path

import eventlet
eventlet.monkey_patch()

from flask import Flask, request, jsonify, abort
from flask_cors import CORS
from flask_socketio import SocketIO, emit

APP_DIR = Path(__file__).parent.resolve()

DEVICES = {}   # device_id -> {sid, name, ip, last_seen}
TRANSFERS = {} # file_id -> {buf, filename, size, token, sender_id, receiver_id, created_at, paused, cancelled}

CHUNK = 256 * 1024

def now_iso():
    return datetime.utcnow().isoformat() + "Z"

def get_lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

def create_app():
    app = Flask(__name__, static_folder="static", static_url_path="/static")
    app.config["SECRET_KEY"] = os.environ.get("AIRLINK_SECRET", "dev-secret")
    CORS(app, supports_credentials=True)
    socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")

    def host_url():
        ip = os.environ.get("HOST", get_lan_ip())
        port = int(os.environ.get("PORT", "8080"))
        return f"http://{ip}:{port}"

    def broadcast_devices():
        payload = [{
            "device_id": d_id,
            "name": info.get("name") or ("Device " + d_id[:6]),
            "ip": info.get("ip"),
            "last_seen": info.get("last_seen"),
        } for d_id, info in DEVICES.items()]
        socketio.emit("devices", payload)

    @app.get("/")
    def index():
        return app.send_static_file("index.html")

    @app.get("/api/info")
    def api_info():
        return jsonify({"ok": True, "host": host_url()})

    @app.get("/api/devices")
    def api_devices():
        items = []
        for d_id, info in DEVICES.items():
            items.append({
                "device_id": d_id, "name": info.get("name") or d_id[:6],
                "ip": info.get("ip"), "last_seen": info.get("last_seen")
            })
        return jsonify({"ok": True, "devices": items})

    @app.post("/api/send_stream")
    def api_send_stream():
        if "file" not in request.files:
            return jsonify({"ok": False, "error": "No file"}), 400
        f = request.files["file"]
        target_id = request.form.get("target_device_id")
        sender_id = request.form.get("sender_device_id")
        sender_name = (request.form.get("sender_name") or "Unknown").strip()[:60]

        if not target_id or target_id not in DEVICES:
            return jsonify({"ok": False, "error": "Target not connected"}), 404
        if not sender_id or sender_id not in DEVICES:
            return jsonify({"ok": False, "error": "Sender not connected"}), 404

        file_id = uuid.uuid4().hex
        token = secrets.token_urlsafe(24)
        sp = SpooledTemporaryFile(max_size=128*1024*1024)
        size = 0
        last_emit = time.time()

        while True:
            chunk = f.stream.read(CHUNK)
            if not chunk: break
            sp.write(chunk)
            size += len(chunk)
            if time.time() - last_emit > 0.25:
                socketio.emit("send_status", {"file_id": file_id, "phase": "upload", "bytes": size}, to=DEVICES[sender_id]["sid"])
                last_emit = time.time()
        sp.seek(0)
        TRANSFERS[file_id] = {
            "buf": sp, "filename": f.filename, "size": size, "token": token,
            "sender_id": sender_id, "receiver_id": target_id, "created_at": time.time(),
            "paused": False, "cancelled": False
        }

        payload = {
            "file_id": file_id,
            "filename": f.filename,
            "size": size,
            "sender_name": sender_name,
            "sender_ip": DEVICES[sender_id]["ip"],
            "download_url": f"/stream/{file_id}/{token}"
        }
        socketio.emit("incoming_file", payload, to=DEVICES[target_id]["sid"])
        socketio.emit("send_status", {"file_id": file_id, "phase": "delivered"}, to=DEVICES[sender_id]["sid"])
        return jsonify({"ok": True, "file_id": file_id})

    @app.post("/api/transfer/<file_id>/<action>")
    def control_transfer(file_id, action):
        meta = TRANSFERS.get(file_id)
        if not meta:
            return jsonify({"ok": False, "error": "not_found"}), 404
        if action == "pause":
            meta["paused"] = True
        elif action == "resume":
            meta["paused"] = False
        elif action == "cancel":
            meta["cancelled"] = True
        else:
            return jsonify({"ok": False, "error": "bad_action"}), 400
        return jsonify({"ok": True, "state": {"paused": meta["paused"], "cancelled": meta["cancelled"]}})

    @app.get("/stream/<file_id>/<token>")
    def stream(file_id, token):
        meta = TRANSFERS.get(file_id)
        if not meta or meta["token"] != token:
            abort(403)

        sender_id = meta["sender_id"]
        recv_id = meta["receiver_id"]
        size = meta["size"]
        filename = meta["filename"]

        try:
            socketio.emit("send_status", {"file_id": file_id, "phase": "accepted"}, to=DEVICES[sender_id]["sid"])
        except Exception:
            pass

        def generate():
            sent = 0
            buf = meta["buf"]
            buf.seek(0)
            last_emit = time.time()
            while True:
                if meta.get("cancelled"):
                    break
                while meta.get("paused"):
                    eventlet.sleep(0.1)
                    if meta.get("cancelled"):
                        break
                if meta.get("cancelled"):
                    break
                data = buf.read(CHUNK)
                if not data: break
                sent += len(data)
                now = time.time()
                if now - last_emit > 0.25:
                    try:
                        socketio.emit("recv_status", {"file_id": file_id, "bytes": sent, "total": size}, to=DEVICES[recv_id]["sid"])
                        socketio.emit("send_status", {"file_id": file_id, "phase": "downloading", "bytes": sent, "total": size}, to=DEVICES[sender_id]["sid"])
                    except Exception:
                        pass
                    last_emit = now
                yield data
            try:
                buf.close()
            except Exception:
                pass
            TRANSFERS.pop(file_id, None)
            try:
                socketio.emit("recv_status", {"file_id": file_id, "bytes": sent, "total": size, "done": True}, to=DEVICES[recv_id]["sid"])
                socketio.emit("send_status", {"file_id": file_id, "phase": "done", "bytes": sent, "total": size}, to=DEVICES[sender_id]["sid"])
            except Exception:
                pass

        headers = {
            "Content-Disposition": f'attachment; filename=\"{filename}\"',
            "Content-Length": str(size),
            "Content-Type": "application/octet-stream",
        }
        return app.response_class(generate(), headers=headers)

    # ---- sockets
    @socketio.on("connect")
    def on_connect():
        device_id = uuid.uuid4().hex
        ip = request.headers.get("X-Forwarded-For", request.remote_addr or "unknown").split(",")[0].strip()
        DEVICES[device_id] = {"sid": request.sid, "name": None, "ip": ip, "last_seen": now_iso()}
        emit("welcome", {"device_id": device_id, "ip": ip, "url": host_url()})
        broadcast_devices()

    @socketio.on("register")
    def on_register(data):
        device_id = (data or {}).get("device_id")
        name = (data or {}).get("name")
        if device_id in DEVICES:
            DEVICES[device_id]["name"] = (name or "Unnamed").strip()[:60]
            DEVICES[device_id]["last_seen"] = now_iso()
            broadcast_devices()

    @socketio.on("heartbeat")
    def on_hb(data):
        device_id = (data or {}).get("device_id")
        if device_id in DEVICES:
            DEVICES[device_id]["last_seen"] = now_iso()

    @socketio.on("disconnect")
    def on_disc():
        sid = request.sid
        dead = None
        for d_id, info in list(DEVICES.items()):
            if info.get("sid") == sid:
                dead = d_id; break
        if dead:
            DEVICES.pop(dead, None)
            broadcast_devices()

    def run():
        url = host_url()
        print(f"AirLink Web v3.3: {url}")
        socketio.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8080")))

    app.run_cli = run
    app.socketio = socketio
    return app

if __name__ == "__main__":
    app = create_app()
    app.run_cli()
