// AirLink Web v3.3 frontend
let socket = null;
let DEVICE_ID = null;
let MY_IP = null;
let SELECTED_TARGET = null;
const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

const hostUrl = document.getElementById("hostUrl");
const copyBtn = document.getElementById("copyBtn");
const deviceNameInput = document.getElementById("deviceName");
const saveNameBtn = document.getElementById("saveName");
const autoTrustCk = document.getElementById("autoTrust");
const deviceListEl = document.getElementById("deviceList");
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const uploads = document.getElementById("uploads");
const incomingList = document.getElementById("incomingList");
const qrEl = document.getElementById("qrcode");
const qrFallback = document.getElementById("qrFallback");

function setCookie(name, value, days=365){
  const d = new Date(); d.setTime(d.getTime() + (days*24*60*60*1000));
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${d.toUTCString()}; path=/`;
}
function getCookie(name){
  const m = document.cookie.match(new RegExp('(^| )'+name+'=([^;]+)')); return m ? decodeURIComponent(m[2]) : null;
}

let ME_NAME = getCookie("airlink_name") || localStorage.getItem("airlink_name") || "";
deviceNameInput.value = ME_NAME;
autoTrustCk.checked = localStorage.getItem("airlink_auto_trust")==="1";
let preferredTargetIP = localStorage.getItem("airlink_preferred_target_ip") || null;
let trustedSenders = JSON.parse(localStorage.getItem("airlink_trusted_senders") || "[]");

function drawQR(url){
  qrEl.innerHTML = "";
  new QRCode(qrEl, { text: url, width: 140, height: 140 });
  qrFallback.textContent = url;
}
function applyHostInfo(url){
  hostUrl.textContent = url; drawQR(url);
  copyBtn.onclick = ()=>{ navigator.clipboard.writeText(url); copyBtn.textContent="Copied!"; setTimeout(()=>copyBtn.textContent="Copy", 1200); };
}
// First attempt, then welcome will update too
fetch("/api/info").then(r=>r.json()).then(d=>{ if(d.ok) applyHostInfo(d.host); });

function connectSocket(){
  socket = io(); // ws or polling
  socket.on("welcome", (data)=>{
    DEVICE_ID = data.device_id; MY_IP = data.ip;
    if(data.url) applyHostInfo(data.url);
    registerName();
  });
  socket.on("devices", renderDevices);
  socket.on("incoming_file", onIncoming);
  socket.on("send_status", onSendStatus);
  socket.on("recv_status", onRecvStatus);
}
connectSocket();
setInterval(()=>{ if(socket && DEVICE_ID) socket.emit("heartbeat", {device_id: DEVICE_ID}); }, 10000);

// Polling fallback so iPhone always sees devices even if socket is flaky
setInterval(()=>{
  fetch("/api/devices").then(r=>r.json()).then(d=>{
    if(d.ok) renderDevices(d.devices);
  });
}, 3000);

function registerName(){
  ME_NAME = (deviceNameInput.value || "Unnamed").trim();
  localStorage.setItem("airlink_name", ME_NAME); setCookie("airlink_name", ME_NAME);
  socket.emit("register", { device_id: DEVICE_ID, name: ME_NAME });
}
saveNameBtn.onclick = registerName;
autoTrustCk.addEventListener("change", ()=>{ localStorage.setItem("airlink_auto_trust", autoTrustCk.checked?"1":"0"); });

function renderDevices(list){
  deviceListEl.innerHTML = "";
  let autoPicked = false;
  list.forEach(d=>{
    const li = document.createElement("li");
    li.className = "device";
    const isSelf = (d.ip === MY_IP);
    li.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center">
        <div style="width:10px;height:10px;background:${isSelf?'#6bc96b':'#4e7dff'};border-radius:50%"></div>
        <div>
          <div><strong>${d.name}${isSelf?' (You)':''}</strong></div>
          <small class="mono">${d.ip||''}</small>
        </div>
      </div>
      <div>
        <button class="pick ${isSelf?'ghost':''}" ${isSelf?'disabled':''}>${SELECTED_TARGET===d.device_id?'Selected':'Select'}</button>
      </div>
    `;
    const pickBtn = li.querySelector(".pick");
    if(!isSelf){
      pickBtn.onclick = ()=>{
        if(SELECTED_TARGET === d.device_id){
          SELECTED_TARGET = null; preferredTargetIP = null;
          localStorage.removeItem("airlink_preferred_target_ip");
          pickBtn.textContent = "Select";
        }else{
          SELECTED_TARGET = d.device_id;
          preferredTargetIP = d.ip || null;
          if(preferredTargetIP) localStorage.setItem("airlink_preferred_target_ip", preferredTargetIP);
          document.querySelectorAll(".device .pick").forEach(b=>{ if(!b.disabled) b.textContent="Select"; });
          pickBtn.textContent = "Selected";
        }
      };
    }
    deviceListEl.appendChild(li);
    if(!autoPicked && preferredTargetIP && d.ip===preferredTargetIP && !isSelf){
      SELECTED_TARGET = d.device_id; pickBtn.textContent="Selected"; autoPicked = true;
    }
  });
}

