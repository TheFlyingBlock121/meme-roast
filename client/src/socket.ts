import { io } from 'socket.io-client';
import type { Ack } from '../../shared/types';

export const socket = io();

/** Sends a request to the server and waits for its answer: { ok: true, ... } or { ok: false, error }. */
export function call<T extends object = {}>(event: string, data?: unknown): Promise<Ack<T>> {
  return new Promise((resolve) => socket.emit(event, data, resolve));
}

// The session lets a refreshed page rejoin its game. sessionStorage is per browser tab,
// so you can test with several tabs on one computer.
const KEY = 'memeRoast.session';
export type Session = { code: string; token: string };
export const loadSession = (): Session | null => {
  try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { return null; }
};
export const saveSession = (s: Session) => sessionStorage.setItem(KEY, JSON.stringify(s));
export const clearSession = () => sessionStorage.removeItem(KEY);

export async function uploadFile(file: File, s: Session): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/upload', { method: 'POST', headers: { 'x-room-code': s.code, 'x-player-token': s.token }, body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'The upload failed. Please try again.');
  return data.url as string;
}

/** Runs a host action (pause, kick, ...) and shows a plain alert if the server says no. */
export async function act(event: string, data?: unknown) {
  const r = await call(event, data);
  if (!r.ok) alert(r.error);
}
