// --- 1. CONFIGURAÇÃO FIREBASE ---
const firebaseConfig = {
    apiKey: "AIzaSyAzUrQOJcALZmO9vyO8J52XDKL4Q49M7Rg",
    authDomain: "cine-54caf.firebaseapp.com",
    databaseURL: "https://cine-54caf-default-rtdb.firebaseio.com",
    projectId: "cine-54caf",
    storageBucket: "cine-54caf.firebasestorage.app",
    messagingSenderId: "345032163360",
    appId: "1:345032163360:web:7be1fca9c58250c2bf3c45"
};
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.database();

let roomRef, user, peer, myStream;
let isHost = false;
let currentSrc = '';
let lastUpdate = 0;

const html5Player = document.getElementById('html5-player');
const ytDiv = document.getElementById('yt-player');
const streamPlayer = document.getElementById('stream-player');
const hostPreview = document.getElementById('host-preview');
const unlockBtn = document.getElementById('unlock-btn');
const broadcastBtn = document.getElementById('broadcastBtn');

function notify(msg, type='info') {
    const d = document.createElement('div');
    d.className = `toast`; d.innerText = msg;
    if(type==='error') d.style.borderLeftColor = 'var(--error)';
    document.getElementById('toast-area').appendChild(d);
    setTimeout(() => d.remove(), 4000);
}

function enterRoom() {
    user = document.getElementById('userInput').value || 'Visitante';
    let roomInput = document.getElementById('roomInput').value || 'geral';
    const room = roomInput.trim().toLowerCase();
    
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    
    const url = window.location.pathname + '?room=' + room;
    window.history.pushState({path: url}, '', url);

    roomRef = db.ref(`rooms/${room}`);
    notify(`Conectado à sala: ${room}`, "success");

    setupSync();
    setupChat();
    setupWebRTC();
}

function loadMedia() {
    const url = document.getElementById('mediaUrl').value.trim();
    if(!url) return notify("Cole um link!", "error");

    let type = 'html5';
    if (url.includes('youtu')) type = 'youtube';

    roomRef.update({
        type: type,
        src: url,
        status: 'playing',
        timestamp: 0,
        updatedAt: firebase.database.ServerValue.TIMESTAMP
    });
}

function setupSync() {
    roomRef.on('value', snap => {
        const data = snap.val();
        if(!data || !data.src) return;

        if (data.broadcast && data.broadcast.isLive) return;

        if (data.src !== currentSrc) {
            currentSrc = data.src;
            playContent(data.type, data.src);
        }

        if (data.type === 'html5' && html5Player.src) {
            if (Math.abs(html5Player.currentTime - data.timestamp) > 3) {
                html5Player.currentTime = data.timestamp;
            }
            if (data.status === 'playing' && html5Player.paused) {
                html5Player.play().catch(()=>{});
            } else if (data.status === 'paused' && !html5Player.paused) {
                html5Player.pause();
            }
        }
    });
}

function playContent(type, src) {
    hostPreview.style.display = 'none';
    streamPlayer.style.display = 'none';
    
    if (type === 'youtube') {
        html5Player.style.display = 'none';
        ytDiv.style.display = 'block';
        if(window.ytPlayer) window.ytPlayer.loadVideoById(src.match(/(?:v=|\/)([\w-]{11})/)[1]);
    } else {
        ytDiv.style.display = 'none';
        html5Player.style.display = 'block';
        
        if (Hls.isSupported() && src.includes('.m3u8')) {
            if(window.hls) window.hls.destroy();
            window.hls = new Hls({
                manifestLoadingTimeOut: 20000,
                fragLoadingTimeOut: 20000
            });
            window.hls.loadSource(src);
            window.hls.attachMedia(html5Player);
            window.hls.on(Hls.Events.ERROR, function (event, data) {
                if (data.fatal) html5Player.src = src; // Fallback
            });
        } else {
            html5Player.src = src;
        }
        
        // Mute inicial para evitar bloqueio do Android
        html5Player.muted = true;
        html5Player.play().then(() => {
            notify("Vídeo pronto. Ative o som.");
            unlockBtn.style.display = 'block';
        }).catch(() => {
            notify("Toque no botão para liberar.");
            unlockBtn.style.display = 'block';
        });
    }
}

