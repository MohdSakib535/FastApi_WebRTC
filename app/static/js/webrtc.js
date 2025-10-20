let localStream;
let ws;
let currentRoom = null;
const clientId = generateClientId();
let videoEnabled = true;
let audioEnabled = true;
let rtcConfig = { iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
]};
let configLoaded = false;
// Map of peerId -> { pc, remoteStream, boxEl, videoEl, statusEl, pendingCandidates: [] }
const peers = new Map();

async function loadRtcConfig() {
    if (configLoaded) return;
    try {
        const res = await fetch('/config', { cache: 'no-store' });
        if (res.ok) {
            const data = await res.json();
            if (data && Array.isArray(data.iceServers)) {
                rtcConfig = { iceServers: data.iceServers };
                console.log('Loaded ICE servers from /config:', rtcConfig);
            }
        }
    } catch (e) {
        console.warn('Failed to load /config, using defaults', e);
    } finally {
        configLoaded = true;
    }
}

const localVideo = document.getElementById('localVideo');
const statusText = document.getElementById('statusText');
const clientIdDisplay = document.getElementById('clientId');
const currentRoomDisplay = document.getElementById('currentRoom');
const peersList = document.getElementById('peersList');
const localStatus = document.getElementById('localStatus');
const videoContainer = document.getElementById('videoContainer');
const noRemotesNotice = document.getElementById('noRemotesNotice');
const recordBtn = document.getElementById('recordBtn');
const transcriptOutput = document.getElementById('transcriptOutput');
const recordingStatus = document.getElementById('recordingStatus');
const summarizeBtn = document.getElementById('summarizeBtn');
const downloadPdfBtn = document.getElementById('downloadPdfBtn');
const summaryOutput = document.getElementById('summaryOutput');
const summaryStatus = document.getElementById('summaryStatus');
// Single active recorder per room
let activeRecorder = null;
let roomTranscriptBuffer = '';
let roomInterim = '';

// Speech-to-Text via Web Speech API (Chrome-based)
let SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition || null;
let recognition = null;
let isRecording = false;
let shouldKeepRecording = false;
let recognitionRestartTimer = null;
let transcriptBuffer = '';
// Throttle transcript-update messages to reduce WS traffic
let transcriptSendTimer = null;
let lastTranscriptSendAt = 0;
const TRANSCRIPT_SEND_INTERVAL_MS = 300;
// Track how much of transcriptBuffer has been persisted to backend
let lastSavedLength = 0;
function renderRoomTranscript() {
    if (!transcriptOutput) return;
    const buf = (roomTranscriptBuffer || '').trim();
    const inter = (roomInterim || '').trim();
    let text = buf;
    if (inter) text = (text ? text + ' ' : '') + inter + '…';
    transcriptOutput.textContent = text;
}

