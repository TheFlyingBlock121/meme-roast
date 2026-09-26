// The heart of the game: one `Room` = one game. The SERVER owns all state.
// Browsers only send requests ("I want to vote for X"); the Room checks the rules.
//
//   LOBBY -> PROMPT -> SUBMISSION -> VOTING -> RESULTS -> (next round: PROMPT ...) -> FINAL
//
// Every round, one rotating player writes that round's prompt live. They can also press
// "skip" if they don't want to; it then asks the next player. If everyone in the round has
// been asked and skipped (or run out of time), a random fallback prompt is used instead so
// the game always keeps moving.
//
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { CONFIG } from './config';
import { GameError } from './errors';
import { OWN_UPLOAD, parseMediaInput } from './media';
import { CLASSIC_PROMPTS, WILD_PROMPTS } from './prompts';
import type { Phase, Reactions, ResultCard, RoomState } from '../shared/types';

export interface Player {
  id: string; // public, random, never changes — this is the player's identity
  token: string; // SECRET, lets the same browser reconnect after a refresh
  name: string; // display name only
  connected: boolean;
  score: number;
  socketId?: string;
  dropTimer?: NodeJS.Timeout;
}
interface Submission { id: string; playerId: string; mediaUrl: string }
interface Round {
  promptText: string | null; // null until the writer submits (or time runs out)
  targetId: string; // the player being roasted (does not submit)
  writerId: string | null; // who is currently being asked to write the prompt
  remainingWriters: string[]; // other players still in line to be asked this round, if writerId declines
  submissions: Submission[]; // in the order they arrived (used to break ties)
  cards: Submission[]; // shuffled order shown during voting
  votes: Map<string, string>; // voterId -> submission id
  reactions: Map<string, Map<string, string>>; // submissionId -> (playerId -> emoji)
  results: Omit<ResultCard, 'reactions'>[]; // reactions are attached per-viewer in stateFor
}

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function cleanName(raw: unknown): string {
  if (typeof raw !== 'string') throw new GameError('Please enter a name.');
  const name = raw.replace(/\s+/g, ' ').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, CONFIG.maxNameLength).trim();
  if (!name) throw new GameError('Please enter a name.');
  return name;
}

/** Checks and cleans a single prompt typed live by a player. Throws friendly errors. */
export function cleanOnePrompt(raw: unknown): string {
  if (typeof raw !== 'string') throw new GameError('Please write a prompt.');
  const text = raw.replace(/\s+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!text) throw new GameError('Please write a prompt.');
  if (text.length > CONFIG.maxPromptLength) throw new GameError(`Prompts can be at most ${CONFIG.maxPromptLength} characters.`);
  return text;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Checks a list of fallback prompts from the host and returns a cleaned copy. Throws friendly errors. */
export function cleanPrompts(raw: unknown, allowEmpty = false): string[] {
  if (!Array.isArray(raw)) throw new GameError('Please add at least one prompt.');
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const text = item.replace(/\s+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (!text) continue; // empty rows are simply ignored
    const preview = text.length > 30 ? text.slice(0, 30) + '…' : text;
    if (text.length > CONFIG.maxPromptLength) throw new GameError(`Prompts can be at most ${CONFIG.maxPromptLength} characters: "${preview}"`);
    if (!/@PLAYER/i.test(text)) throw new GameError(`Every prompt needs @PLAYER in it: "${preview}"`);
    if (seen.has(text.toLowerCase())) continue; // drop duplicates
    seen.add(text.toLowerCase());
    out.push(text);
  }
  if (out.length === 0 && !allowEmpty) throw new GameError('Please add at least one prompt.');
  if (out.length > CONFIG.maxPrompts) throw new GameError(`You can have at most ${CONFIG.maxPrompts} prompts.`);
  return out;
}

function pickSeconds(value: unknown, range: readonly [number, number], what: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < range[0] || n > range[1]) throw new GameError(`${what} must be between ${range[0]} and ${range[1]} seconds.`);
  return n;
}

function emptyReactions(): Reactions {
  return { counts: {}, mine: null };
}

