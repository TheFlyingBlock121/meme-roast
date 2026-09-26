import { useEffect, useMemo, useState } from 'react';
import type { PublicPlayer, RoomState } from '../../shared/types';
import { act, call, loadSession, uploadFile } from './socket';
import { Avatar, Media, Prompt, ReactionBar, Scoreboard, Timer } from './ui';

export function Game({ s }: { s: RoomState }) {
  const isHost = s.youId === s.hostId;
  return (
    <>
      {s.paused && <p className="banner">Paused by the host</p>}
      {s.phase === 'PROMPT' && <PromptWriting s={s} isHost={isHost} />}
      {s.phase === 'SUBMISSION' && <Submission s={s} />}
      {s.phase === 'VOTING' && <Voting s={s} />}
      {s.phase === 'RESULTS' && <Results s={s} isHost={isHost} />}
      {s.phase === 'FINAL' && <Final s={s} isHost={isHost} />}
      {s.phase !== 'FINAL' && (
        <div className="side">
          <h3>Scores</h3>
          <Scoreboard s={s} canKick={isHost} />
          {isHost && <HostControls s={s} />}
        </div>
      )}
    </>
  );
}

// Discord-style @mention autocomplete: typing "@" plus a few letters suggests matching real
// player names; picking one inserts their actual name into the text.
function MentionSuggestions({ text, players, onPick }: { text: string; players: PublicPlayer[]; onPick: (newText: string) => void }) {
  const m = /@([^@]{0,20})$/.exec(text); // everything after the last "@" up to the end of the text
  if (!m) return null;
  const query = m[1].toLowerCase();
  const matches = players.filter((p) => p.name.toLowerCase().startsWith(query)).slice(0, 6);
  if (matches.length === 0) return null;
  const atIndex = m.index;
  return (
    <div className="row-buttons wrap autofill">
      {matches.map((p) => (
        <button key={p.id} className="ghost small" onClick={() => onPick(text.slice(0, atIndex) + '@' + p.name + ' ')}>@{p.name}</button>
      ))}
    </div>
  );
}

function PromptWriting({ s, isHost }: { s: RoomState; isHost: boolean }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const writer = s.players.find((p) => p.id === s.writerId);
  const target = s.players.find((p) => p.id === s.targetId);

  async function send() {
    setBusy(true);
    setError('');
    const r = await call('writePrompt', { text });
    setBusy(false);
    if (!r.ok) setError(r.error);
  }

  async function decline() {
    setBusy(true);
    setError('');
    const r = await call('declineWrite');
    setBusy(false);
    if (!r.ok) setError(r.error);
  }

  return (
    <div>
      <Timer s={s} label="Time to write" />
      {s.youAreWriter ? (
        <div className="card blue">
          <h2>Write this round's prompt</h2>
          <p>
            Roasting <b>{target?.name}</b>. Write anything you like — type "@" to mention a player by name.
          </p>
          <input
            value={text}
            maxLength={s.settings.maxPromptLength}
            placeholder={`${target?.name ?? 'Someone'} at 4 AM`}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && text.trim() && send()}
          />
          <MentionSuggestions text={text} players={s.players} onPick={setText} />
          <button disabled={busy || s.paused || !text.trim()} onClick={send}>{busy ? 'Sending…' : 'Send prompt'}</button>
          <button className="ghost" disabled={busy || s.paused} onClick={decline}>Skip — let someone else write it</button>
          {error && <p className="error">{error}</p>}
        </div>
      ) : (
        <div className="card center">
          <h2>{writer?.name ?? 'Someone'} is writing this round's prompt…</h2>
          <p>Get ready to roast <b>{target?.name}</b>.</p>
          {s.writeableByCount === 0 && <p><small>Last chance — if they skip, a random prompt will be used.</small></p>}
          {isHost && <button className="ghost small" onClick={() => act('skip')}>Skip ahead</button>}
        </div>
      )}
    </div>
  );
}

function Submission({ s }: { s: RoomState }) {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!file) return setPreview(/^https?:\/\//i.test(url.trim()) ? url.trim() : '');
    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file, url]);

  async function submit() {
    setBusy(true);
    setError('');
    try {
      let media = url;
      if (file) {
        const session = loadSession();
        if (!session) throw new Error('Your session has expired. Please join again.');
        media = await uploadFile(file, session);
      }
      const r = await call('submit', { media });
      if (!r.ok) return setError(r.error);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    }
    setBusy(false);
  }

  const waiting = s.players;

  return (
    <div>
      <Prompt s={s} />
      <Timer s={s} label="Time left" />
      {s.youAreTarget && <p className="center"><small>You're the one being roasted this round — but you can still submit too, if you dare.</small></p>}
      {s.youSubmitted && !editing ? (
        <div className="card mint center">
          <h2>Submitted</h2>
          <p>Waiting for the others…</p>
          <button className="ghost" disabled={s.paused} onClick={() => setEditing(true)}>Change your pick</button>
        </div>
      ) : (
        <div className="card blue">
          <h2>{s.youSubmitted ? 'Change your answer' : 'Your answer'}</h2>
          <label
            className={'drop' + (drag ? ' over' : '')}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) { setFile(f); setUrl(''); } }}
          >
            {preview ? <img src={preview} alt="Preview" /> : <span>Drop an image or GIF here<br />or click to upload</span>}
            <input type="file" hidden accept=".jpg,.jpeg,.png,.webp,.gif,image/jpeg,image/png,image/webp,image/gif" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFile(f); setUrl(''); } }} />
          </label>
          <p className="center">or paste an image/GIF link</p>
          <input value={url} placeholder="https://example.com/funny.gif" onChange={(e) => { setUrl(e.target.value); setFile(null); }} />
          <button disabled={busy || s.paused || (!file && !url.trim())} onClick={submit}>{busy ? 'Submitting…' : s.youSubmitted ? 'Change answer' : 'Submit'}</button>
          {s.youSubmitted && <button className="ghost" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>}
          {error && <p className="error">{error}</p>}
        </div>
      )}
      <div className="chips">
        {waiting.map((p) => <span key={p.id} className={'chip' + (p.submitted ? ' done' : '')}><Avatar p={p} />{p.name}{p.submitted ? ' ✓' : ' …'}</span>)}
      </div>
    </div>
  );
}

