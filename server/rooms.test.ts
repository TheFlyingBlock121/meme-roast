import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG } from './config';
import { GameError } from './errors';
import { RoomManager } from './rooms';

const managers: RoomManager[] = [];
afterEach(() => { managers.splice(0).forEach((m) => m.rooms.forEach((r) => r.destroy())); });
function mk() {
  const m = new RoomManager();
  managers.push(m);
  return m;
}

describe('RoomManager', () => {
  it('room codes never use ambiguous letters/numbers (0, O, 1, I, L)', () => {
    const m = mk();
    for (let i = 0; i < 30; i++) {
      const { room } = m.create('P' + i);
      expect(room.code).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
    }
  });
  it('never hands out the same room code twice while a room is live', () => {
    const m = mk();
    const codes = new Set<string>();
    for (let i = 0; i < 50; i++) codes.add(m.create('P' + i).room.code);
    expect(codes.size).toBe(50);
  });
  it('get() is case-insensitive and trims whitespace, and rejects unknown codes', () => {
    const m = mk();
    const { room } = m.create('Ann');
    expect(m.get(room.code.toLowerCase())).toBe(room);
    expect(m.get(' ' + room.code + ' ')).toBe(room);
    expect(() => m.get('ZZZZZ')).toThrow(GameError);
    expect(() => m.get(undefined)).toThrow(GameError);
  });
  it('sweep leaves an active room alone, but removes it once past the idle limit', () => {
    const m = mk();
    const { room } = m.create('Ann');
    const created = room.lastActivity;
    m.sweep(created + CONFIG.roomIdleMinutes * 60_000 - 1000); // just under the limit
    expect(m.rooms.has(room.code)).toBe(true);
    m.sweep(created + CONFIG.roomIdleMinutes * 60_000 + 1000); // just past the limit
    expect(m.rooms.has(room.code)).toBe(false);
  });
  it('sweep only removes the idle room, not one that is still active', () => {
    const m = mk();
    const { room: quiet } = m.create('Ann');
    const { room: busy } = m.create('Bob');
    const deadline = quiet.lastActivity + CONFIG.roomIdleMinutes * 60_000 + 1000;
    busy.lastActivity = deadline; // pretend this room was just touched
    m.sweep(deadline);
    expect(m.rooms.has(quiet.code)).toBe(false);
    expect(m.rooms.has(busy.code)).toBe(true);
  });
});
