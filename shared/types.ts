// Types shared by the server and the browser client.
// The server sends a `RoomState` to every player after every change.

export type Phase = 'LOBBY' | 'PROMPT' | 'SUBMISSION' | 'VOTING' | 'RESULTS' | 'FINAL';

export interface PublicPlayer {
  id: string;
  name: string;
  connected: boolean;
  score: number;
  isHost: boolean;
  submitted: boolean; // only true during SUBMISSION, never says WHICH image is theirs
}

// Reaction emoji counts on a submission. `mine` is the caller's own reaction, if any.
export interface Reactions {
  counts: Record<string, number>;
  mine: string | null;
}

// During voting, cards carry NO author information.
export interface VoteCard {
  id: string;
  mediaUrl: string;
  mine: boolean; // true if you submitted it (so the UI can disable that button)
  reactions: Reactions;
}

// After voting, results reveal who made what.
export interface ResultCard {
  id: string;
  mediaUrl: string;
  authorId: string;
  authorName: string;
  votes: number;
  points: number;
  reactions: Reactions;
}

export interface RoomState {
  code: string;
  phase: Phase;
  youId: string;
  hostId: string;
  players: PublicPlayer[];
  settings: {
    roundOptions: number[]; defaultRounds: number; minPlayers: number; maxPlayers: number; maxUploadMb: number;
    submissionChoices: number[]; votingChoices: number[]; maxPrompts: number; maxPromptLength: number;
    promptWriteRange: [number, number]; reactionEmojis: string[];
  };
  timers: { submissionSeconds: number; votingSeconds: number; promptWriteSeconds: number };
  paused: boolean;
  prompts: string[]; // the host's own fallback prompts (host only, lobby only)
  includeWild: boolean;
  builtinCount: number;
  totalRounds: number;
  roundNumber: number;
  promptText: string | null;
  targetId: string | null;
  writerId: string | null; // who is writing the prompt this round
  youAreWriter: boolean;
  writeableByCount: number; // how many players could still be asked to write this round (0 = last chance)
  msLeft: number | null; // time left in this phase, measured by the server
  youAreTarget: boolean;
  youSubmitted: boolean;
  youVoted: boolean;
  cards: VoteCard[];
  results: ResultCard[];
}

export type Ack<T extends object = {}> = ({ ok: true } & T) | { ok: false; error: string };