function unlockAudio() {
    if(html5Player.style.display !== 'none') {
        html5Player.muted = false; html5Player.play();
    } else {
        streamPlayer.muted = false; streamPlayer.play();
    }
    unlockBtn.style.display = 'none';
}

function onYouTubeIframeAPIReady() {
    window.ytPlayer = new YT.Player('yt-player', {
        height: '100%', width: '100%', videoId: '',
        playerVars: { 'autoplay': 1, 'controls': 1 },
        events: {
            'onStateChange': e => {
                if(e.data === 1 && currentSrc) updateServer('playing');
                if(e.data === 2 && currentSrc) updateServer('paused');
            }
        }
    });
}

html5Player.onplay = () => updateServer('playing');
html5Player.onpause = () => updateServer('paused');
html5Player.ontimeupdate = () => {
    if (!html5Player.paused && Date.now() - lastUpdate > 2000) {
        updateServer('playing'); lastUpdate = Date.now();
    }
};

function updateServer(status) {
    if (!currentSrc) return;
    roomRef.update({
        status: status,
        timestamp: html5Player.currentTime,
        updatedAt: firebase.database.ServerValue.TIMESTAMP
    });
}

function setupWebRTC() {
    peer = new Peer(undefined, { config: {'iceServers': [{ urls: 'stun:stun.l.google.com:19302' }]} });
    
    peer.on('open', id => {
        roomRef.child('broadcast').on('value', snap => {
            const data = snap.val();
            if (data && data.isLive && data.hostPeerId !== peer.id) {
                notify(`Recebendo transmissão de ${data.hostName}`);
                peer.connect(data.hostPeerId);
                html5Player.style.display = 'none';
                ytDiv.style.display = 'none';
                streamPlayer.style.display = 'block';
                unlockBtn.style.display = 'block';
            }
        });
    });

    peer.on('call', call => {
        call.answer(null);
        call.on('stream', stream => {
            streamPlayer.srcObject = stream;
            streamPlayer.muted = true;
            streamPlayer.play().catch(() => unlockBtn.style.display = 'block');
        });
    });
}

async function startBroadcast() {
    try {
        const stream = await navigator.mediaDevices.getDisplayMedia({video:{cursor:"always"}, audio:true});
        isHost = true;
        hostPreview.srcObject = stream;
        hostPreview.style.display = 'block';
        streamPlayer.style.display = 'none'; html5Player.style.display = 'none'; ytDiv.style.display = 'none';
        
        broadcastBtn.classList.add('active');
        roomRef.child('broadcast').set({ hostPeerId: peer.id, isLive: true, hostName: user });
        
        peer.on('connection', conn => { peer.call(conn.peer, stream); });
        stream.getVideoTracks()[0].onended = () => {
            roomRef.child('broadcast').set({ isLive: false });
            hostPreview.style.display = 'none'; isHost = false;
            broadcastBtn.classList.remove('active');
        };
    } catch (e) { notify("Erro: Recurso indisponível no celular."); }
}

function setupChat() {
    roomRef.child('chat').on('child_added', snap => {
        const msg = snap.val();
        const d = document.createElement('div');
        d.className = 'msg-bubble';
        d.innerHTML = `<strong>${msg.user}</strong>${msg.text}`;
        document.getElementById('chatList').appendChild(d);
        document.getElementById('chatList').scrollTop = 99999;
    });
}
function sendMsg() {
    const i = document.getElementById('msgInput');
    if(i.value) roomRef.child('chat').push({ user, text: i.value });
    i.value = '';
}
function shareLink() { navigator.clipboard.writeText(window.location.href); notify("Link copiado!", "success"); }
