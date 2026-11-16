/**
 * GSM Call Bridge - Web Audio Manager
 * Handles iOS Safari AudioContext unlocking, DTMF tone synthesis,
 * ringtone generators, and audio routing calibration.
 */
class AudioManager {
    constructor() {
        this.audioCtx = null;
        this.isUnlocked = false;
        this.activeOscillators = [];
        this.ringtoneInterval = null;

        // ITU-T Q.23 DTMF Standard Frequencies (Hz)
        this.dtmfFrequencies = {
            '1': [697, 1209],
            '2': [697, 1336],
            '3': [697, 1477],
            '4': [770, 1209],
            '5': [770, 1336],
            '6': [770, 1477],
            '7': [852, 1209],
            '8': [852, 1336],
            '9': [852, 1477],
            '*': [941, 1209],
            '0': [941, 1336],
            '#': [941, 1477]
        };

        this.initEventListeners();
    }

    /**
     * iOS Safari AudioContext Unlock:
     * Requires explicit user interaction to activate Web Audio pipeline.
     */
    initEventListeners() {
        const unlock = () => {
            if (!this.isUnlocked) {
                this.unlockAudioContext();
            }
        };
        window.addEventListener('touchstart', unlock, { once: true, passive: true });
        window.addEventListener('click', unlock, { once: true, passive: true });
    }

    unlockAudioContext() {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;

        if (!this.audioCtx) {
            this.audioCtx = new AudioContextClass({ latencyHint: 'interactive' });
        }

        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume().then(() => {
                this.isUnlocked = true;
                this.playSilentBuffer();
                console.log('[AudioManager] AudioContext successfully unlocked on iOS Safari.');
                this.updateStatusBadge();
            }).catch(err => {
                console.warn('[AudioManager] AudioContext resume failed:', err);
            });
        } else {
            this.isUnlocked = true;
            this.updateStatusBadge();
        }
    }

    playSilentBuffer() {
        if (!this.audioCtx) return;
        const buffer = this.audioCtx.createBuffer(1, 1, 22050);
        const source = this.audioCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(this.audioCtx.destination);
        source.start(0);
    }

    updateStatusBadge() {
        const badge = document.getElementById('audioContextStatus');
        if (badge) {
            badge.textContent = this.isUnlocked ? 'Active (Ready)' : 'Locked';
            badge.style.color = this.isUnlocked ? '#30D158' : '#FF9500';
        }
    }

    /**
     * Synthesize ITU-T DTMF tone on keypad press
     */
    playDtmf(key, durationMs = 150) {
        if (!this.audioCtx) this.unlockAudioContext();
        if (!this.audioCtx) return;

        const freqs = this.dtmfFrequencies[key];
        if (!freqs) return;

        const now = this.audioCtx.currentTime;
        const gainNode = this.audioCtx.createGain();
        gainNode.gain.setValueAtTime(0.12, now);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + (durationMs / 1000));
        gainNode.connect(this.audioCtx.destination);

        const osc1 = this.audioCtx.createOscillator();
        const osc2 = this.audioCtx.createOscillator();
        osc1.type = 'sine';
        osc2.type = 'sine';
        osc1.frequency.setValueAtTime(freqs[0], now);
        osc2.frequency.setValueAtTime(freqs[1], now);

        osc1.connect(gainNode);
        osc2.connect(gainNode);

        osc1.start(now);
        osc2.start(now);

        const stopTime = now + (durationMs / 1000);
        osc1.stop(stopTime);
        osc2.stop(stopTime);
    }

    /**
     * Play standard telephone ringing tone when waiting for GSM callee to answer
     */
    startRingbackTone() {
        this.stopAllTones();
        if (!this.audioCtx) this.unlockAudioContext();
        if (!this.audioCtx) return;

        const playBurst = () => {
            if (!this.audioCtx) return;
            const now = this.audioCtx.currentTime;
            const gain = this.audioCtx.createGain();
            gain.gain.setValueAtTime(0.08, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 1.8);
            gain.connect(this.audioCtx.destination);

            const osc1 = this.audioCtx.createOscillator();
            const osc2 = this.audioCtx.createOscillator();
            osc1.type = 'sine';
            osc2.type = 'sine';
            osc1.frequency.setValueAtTime(440, now);
            osc2.frequency.setValueAtTime(480, now);

            osc1.connect(gain);
            osc2.connect(gain);
            osc1.start(now);
            osc2.start(now);
            osc1.stop(now + 1.8);
            osc2.stop(now + 1.8);
        };

        playBurst();
        this.ringtoneInterval = setInterval(playBurst, 4000);
    }

    /**
     * Synthesize clean iOS incoming call chime
     */
    startIncomingRingtone() {
        this.stopAllTones();
        if (!this.audioCtx) this.unlockAudioContext();
        if (!this.audioCtx) return;

        const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6 arpeggio
        const playRingtonePhrase = () => {
            if (!this.audioCtx) return;
            let time = this.audioCtx.currentTime;

            notes.forEach((freq, idx) => {
                const noteTime = time + (idx * 0.14);
                const gain = this.audioCtx.createGain();
                gain.gain.setValueAtTime(0.15, noteTime);
                gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.35);
                gain.connect(this.audioCtx.destination);

                const osc = this.audioCtx.createOscillator();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, noteTime);
                osc.connect(gain);
                osc.start(noteTime);
                osc.stop(noteTime + 0.35);
            });
        };

        playRingtonePhrase();
        this.ringtoneInterval = setInterval(playRingtonePhrase, 2200);
    }

    stopAllTones() {
        if (this.ringtoneInterval) {
            clearInterval(this.ringtoneInterval);
            this.ringtoneInterval = null;
        }
        this.activeOscillators.forEach(osc => {
            try { osc.stop(); } catch (e) {}
        });
        this.activeOscillators = [];
    }

    /**
     * Route audio to speaker or receiver (earpiece)
     */
    async setAudioRoute(route = 'earpiece') {
        const audioElement = document.getElementById('remoteAudioStream');
        if (!audioElement) return;

        if (typeof audioElement.setSinkId === 'function') {
            try {
                // Find earpiece or speaker output device if available
                const devices = await navigator.mediaDevices.enumerateDevices();
                const audioOutputs = devices.filter(d => d.kind === 'audiooutput');
                console.log('[AudioManager] Available audio outputs:', audioOutputs);

                const targetDevice = audioOutputs.find(d => {
                    const label = d.label.toLowerCase();
                    return route === 'speaker' ? label.includes('speaker') : label.includes('earpiece') || label.includes('receiver');
                });

                if (targetDevice) {
                    await audioElement.setSinkId(targetDevice.deviceId);
                    console.log(`[AudioManager] Routed audio to: ${targetDevice.label}`);
                }
            } catch (err) {
                console.warn('[AudioManager] setSinkId routing error:', err);
            }
        } else {
            console.log(`[AudioManager] iOS system handles audio route via control center. Requested: ${route}`);
        }
    }
}

window.audioManager = new AudioManager();
