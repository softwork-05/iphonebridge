/**
 * GSM Call Bridge - Dialer & Keypad Manager
 * Handles user keypad interaction, number formatting, DTMF sound feedback,
 * and call history logging in LocalStorage.
 */
class DialerManager {
    constructor(onCallInitiated) {
        this.onCallInitiated = onCallInitiated;
        this.dialInput = document.getElementById('dialInput');
        this.btnBackspace = document.getElementById('btnBackspace');
        this.btnCall = document.getElementById('btnCall');
        this.recentsList = document.getElementById('recentsList');
        this.btnClearLogs = document.getElementById('btnClearLogs');

        this.longPressTimer = null;
        this.isLongPress = false;

        this.initKeypadEvents();
        this.initRecentsEvents();
        this.renderCallLogs();
    }

    initKeypadEvents() {
        const keys = document.querySelectorAll('.keypad-btn');
        keys.forEach(btn => {
            const key = btn.getAttribute('data-key');

            btn.addEventListener('touchstart', (e) => {
                this.isLongPress = false;
                if (key === '0') {
                    this.longPressTimer = setTimeout(() => {
                        this.isLongPress = true;
                        this.appendDigit('+');
                        window.audioManager.playDtmf('0');
                    }, 550);
                }
            }, { passive: true });

            btn.addEventListener('touchend', (e) => {
                if (this.longPressTimer) {
                    clearTimeout(this.longPressTimer);
                    this.longPressTimer = null;
                }
                if (!this.isLongPress) {
                    this.appendDigit(key);
                    window.audioManager.playDtmf(key);
                }
            }, { passive: true });

            btn.addEventListener('click', (e) => {
                // Fallback for desktop browser clicks
                if (!('ontouchstart' in window)) {
                    this.appendDigit(key);
                    window.audioManager.playDtmf(key);
                }
            });
        });

        // Backspace handling
        this.btnBackspace.addEventListener('click', () => {
            this.deleteLastDigit();
        });

        // Long press backspace to clear all
        let backspaceHoldTimer = null;
        this.btnBackspace.addEventListener('touchstart', () => {
            backspaceHoldTimer = setTimeout(() => {
                this.clearDigits();
            }, 500);
        }, { passive: true });

        this.btnBackspace.addEventListener('touchend', () => {
            if (backspaceHoldTimer) clearTimeout(backspaceHoldTimer);
        }, { passive: true });

        // Call Button
        this.btnCall.addEventListener('click', () => {
            const number = this.dialInput.value.trim();
            if (number.length > 0) {
                if (typeof this.onCallInitiated === 'function') {
                    this.onCallInitiated(number);
                }
            }
        });
    }

    appendDigit(char) {
        let current = this.dialInput.value;
        this.dialInput.value = current + char;
        this.updateBackspaceVisibility();
    }

    deleteLastDigit() {
        let current = this.dialInput.value;
        if (current.length > 0) {
            this.dialInput.value = current.slice(0, -1);
            this.updateBackspaceVisibility();
        }
    }

    clearDigits() {
        this.dialInput.value = '';
        this.updateBackspaceVisibility();
    }

    updateBackspaceVisibility() {
        if (this.dialInput.value.length > 0) {
            this.btnBackspace.classList.add('visible');
        } else {
            this.btnBackspace.classList.remove('visible');
        }
    }

    // Call History Management
    initRecentsEvents() {
        if (this.btnClearLogs) {
            this.btnClearLogs.addEventListener('click', () => {
                localStorage.removeItem('gsm_call_history');
                this.renderCallLogs();
            });
        }
    }

    getCallLogs() {
        try {
            return JSON.parse(localStorage.getItem('gsm_call_history')) || [];
        } catch (e) {
            return [];
        }
    }

    saveCallLog(number, type = 'outgoing', duration = 0) {
        const logs = this.getCallLogs();
        const newLog = {
            id: Date.now(),
            number: number || 'Unknown',
            type: type, // 'incoming', 'outgoing', 'missed'
            duration: duration,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            date: new Date().toLocaleDateString()
        };
        logs.unshift(newLog);
        localStorage.setItem('gsm_call_history', JSON.stringify(logs.slice(0, 50))); // Keep last 50
        this.renderCallLogs();
    }

    renderCallLogs() {
        if (!this.recentsList) return;
        const logs = this.getCallLogs();

        if (logs.length === 0) {
            this.recentsList.innerHTML = '<div class="empty-state">No recent GSM calls</div>';
            return;
        }

        this.recentsList.innerHTML = logs.map(log => {
            const isMissed = log.type === 'missed';
            const numColor = isMissed ? '#FF453A' : '#FFFFFF';
            const typeLabel = log.type === 'incoming' ? 'Incoming Call' : log.type === 'outgoing' ? 'Outgoing Call' : 'Missed Call';
            const durationLabel = log.duration > 0 ? ` • ${Math.floor(log.duration / 60)}m ${log.duration % 60}s` : '';

            return `
                <div class="recent-call-item" data-num="${log.number}">
                    <div class="call-info-left">
                        <div class="caller-num" style="color: ${numColor}">${log.number}</div>
                        <div class="caller-type">${typeLabel}${durationLabel}</div>
                    </div>
                    <div class="call-info-right">
                        <div class="call-time">${log.timestamp}</div>
                    </div>
                </div>
            `;
        }).join('');

        // Add tap-to-redial
        const items = this.recentsList.querySelectorAll('.recent-call-item');
        items.forEach(item => {
            item.addEventListener('click', () => {
                const num = item.getAttribute('data-num');
                if (num && num !== 'Unknown') {
                    this.dialInput.value = num;
                    this.updateBackspaceVisibility();
                    // Switch to Keypad tab
                    const keypadTabBtn = document.querySelector('[data-target="viewKeypad"]');
                    if (keypadTabBtn) keypadTabBtn.click();
                }
            });
        });
    }
}

window.DialerManager = DialerManager;