export class Room {
  phase: Phase = 'LOBBY';
  players = new Map<string, Player>();
  hostId = '';
  totalRounds: number = CONFIG.defaultRounds;
  submissionSeconds: number = CONFIG.submissionSeconds;
  votingSeconds: number = CONFIG.votingSeconds;
  promptWriteSeconds: number = CONFIG.promptWriteSeconds;
  paused = false;
  roundNumber = 0;
  round: Round | null = null;
  customPrompts: string[] = []; // host's own fallback prompts, used when nobody writes in time
  includeWild = true; // include the wild built-in fallback pack
  uploads = new Map<string, string>(); // filename -> playerId who uploaded it
  lastActivity = Date.now();
  onChange: () => void = () => {}; // the socket layer plugs in here to broadcast

  private phaseEndsAt: number | null = null;
  private timer?: NodeJS.Timeout;
  private remainingMs: number | null = null; // time left while paused
  private onPhaseEnd?: () => void;
  private customQueue: string[] = [];
  private builtinQueue: string[] = [];
  private targetQueue: string[] = [];
  private writerQueue: string[] = []; // cross-round rotation, so everyone gets asked about equally often

  constructor(public readonly code: string) {}

  // ---------- players ----------

  addPlayer(rawName: unknown): { id: string; token: string } {
    if (this.phase !== 'LOBBY') throw new GameError('This game has already started.');
    if (this.players.size >= CONFIG.maxPlayers) throw new GameError('The room is full.');
    const name = cleanName(rawName);
    if ([...this.players.values()].some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      throw new GameError('That name is already taken in this room.');
    }
    const player: Player = {
      id: randomUUID(),
      token: randomBytes(24).toString('hex'),
      name,
      connected: true,
      score: 0,
    };
    this.players.set(player.id, player);
    if (!this.hostId) this.hostId = player.id;
    this.changed();
    return { id: player.id, token: player.token };
  }

  findByToken(token: unknown): Player | undefined {
    if (typeof token !== 'string' || !token) return undefined;
    return [...this.players.values()].find((p) => p.token === token);
  }

  attach(playerId: string, socketId: string) {
    const p = this.mustGet(playerId);
    clearTimeout(p.dropTimer);
    p.socketId = socketId;
    p.connected = true;
    this.changed();
  }

  detach(playerId: string, socketId: string) {
    const p = this.players.get(playerId);
    if (!p || p.socketId !== socketId) return; // a newer connection already replaced this one
    p.socketId = undefined;
    p.connected = false;
    if (this.hostId === p.id) this.transferHost();
    if (this.phase === 'LOBBY') {
      p.dropTimer = setTimeout(() => this.remove(p.id), CONFIG.reconnectGraceSeconds * 1000);
      p.dropTimer.unref?.();
    }
    this.checkAdvance();
    this.changed();
  }

  remove(playerId: string) {
    this.players.delete(playerId);
    if (this.hostId === playerId) this.transferHost();
    this.changed();
  }

  connections() {
    return [...this.players.values()].filter((p) => p.socketId).map((p) => ({ playerId: p.id, socketId: p.socketId! }));
  }

  private transferHost() {
    const all = [...this.players.values()];
    this.hostId = (all.find((p) => p.connected) ?? all[0])?.id ?? '';
  }

  private mustGet(id: string): Player {
    const p = this.players.get(id);
    if (!p) throw new GameError('You are not in this room.');
    return p;
  }

  private requireHost(id: string) {
    if (id !== this.hostId) throw new GameError('Only the host can do that.');
  }

  // ---------- host actions ----------

  start(requesterId: string, rounds: unknown, timers: { submissionSeconds?: unknown; votingSeconds?: unknown; promptWriteSeconds?: unknown } = {}) {
    this.requireHost(requesterId);
    if (this.phase !== 'LOBBY') throw new GameError('The game has already started.');
    const n = Number(rounds);
    if (!Number.isInteger(n) || n < 1 || n > CONFIG.maxRounds) throw new GameError(`Choose between 1 and ${CONFIG.maxRounds} rounds.`);
    // Timers are optional; if the host sends them they must be inside the allowed range.
    const sub = timers.submissionSeconds === undefined ? this.submissionSeconds : pickSeconds(timers.submissionSeconds, CONFIG.submissionRange, 'Submit time');
    const vote = timers.votingSeconds === undefined ? this.votingSeconds : pickSeconds(timers.votingSeconds, CONFIG.votingRange, 'Vote time');
    const write = timers.promptWriteSeconds === undefined ? this.promptWriteSeconds : pickSeconds(timers.promptWriteSeconds, CONFIG.promptWriteRange, 'Prompt-writing time');
    this.requireEnoughPlayers();
    this.totalRounds = n;
    this.submissionSeconds = sub;
    this.votingSeconds = vote;
    this.promptWriteSeconds = write;
    this.beginGame();
  }

