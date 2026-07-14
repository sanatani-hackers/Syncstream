// Account authentication — email/OTP sign-in, session check, logout.
// Deliberately separate from anything room-related: nothing in this file
// touches state.roomId, ws, or any room-membership concept.
import { state } from './state.js';

export async function checkExistingSession() {
    try {
        const res = await fetch('/api/auth/validate');
        if (res.ok) {
            const data = await res.json();
            state.currentUser = data.user;
            state.isAuthenticated = true;
            return true;
        }
    } catch (e) { /* treat any failure as "not signed in" */ }
    state.currentUser = null;
    state.isAuthenticated = false;
    return false;
}

export async function sendOtp(email) {
    try {
        const res = await fetch('/api/auth/send-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        return res.ok;
    } catch (e) {
        return false;
    }
}

export async function verifyOtp(email, code) {
    try {
        const res = await fetch('/api/auth/verify-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, code })
        });
        const data = await res.json();
        if (res.ok) {
            state.currentUser = data.user;
            state.isAuthenticated = true;
            return { success: true };
        }
        return { success: false, error: data.error || 'Verification failed.' };
    } catch (e) {
        return { success: false, error: 'Something went wrong. Please try again.' };
    }
}

export async function logout() {
    try {
        await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) { /* clear local state regardless of network outcome */ }
    state.currentUser = null;
    state.isAuthenticated = false;
}

// Avatar: first 2 alphabetic characters of the email's local part
// (before @), uppercase. Background color deterministic from a simple
// hash of the email, so the same address always renders the same color.
export function getAvatarInitials(email) {
    const localPart = (email || '').split('@')[0];
    const letters = (localPart.match(/[a-zA-Z]/g) || []).slice(0, 2).join('').toUpperCase();
    return letters || '??';
}

export function getAvatarColor(email) {
    let hash = 0;
    for (let i = 0; i < (email || '').length; i++) {
        hash = email.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 55%, 45%)`;
}
