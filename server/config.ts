// ALL game limits live here. Change a number, restart the server, done.
// A few can also be changed with environment variables (see .env.example).
import path from 'node:path';

const num = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const CONFIG = {
  port: num(process.env.PORT, 3000),

  minPlayers: num(process.env.MIN_PLAYERS, 2),
  maxPlayers: 12,

  roundOptions: [5, 10, 15, 20], // choices shown to the host
  defaultRounds: 10,
  maxRounds: 20,

  // Timer defaults and the limits the host can pick from in the lobby.
  submissionRange: [10, 120] as const,
  votingRange: [10, 60] as const,
  promptWriteRange: [10, 120] as const, // free-typed in the lobby, not preset buttons
  submissionChoices: [10, 15, 30, 60],
  votingChoices: [10, 20, 30, 45, 60],
  submissionSeconds: Math.min(30, Math.max(10, num(process.env.SUBMISSION_SECONDS, 30))),
  votingSeconds: Math.min(60, Math.max(10, num(process.env.VOTING_SECONDS, 30))),
  promptWriteSeconds: Math.min(120, Math.max(10, num(process.env.PROMPT_WRITE_SECONDS, 30))),

  maxPrompts: 100,
  maxPromptLength: 400,
  resultsSeconds: 10, // how long round results stay on screen before the next round
  finalCallMs: 5000, // once everyone's submitted, shrink the remaining time down to this instead of cutting it off

  // Emoji players can react with on a submission, during voting and results.
  reactionEmojis: ['😂', '💀', '🔥', '👀', '😭'],

  scoring: [3, 2, 1], // points for 1st, 2nd, 3rd place

  maxUploadBytes: 10 * 1024 * 1024, // 10 MB
  maxUploadsPerPlayer: 10,
  allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp', '.gif'],
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  maxUrlLength: 2000,
  maxNameLength: 20,

  reconnectGraceSeconds: 60, // lobby players who vanish are removed after this
  roomIdleMinutes: 60, // idle rooms (and their uploads) are deleted after this

  uploadDir: path.resolve(process.cwd(), 'uploads'),
};