if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            const res = event.results[i];
            if (res.isFinal) {
                transcriptBuffer += (transcriptBuffer ? ' ' : '') + res[0].transcript.trim();
            } else {
                interim += res[0].transcript;
            }
        }
        // Update local room transcript view and broadcast to room
        roomTranscriptBuffer = transcriptBuffer;
        roomInterim = interim;
        renderRoomTranscript();
        scheduleTranscriptUpdate();

        // Persist only the newly finalized portion to backend
        const delta = transcriptBuffer.slice(lastSavedLength).trim();
        if (delta.length > 0) {
            saveTranscriptChunk(delta);
            lastSavedLength = transcriptBuffer.length;
        }
    };

    function sendTranscriptUpdateNow() {
        try {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'transcript-update',
                    buffer: roomTranscriptBuffer,
                    interim: roomInterim,
                    language: recognition.lang
                }));
            }
        } catch {}
    }

    function scheduleTranscriptUpdate() {
        const now = Date.now();
        const elapsed = now - lastTranscriptSendAt;
        if (elapsed >= TRANSCRIPT_SEND_INTERVAL_MS) {
            sendTranscriptUpdateNow();
            lastTranscriptSendAt = now;
        } else {
            if (transcriptSendTimer) clearTimeout(transcriptSendTimer);
            transcriptSendTimer = setTimeout(() => {
                sendTranscriptUpdateNow();
                lastTranscriptSendAt = Date.now();
                transcriptSendTimer = null;
            }, TRANSCRIPT_SEND_INTERVAL_MS - elapsed);
        }
    }

    recognition.onerror = (e) => {
        console.warn('Speech recognition error', e);
        const recoverable = ['no-speech', 'audio-capture', 'aborted', 'network'];
        if (shouldKeepRecording && recoverable.includes(e.error)) {
            try { recognition.stop(); } catch {}
            if (recognitionRestartTimer) clearTimeout(recognitionRestartTimer);
            recognitionRestartTimer = setTimeout(() => {
                try { recognition.start(); } catch {}
            }, 500);
            return;
        }
        updateStatus('Recognition error');
        if (isRecording) stopRecording();
    };

    recognition.onend = async () => {
        if (shouldKeepRecording) {
            if (recognitionRestartTimer) clearTimeout(recognitionRestartTimer);
            recognitionRestartTimer = setTimeout(() => {
                try { recognition.start(); } catch {}
            }, 300);
            return;
        }
        // Finalize only on explicit stop
        if (isRecording) {
            isRecording = false;
            if (recordBtn) {
                recordBtn.textContent = '⏺️ Start Recording';
                recordBtn.classList.remove('btn-danger');
                recordBtn.classList.add('btn-primary');
            }
            try {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'recording-state', recording: false }));
                }
            } catch {}
        }
        if (transcriptBuffer.trim()) {
            try {
                await fetch('/transcripts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        room: currentRoom,
                        client_id: clientId,
                        language: recognition ? recognition.lang : 'en-US',
                        text: transcriptBuffer.trim()
                    })
                });
                updateStatus('Transcript saved');
            } catch (err) {
                console.error('Failed to save transcript', err);
                updateStatus('Failed to save transcript');
            }
        }
        updateRecordingUI();
    };
} else if (recordBtn && transcriptOutput) {
    recordBtn.disabled = true;
    transcriptOutput.textContent = 'Speech recognition not supported in this browser.';
}

clientIdDisplay.textContent = clientId;
console.log('Client ID:', clientId);

function generateClientId() {
    return 'client_' + Math.random().toString(36).substring(2, 11);
}

async function initLocalStream() {
    try {
        localStatus.textContent = 'Requesting...';
        localStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: { echoCancellation: true, noiseSuppression: true }
        });
        
        localVideo.srcObject = localStream;
        localStatus.textContent = 'Active';
        updateStatus('✅ Camera ready');
        console.log('✅ Local stream initialized');
        if (recordBtn && recognition) {
            // Enable only when connected to a room
            recordBtn.disabled = !(ws && ws.readyState === WebSocket.OPEN);
        }
    } catch (error) {
        console.error('Error:', error);
        localStatus.textContent = 'Error';
        updateStatus('❌ Camera access denied');
        alert('Please allow camera and microphone access');
    }
}

function toggleRecording() {
    if (!recognition) {
        alert('Speech recognition is not supported in this browser.');
        return;
    }
    if (activeRecorder && activeRecorder !== clientId) {
        updateStatus(`Recording already active by ${activeRecorder}`);
        return;
    }
    if (!isRecording) {
        startRecording();
    } else {
        stopRecording();
    }
}

function startRecording() {
    transcriptBuffer = '';
    lastSavedLength = 0;
    if (transcriptOutput) transcriptOutput.textContent = '';
    try {
        shouldKeepRecording = true;
        recognition.start();
        isRecording = true;
        // Notify room
        try {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'recording-state', recording: true }));
                // Initialize a clean shared transcript for everyone
                ws.send(JSON.stringify({
                    type: 'transcript-update',
                    buffer: '',
                    interim: '',
                    language: recognition.lang
                }));
                lastTranscriptSendAt = 0;
                if (transcriptSendTimer) { clearTimeout(transcriptSendTimer); transcriptSendTimer = null; }
            }
        } catch {}
        activeRecorder = clientId;
        updateRecordingUI();
        if (recordBtn) {
            recordBtn.textContent = '⏹ Stop Recording';
            recordBtn.classList.remove('btn-primary');
            recordBtn.classList.add('btn-danger');
        }
        updateStatus('Recording…');
    } catch (e) {
        console.warn('Failed to start recognition', e);
        updateStatus('Could not start recording');
    }
}