function Voting({ s }: { s: RoomState }) {
  const [error, setError] = useState('');
  async function vote(cardId: string) {
    const r = await call('vote', { cardId });
    if (!r.ok) setError(r.error);
  }
  return (
    <div>
      <Prompt s={s} />
      <Timer s={s} label="Vote time" />
      <p className="center">{s.youVoted ? 'Vote locked in! Waiting for the others…' : 'Vote for the funniest!'}</p>
      {error && <p className="error">{error}</p>}
      <div className="cards">
        {s.cards.map((c) => (
          <div key={c.id} className="card media-card">
            <Media src={c.mediaUrl} />
            <button disabled={s.youVoted || s.paused || c.mine} onClick={() => vote(c.id)}>{c.mine ? 'Your image' : 'Vote'}</button>
            <ReactionBar cardId={c.id} reactions={c.reactions} emojis={s.settings.reactionEmojis} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Results({ s, isHost }: { s: RoomState; isHost: boolean }) {
  // Kept visible between rounds, right alongside the winning image, not just in the sidebar.
  const standings = useMemo(() => [...s.players].sort((a, b) => b.score - a.score), [s.players]);
  return (
    <div>
      <Prompt s={s} />
      <Timer s={s} label="Next round in" />
      {s.results.length === 0 && <p className="center">Nobody submitted this round.</p>}
      <div className="cards">
        {s.results.map((r, i) => (
          <div key={r.id} className={'card media-card' + (i === 0 && r.votes > 0 ? ' winner' : '')}>
            <Media src={r.mediaUrl} />
            <p><b>{r.authorName}</b> — {r.votes} vote{r.votes === 1 ? '' : 's'}{r.points > 0 && <> · +{r.points} pts</>}</p>
            <ReactionBar cardId={r.id} reactions={r.reactions} emojis={s.settings.reactionEmojis} />
          </div>
        ))}
      </div>
      <div className="card standings">
        <h3>Standings after round {s.roundNumber}</h3>
        <div className="chips">
          {standings.map((p, i) => <span key={p.id} className="chip"><b>{i + 1}.</b> <Avatar p={p} />{p.name} — {p.score}</span>)}
        </div>
      </div>
      {isHost && <button onClick={() => call('skip')}>{s.roundNumber >= s.totalRounds ? 'Show final results' : 'Next round'}</button>}
    </div>
  );
}

function HostControls({ s }: { s: RoomState }) {
  const canPause = s.phase === 'PROMPT' || s.phase === 'SUBMISSION' || s.phase === 'VOTING' || s.phase === 'RESULTS';
  return (
    <div className="host-bar">
      <h3>Host controls</h3>
      <div className="row-buttons wrap">
        {canPause && <button className="ghost small" onClick={() => act('pause')}>{s.paused ? 'Resume' : 'Pause'}</button>}
        {s.phase !== 'RESULTS' && <button className="ghost small" onClick={() => act('skip')}>Skip ahead</button>}
        <button className="ghost small" onClick={() => confirm('Start over from round 1 with everyone at 0 points?') && act('restart')}>Restart</button>
        <button className="ghost small" onClick={() => confirm('End the game now and show the final results?') && act('endGame')}>End game</button>
      </div>
    </div>
  );
}

function Final({ s, isHost }: { s: RoomState; isHost: boolean }) {
  const sorted = [...s.players].sort((a, b) => b.score - a.score);
  const winners = sorted.filter((p) => p.score === sorted[0]?.score);
  const place = ['1st', '2nd', '3rd'];
  return (
    <div className="card lemon final">
      <h2>Final results</h2>
      <p className="center">{winners.map((p) => p.name).join(' & ')} {winners.length > 1 ? 'tie for the win!' : 'wins!'}</p>
      {sorted.map((p, i) => (
        <div key={p.id} className="row"><span>{place[i] ?? `${i + 1}th`}: {p.name}</span><b>{p.score} points</b></div>
      ))}
      {isHost ? (
        <>
          <button onClick={() => act('restart')}>Play again</button>
          <button className="ghost" onClick={() => act('playAgain')}>Return to lobby</button>
        </>
      ) : (
        <p className="center">Waiting for the host…</p>
      )}
    </div>
  );
}