  private requireEnoughPlayers() {
    if ([...this.players.values()].filter((p) => p.connected).length < CONFIG.minPlayers) {
      throw new GameError(`You need at least ${CONFIG.minPlayers} players to start.`);
    }
  }

  private beginGame() {
    this.roundNumber = 0;
    this.customQueue = [];
    this.builtinQueue = [];
    this.targetQueue = [];
    this.writerQueue = [];
    for (const p of this.players.values()) p.score = 0;
    this.deleteUploads();
    this.startRound();
    this.changed();
  }

  /** Saves the host's own fallback prompts (lobby only). Used only if nobody writes in time. */
  setPrompts(requesterId: string, prompts: unknown, options: { includeWild?: unknown } = {}) {
    this.requireHost(requesterId);
    if (this.phase !== 'LOBBY') throw new GameError('Prompts can only be changed in the lobby.');
    this.customPrompts = cleanPrompts(prompts, true);
    if (options.includeWild !== undefined) this.includeWild = options.includeWild === true;
    this.changed();
  }

  private builtinPool(): string[] {
    return this.includeWild ? [...CLASSIC_PROMPTS, ...WILD_PROMPTS] : [...CLASSIC_PROMPTS];
  }

  /** Freezes or resumes the countdown. */
  togglePause(requesterId: string) {
    this.requireHost(requesterId);
    if (this.phase !== 'PROMPT' && this.phase !== 'SUBMISSION' && this.phase !== 'VOTING' && this.phase !== 'RESULTS') {
      throw new GameError('There is nothing to pause right now.');
    }
    if (this.paused) {
      const ms = this.remainingMs ?? 0;
      this.paused = false;
      this.remainingMs = null;
      this.phaseEndsAt = Date.now() + ms;
      this.armTimer(ms);
    } else {
      this.remainingMs = Math.max(0, (this.phaseEndsAt ?? Date.now()) - Date.now());
      clearTimeout(this.timer);
      this.phaseEndsAt = null;
      this.paused = true;
    }
    this.changed();
  }

  /** Stops the game now and shows the final results. */
  endGame(requesterId: string) {
    this.requireHost(requesterId);
    if (this.phase === 'LOBBY' || this.phase === 'FINAL') throw new GameError('There is no game to end.');
    this.setPhase('FINAL');
    this.changed();
  }

  /** Starts over from round 1 with the same players and settings. */
  restart(requesterId: string) {
    this.requireHost(requesterId);
    if (this.phase === 'LOBBY') throw new GameError('Use Start game in the lobby.');
    this.requireEnoughPlayers();
    this.beginGame();
  }

  /** Removes a player. Returns their socket id (if connected) so the server can tell them. */
  kick(requesterId: string, targetId: unknown): string | undefined {
    this.requireHost(requesterId);
    if (typeof targetId !== 'string' || !this.players.has(targetId)) throw new GameError('That player is not in the room.');
    if (targetId === requesterId) throw new GameError("You can't kick yourself.");
    const player = this.players.get(targetId)!;
    clearTimeout(player.dropTimer);
    this.players.delete(targetId);
    const r = this.round;
    if (r && (this.phase === 'PROMPT' || this.phase === 'SUBMISSION' || this.phase === 'VOTING')) {
      if (r.targetId === targetId) {
        // The person being roasted left: end this round quietly with no points.
        r.submissions = [];
        r.cards = [];
        r.votes.clear();
        this.finishRound();
      } else if (this.phase === 'PROMPT' && r.writerId === targetId) {
        // The writer left before finishing: move straight on to the next candidate.
        r.remainingWriters = r.remainingWriters.filter((id) => id !== targetId);
        this.skipWriter();
      } else {
        r.remainingWriters = r.remainingWriters.filter((id) => id !== targetId);
        // Their image disappears with them.
        r.submissions = r.submissions.filter((s) => s.playerId !== targetId);
        r.cards = r.cards.filter((s) => s.playerId !== targetId);
        r.votes.delete(targetId);
        this.checkAdvance();
      }
    }
    this.changed();
    return player.socketId;
  }