// ---- Progress trackers + controls
const sendMap = new Map(); // file_id -> {card, bar, label, xhr, paused}
const recvMap = new Map(); // file_id -> {card, bar, label, aborter, paused}

function mkCard(container, title){
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `<div class="mono">${title}</div>
    <div class="progress"><div></div></div>
    <div class="speed mono">0% • 0 MB/s • ETA --s</div>
    <div style="margin-top:8px;display:flex;gap:8px">
      <button class="pause">Pause</button>
      <button class="resume" style="display:none">Resume</button>
      <button class="cancel" class="ghost">Cancel</button>
    </div>`;
  container.prepend(card);
  return {
    card,
    bar: card.querySelector(".progress>div"),
    label: card.querySelector(".speed"),
    pauseBtn: card.querySelector(".pause"),
    resumeBtn: card.querySelector(".resume"),
    cancelBtn: card.querySelector(".cancel"),
  };
}

// ---- Receiver flow
function onIncoming(payload){
  // Create or reuse card
  let rec = recvMap.get(payload.file_id);
  if(!rec){
    rec = mkCard(incomingList, `Receiving: ${payload.filename}`);
    rec.aborter = null;
    rec.paused = false;
    rec.pauseBtn.onclick = ()=>{
      rec.paused = true;
      fetch(`/api/transfer/${payload.file_id}/pause`, {method:"POST"});
      rec.pauseBtn.style.display="none"; rec.resumeBtn.style.display="";
    };
    rec.resumeBtn.onclick = ()=>{
      rec.paused = false;
      fetch(`/api/transfer/${payload.file_id}/resume`, {method:"POST"});
      rec.resumeBtn.style.display="none"; rec.pauseBtn.style.display="";
    };
    rec.cancelBtn.onclick = ()=>{
      fetch(`/api/transfer/${payload.file_id}/cancel`, {method:"POST"});
      if(rec.aborter) rec.aborter.abort();
      rec.card.remove(); recvMap.delete(payload.file_id);
    };
    recvMap.set(payload.file_id, rec);
  }

  const start = ()=>{
    // On iOS, navigate to the URL and rely on socket 'recv_status' for progress
    if(isIOS){
      window.location.href = payload.download_url;
      return;
    }
    // Desktop browsers: fetch stream to show live % and save via blob
    rec.aborter = new AbortController();
    fetch(payload.download_url, {signal: rec.aborter.signal}).then(async res=>{
      const reader = res.body.getReader();
      const total = Number(res.headers.get("Content-Length")) || payload.size || 0;
      let got = 0, lastT = performance.now(), lastGot = 0;
      const chunks = [];
      for(;;){
        const {done, value} = await reader.read();
        if(done) break;
        got += value.length; chunks.push(value);
        const pct = total? Math.round(100*got/total) : 0;
        const now = performance.now(); const dt = (now-lastT)/1000;
        if(dt>=0.5){
          const spd = (got-lastGot)/dt/1048576;
          const rem = total ? total - got : 0;
          const eta = spd>0 ? Math.round((rem/1048576)/spd) : 0;
          rec.bar.style.width = pct+"%";
          rec.label.textContent = `${pct}% • ${spd.toFixed(2)} MB/s • ETA ${eta}s`;
          lastT = now; lastGot = got;
        }
      }
      const blob = new Blob(chunks);
      const a = document.createElement("a");
      const url = URL.createObjectURL(blob);
      a.href=url; a.download=payload.filename||"download.bin"; a.click();
      URL.revokeObjectURL(url);
      rec.bar.style.width = "100%";
      rec.label.textContent = `Done`;
    }).catch(_=>{});
  };

  // Auto-accept if user enabled
  if(localStorage.getItem("airlink_auto_trust")==="1"){
    start(); return;
  }
  // Show quick accept inline (use pause/cancel to control after start)
  const acceptRow = document.createElement("div");
  acceptRow.style="margin-top:8px;display:flex;gap:8px";
  const acceptBtn = document.createElement("button"); acceptBtn.textContent="Accept";
  const declineBtn = document.createElement("button"); declineBtn.textContent="Decline"; declineBtn.className="ghost";
  acceptRow.appendChild(acceptBtn); acceptRow.appendChild(declineBtn);
  rec.card.appendChild(acceptRow);
  acceptBtn.onclick = ()=>{ start(); acceptRow.remove(); };
  declineBtn.onclick = ()=>{ rec.card.remove(); recvMap.delete(payload.file_id); };
}

