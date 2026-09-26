import { useEffect, useState } from 'react';
import type { PublicPlayer, Reactions, RoomState } from '../../shared/types';
import { act } from './socket';

const COLORS = ['#d9899f', '#e6c973', '#7fc8b0', '#7f9bd6', '#a596d6', '#d9a07a'];

/** A small coloured circle with the player's first letter. */
export function Avatar({ p }: { p: PublicPlayer }) {
  let h = 0;
  for (const ch of p.id) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return <span className="avatar" style={{ background: COLORS[h % COLORS.length] }} aria-hidden="true">{p.name.charAt(0).toUpperCase()}</span>;
}

export function kickPlayer(p: PublicPlayer) {
  if (confirm(`Remove ${p.name} from the game?`)) act('kick', { playerId: p.id });
}

/** Shows an image/GIF, or a friendly box if it can't be loaded. */
export function Media({ src }: { src: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <div className="broken">This image couldn't be loaded</div>;
  return <img src={src} alt="A submitted image" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
}

/** Counts down using the time the SERVER says is left (so slow clocks can't cheat). */
export function useCountdown(s: RoomState): number | null {
  const [secs, setSecs] = useState<number | null>(null);
  useEffect(() => {
    if (s.msLeft === null) return setSecs(null);
    if (s.paused) return setSecs(Math.ceil(s.msLeft / 1000)); // frozen while paused
    const end = Date.now() + s.msLeft;
    const tick = () => setSecs(Math.max(0, Math.ceil((end - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [s]);
  return secs;
}

export function Timer({ s, label }: { s: RoomState; label: string }) {
  const secs = useCountdown(s);
  if (secs === null) return null;
  return <div className={'timer' + (secs <= 5 && !s.paused ? ' hurry' : '')}>{s.paused ? 'Paused' : label}: {secs}</div>;
}

export function Prompt({ s }: { s: RoomState }) {
  return (
    <div className="prompt">
      <small>Round {s.roundNumber} of {s.totalRounds}</small>
      <h2>{s.promptText}</h2>
    </div>
  );
}

export function Scoreboard({ s, canKick }: { s: RoomState; canKick?: boolean }) {
  const sorted = [...s.players].sort((a, b) => b.score - a.score);
  return (
    <div className="scoreboard">
      {sorted.map((p) => (
        <div key={p.id} className={'row' + (p.id === s.youId ? ' you' : '')}>
          <span><Avatar p={p} />{p.name}{!p.connected && ' (away)'}</span>
          <span>
            <b>{p.score}</b>
            {canKick && p.id !== s.youId && <button className="ghost kick" onClick={() => kickPlayer(p)}>Kick</button>}
          </span>
        </div>
      ))}
    </div>
  );
}

/** A row of emoji-reaction buttons under a submission card. Tap an emoji to react; tap it again to remove it. */
export function ReactionBar({ cardId, reactions, emojis }: { cardId: string; reactions: Reactions; emojis: string[] }) {
  return (
    <div className="reactions">
      {emojis.map((emoji) => {
        const count = reactions.counts[emoji] ?? 0;
        const mine = reactions.mine === emoji;
        return (
          <button key={emoji} className={'reaction' + (mine ? ' mine' : '')} onClick={() => act('react', { cardId, emoji })}>
            {emoji}{count > 0 && <span className="reaction-count">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}