function stopRecording() {
    try {
        shouldKeepRecording = false;
        recognition.stop();
    } catch (e) {
        console.warn('Failed to stop recognition', e);
    }
    isRecording = false;
    // Notify room
    try {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'recording-state', recording: false }));
        }
    } catch {}
    if (transcriptSendTimer) { clearTimeout(transcriptSendTimer); transcriptSendTimer = null; }
    updateRecordingUI();
    if (recordBtn) {
        recordBtn.textContent = '⏺️ Start Recording';
        recordBtn.classList.remove('btn-danger');
        recordBtn.classList.add('btn-primary');
    }
    updateStatus('Recording stopped');
}

function updateRecordingUI() {
    if (recordingStatus) {
        if (!activeRecorder) {
            recordingStatus.textContent = 'Off';
        } else {
            recordingStatus.textContent = `On (${activeRecorder})`;
        }
    }
    if (recordBtn && recognition) {
        if (activeRecorder && activeRecorder !== clientId) {
            recordBtn.disabled = true;
            recordBtn.textContent = 'Recording in progress';
            recordBtn.classList.remove('btn-primary');
            recordBtn.classList.remove('btn-danger');
        } else {
            // If not connected, elsewhere we disable the button; we don't override that here
            if (ws && ws.readyState === WebSocket.OPEN) {
                recordBtn.disabled = false;
                recordBtn.textContent = isRecording ? '⏹ Stop Recording' : '⏺️ Start Recording';
                if (isRecording) {
                    recordBtn.classList.add('btn-danger');
                    recordBtn.classList.remove('btn-primary');
                } else {
                    recordBtn.classList.add('btn-primary');
                    recordBtn.classList.remove('btn-danger');
                }
            }
        }
    }
}

function createRemoteVideoBox(peerId) {
    const box = document.createElement('div');
    box.className = 'video-box';
    box.id = `peer-${peerId}`;

    const header = document.createElement('div');
    header.className = 'video-header';
    const title = document.createElement('h3');
    title.textContent = `👤 ${peerId}`;
    const status = document.createElement('span');
    status.className = 'video-status';
    status.textContent = 'Connecting...';
    header.appendChild(title);
    header.appendChild(status);

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    // Don't mute remote videos by default
    video.muted = false;
    video.style.width = '100%';
    video.style.height = '100%';

    const overlay = document.createElement('div');
    overlay.className = 'video-overlay';
    overlay.innerHTML = `<p>${peerId}</p><button class="btn-success btn-small" data-action="toggle-audio">Mute</button>`;

    box.appendChild(header);
    box.appendChild(video);
    box.appendChild(overlay);
    videoContainer.appendChild(box);

    // Toggle audio on click
    overlay.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-action="toggle-audio"]');
        if (!btn) return;
        video.muted = !video.muted;
        btn.textContent = video.muted ? 'Unmute' : 'Mute';
        try { video.play(); } catch {}
    });

    return { box, video, status };
}