  /** Host shortcut: jump to the next phase (asks the next writer, ends submitting/voting early, or skips results). */
  skip(requesterId: string) {
    this.requireHost(requesterId);
    if (this.phase === 'PROMPT') this.skipWriter();
    else if (this.phase === 'SUBMISSION') this.endSubmission();
    else if (this.phase === 'VOTING') this.endVoting();
    else if (this.phase === 'RESULTS') this.nextRound();
    this.changed();
  }

  /** After the final results: back to the lobby, same room, fresh scores. */
  playAgain(requesterId: string) {
    this.requireHost(requesterId);
    if (this.phase !== 'FINAL') throw new GameError('The game is not finished yet.');
    for (const p of [...this.players.values()]) if (!p.connected) this.players.delete(p.id);
    for (const p of this.players.values()) p.score = 0;
    if (!this.players.has(this.hostId)) this.transferHost();
    this.round = null;
    this.roundNumber = 0;
    this.deleteUploads();
    this.setPhase('LOBBY');
    this.changed();
  }

  // ---------- round flow ----------

  private startRound() {
    this.roundNumber++;
    const target = this.pickTarget();
    const candidates = this.orderedWriterCandidates();
    this.round = {
      promptText: null,
      targetId: target.id,
      writerId: candidates[0] ?? null,
      remainingWriters: candidates.slice(1),
      submissions: [],
      cards: [],
      votes: new Map(),
      reactions: new Map(),
      results: [],
    };
    if (!this.round.writerId) return this.applyFallbackPrompt(); // nobody available to write at all
    this.setPhase('PROMPT', this.promptWriteSeconds * 1000, () => this.skipWriter());
  }

  private beginSubmission() {
    this.setPhase('SUBMISSION', this.submissionSeconds * 1000, () => this.endSubmission());
  }

  // Everyone gets roasted once before anyone is roasted twice.
  private pickTarget(): Player {
    for (let attempt = 0; attempt < 2; attempt++) {
      while (this.targetQueue.length) {
        const p = this.players.get(this.targetQueue.pop()!);
        if (p?.connected) return p;
      }
      this.targetQueue = shuffle([...this.players.keys()]);
    }
    return [...this.players.values()][0];
  }

  // Builds this round's order of writer candidates — including the player being roasted, who
  // is free to write their own prompt — using the cross-round rotation queue so everyone gets
  // asked about equally often over the course of the game.
  private orderedWriterCandidates(): string[] {
    const order: string[] = [];
    const used = new Set<string>();
    for (let round = 0; round < 2; round++) {
      while (this.writerQueue.length) {
        const id = this.writerQueue.pop()!;
        const p = this.players.get(id);
        if (p?.connected && !used.has(id)) {
          order.push(id);
          used.add(id);
        }
      }
      if (order.length) break; // got at least one full pass; don't reshuffle again
      const pool = [...this.players.values()].filter((p) => p.connected).map((p) => p.id);
      if (pool.length === 0) return [];
      this.writerQueue = shuffle(pool);
    }
    return order;
  }

  // Every prompt is used once before any repeats. About half from the host's fallback list
  // (if any), half from the built-in pack.
  private nextFallbackPrompt(): string {
    const custom = this.customPrompts;
    const useCustom = custom.length > 0 && randomInt(2) === 0;
    if (useCustom) {
      if (!this.customQueue.length) this.customQueue = shuffle(custom);
      return this.customQueue.pop()!;
    }
    if (!this.builtinQueue.length) this.builtinQueue = shuffle(this.builtinPool());
    return this.builtinQueue.pop()!;
  }

