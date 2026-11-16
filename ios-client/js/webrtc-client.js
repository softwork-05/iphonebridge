/**
 * GSM Call Bridge - WebRTC & WebSocket Client
 * Manages ultra-low latency audio bridging between iOS Safari and Android Host.
 */
class WebRtcBridgeClient {
    constructor(eventCallbacks = {}) {
        this.callbacks = eventCallbacks;
        this.ws = null;
        this.pc = null;
        this.localAudioStream = null;
        this.isConnected = false;
        this.reconnectTimer = null;
        this.pingInterval = null;
        this.lastPingTimestamp = 0;
        this.currentLatency = 0;

        this.hostAddress = localStorage.getItem('gsm_host_address') || window.location.host || '192.168.43.1:8080';
    }

    setHostAddress(address) {
        this.hostAddress = address.trim();
        localStorage.setItem('gsm_host_address', this.hostAddress);
    }

    connect() {
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            return;
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        // If hostAddress contains protocol, strip it
        let cleanHost = this.hostAddress.replace(/^https?:\/\//, '').replace(/^wss?:\/\//, '');

        // If accessed on Android HTTP port 8080, route WebSocket connection to port 8081
        if (cleanHost.includes(':8080')) {
            cleanHost = cleanHost.replace(':8080', ':8081');
        } else if (!cleanHost.includes(':')) {
            cleanHost = `${cleanHost}:8081`;
        }

        const wsUrl = `${protocol}//${cleanHost}`;

        console.log(`[WebRtcBridge] Connecting to Android Gateway: ${wsUrl}`);

        try {
            this.ws = new WebSocket(wsUrl);
            this.ws.binaryType = 'arraybuffer';

            this.ws.onopen = () => {
                console.log('[WebRtcBridge] WebSocket Connected!');
                this.isConnected = true;
                if (this.reconnectTimer) {
                    clearTimeout(this.reconnectTimer);
                    this.reconnectTimer = null;
                }
                this.startPingHeartbeat();
                this.triggerCallback('onConnected', true);
            };

            this.ws.onmessage = (event) => {
                if (typeof event.data === 'string') {
                    this.handleSignalingMessage(event.data);
                } else if (event.data instanceof ArrayBuffer) {
                    // Fallback raw binary audio packet
                    this.handleBinaryAudioPacket(event.data);
                }
            };

            this.ws.onclose = (event) => {
                console.warn('[WebRtcBridge] WebSocket Disconnected:', event.code, event.reason);
                this.cleanup();
                this.triggerCallback('onConnected', false);
                this.scheduleReconnect();
            };

            this.ws.onerror = (err) => {
                console.error('[WebRtcBridge] WebSocket Error:', err);
                this.triggerCallback('onError', err);
            };

        } catch (e) {
            console.error('[WebRtcBridge] Exception creating WebSocket:', e);
            this.scheduleReconnect();
        }
    }

    scheduleReconnect() {
        if (!this.reconnectTimer) {
            this.reconnectTimer = setTimeout(() => {
                console.log('[WebRtcBridge] Attempting auto-reconnect...');
                this.connect();
            }, 3000);
        }
    }

    startPingHeartbeat() {
        this.stopPingHeartbeat();
        this.pingInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.lastPingTimestamp = Date.now();
                this.sendJson('PING');
            }
        }, 3000);
    }

    stopPingHeartbeat() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }

    handleSignalingMessage(jsonStr) {
        try {
            const msg = JSON.parse(jsonStr);
            const type = msg.type;
            const payload = msg.payload || {};

            switch (type) {
                case 'PONG':
                    this.currentLatency = Date.now() - this.lastPingTimestamp;
                    this.triggerCallback('onLatency', this.currentLatency);
                    break;

                case 'HOST_STATUS':
                    this.triggerCallback('onHostStatus', payload);
                    break;

                case 'CALL_STATE':
                    this.triggerCallback('onCallState', payload);
                    break;

                case 'WEBRTC_ANSWER':
                    this.handleWebRtcAnswer(payload.sdp);
                    break;

                case 'WEBRTC_ICE':
                    this.handleRemoteIceCandidate(payload);
                    break;

                case 'ERROR':
                    console.error('[WebRtcBridge] Host Error:', payload.message);
                    this.triggerCallback('onError', payload.message);
                    break;
            }
        } catch (e) {
            console.error('[WebRtcBridge] Error parsing JSON message:', e);
        }
    }

    /**
     * Start WebRTC Audio Session for an active call
     */
    async startWebRtcSession() {
        console.log('[WebRtcBridge] Initializing WebRTC Audio Session...');
        this.closePeerConnection();

        try {
            // Request iPhone Microphone with voice constraints
            this.localAudioStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 48000,
                    channelCount: 1
                },
                video: false
            });

            const rtcConfig = {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' }
                ],
                sdpSemantics: 'unified-plan',
                bundlePolicy: 'max-bundle'
            };

            this.pc = new RTCPeerConnection(rtcConfig);

            // Add local microphone tracks
            this.localAudioStream.getTracks().forEach(track => {
                this.pc.addTrack(track, this.localAudioStream);
            });

            // Handle incoming remote audio track from Android GSM gateway
            this.pc.ontrack = (event) => {
                console.log('[WebRtcBridge] Inbound GSM Call audio track received!');
                const remoteAudio = document.getElementById('remoteAudioStream');
                if (remoteAudio && event.streams[0]) {
                    remoteAudio.srcObject = event.streams[0];
                    remoteAudio.play().catch(e => {
                        console.warn('[WebRtcBridge] Remote audio play failed (audio unlock required):', e);
                    });
                }
            };

            // ICE Candidate gathering
            this.pc.onicecandidate = (event) => {
                if (event.candidate) {
                    this.sendJson('WEBRTC_ICE', {
                        candidate: event.candidate.candidate,
                        sdpMid: event.candidate.sdpMid,
                        sdpMLineIndex: event.candidate.sdpMLineIndex
                    });
                }
            };

            // Create WebRTC Offer
            const offer = await this.pc.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: false,
                voiceActivityDetection: true
            });

            // Modify SDP for maximum Opus audio quality & minimal latency
            offer.sdp = this.optimizeSdpForUltraLowLatency(offer.sdp);

            await this.pc.setLocalDescription(offer);
            console.log('[WebRtcBridge] Sending WebRTC Offer to Android Host...');
            this.sendJson('WEBRTC_OFFER', { sdp: offer.sdp });

        } catch (err) {
            console.error('[WebRtcBridge] WebRTC setup error:', err);
            this.triggerCallback('onError', 'Microphone access denied or WebRTC failure.');
        }
    }

    optimizeSdpForUltraLowLatency(sdp) {
        // Enforce stereo=0, ptime=20, maxplaybackrate=48000, minptime=10 for Opus
        return sdp.replace(
            /(a=rtpmap:(\d+) opus\/48000\/2[\r\n]+)/,
            '$1a=fmtp:$2 minptime=10;useinbandfec=1;usedtx=1;stereo=0;sprop-stereo=0\r\n'
        );
    }

    async handleWebRtcAnswer(answerSdp) {
        if (!this.pc) return;
        try {
            console.log('[WebRtcBridge] Setting Remote Description from WebRTC Answer...');
            const desc = new RTCSessionDescription({ type: 'answer', sdp: answerSdp });
            await this.pc.setRemoteDescription(desc);
            console.log('[WebRtcBridge] WebRTC Audio Pipeline established!');
        } catch (e) {
            console.error('[WebRtcBridge] Error setting remote description:', e);
        }
    }

    async handleRemoteIceCandidate(icePayload) {
        if (!this.pc) return;
        try {
            const candidate = new RTCIceCandidate({
                candidate: icePayload.candidate,
                sdpMid: icePayload.sdpMid,
                sdpMLineIndex: icePayload.sdpMLineIndex
            });
            await this.pc.addIceCandidate(candidate);
        } catch (e) {
            console.warn('[WebRtcBridge] Error adding remote ICE candidate:', e);
        }
    }

    handleBinaryAudioPacket(arrayBuffer) {
        // Fallback PCM playback handler if WebRTC is unavailable
        console.log(`[WebRtcBridge] Fallback raw audio frame: ${arrayBuffer.byteLength} bytes`);
    }

    // Call Control Commands to Android Host
    sendDial(phoneNumber) {
        this.sendJson('DIAL', { phoneNumber });
    }

    sendAnswer() {
        this.sendJson('ANSWER');
    }

    sendReject() {
        this.sendJson('REJECT');
    }

    sendHangup() {
        this.sendJson('HANGUP');
    }

    sendDtmf(digit) {
        this.sendJson('DTMF', { digit });
    }

    setMicrophoneMuted(isMuted) {
        if (this.localAudioStream) {
            this.localAudioStream.getAudioTracks().forEach(track => {
                track.enabled = !isMuted;
            });
            console.log(`[WebRtcBridge] Microphone muted: ${isMuted}`);
        }
    }

    sendJson(type, payload = {}) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            const message = JSON.stringify({
                type,
                payload,
                timestamp: Date.now()
            });
            this.ws.send(message);
        } else {
            console.warn(`[WebRtcBridge] Cannot send ${type}: WebSocket not connected`);
        }
    }

    closePeerConnection() {
        if (this.pc) {
            this.pc.close();
            this.pc = null;
        }
        if (this.localAudioStream) {
            this.localAudioStream.getTracks().forEach(t => t.stop());
            this.localAudioStream = null;
        }
    }

    cleanup() {
        this.stopPingHeartbeat();
        this.closePeerConnection();
        this.isConnected = false;
    }

    triggerCallback(event, data) {
        if (typeof this.callbacks[event] === 'function') {
            this.callbacks[event](data);
        }
    }
}

window.WebRtcBridgeClient = WebRtcBridgeClient;