function createPeerConnectionFor(targetId) {
    if (peers.has(targetId)) {
        return peers.get(targetId).pc;
    }

    console.log('Creating peer connection for', targetId);
    const pc = new RTCPeerConnection(rtcConfig);

    // Attach local media
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    // Prepare UI
    const ui = createRemoteVideoBox(targetId);
    if (noRemotesNotice) noRemotesNotice.style.display = 'none';
    const remoteStream = new MediaStream();
    ui.video.srcObject = remoteStream;

    pc.ontrack = (event) => {
        console.log('Received remote track from', targetId);
        remoteStream.addTrack(event.track);
        ui.status.textContent = 'Connected';
        
        // Force play the video and ensure it's visible
        ui.video.style.display = 'block';
        ui.video.play().catch((err) => {
            console.warn('Autoplay blocked, trying again...', err);
            // Add a play button if autoplay fails
            const playButton = document.createElement('button');
            playButton.textContent = 'Click to Play';
            playButton.className = 'btn-primary';
            playButton.style.position = 'absolute';
            playButton.style.top = '50%';
            playButton.style.left = '50%';
            playButton.style.transform = 'translate(-50%, -50%)';
            ui.box.appendChild(playButton);
            
            playButton.onclick = () => {
                ui.video.play();
                playButton.remove();
            };
        });
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            ws.send(JSON.stringify({
                type: 'ice-candidate',
                target_id: targetId,
                candidate: event.candidate
            }));
        }
    };

    pc.onconnectionstatechange = () => {
        console.log('Connection state with', targetId, pc.connectionState);
        const state = pc.connectionState;
        ui.status.textContent = state.charAt(0).toUpperCase() + state.slice(1);
        if (state === 'failed' || state === 'closed') {
            removePeer(targetId);
        }
    };

    peers.set(targetId, { pc, remoteStream, boxEl: ui.box, videoEl: ui.video, statusEl: ui.status, pendingCandidates: [] });
    return pc;
}