  // Fills in @PLAYER (the target) and @random (one other random connected player, picked
  // once and reused for every @random in the text) in a raw prompt.
  private fillPrompt(raw: string, target: Player): string {
    let randomPick: Player | undefined | null = null;
    return raw
      .replace(/@PLAYER/gi, () => '@' + target.name)
      .replace(/@random/gi, () => {
        if (randomPick === null) {
          const pool = [...this.players.values()].filter((p) => p.connected && p.id !== target.id);
          randomPick = pool.length ? pool[randomInt(pool.length)] : undefined;
        }
        return randomPick ? '@' + randomPick.name : 'someone';
      });
  }

  private applyFallbackPrompt() {
    const r = this.round!;
    const target = this.mustGet(r.targetId);
    r.promptText = this.fillPrompt(this.nextFallbackPrompt(), target);
    r.writerId = null;
    this.beginSubmission();
  }

  /** The current writer types this round's prompt. */
  writePrompt(playerId: string, text: unknown) {
    const r = this.round;
    if (this.phase !== 'PROMPT' || !r) throw new GameError('It is not time to write a prompt.');
    if (this.paused) throw new GameError('The game is paused.');
    if (playerId !== r.writerId) throw new GameError("It's not your turn to write the prompt.");
    const target = this.mustGet(r.targetId);
    r.promptText = this.fillPrompt(cleanOnePrompt(text), target);
    this.beginSubmission();
    this.changed();
  }

  /** The current writer doesn't want to write this round: ask the next player instead. */
  declineToWrite(playerId: string) {
    const r = this.round;
    if (this.phase !== 'PROMPT' || !r) throw new GameError('It is not time to write a prompt.');
    if (playerId !== r.writerId) throw new GameError("It's not your turn to write the prompt.");
    this.skipWriter();
    this.changed();
  }

  // Moves the writing duty to the next candidate. Used by "decline", a timeout, a kick, or
  // the host's Skip button. Falls back to a random prompt once everyone has had a turn.
  private skipWriter() {
    const r = this.round;
    if (!r || this.phase !== 'PROMPT' || r.promptText) return;
    if (r.remainingWriters.length === 0) return this.applyFallbackPrompt();
    const [next, ...rest] = r.remainingWriters;
    r.writerId = next;
    r.remainingWriters = rest;
    this.setPhase('PROMPT', this.promptWriteSeconds * 1000, () => this.skipWriter());
  }

  submit(playerId: string, media: unknown) {
    const r = this.round;
    if (this.phase !== 'SUBMISSION' || !r) throw new GameError('Submissions are closed.');
    if (this.paused) throw new GameError('The game is paused.');
    this.mustGet(playerId);
    const mediaUrl = parseMediaInput(media);
    const own = OWN_UPLOAD.exec(mediaUrl);
    if (own && this.uploads.get(own[1]) !== playerId) throw new GameError('That upload was not found. Please upload it again.');
    // Submitting again before the round moves on replaces your previous pick.
    const existing = r.submissions.find((s) => s.playerId === playerId);
    if (existing) existing.mediaUrl = mediaUrl;
    else r.submissions.push({ id: randomUUID(), playerId, mediaUrl });
    this.checkAdvance();
    this.changed();
  }

  vote(playerId: string, cardId: unknown) {
    const r = this.round;
    if (this.phase !== 'VOTING' || !r) throw new GameError('Voting is not open right now.');
    if (this.paused) throw new GameError('The game is paused.');
    this.mustGet(playerId);
    if (r.votes.has(playerId)) throw new GameError('You already voted.');
    const card = r.cards.find((c) => c.id === cardId);
    if (!card) throw new GameError('That submission does not exist.');
    if (card.playerId === playerId) throw new GameError('You cannot vote for your own submission.');
    r.votes.set(playerId, card.id);
    this.checkAdvance();
    this.changed();
  }

