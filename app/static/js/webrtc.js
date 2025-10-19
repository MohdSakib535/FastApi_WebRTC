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
    } catch (error) {
        console.error('Error:', error);
        localStatus.textContent = 'Error';
        updateStatus('❌ Camera access denied');
        alert('Please allow camera and microphone access');
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
    // Close all peer connections and remove UI
    Array.from(peers.keys()).forEach(removePeer);
    
    currentRoom = null;
    currentRoomDisplay.textContent = 'None';
    document.getElementById('joinBtn').disabled = false;
    document.getElementById('leaveBtn').disabled = true;
    document.getElementById('roomInput').disabled = false;
    updateStatus('Left the room');
    updatePeersList([]);
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