async function joinRoom() {
    await loadRtcConfig();
    const roomInput = document.getElementById('roomInput');
    const room = roomInput.value.trim();

    if (!room) {
        alert('Please enter a room name');
        return;
    }

    if (!localStream) {
        await initLocalStream();
    }

    currentRoom = room;
    currentRoomDisplay.textContent = room;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/${room}/${clientId}`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('WebSocket connected');
        updateStatus(`Connected to room: ${room}`);
        document.getElementById('joinBtn').disabled = true;
        document.getElementById('leaveBtn').disabled = false;
        roomInput.disabled = true;
        if (recordBtn && recognition) {
            recordBtn.disabled = false;
        }
        if (summarizeBtn) summarizeBtn.disabled = false;
        if (downloadPdfBtn) downloadPdfBtn.disabled = false;
    };

    ws.onmessage = async (event) => {
        const message = JSON.parse(event.data);
        console.log('Received:', message.type);

        switch (message.type) {
            case 'room-clients':
                updatePeersList(message.clients.filter(id => id !== clientId));
                const otherClients = message.clients.filter(id => id !== clientId);
                for (const id of otherClients) {
                    if (!peers.has(id)) {
                        await createOffer(id);
                    }
                }
                // Sync active recorder state on join
                if (typeof message.active_recorder !== 'undefined') {
                    activeRecorder = message.active_recorder || null;
                    updateRecordingUI();
                }
                break;

            case 'user-joined':
                updatePeersList(message.clients.filter(id => id !== clientId));
                // Deterministic initiator to avoid glare: higher clientId initiates
                if (message.client_id && message.client_id !== clientId && !peers.has(message.client_id)) {
                    const shouldInitiate = clientId.localeCompare(message.client_id) > 0;
                    if (shouldInitiate) {
                        await createOffer(message.client_id);
                    }
                }
                break;

            case 'user-left':
                removePeer(message.client_id);
                updatePeersList(message.clients?.filter(id => id !== clientId) || []);
                if (message.client_id && message.client_id === activeRecorder) {
                    activeRecorder = null;
                    updateRecordingUI();
                }
                break;

            case 'offer':
                await handleOffer(message.sender_id, message.offer);
                break;

            case 'answer':
                await handleAnswer(message.sender_id, message.answer);
                break;

            case 'ice-candidate':
                await handleIceCandidate(message.sender_id, message.candidate);
                break;

            case 'recording-state':
                if (message.recording) {
                    activeRecorder = message.active_recorder || message.sender_id;
                    // Reset transcript display at the start
                    roomTranscriptBuffer = '';
                    roomInterim = '';
                    renderRoomTranscript();
                } else {
                    activeRecorder = null;
                    // Optionally keep last transcript on stop, do not clear here.
                }
                updateRecordingUI();
                break;

            case 'transcript-update':
                // Only display the active recorder's transcript
                roomTranscriptBuffer = message.buffer || '';
                roomInterim = message.interim || '';
                renderRoomTranscript();
                break;

            case 'recording-denied':
                // Another user is already recording. Ensure our UI reflects that state.
                if (isRecording) {
                    try { recognition.stop(); } catch {}
                    isRecording = false;
                }
                shouldKeepRecording = false;
                activeRecorder = message.active_recorder || null;
                updateRecordingUI();
                break;
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        updateStatus('Connection error');
    };

    ws.onclose = () => {
        console.log('WebSocket disconnected');
        updateStatus('Disconnected');
    };
}

async function createOffer(targetId) {
    const pc = createPeerConnectionFor(targetId);
    try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        
        ws.send(JSON.stringify({
            type: 'offer',
            target_id: targetId,
            offer: offer
        }));
        console.log('Offer sent');
    } catch (error) {
        console.error('Error creating offer:', error);
    }
}

async function handleOffer(fromId, offer) {
    const pc = createPeerConnectionFor(fromId);
    try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        ws.send(JSON.stringify({
            type: 'answer',
            target_id: fromId,
            answer: answer
        }));
        console.log('Answer sent');
        // Flush any pending ICE candidates queued before remoteDescription was set
        const peer = peers.get(fromId);
        if (peer && peer.pendingCandidates && peer.pendingCandidates.length) {
            for (const cand of peer.pendingCandidates) {
                try { await pc.addIceCandidate(new RTCIceCandidate(cand)); } catch (e) { console.warn('Failed to add queued ICE', e); }
            }
            peer.pendingCandidates = [];
        }
    } catch (error) {
        console.error('Error handling offer:', error);
    }
}

async function handleAnswer(fromId, answer) {
    try {
        const peer = peers.get(fromId);
        if (peer) {
            await peer.pc.setRemoteDescription(new RTCSessionDescription(answer));
            // Flush queued ICE candidates
            if (peer.pendingCandidates && peer.pendingCandidates.length) {
                for (const cand of peer.pendingCandidates) {
                    try { await peer.pc.addIceCandidate(new RTCIceCandidate(cand)); } catch (e) { console.warn('Failed to add queued ICE', e); }
                }
                peer.pendingCandidates = [];
            }
        }
        console.log('Answer received');
    } catch (error) {
        console.error('Error handling answer:', error);
    }
}

async function handleIceCandidate(fromId, candidate) {
    try {
        const peer = peers.get(fromId);
        if (peer && candidate) {
            // Queue ICE candidates until we have a remoteDescription set
            if (!peer.pc.remoteDescription) {
                peer.pendingCandidates.push(candidate);
                console.log('Queued ICE candidate until remoteDescription is set');
            } else {
                await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
                console.log('ICE candidate added');
            }
        }
    } catch (error) {
        console.error('Error adding ICE candidate:', error);
    }
}

function leaveRoom() {
    if (ws) {
        ws.close();
    }
    if (recordBtn) recordBtn.disabled = true;
    if (summarizeBtn) summarizeBtn.disabled = true;
    if (downloadPdfBtn) downloadPdfBtn.disabled = true;
    if (isRecording && recognition) {
        try { recognition.stop(); } catch {}
        isRecording = false;
    }
    shouldKeepRecording = false;
    if (transcriptSendTimer) { clearTimeout(transcriptSendTimer); transcriptSendTimer = null; }
    // Close all peer connections and remove UI
    Array.from(peers.keys()).forEach(removePeer);
    
    currentRoom = null;
    currentRoomDisplay.textContent = 'None';
    document.getElementById('joinBtn').disabled = false;
    document.getElementById('leaveBtn').disabled = true;
    document.getElementById('roomInput').disabled = false;
    updateStatus('Left the room');
    updatePeersList([]);
    roomTranscriptBuffer = '';
    roomInterim = '';
    renderRoomTranscript();
    activeRecorder = null;
    updateRecordingUI();
}

async function saveTranscriptChunk(chunkText) {
    try {
        await fetch('/transcripts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                room: currentRoom,
                client_id: clientId,
                language: recognition ? recognition.lang : 'en-US',
                text: chunkText
            })
        });
    } catch (e) {
        console.warn('Failed to persist transcript chunk', e);
    }
}

async function summarizeRoom() {
    if (!currentRoom) {
        alert('Join a room first');
        return;
    }
    if (summaryOutput) summaryOutput.textContent = '';
    if (summaryStatus) summaryStatus.textContent = 'Summarizing…';
    try {
        const res = await fetch(`/summaries/room/${encodeURIComponent(currentRoom)}`, {
            method: 'POST'
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || `Request failed (${res.status})`);
        }
        const data = await res.json();
        if (summaryOutput) summaryOutput.textContent = data.summary || 'No summary.';
        if (summaryStatus) summaryStatus.textContent = '';
    } catch (e) {
        console.error('Summarize failed', e);
        if (summaryStatus) summaryStatus.textContent = `Error: ${e.message}`;
    }
}

async function downloadSummaryPdf() {
    if (!currentRoom) {
        alert('Join a room first');
        return;
    }
    if (summaryStatus) summaryStatus.textContent = 'Generating PDF…';
    if (downloadPdfBtn) downloadPdfBtn.disabled = true;
    try {
        const body = { summary: (summaryOutput && summaryOutput.textContent) ? summaryOutput.textContent : '' };
        const res = await fetch(`/summaries/room/${encodeURIComponent(currentRoom)}/pdf`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || `Request failed (${res.status})`);
        }
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const ts = new Date().toISOString().slice(0,16).replace(/[:T]/g,'-');
        a.download = `room-summary-${currentRoom}-${ts}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        if (summaryStatus) summaryStatus.textContent = '';
    } catch (e) {
        console.error('Download PDF failed', e);
        if (summaryStatus) summaryStatus.textContent = `Error: ${e.message}`;
    } finally {
        if (downloadPdfBtn) downloadPdfBtn.disabled = false;
    }
}

