import { randomInt } from 'node:crypto';
import { CONFIG } from './config';
import { GameError } from './errors';
import { Room } from './game';

// No 0/O/1/I/L so codes are easy to read out loud.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export class RoomManager {
  rooms = new Map<string, Room>();

  create(hostName: unknown) {
    const room = new Room(this.newCode());
    const host = room.addPlayer(hostName); // throws (and creates nothing) if the name is bad
    this.rooms.set(room.code, room);
    return { room, playerId: host.id, token: host.token };
  }

  get(code: unknown): Room {
    const key = typeof code === 'string' ? code.trim().toUpperCase() : '';
    const room = this.rooms.get(key);
    if (!room) throw new GameError("The room doesn't exist.");
    return room;
  }

  /** Deletes rooms nobody has touched for a while (and their uploaded files). */
  sweep(now = Date.now()) {
    for (const [code, room] of this.rooms) {
      if (now - room.lastActivity > CONFIG.roomIdleMinutes * 60_000) {
        room.destroy();
        this.rooms.delete(code);
      }
    }
  }

  private newCode(): string {
    for (;;) {
      const code = Array.from({ length: 5 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
      if (!this.rooms.has(code)) return code;
    }
  }
}