  /** Reacts to a submission with an emoji, during voting (anonymous) or results (revealed). Toggles off on repeat. */
  react(playerId: string, cardId: unknown, emoji: unknown) {
    const r = this.round;
    if (!r || (this.phase !== 'VOTING' && this.phase !== 'RESULTS')) throw new GameError('Reactions are not available right now.');
    this.mustGet(playerId);
    if (typeof emoji !== 'string' || !CONFIG.reactionEmojis.includes(emoji)) throw new GameError('That reaction is not available.');
    const pool = this.phase === 'VOTING' ? r.cards : r.submissions;
    if (typeof cardId !== 'string' || !pool.some((c) => c.id === cardId)) throw new GameError('That submission does not exist.');
    if (!r.reactions.has(cardId)) r.reactions.set(cardId, new Map());
    const forCard = r.reactions.get(cardId)!;
    if (forCard.get(playerId) === emoji) forCard.delete(playerId); // click the same emoji again to remove it
    else forCard.set(playerId, emoji);
    this.changed();
  }

  private reactionsFor(cardId: string, viewerId: string): Reactions {
    const map = this.round?.reactions.get(cardId);
    if (!map) return emptyReactions();
    const counts: Record<string, number> = {};
    let mine: string | null = null;
    for (const [pid, emoji] of map) {
      counts[emoji] = (counts[emoji] ?? 0) + 1;
      if (pid === viewerId) mine = emoji;
    }
    return { counts, mine };
  }

  // Ends a phase early once everybody who can act has acted.
  private checkAdvance() {
    const r = this.round;
    if (!r || this.paused) return;
    const here = [...this.players.values()].filter((p) => p.connected);
    if (this.phase === 'PROMPT') {
      if (r.writerId && !this.players.get(r.writerId)?.connected) this.skipWriter();
    } else if (this.phase === 'SUBMISSION') {
      const waiting = here.filter((p) => !r.submissions.some((s) => s.playerId === p.id));
      // Once everyone's in, give a final few seconds to change a pick instead of cutting it off instantly.
      if (waiting.length === 0) this.speedUpSubmission();
    } else if (this.phase === 'VOTING') {
      const canVote = here.filter((p) => r.cards.some((c) => c.playerId !== p.id));
      if (canVote.every((p) => r.votes.has(p.id))) this.endVoting();
    }
  }

  private endSubmission() {
    const r = this.round;
    if (!r || this.phase !== 'SUBMISSION') return;
    if (r.submissions.length === 0) return this.finishRound(); // nobody submitted: nothing to vote on
    r.cards = shuffle(r.submissions); // anonymous, random order
    this.setPhase('VOTING', this.votingSeconds * 1000, () => this.endVoting());
  }

  // Once everyone has submitted, don't cut them off instantly — leave a short final-call window
  // (so a last-second change of mind still counts) instead of jumping straight to voting.
  private speedUpSubmission() {
    if (this.phase !== 'SUBMISSION') return;
    const remaining = this.phaseEndsAt ? this.phaseEndsAt - Date.now() : 0;
    const cap = CONFIG.finalCallMs;
    if (remaining <= cap) return; // already short enough: let the existing timer run out
    clearTimeout(this.timer);
    this.phaseEndsAt = Date.now() + cap;
    this.armTimer(cap);
  }

  private endVoting() {
    if (this.phase === 'VOTING') this.finishRound();
  }

  // Scoring is 100% server-side. Ranking: most votes wins; a tie goes to whoever submitted first.
  private finishRound() {
    const r = this.round!;
    const tally = new Map<string, number>();
    for (const cardId of r.votes.values()) tally.set(cardId, (tally.get(cardId) ?? 0) + 1);
    const ranked = r.submissions
      .map((s, order) => ({ s, order, votes: tally.get(s.id) ?? 0 }))
      .sort((a, b) => b.votes - a.votes || a.order - b.order);
    r.results = ranked.map((x, rank) => {
      const points = x.votes > 0 ? CONFIG.scoring[rank] ?? 0 : 0;
      const author = this.players.get(x.s.playerId);
      if (author) author.score += points;
      return { id: x.s.id, mediaUrl: x.s.mediaUrl, authorId: x.s.playerId, authorName: author?.name ?? 'Someone', votes: x.votes, points };
    });
    this.setPhase('RESULTS', CONFIG.resultsSeconds * 1000, () => this.nextRound());
  }

  private nextRound() {
    if (this.phase !== 'RESULTS') return;
    if (this.roundNumber >= this.totalRounds) this.setPhase('FINAL');
    else this.startRound();
  }

