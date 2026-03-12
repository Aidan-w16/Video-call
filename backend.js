// ── Config ────────────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://khbdyxepckphorwapgvg.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtoYmR5eGVwY2twaG9yd2FwZ3ZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMjUzOTMsImV4cCI6MjA4ODYwMTM5M30.5QKNYwvVlXU9kebZ0Qd96R_BGj2CCkxMfT-UfJOAOnI';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

// ── Supabase client ───────────────────────────────────────────────────────────
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ── State ─────────────────────────────────────────────────────────────────────
let currentCallId   = null;
let incomingCallId  = null;
let incomingCaller  = null;
let callChannel     = null;

// pc and localStream are owned by media.js but shared here via window globals

// ── Caller flow ───────────────────────────────────────────────────────────────
async function signalingStartCall(target) {
  const offer = await window.pc.createOffer();
  await window.pc.setLocalDescription(offer);

  // Wait for ICE gathering to complete (max 3s)
  await new Promise(res => {
    if (window.pc.iceGatheringState === 'complete') { res(); return; }
    window.pc.onicegatheringstatechange = () => {
      if (window.pc.iceGatheringState === 'complete') res();
    };
    setTimeout(res, 3000);
  });

  const { data, error } = await sb.from('calls').insert({
    caller:   window.myName,
    receiver: target,
    offer:    window.pc.localDescription.toJSON(),
    status:   'pending',
  }).select().single();

  if (error) throw new Error('Signaling insert failed: ' + error.message);

  currentCallId = data.id;

  // Listen for the answer from the receiver
  callChannel = sb.channel('call-' + currentCallId)
    .on('postgres_changes', {
      event:  'UPDATE',
      schema: 'public',
      table:  'calls',
      filter: `id=eq.${currentCallId}`,
    }, async payload => {
      const row = payload.new;
      if (row.status === 'rejected') { endCall(); return; }
      if (row.answer && window.pc.signalingState !== 'stable') {
        await window.pc.setRemoteDescription(new RTCSessionDescription(row.answer));
        onCallConnected(target);
      }
    })
    .subscribe();

  return currentCallId;
}

// ── Receiver flow ─────────────────────────────────────────────────────────────
async function signalingAnswerCall() {
  const { data, error } = await sb.from('calls').select('*').eq('id', incomingCallId).single();
  if (error) throw new Error('Could not fetch call: ' + error.message);

  await window.pc.setRemoteDescription(new RTCSessionDescription(data.offer));

  const answer = await window.pc.createAnswer();
  await window.pc.setLocalDescription(answer);

  await new Promise(res => {
    if (window.pc.iceGatheringState === 'complete') { res(); return; }
    window.pc.onicegatheringstatechange = () => {
      if (window.pc.iceGatheringState === 'complete') res();
    };
    setTimeout(res, 3000);
  });

  const { error: updateError } = await sb.from('calls').update({
    answer: window.pc.localDescription.toJSON(),
    status: 'active',
  }).eq('id', incomingCallId);

  if (updateError) throw new Error('Failed to send answer: ' + updateError.message);

  currentCallId = incomingCallId;

  // Listen for call end from caller
  callChannel = sb.channel('call-ans-' + currentCallId)
    .on('postgres_changes', {
      event:  'UPDATE',
      schema: 'public',
      table:  'calls',
      filter: `id=eq.${currentCallId}`,
    }, payload => {
      if (payload.new.status === 'ended') endCall();
    })
    .subscribe();

  return incomingCaller;
}

async function signalingRejectCall() {
  await sb.from('calls').update({ status: 'rejected' }).eq('id', incomingCallId);
  incomingCallId = null;
  incomingCaller = null;
}

async function signalingEndCall() {
  if (currentCallId) {
    await sb.from('calls').update({ status: 'ended' }).eq('id', currentCallId);
    currentCallId = null;
  }
  if (callChannel) {
    sb.removeChannel(callChannel);
    callChannel = null;
  }
}

// ── Incoming call listener ─────────────────────────────────────────────────────
function listenForCalls(myName) {
  sb.channel('incoming-' + myName)
    .on('postgres_changes', {
      event:  'INSERT',
      schema: 'public',
      table:  'calls',
      filter: `receiver=eq.${myName}`,
    }, payload => {
      const row = payload.new;
      if (row.status !== 'pending') return;

      // Auto-reject if already in a call
      if (currentCallId) {
        sb.from('calls').update({ status: 'rejected' }).eq('id', row.id);
        return;
      }

      incomingCallId = row.id;
      incomingCaller = row.caller;
      showIncomingCall(row.caller);
    })
    .subscribe(status => {
      if (status === 'SUBSCRIBED') onSignalingReady();
    });
}
