import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameError } from './errors';
import { Room } from './game';
import { RoomManager } from './rooms';

const rooms: Room[] = [];
afterEach(() => { rooms.splice(0).forEach((r) => r.destroy()); vi.useRealTimers(); });

// Makes a room with n players. Returns ids in join order (first is the host).
function setup(n = 4) {
  const room = new Room('TEST1');
  rooms.push(room);
  const ids = ['Ann', 'Bob', 'Cy', 'Dee', 'Eli'].slice(0, n).map((name) => room.addPlayer(name).id);
  return { room, ids, host: ids[0] };
}
const IMG = (n: number) => `https://example.com/${n}.gif`;
const expectError = (fn: () => void, text: RegExp) => {
  expect(fn).toThrow(GameError);
  expect(fn).toThrow(text);
};
// A fresh, already-started room where `avoid` is false — useful for tests that need to call
// kick/pause/skip as the host on someone who is NOT the host, target, or writer.
function setupAvoiding(n: number, avoid: (room: Room, host: string) => boolean) {
  for (;;) {
    const s = setup(n);
    s.room.start(s.host, 5);
    if (!avoid(s.room, s.host)) return s;
    s.room.destroy();
    rooms.splice(rooms.indexOf(s.room), 1);
  }
}

// Gets the current round out of PROMPT: the current writer just writes a plain prompt.
function toSubmission(room: Room) {
  room.writePrompt(room.round!.writerId!, 'a completely free-form prompt with no placeholders');
  return room;
}

// Starts a game and gets EVERY player (including the one being roasted) to submit.
function toVoting() {
  const { room, ids, host } = setup(4);
  room.start(host, 5);
  toSubmission(room);
  ids.forEach((id, i) => room.submit(id, IMG(i)));
  if (room.phase === 'SUBMISSION') room.skip(host); // end the final-call window early
  return { room, ids, host, target: room.round!.targetId };
}

// Declines every remaining writer candidate in turn until the round falls back to a random prompt.
function declineAllWriters(room: Room) {
  for (let i = 0; i < 10 && room.phase === 'PROMPT' && room.round!.promptText === null; i++) {
    room.declineToWrite(room.round!.writerId!);
  }
}
const cardOf = (room: Room, authorId: string) => room.round!.submissions.find((s) => s.playerId === authorId)!.id;

