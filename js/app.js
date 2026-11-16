/**
 * GSM Call Bridge - Main iOS Application Controller
 * Coordinates UI states, WebRTC audio bridge, simulated native call overlays, and tab routing.
 */
document.addEventListener('DOMContentLoaded', () => {

    // UI Elements - Status Header
    const hostConnDot = document.getElementById('hostConnDot');
    const hostBattery = document.getElementById('hostBattery');
    const hostLatency = document.getElementById('hostLatency');
    const simCarrier = document.getElementById('simCarrier');
    const signalBars = document.getElementById('signalBars');

    // UI Elements - Overlays
    const incomingOverlay = document.getElementById('incomingCallOverlay');
    const incCallerName = document.getElementById('incCallerName');
    const incCallerNumber = document.getElementById('incCallerNumber');
    const btnAcceptCall = document.getElementById('btnAcceptCall');
    const btnDeclineCall = document.getElementById('btnDeclineCall');

    const activeOverlay = document.getElementById('activeCallOverlay');
    const activeCallerTitle = document.getElementById('activeCallerTitle');
    const activeCallTimer = document.getElementById('activeCallTimer');
    const activeCallStatusBadge = document.getElementById('activeCallStatusBadge');
    const btnEndCall = document.getElementById('btnEndCall');
    const btnToggleMute = document.getElementById('btnToggleMute');
    const btnToggleSpeaker = document.getElementById('btnToggleSpeaker');
    const speakerLabel = document.getElementById('speakerLabel');
    const btnToggleKeypadModal = document.getElementById('btnToggleKeypadModal');
    const incallKeypadModal = document.getElementById('incallKeypadModal');
    const btnCloseDtmf = document.getElementById('btnCloseDtmf');
    const dtmfDigitsStream = document.getElementById('dtmfDigitsStream');

    // Settings UI
    const inputHostAddress = document.getElementById('inputHostAddress');
    const btnReconnect = document.getElementById('btnReconnect');
    const btnReqMic = document.getElementById('btnReqMic');
    const selectAudioOutput = document.getElementById('selectAudioOutput');

    // State Variables
    let isCallActive = false;
    let isIncomingCall = false;
    let callTimerInterval = null;
    let callSeconds = 0;
    let isMuted = false;
    let isSpeakerOn = false;
    let currentCallNumber = '';

    // Initialize WebRTC Client
    const bridge = new WebRtcBridgeClient({
        onConnected: (connected) => {
            if (connected) {
                hostConnDot.classList.add('connected');
                console.log('[App] Connected to Android Gateway');
            } else {
                hostConnDot.classList.remove('connected');
                hostLatency.textContent = '--ms';
            }
        },
        onLatency: (ms) => {
            hostLatency.textContent = `${ms}ms`;
        },
        onHostStatus: (status) => {
            // Update battery
            const chargeIcon = status.isCharging ? '⚡' : '';
            hostBattery.textContent = `${status.batteryPct}% ${chargeIcon}`;
            // Update carrier
            simCarrier.textContent = status.carrierName || 'GSM SIM';
            // Update signal level (0 - 4)
            signalBars.setAttribute('data-level', status.signalBars != null ? status.signalBars : 4);
        },
        onCallState: (callState) => {
            handleCallStateChange(callState);
        },
        onError: (err) => {
            console.error('[App] Bridge error:', err);
        }
    });

    // Initialize Dialer Manager
    const dialer = new DialerManager((numberToDial) => {
        initiateOutgoingCall(numberToDial);
    });

    // Setup Tabs Navigation
    const tabButtons = document.querySelectorAll('.tab-item');
    const views = document.querySelectorAll('.view');
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            tabButtons.forEach(b => b.classList.remove('active'));
            views.forEach(v => v.classList.remove('active-view'));

            btn.classList.add('active');
            const targetId = btn.getAttribute('data-target');
            const targetView = document.getElementById(targetId);
            if (targetView) targetView.classList.add('active-view');
        });
    });

    // Prepopulate Settings
    inputHostAddress.value = bridge.hostAddress;
    btnReconnect.addEventListener('click', () => {
        bridge.setHostAddress(inputHostAddress.value);
        bridge.connect();
    });

    btnReqMic.addEventListener('click', async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(t => t.stop());
            btnReqMic.textContent = 'Granted';
            btnReqMic.style.color = '#30D158';
        } catch (e) {
            alert('Please allow microphone access in iOS Safari settings.');
        }
    });

    selectAudioOutput.addEventListener('change', (e) => {
        window.audioManager.setAudioRoute(e.target.value);
    });

    // Call State Coordinator
    function handleCallStateChange(stateUpdate) {
        const state = stateUpdate.state;
        const number = stateUpdate.phoneNumber || 'Unknown';
        console.log(`[App] Telephony State Transition: ${state} (${number})`);

        switch (state) {
            case 'RINGING':
                showIncomingCallUI(number, stateUpdate.callerName);
                break;

            case 'DIALING':
                showDialingUI(number);
                break;

            case 'ACTIVE':
                showActiveCallUI(number);
                break;

            case 'DISCONNECTED':
            case 'IDLE':
                handleCallEnded();
                break;
        }
    }

    function showIncomingCallUI(number, callerName) {
        isIncomingCall = true;
        currentCallNumber = number;
        incCallerNumber.textContent = number;
        incCallerName.textContent = callerName || 'Cellular Call';
        incomingOverlay.classList.remove('hidden');

        // Play native incoming ringtone
        window.audioManager.startIncomingRingtone();
    }

    function showDialingUI(number) {
        currentCallNumber = number;
        activeCallerTitle.textContent = number;
        activeCallStatusBadge.textContent = 'Calling...';
        activeCallTimer.textContent = '00:00';
        activeOverlay.classList.remove('hidden');

        window.audioManager.startRingbackTone();
    }

    function showActiveCallUI(number) {
        isCallActive = true;
        window.audioManager.stopAllTones();

        incomingOverlay.classList.add('hidden');
        activeOverlay.classList.remove('hidden');
        activeCallerTitle.textContent = number || currentCallNumber;
        activeCallStatusBadge.textContent = 'Connected (GSM Route)';

        // Start call duration timer
        startCallTimer();

        // Launch low-latency WebRTC audio session
        bridge.startWebRtcSession();
    }

    function handleCallEnded() {
        window.audioManager.stopAllTones();
        stopCallTimer();

        if (isIncomingCall && !isCallActive) {
            dialer.saveCallLog(currentCallNumber, 'missed', 0);
        } else if (isCallActive) {
            dialer.saveCallLog(currentCallNumber, 'outgoing', callSeconds);
        }

        isCallActive = false;
        isIncomingCall = false;
        callSeconds = 0;

        incomingOverlay.classList.add('hidden');
        activeOverlay.classList.add('hidden');
        incallKeypadModal.classList.add('hidden');
        bridge.closePeerConnection();

        // Reset toggles
        isMuted = false;
        btnToggleMute.classList.remove('active');
    }

    function initiateOutgoingCall(phoneNumber) {
        currentCallNumber = phoneNumber;
        window.audioManager.unlockAudioContext();
        bridge.sendDial(phoneNumber);
        showDialingUI(phoneNumber);
    }

    // Call Action Handlers
    btnAcceptCall.addEventListener('click', () => {
        window.audioManager.unlockAudioContext();
        window.audioManager.stopAllTones();
        bridge.sendAnswer();
        showActiveCallUI(currentCallNumber);
    });

    btnDeclineCall.addEventListener('click', () => {
        window.audioManager.stopAllTones();
        bridge.sendReject();
        incomingOverlay.classList.add('hidden');
        dialer.saveCallLog(currentCallNumber, 'missed', 0);
    });

    btnEndCall.addEventListener('click', () => {
        bridge.sendHangup();
        handleCallEnded();
    });

    // In-Call Controls
    btnToggleMute.addEventListener('click', () => {
        isMuted = !isMuted;
        btnToggleMute.classList.toggle('active', isMuted);
        bridge.setMicrophoneMuted(isMuted);
    });

    btnToggleSpeaker.addEventListener('click', () => {
        isSpeakerOn = !isSpeakerOn;
        btnToggleSpeaker.classList.toggle('active', isSpeakerOn);
        speakerLabel.textContent = isSpeakerOn ? 'Earpiece' : 'Speaker';
        window.audioManager.setAudioRoute(isSpeakerOn ? 'speaker' : 'earpiece');
    });

    btnToggleKeypadModal.addEventListener('click', () => {
        incallKeypadModal.classList.toggle('hidden');
    });

    btnCloseDtmf.addEventListener('click', () => {
        incallKeypadModal.classList.add('hidden');
    });

    // DTMF In-Call Keypad Buttons
    const dtmfButtons = document.querySelectorAll('.dtmf-btn');
    dtmfButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const digit = btn.getAttribute('data-key');
            window.audioManager.playDtmf(digit, 200);
            bridge.sendDtmf(digit);
            dtmfDigitsStream.textContent = (dtmfDigitsStream.textContent + digit).slice(-10);
        });
    });

    function startCallTimer() {
        stopCallTimer();
        callSeconds = 0;
        callTimerInterval = setInterval(() => {
            callSeconds++;
            const mins = String(Math.floor(callSeconds / 60)).padStart(2, '0');
            const secs = String(callSeconds % 60).padStart(2, '0');
            activeCallTimer.textContent = `${mins}:${secs}`;
        }, 1000);
    }

    function stopCallTimer() {
        if (callTimerInterval) {
            clearInterval(callTimerInterval);
            callTimerInterval = null;
        }
    }

    // Auto-connect on start
    bridge.connect();
});