function removePeer(peerId) {
    const peer = peers.get(peerId);
    if (!peer) return;
    try {
        peer.pc.ontrack = null;
        peer.pc.onicecandidate = null;
        peer.pc.onconnectionstatechange = null;
        peer.pc.close();
    } catch (e) {
        console.warn('Error closing peer', peerId, e);
    }
    if (peer.remoteStream) {
        peer.remoteStream.getTracks().forEach(t => t.stop());
    }
    if (peer.boxEl && peer.boxEl.parentNode) {
        peer.boxEl.parentNode.removeChild(peer.boxEl);
    }
    peers.delete(peerId);
    if (peers.size === 0 && noRemotesNotice) {
        noRemotesNotice.style.display = '';
    }
}

function toggleVideo() {
    if (localStream) {
        videoEnabled = !videoEnabled;
        localStream.getVideoTracks()[0].enabled = videoEnabled;
        const btn = document.getElementById('toggleVideo');
        btn.textContent = videoEnabled ? '📹 Video On' : '📹 Video Off';
        btn.classList.toggle('off');
    }
}

function toggleAudio() {
    if (localStream) {
        audioEnabled = !audioEnabled;
        localStream.getAudioTracks()[0].enabled = audioEnabled;
        const btn = document.getElementById('toggleAudio');
        btn.textContent = audioEnabled ? '🎤 Audio On' : '🎤 Audio Off';
        btn.classList.toggle('off');
    }
}

function updateStatus(message) {
    statusText.textContent = message;
}

function updatePeersList(peers) {
    peersList.innerHTML = '';
    if (peers.length === 0) {
        peersList.innerHTML = '<li class="no-peers">No participants yet</li>';
    } else {
        peers.forEach(peerId => {
            const li = document.createElement('li');
            li.textContent = `User: ${peerId}`;
            peersList.appendChild(li);
        });
    }
}

initLocalStream();
