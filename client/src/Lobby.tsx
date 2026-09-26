import { useState } from 'react';
import type { RoomState } from '../../shared/types';
import { call } from './socket';
import { Avatar, kickPlayer } from './ui';

function Choices({ options, value, onChange, suffix = '' }: { options: number[]; value: number; onChange: (n: number) => void; suffix?: string }) {
  return (
    <div className="row-buttons wrap">
      {options.map((n) => (
        <button key={n} className={n === value ? 'on' : 'ghost'} onClick={() => onChange(n)}>{n}{suffix}</button>
      ))}
    </div>
  );
}

// A plain number box instead of preset buttons, for a range that's wide and free-form.
function SecondsInput({ value, onChange, range }: { value: number; onChange: (n: number) => void; range: [number, number] }) {
  return (
    <div className="seconds-input">
      <input
        type="number"
        min={range[0]}
        max={range[1]}
        value={value}
        onChange={(e) => {
          const n = Math.round(Number(e.target.value));
          if (Number.isFinite(n)) onChange(Math.max(range[0], Math.min(range[1], n)));
        }}
      />
      <span>seconds ({range[0]}–{range[1]})</span>
    </div>
  );
}

export function Lobby({ s }: { s: RoomState }) {
  const isHost = s.youId === s.hostId;
  const [rounds, setRounds] = useState(s.settings.defaultRounds);
  const [subSecs, setSubSecs] = useState(s.timers.submissionSeconds);
  const [voteSecs, setVoteSecs] = useState(s.timers.votingSeconds);
  const [writeSecs, setWriteSecs] = useState(s.timers.promptWriteSeconds);
  const [error, setError] = useState('');
  // Fallback prompts live here (not just in the editor) so "Start game" can save them automatically.
  const [custom, setCustom] = useState<string[]>(s.prompts);
  const [wild, setWild] = useState(s.includeWild);
  const here = s.players.filter((p) => p.connected).length;

  async function start() {
    setError('');
    const saved = await call('setPrompts', { prompts: custom, includeWild: wild });
    if (!saved.ok) return setError(saved.error);
    const r = await call('start', { rounds, submissionSeconds: subSecs, votingSeconds: voteSecs, promptWriteSeconds: writeSecs });
    if (!r.ok) setError(r.error);
  }

  return (
    <div className="lobby">
      <div className="card lemon">
        <small>Room code: tell your friends</small>
        <div className="room-code">{s.code}</div>
      </div>
      <div className="card">
        <h2>Players ({here}/{s.settings.maxPlayers})</h2>
        <div className="players">
          {s.players.map((p) => (
            <div key={p.id} className={'chip' + (p.connected ? '' : ' away')}>
              <Avatar p={p} />{p.name}{p.isHost && ' (host)'}{p.id === s.youId && ' (you)'}
              {isHost && p.id !== s.youId && <button className="ghost kick" onClick={() => kickPlayer(p)}>Kick</button>}
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <h2>How prompts work</h2>
        <p>
          Each round, one player is asked to write that round's prompt live, with a countdown. They can write it or press
          Skip to pass to someone else. Once everyone has been asked, a random fallback prompt is used instead.
        </p>
      </div>
      {isHost ? (
        <>
          <div className="card violet">
            <h2>Game settings</h2>
            <p className="field-label">Rounds</p>
            <Choices options={s.settings.roundOptions} value={rounds} onChange={setRounds} />
            <p className="field-label">Time to write a prompt</p>
            <SecondsInput value={writeSecs} onChange={setWriteSecs} range={s.settings.promptWriteRange} />
            <p className="field-label">Time to submit</p>
            <Choices options={s.settings.submissionChoices} value={subSecs} onChange={setSubSecs} suffix="s" />
            <p className="field-label">Time to vote</p>
            <Choices options={s.settings.votingChoices} value={voteSecs} onChange={setVoteSecs} suffix="s" />
          </div>
          <PromptEditor s={s} custom={custom} setCustom={setCustom} wild={wild} setWild={setWild} />
          <button disabled={here < s.settings.minPlayers} onClick={start}>Start game</button>
          {here < s.settings.minPlayers && <p className="center">Waiting for at least {s.settings.minPlayers} players.</p>}
          {error && <p className="error">{error}</p>}
        </>
      ) : (
        <p className="center">Waiting for the host to start the game…</p>
      )}
    </div>
  );
}

/** Host-only editor for the fallback prompts. "Start game" saves these automatically. */
function PromptEditor(p: {
  s: RoomState;
  custom: string[]; setCustom: (l: string[]) => void;
  wild: boolean; setWild: (w: boolean) => void;
}) {
  const { s, custom } = p;
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const count = custom.filter((t) => t.trim()).length;
  const change = (next: string[]) => { p.setCustom(next); setMsg(null); };

  async function save() {
    const r = await call('setPrompts', { prompts: custom, includeWild: p.wild });
    setMsg(r.ok ? { ok: true, text: 'Fallback prompts saved.' } : { ok: false, text: r.error });
  }

  return (
    <details className="card">
      <summary>Fallback prompts ({count} of yours, {s.builtinCount} built-in)</summary>
      <p>
        These are only used when nobody writes a prompt in time. Write @PLAYER where the roasted player's name goes, for
        example: <i>@PLAYER at 4 AM</i>. You can also use @random for a different random player.
      </p>
      <label className="check">
        <input type="checkbox" checked={p.wild} onChange={(e) => { p.setWild(e.target.checked); setMsg(null); }} />
        Include the wild built-in prompts
      </label>
      {custom.map((text, i) => (
        <div key={i} className="prompt-row">
          <input
            value={text}
            maxLength={s.settings.maxPromptLength}
            placeholder="@PLAYER when ..."
            aria-label={`Prompt ${i + 1}`}
            onChange={(e) => change(custom.map((t, j) => (j === i ? e.target.value : t)))}
          />
          <button className="ghost small" onClick={() => change(custom.filter((_, j) => j !== i))}>Delete</button>
        </div>
      ))}
      <button className="ghost" disabled={custom.length >= s.settings.maxPrompts} onClick={() => change([...custom, ''])}>Add prompt</button>
      <button onClick={save}>Save prompts</button>
      {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.text}</p>}
    </details>
  );
}