  private setPhase(phase: Phase, ms = 0, onEnd?: () => void) {
    clearTimeout(this.timer);
    this.paused = false; // moving to a new phase always un-pauses
    this.remainingMs = null;
    this.phase = phase;
    this.phaseEndsAt = ms ? Date.now() + ms : null;
    this.onPhaseEnd = onEnd;
    if (ms && onEnd) this.armTimer(ms);
  }

  private armTimer(ms: number) {
    this.timer = setTimeout(() => {
      this.onPhaseEnd?.();
      this.changed();
    }, ms);
    this.timer.unref?.();
  }

  // ---------- uploads ----------

  uploadCount(playerId: string) {
    return [...this.uploads.values()].filter((id) => id === playerId).length;
  }

  registerUpload(playerId: string, filename: string) {
    this.uploads.set(filename, playerId);
  }

  private deleteUploads() {
    // Filenames were generated by us (32 hex chars), so there is no path-traversal risk here.
    for (const file of this.uploads.keys()) fs.rm(path.join(CONFIG.uploadDir, file), { force: true }, () => {});
    this.uploads.clear();
  }

  destroy() {
    clearTimeout(this.timer);
    for (const p of this.players.values()) clearTimeout(p.dropTimer);
    this.deleteUploads();
  }

  // ---------- what each player is allowed to see ----------

  private changed() {
    this.lastActivity = Date.now();
    this.onChange();
  }

  stateFor(playerId: string): RoomState {
    const r = this.round;
    const inSubmission = this.phase === 'SUBMISSION';
    return {
      code: this.code,
      phase: this.phase,
      youId: playerId,
      hostId: this.hostId,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        connected: p.connected,
        score: p.score,
        isHost: p.id === this.hostId,
        submitted: inSubmission && !!r?.submissions.some((s) => s.playerId === p.id),
      })),
      settings: {
        roundOptions: CONFIG.roundOptions,
        defaultRounds: CONFIG.defaultRounds,
        minPlayers: CONFIG.minPlayers,
        maxPlayers: CONFIG.maxPlayers,
        maxUploadMb: CONFIG.maxUploadBytes / 1024 / 1024,
        submissionChoices: CONFIG.submissionChoices,
        votingChoices: CONFIG.votingChoices,
        maxPrompts: CONFIG.maxPrompts,
        maxPromptLength: CONFIG.maxPromptLength,
        promptWriteRange: CONFIG.promptWriteRange as unknown as [number, number],
        reactionEmojis: CONFIG.reactionEmojis,
      },
      timers: { submissionSeconds: this.submissionSeconds, votingSeconds: this.votingSeconds, promptWriteSeconds: this.promptWriteSeconds },
      totalRounds: this.totalRounds,
      roundNumber: this.roundNumber,
      promptText: r?.promptText ?? null,
      targetId: r?.targetId ?? null,
      writerId: r?.writerId ?? null,
      youAreWriter: r?.writerId === playerId,
      writeableByCount: r?.remainingWriters.length ?? 0,
      msLeft: this.paused ? this.remainingMs : this.phaseEndsAt ? Math.max(0, this.phaseEndsAt - Date.now()) : null,
      paused: this.paused,
      youAreTarget: r?.targetId === playerId,
      youSubmitted: !!r?.submissions.some((s) => s.playerId === playerId),
      youVoted: !!r?.votes.has(playerId),
      // Voting cards contain NO author ids. Authors are only revealed in `results`.
      cards:
        this.phase === 'VOTING' && r
          ? r.cards.map((c) => ({ id: c.id, mediaUrl: c.mediaUrl, mine: c.playerId === playerId, reactions: this.reactionsFor(c.id, playerId) }))
          : [],
      results: this.phase === 'RESULTS' && r ? r.results.map((res) => ({ ...res, reactions: this.reactionsFor(res.id, playerId) })) : [],
      // The fallback prompt list is only sent to the host, and only while in the lobby.
      prompts: this.phase === 'LOBBY' && playerId === this.hostId ? this.customPrompts : [],
      includeWild: this.includeWild,
      builtinCount: this.builtinPool().length,
    };
  }
}