// socket mirror updates for receiver
function onRecvStatus(d){
  const rec = recvMap.get(d.file_id);
  if(!rec) return;
  const pct = d.total? Math.round(100*d.bytes/d.total) : 0;
  rec.bar.style.width = pct+"%";
  rec.label.textContent = `${pct}%`;
  if(d.done){ rec.label.textContent = "Done"; }
}

// ---- Sender flow (fixed clean single progress line)
function onSendStatus(d) {
  // Create or fetch a single card per file_id
  let s = sendMap.get(d.file_id);
  if (!s) {
    s = mkCard(uploads, `Sending: ${d.filename || fileInput.files[0]?.name || "file"}`);
    s.paused = false;

    // Pause / Resume / Cancel controls
    s.pauseBtn.onclick = () => {
      s.paused = true;
      fetch(`/api/transfer/${d.file_id}/pause`, { method: "POST" });
      s.pauseBtn.style.display = "none";
      s.resumeBtn.style.display = "";
    };
    s.resumeBtn.onclick = () => {
      s.paused = false;
      fetch(`/api/transfer/${d.file_id}/resume`, { method: "POST" });
      s.resumeBtn.style.display = "none";
      s.pauseBtn.style.display = "";
    };
    s.cancelBtn.onclick = () => {
      fetch(`/api/transfer/${d.file_id}/cancel`, { method: "POST" });
      s.card.remove();
      sendMap.delete(d.file_id);
    };

    sendMap.set(d.file_id, s);
  }

  // Update progress bar
  const pct = d.total ? Math.round((100 * d.bytes) / d.total) : 0;
  const now = performance.now();
  s._lastT = s._lastT || now;
  s._lastBytes = s._lastBytes || 0;
  const dt = Math.max(0.5, (now - s._lastT) / 1000);
  const spd = ((d.bytes - s._lastBytes) / dt) / 1048576;
  const rem = d.total ? d.total - d.bytes : 0;
  const eta = spd > 0 ? Math.round((rem / 1048576) / spd) : "--";

  if (d.phase === "upload" || d.phase === "downloading") {
    s.bar.style.width = pct + "%";
    s.label.textContent = `${pct}% • ${spd.toFixed(2)} MB/s • ETA ${eta}s`;
  } else if (d.phase === "delivered") {
    s.label.textContent = `Delivered. Waiting for accept…`;
  } else if (d.phase === "accepted") {
    s.label.textContent = `Accepted. Starting download…`;
  } else if (d.phase === "done") {
    s.bar.style.width = "100%";
    s.label.textContent = `Done`;
  }

  s._lastT = now;
  s._lastBytes = d.bytes;
}

// ---- Auto-send when file dropped or selected
function startSend(file) {
  if (!SELECTED_TARGET) {
    alert("Select a target device first.");
    return;
  }

  const form = new FormData();
  form.append("file", file);
  form.append("target_device_id", SELECTED_TARGET);
  form.append("sender_device_id", DEVICE_ID);
  form.append("sender_name", getCookie("airlink_name") || "Unknown");

  const xhr = new XMLHttpRequest();
  xhr.open("POST", "/api/send_stream");
  xhr.onload = () => {};
  xhr.send(form);

  // Create one progress card immediately
  const tempId = "temp_" + Math.random().toString(36).slice(2);
  const card = mkCard(uploads, `Uploading: ${file.name}`);
  sendMap.set(tempId, { ...card, xhr });
}

// ---- Drag & drop / file picker
dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("drag");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("drag");
  Array.from(e.dataTransfer.files || []).forEach(startSend);
});
fileInput.addEventListener("change", () => {
  Array.from(fileInput.files || []).forEach(startSend);
});
