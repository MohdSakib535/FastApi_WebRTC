let localStream;
let remoteStream;
let peerConnection;
let ws;
let currentRoom = null;
let clientId = generateClientId();
let remotePeerId = null;
let videoEnabled = true;
let audioEnabled = true;

const config = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const statusText = document.getElementById('statusText');
const clientIdDisplay = document.getElementById('clientId');
const currentRoomDisplay = document.getElementById('currentRoom');
const peersList = document.getElementById('peersList');
const localStatus = document.getElementById('localStatus');
const remoteStatus = document.getElementById('remoteStatus');
const remoteOverlay = document.getElementById('remoteOverlay');

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

function createPeerConnection() {
    console.log('Creating peer connection...');
    peerConnection = new RTCPeerConnection(config);

    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    peerConnection.ontrack = (event) => {
        console.log('Received remote track');
        if (!remoteStream) {
            remoteStream = new MediaStream();
            remoteVideo.srcObject = remoteStream;
        }
        remoteStream.addTrack(event.track);
        remoteStatus.textContent = 'Connected';
        remoteOverlay.style.display = 'none';
        updateStatus('✅ Connected');
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            ws.send(JSON.stringify({
                type: 'ice-candidate',
                target_id: remotePeerId,
                candidate: event.candidate
            }));
        }
    };

    peerConnection.onconnectionstatechange = () => {
        console.log('Connection state:', peerConnection.connectionState);
        updateStatus(`Connection: ${peerConnection.connectionState}`);
    };
}

async function joinRoom() {
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
                if (otherClients.length > 0) {
                    remotePeerId = otherClients[0];
                    await createOffer(remotePeerId);
                }
                break;

            case 'user-joined':
                updatePeersList(message.clients.filter(id => id !== clientId));
                break;

            case 'user-left':
                if (message.client_id === remotePeerId) {
                    closeConnection();
                }
                updatePeersList(message.clients?.filter(id => id !== clientId) || []);
                break;

            case 'offer':
                remotePeerId = message.sender_id;
                await handleOffer(message.offer);
                break;

            case 'answer':
                await handleAnswer(message.answer);
                break;

            case 'ice-candidate':
                await handleIceCandidate(message.candidate);
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
    createPeerConnection();
    try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
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

async function handleOffer(offer) {
    createPeerConnection();
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        ws.send(JSON.stringify({
            type: 'answer',
            target_id: remotePeerId,
            answer: answer
        }));
        console.log('Answer sent');
    } catch (error) {
        console.error('Error handling offer:', error);
    }
}

async function handleAnswer(answer) {
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        console.log('Answer received');
    } catch (error) {
        console.error('Error handling answer:', error);
    }
}

async function handleIceCandidate(candidate) {
    try {
        if (peerConnection && candidate) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            console.log('ICE candidate added');
        }
    } catch (error) {
        console.error('Error adding ICE candidate:', error);
    }
}

function leaveRoom() {
    if (ws) {
        ws.close();
    }
    closeConnection();
    
    currentRoom = null;
    currentRoomDisplay.textContent = 'None';
    document.getElementById('joinBtn').disabled = false;
    document.getElementById('leaveBtn').disabled = true;
    document.getElementById('roomInput').disabled = false;
    updateStatus('Left the room');
    updatePeersList([]);
}

function closeConnection() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (remoteStream) {
        remoteStream.getTracks().forEach(track => track.stop());
        remoteStream = null;
        remoteVideo.srcObject = null;
    }
    remotePeerId = null;
    remoteStatus.textContent = 'Waiting...';
    remoteOverlay.style.display = 'block';
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