describe('rooms and players', () => {
  it('creates a room with a 5-letter code and makes the creator host', () => {
    const m = new RoomManager();
    const { room, playerId } = m.create('Ann');
    expect(room.code).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
    expect(room.hostId).toBe(playerId);
    expect(m.get(room.code.toLowerCase())).toBe(room);
    room.destroy();
  });
  it('rejects unknown rooms, duplicate names, and full rooms', () => {
    const m = new RoomManager();
    expectError(() => m.get('NOPE1'), /doesn't exist/);
    const { room } = setup(2);
    expectError(() => room.addPlayer('ann'), /already taken/);
    for (let i = 0; i < 10; i++) room.addPlayer('P' + i);
    expectError(() => room.addPlayer('One too many'), /full/);
  });
  it('gives players unique ids and cleans names', () => {
    const room = new Room('X');
    rooms.push(room);
    const a = room.addPlayer('  <b>Al</b>\n ');
    expect(room.players.get(a.id)!.name).toBe('bAl/b');
    expectError(() => room.addPlayer('   '), /enter a name/);
  });
  it('moves host status when the host disconnects', () => {
    const { room, ids } = setup(3);
    room.attach(ids[0], 's0'); room.attach(ids[1], 's1');
    room.detach(ids[0], 's0');
    expect(room.hostId).toBe(ids[1]);
  });
});

describe('starting a game', () => {
  it('only the host can start, and not with too few players', () => {
    const { room, ids } = setup(3);
    expectError(() => room.start(ids[1], 5), /Only the host/);
    const small = setup(2);
    expectError(() => small.room.start(small.host, 5), /at least/);
    expectError(() => room.start(ids[0], 999), /rounds/);
    room.start(ids[0], 5);
    expect(room.phase).toBe('PROMPT');
    expectError(() => room.start(ids[0], 5), /already started/);
  });
  it('validates the write-time timer range', () => {
    const { room, host } = setup(3);
    expectError(() => room.start(host, 5, { promptWriteSeconds: 3 }), /Prompt-writing time/);
    room.start(host, 5, { promptWriteSeconds: 90 });
    expect(room.stateFor(host).timers.promptWriteSeconds).toBe(90);
  });
});

describe('live prompt writing', () => {
  it('picks a writer to start (could be anyone, including the eventual target)', () => {
    const { room } = setup(4);
    room.start(room.hostId, 5);
    expect(room.phase).toBe('PROMPT');
    const r = room.round!;
    expect(r.writerId).toBeTruthy();
    expect(r.promptText).toBeNull();
  });
  it('only the current writer can write; free text with no @PLAYER is accepted', () => {
    const { room, ids } = setup(4);
    room.start(room.hostId, 5);
    const writer = room.round!.writerId!;
    const someoneElse = ids.find((id) => id !== writer)!;
    expectError(() => room.writePrompt(someoneElse, 'at the beach'), /not your turn/);
    room.writePrompt(writer, 'a totally free prompt, no placeholders needed');
    expect(room.phase).toBe('SUBMISSION');
    expect(room.round!.promptText).toBe('a totally free prompt, no placeholders needed');
  });
  it('rejects an empty prompt', () => {
    const { room } = setup(4);
    room.start(room.hostId, 5);
    expectError(() => room.writePrompt(room.round!.writerId!, '   '), /write a prompt/);
  });
  it('declining passes the turn to the next candidate; only the current writer may decline', () => {
    const { room, ids } = setup(4);
    room.start(room.hostId, 5);
    const first = room.round!.writerId!;
    const notWriter = ids.find((id) => id !== first)!;
    expectError(() => room.declineToWrite(notWriter), /not your turn/);
    room.declineToWrite(first);
    expect(room.phase).toBe('PROMPT');
    expect(room.round!.writerId).not.toBe(first);
    expect(room.round!.promptText).toBeNull();
  });
  it('falls back to a random prompt once everyone has declined', () => {
    const { room } = setup(3);
    room.start(room.hostId, 5);
    const first = room.round!.writerId;
    room.declineToWrite(first!);
    expect(room.phase).toBe('PROMPT'); // next candidate's turn
    expect(room.round!.writerId).not.toBe(first);
    declineAllWriters(room);
    expect(room.phase).toBe('SUBMISSION'); // everyone declined: fallback used
    expect(room.round!.promptText).toBeTruthy();
    expect(room.round!.writerId).toBeNull();
  });
  it('a timeout behaves like a decline (moves to the next candidate, then falls back)', () => {
    vi.useFakeTimers();
    const { room } = setup(3);
    room.start(room.hostId, 5, { promptWriteSeconds: 10 });
    const first = room.round!.writerId;
    vi.advanceTimersByTime(10_100);
    expect(room.phase).toBe('PROMPT');
    expect(room.round!.writerId).not.toBe(first);
    for (let i = 0; i < 5 && room.round!.promptText === null; i++) vi.advanceTimersByTime(10_100);
    expect(room.phase).toBe('SUBMISSION');
  });
  it('host Skip in the PROMPT phase does the same thing as a decline', () => {
    const { room, host } = setup(3);
    room.start(host, 5);
    const first = room.round!.writerId;
    room.skip(host);
    expect(room.round!.writerId).not.toBe(first);
    for (let i = 0; i < 5 && room.phase === 'PROMPT' && room.round!.promptText === null; i++) room.skip(host);
    expect(room.phase).toBe('SUBMISSION');
  });
  it('fallback prompts still use @PLAYER and @random substitution', () => {
    const { room, host } = setup(4);
    room.setPrompts(host, ['@player and @random are rivals']);
    room.start(host, 5);
    declineAllWriters(room);
    const text = room.round!.promptText!;
    const target = room.players.get(room.round!.targetId)!;
    expect(text).toContain('@' + target.name); // built-in prompts substitute @PLAYER too, so this always holds
    expect(text).not.toContain('@PLAYER');
    expect(text).not.toContain('@random');
  });
  it('the host fallback-prompt editor still requires @PLAYER (used for template substitution)', () => {
    const { room, host } = setup(3);
    expectError(() => room.setPrompts(host, ['no placeholder here']), /needs @PLAYER/);
    expectError(() => room.setPrompts(host, ['@PLAYER ' + 'x'.repeat(200)]), /at most/);
    room.setPrompts(host, ['@PLAYER a', '@player A', '  ']);
    expect(room.customPrompts).toEqual(['@PLAYER a']);
  });
  it('only sends the host fallback prompt list to the host', () => {
    const { room, ids, host } = setup(3);
    room.setPrompts(host, ['@PLAYER x']);
    expect(room.stateFor(ids[0]).prompts).toEqual(['@PLAYER x']);
    expect(room.stateFor(ids[1]).prompts).toEqual([]);
  });
});

describe('submissions', () => {
  it('blocks bad URLs and other players\' uploads, but lets you change your pick', () => {
    const { room, ids } = setup(4);
    room.start(room.hostId, 5);
    toSubmission(room);
    const [a, b] = ids;
    room.submit(a, IMG(1));
    room.submit(a, IMG(2)); // resubmitting replaces the previous pick instead of erroring
    expect(room.round!.submissions.filter((s) => s.playerId === a)).toHaveLength(1);
    expect(cardOf(room, a)).toBeTruthy();
    expect(room.round!.submissions.find((s) => s.playerId === a)!.mediaUrl).toBe(IMG(2));
    expectError(() => room.submit(b, 'javascript:alert(1)'), /valid image/);
    expectError(() => room.submit(b, 'not a url'), /valid image/);
    expectError(() => room.submit(b, '/uploads/' + 'a'.repeat(32) + '.png'), /upload was not found/);
  });
  it('the player being roasted can submit too', () => {
    const { room } = setup(4);
    room.start(room.hostId, 5);
    toSubmission(room);
    const target = room.round!.targetId;
    room.submit(target, IMG(1));
    expect(room.round!.submissions.some((s) => s.playerId === target)).toBe(true);
  });
  it('moves to voting once everyone (including the target) has submitted', () => {
    const { room } = toVoting();
    expect(room.phase).toBe('VOTING');
  });
  it('hides authors while voting', () => {
    const { room, ids } = toVoting();
    const view = JSON.stringify(room.stateFor(ids[0]));
    for (const id of ids) expect(view).not.toContain(`"authorId":"${id}"`);
    expect(room.stateFor(ids[0]).cards.length).toBe(4);
  });
  it('once everyone has submitted, the remaining time shrinks to a short final call instead of ending instantly', () => {
    vi.useFakeTimers();
    const { room, ids, host } = setup(3);
    room.start(host, 5, { submissionSeconds: 30 });
    toSubmission(room);
    ids.slice(0, 2).forEach((id, i) => room.submit(id, IMG(i)));
    room.submit(ids[2], IMG(2)); // last submission
    expect(room.phase).toBe('SUBMISSION'); // not instantly moved to voting
    expect(room.stateFor(host).msLeft).toBeLessThanOrEqual(5000);
    vi.advanceTimersByTime(5100);
    expect(room.phase).toBe('VOTING');
  });
});

describe('voting and scoring', () => {
  it('prevents self-votes, double votes and unknown cards', () => {
    const { room, ids } = toVoting();
    const [x, y, z] = ids;
    expectError(() => room.vote(x, cardOf(room, x)), /own submission/);
    room.vote(x, cardOf(room, y));
    expectError(() => room.vote(x, cardOf(room, z)), /already voted/);
    expectError(() => room.vote(y, 'nope'), /does not exist/);
  });
  it('awards 3/2/1 points by votes, including to the target if they submitted', () => {
    const { room, ids, target } = toVoting();
    const [x, y] = ids.filter((id) => id !== target);
    room.vote(target, cardOf(room, x));
    room.vote(y, cardOf(room, x));
    room.vote(ids.find((id) => id !== target && id !== y && id !== x)!, cardOf(room, x));
    room.vote(x, cardOf(room, y)); // last vote ends voting
    expect(room.phase).toBe('RESULTS');
    expect(room.players.get(x)!.score).toBe(3);
    expect(room.stateFor(target).results[0]).toMatchObject({ authorId: x, votes: 3, points: 3 });
  });
});

describe('reactions', () => {
  it('reacting requires a real emoji and a real card, and only during voting/results', () => {
    const { room, ids } = toVoting();
    const cardId = room.round!.cards[0].id;
    expectError(() => room.react(ids[0], cardId, '🍕'), /not available/);
    expectError(() => room.react(ids[0], 'nope', '😂'), /does not exist/);
    room.react(ids[0], cardId, '😂'); // fine during voting
  });
  it('toggles off on a repeat click, and counts are anonymous while voting', () => {
    const { room, ids } = toVoting();
    const cardId = room.round!.cards[0].id;
    room.react(ids[0], cardId, '😂');
    room.react(ids[1], cardId, '😂');
    let view = room.stateFor(ids[2]).cards.find((c) => c.id === cardId)!;
    expect(view.reactions.counts).toEqual({ '😂': 2 });
    expect(room.stateFor(ids[0]).cards.find((c) => c.id === cardId)!.reactions.mine).toBe('😂');
    room.react(ids[0], cardId, '😂'); // toggle off
    view = room.stateFor(ids[2]).cards.find((c) => c.id === cardId)!;
    expect(view.reactions.counts).toEqual({ '😂': 1 });
  });
  it('reactions still work (and stay attached) once results reveal authors', () => {
    const { room, ids, target } = toVoting();
    const [x, y, z] = ids.filter((id) => id !== target);
    const cardId = cardOf(room, x);
    room.vote(target, cardId);
    room.vote(y, cardId);
    room.vote(z, cardId);
    room.react(target, cardId, '🔥');
    expect(room.phase).toBe('VOTING');
    room.vote(x, cardOf(room, y)); // finishes voting
    expect(room.phase).toBe('RESULTS');
    const result = room.stateFor(x).results.find((r) => r.id === cardId)!;
    expect(result.reactions.counts).toEqual({ '🔥': 1 });
    room.react(x, cardId, '💀');
    expect(room.stateFor(x).results.find((r) => r.id === cardId)!.reactions.counts).toEqual({ '🔥': 1, '💀': 1 });
  });
});

describe('round transitions', () => {
  it('runs PROMPT -> SUBMISSION -> RESULTS -> next round -> FINAL and resets on play again', () => {
    const { room, host, ids } = setup(3);
    room.start(host, 2);
    expect(room.roundNumber).toBe(1);
    toSubmission(room);
    room.skip(host); // nobody submitted: straight to results
    expect(room.phase).toBe('RESULTS');
    room.skip(host);
    expect(room.phase).toBe('PROMPT');
    expect(room.roundNumber).toBe(2);
    toSubmission(room);
    room.skip(host); // SUBMISSION -> RESULTS
    room.skip(host); // RESULTS -> FINAL (last round)
    expect(room.phase).toBe('FINAL');
    expectError(() => room.playAgain(ids[1]), /Only the host/);
    room.playAgain(host);
    expect(room.phase).toBe('LOBBY');
  });
});

describe('host controls', () => {
  it('pause freezes the timer and blocks writing/submissions until resumed', () => {
    vi.useFakeTimers();
    const { room, host } = setup(3);
    room.start(host, 5, { promptWriteSeconds: 20 });
    vi.advanceTimersByTime(5_000);
    const notHost = room.round!.writerId === host ? room.round!.remainingWriters[0] : room.round!.writerId!;
    expectError(() => room.togglePause(notHost), /Only the host/);
    room.togglePause(host);
    const frozen = room.stateFor(host).msLeft;
    expect(room.stateFor(host).paused).toBe(true);
    vi.advanceTimersByTime(120_000);
    expect(room.phase).toBe('PROMPT');
    expect(room.stateFor(host).msLeft).toBe(frozen);
    expectError(() => room.writePrompt(room.round!.writerId!, 'x'), /paused/);
    room.togglePause(host);
    room.writePrompt(room.round!.writerId!, 'x');
    expect(room.phase).toBe('SUBMISSION');
  });
  it('end game jumps to final results; only the host may do it', () => {
    const { room, ids, host } = setup(3);
    expectError(() => room.endGame(host), /no game/);
    room.start(host, 5);
    expectError(() => room.endGame(ids[1]), /Only the host/);
    room.endGame(host);
    expect(room.phase).toBe('FINAL');
  });
  it('restart starts round 1 again with zero scores', () => {
    const { room, ids, host, target } = toVoting();
    const [x] = ids.filter((id) => id !== target);
    const others = ids.filter((id) => id !== x);
    others.forEach((id) => room.vote(id, cardOf(room, x)));
    room.vote(x, cardOf(room, others[0]));
    if (room.phase !== 'RESULTS') room.skip(host);
    expect(ids.some((id) => room.players.get(id)!.score > 0)).toBe(true);
    expectError(() => room.restart(ids[1] === host ? ids[2] : ids[1]), /Only the host/);
    room.restart(host);
    expect(room.phase).toBe('PROMPT');
    expect(room.roundNumber).toBe(1);
    expect(ids.every((id) => room.players.get(id)!.score === 0)).toBe(true);
  });
  it('kick removes a player and their image', () => {
    const { room, ids, target } = toVoting();
    const host = room.hostId;
    const victim = ids.find((id) => id !== host && id !== target) ?? ids.find((id) => id !== host)!;
    const other = ids.find((id) => id !== host && id !== victim)!;
    expectError(() => room.kick(other, victim), /Only the host/);
    expectError(() => room.kick(host, host), /yourself/);
    expectError(() => room.kick(host, 'nobody'), /not in the room/);
    const before = room.round!.cards.length;
    room.kick(host, victim);
    expect(room.players.has(victim)).toBe(false);
    expect(room.round!.cards.some((c) => c.playerId === victim)).toBe(false);
    expect(room.stateFor(host).cards.length).toBe(before - 1);
  });
  it('kicking the target ends the round without points', () => {
    const s = setupAvoiding(4, (room, host) => room.round!.targetId === host);
    s.room.kick(s.host, s.room.round!.targetId);
    expect(s.room.phase).toBe('RESULTS');
    expect([...s.room.players.values()].every((p) => p.score === 0)).toBe(true);
  });
  it('kicking the current writer moves on to the next candidate', () => {
    // Avoid the host being the writer, and avoid the writer and target being the same player
    // (kicking a self-roasting writer ends the round instead, which is covered separately).
    const s = setupAvoiding(4, (room, host) => room.round!.writerId === host || room.round!.writerId === room.round!.targetId);
    const before = s.room.round!.writerId;
    s.room.kick(s.host, before!);
    expect(s.room.phase).toBe('PROMPT');
    expect(s.room.round!.writerId).not.toBe(before);
  });
});
