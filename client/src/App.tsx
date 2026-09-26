import { useEffect, useState } from 'react';
import type { RoomState } from '../../shared/types';
import { Game } from './Game';
import { Lobby } from './Lobby';
import { call, clearSession, loadSession, saveSession, socket } from './socket';

export default function App() {
  const [state, setState] = useState<RoomState | null>(null);
  const [online, setOnline] = useState(socket.connected);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    // The server pushes a fresh `state` after every change. The browser never decides the phase itself.
    const onState = (s: RoomState) => { setState(s); setNotice(''); };
    const onKicked = () => { clearSession(); setState(null); setNotice('The host removed you from the room.'); };
    const onConnect = async () => {
      setOnline(true);
      const session = loadSession();
      if (session) {
        const r = await call('resume', session); // rejoin after a refresh / dropped connection
        if (!r.ok) { clearSession(); setState(null); }
      }
      setReady(true);
    };
    const onDisconnect = () => setOnline(false);
    socket.on('state', onState);
    socket.on('kicked', onKicked);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    if (socket.connected) onConnect();
    return () => {
      socket.off('state', onState);
      socket.off('kicked', onKicked);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  return (
    <main>
      <h1 className="logo">Meme Roast</h1>
      {!online && ready && <p className="banner">Connection lost. Reconnecting…</p>}
      {!ready ? <p className="center">Connecting…</p> : !state ? <Home notice={notice} /> : state.phase === 'LOBBY' ? <Lobby s={state} /> : <Game s={state} />}
    </main>
  );
}

function Home({ notice }: { notice: string }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function go(event: 'create' | 'join') {
    setBusy(true);
    setError('');
    const r = await call<{ code: string; token: string }>(event, event === 'create' ? { name } : { name, code });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    saveSession({ code: r.code, token: r.token });
  }

  return (
    <div className="home">
      {notice && <p className="banner">{notice}</p>}
      <div className="card pink">
        <h2>Your name</h2>
        <input value={name} maxLength={20} placeholder="Daniel" onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="card blue">
        <h2>Join a game</h2>
        <input value={code} maxLength={5} placeholder="Room code, e.g. K7X4P" className="code-input" onChange={(e) => setCode(e.target.value.toUpperCase())} />
        <button disabled={busy} onClick={() => go('join')}>Join game</button>
      </div>
      <div className="card mint">
        <h2>Host a game</h2>
        <p>Get a room code and send it to your friends.</p>
        <button disabled={busy} onClick={() => go('create')}>Create game</button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
