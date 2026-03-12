// ── Name generation ───────────────────────────────────────────────────────────
const ADJECTIVES = ['swift','calm','bold','quiet','bright','sharp','warm','cool','deep','vast','pure','wild'];
const NOUNS      = ['otter','raven','cedar','drift','ember','haze','quill','bloom','ridge','stone','wave','flux'];

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function genName()  { return rand(ADJECTIVES) + '-' + rand(NOUNS); }

// ── Shared globals (used by backend.js) ───────────────────────────────────────
window.myName = genName();
window.pc     = null;

// ── DOM helpers ───────────────────────────────────────────────────────────────
function log(msg, cls = '') {
  const el = document.getElementById('log');
  el.textContent = msg;
  el.className = cls;
}

function pill(txt, cls = '') {
  const el = document.getElementById('conn-pill');
  el.textContent = '● ' + txt;
  el.className = 'status-pill ' + cls;
}

function showIncomingCall(caller) {
  document.getElementById('caller-name-label').textContent = caller + ' is calling…';
  document.getElementById('incoming-overlay').classList.add('active');
}

function hideIncoming() {
  document.getElementById('incoming-overlay').classList.remove('active');
}

function showCallView() {
  document.getElementById('lobby').style.display = 'none';
  document.getElementById('call-view').classList.add('active');
}

function hideCallView() {
  document.getElementById('call-view').classList.remove('active');
  document.getElementById('lobby').style.display = 'flex';
}

// ── Callback hooks from backend.js ───────────────────────────────────────────
function onSignalingReady() {
  pill('online', 'connected');
  log('ready — share your username to receive calls', 'ok');
}

function onCallConnected(peerName) {
  document.getElementById('call-label').textContent = 'connected · ' + peerName;
  pill('in call', 'in-call');
}

// ── Media ─────────────────────────────────────────────────────────────────────
let localStream = null;
let micOn = true;
let camOn = true;

async function getMedia() {
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  document.getElementById('local-video').srcObject = localStream;
}

function createPC() {
  window.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  localStream.getTracks().forEach(t => window.pc.addTrack(t, localStream));

  window.pc.ontrack = e => {
    const rv = document.getElementById('remote-video');
    rv.srcObject = e.streams[0];
    rv.style.display = 'block';
    document.getElementById('waiting-msg').style.display = 'none';
  };

  window.pc.onconnectionstatechange = () => {
    const state = window.pc.connectionState;
    if (['disconnected', 'failed', 'closed'].includes(state)) endCall();
  };
}

function toggleMic() {
  micOn = !micOn;
  localStream.getAudioTracks().forEach(t => t.enabled = micOn);
  const btn = document.getElementById('mic-btn');
  btn.textContent = micOn ? '🎤' : '🔇';
  btn.className   = 'ctrl-btn ' + (micOn ? 'unmuted' : 'muted');
}

function toggleCam() {
  camOn = !camOn;
  localStream.getVideoTracks().forEach(t => t.enabled = camOn);
  const btn = document.getElementById('cam-btn');
  btn.textContent = camOn ? '📹' : '🚫';
  btn.className   = 'ctrl-btn ' + (camOn ? 'unmuted' : 'muted');
}

// ── Call actions (called by HTML buttons) ─────────────────────────────────────
async function startCall() {
  const target = document.getElementById('call-target').value.trim();
  if (!target)           { log('enter a username', 'err'); return; }
  if (target === window.myName) { log('cannot call yourself', 'err'); return; }

  try {
    await getMedia();
    createPC();
    showCallView();
    document.getElementById('call-label').textContent = 'calling ' + target + '…';
    pill('calling…', 'in-call');
    await signalingStartCall(target);
  } catch (e) {
    log('error: ' + e.message, 'err');
    console.error(e);
    hideCallView();
  }
}

async function answerCall() {
  hideIncoming();
  try {
    await getMedia();
    createPC();
    showCallView();
    document.getElementById('call-label').textContent = 'connecting…';
    const caller = await signalingAnswerCall();
    onCallConnected(caller);
  } catch (e) {
    log('answer failed: ' + e.message, 'err');
    console.error(e);
    hideCallView();
  }
}

async function rejectCall() {
  hideIncoming();
  await signalingRejectCall();
}

async function endCall() {
  await signalingEndCall();

  if (window.pc) { window.pc.close(); window.pc = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }

  // Reset video elements
  const rv = document.getElementById('remote-video');
  rv.srcObject = null;
  rv.style.display = 'none';
  document.getElementById('waiting-msg').style.display = 'flex';
  document.getElementById('local-video').srcObject = null;

  // Reset controls
  micOn = true; camOn = true;
  document.getElementById('mic-btn').textContent = '🎤';
  document.getElementById('mic-btn').className   = 'ctrl-btn unmuted';
  document.getElementById('cam-btn').textContent = '📹';
  document.getElementById('cam-btn').className   = 'ctrl-btn unmuted';

  hideCallView();
  pill('online', 'connected');
  log('call ended');
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.getElementById('my-name').textContent = window.myName;
log('connecting to signaling…');
listenForCalls(window.myName);
