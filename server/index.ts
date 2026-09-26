import 'dotenv/config'; // must stay first: loads .env before config is read
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import express from 'express';
import multer from 'multer';
import { Server, type Socket } from 'socket.io';
import { CONFIG } from './config';
import { GameError } from './errors';
import type { Room } from './game';
import { sniffImageType } from './media';
import { RoomManager } from './rooms';

const rooms = new RoomManager();
const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 100_000 });

// Rooms live in memory, so files left from a previous run belong to no room: clear them.
fs.mkdirSync(CONFIG.uploadDir, { recursive: true });
for (const f of fs.readdirSync(CONFIG.uploadDir)) if (f !== '.gitkeep') fs.rmSync(path.join(CONFIG.uploadDir, f), { force: true });

// ---------- helpers ----------

type Payload = Record<string, unknown> | undefined;

/** Runs a handler and sends the result back to the browser. Players only ever see GameError messages. */
function run(ack: unknown, fn: () => object | void) {
  const reply = typeof ack === 'function' ? (ack as (r: object) => void) : () => {};
  try {
    reply({ ok: true, ...(fn() ?? {}) });
  } catch (err) {
    if (err instanceof GameError) return reply({ ok: false, error: err.message });
    console.error(err); // stack traces stay in the server log
    reply({ ok: false, error: 'Something went wrong. Please try again.' });
  }
}

function broadcast(room: Room) {
  for (const c of room.connections()) io.to(c.socketId).emit('state', room.stateFor(c.playerId));
}

// ---------- realtime game ----------

io.on('connection', (socket: Socket) => {
  let room: Room | undefined;
  let playerId = '';

  const leave = () => room?.detach(playerId, socket.id);
  const enter = (r: Room, id: string) => {
    if (room !== r || playerId !== id) leave();
    room = r;
    playerId = id;
    r.attach(id, socket.id);
  };
  // The server decides who this socket is. Browsers can never claim to be someone else.
  const me = () => {
    if (!room || !playerId) throw new GameError('You are not in a room.');
    return { room, id: playerId };
  };

  socket.on('create', (data: Payload, ack) =>
    run(ack, () => {
      const c = rooms.create(data?.name);
      c.room.onChange = () => broadcast(c.room);
      enter(c.room, c.playerId);
      return { code: c.room.code, playerId: c.playerId, token: c.token };
    }),
  );

  socket.on('join', (data: Payload, ack) =>
    run(ack, () => {
      const r = rooms.get(data?.code);
      const p = r.addPlayer(data?.name);
      enter(r, p.id);
      return { code: r.code, playerId: p.id, token: p.token };
    }),
  );

  // Used after a page refresh or a dropped connection.
  socket.on('resume', (data: Payload, ack) =>
    run(ack, () => {
      const r = rooms.get(data?.code);
      const p = r.findByToken(data?.token);
      if (!p) throw new GameError('Your session has expired. Please join again.');
      enter(r, p.id);
    }),
  );

  socket.on('start', (data: Payload, ack) =>
    run(ack, () => {
      const m = me();
      m.room.start(m.id, data?.rounds, {
        submissionSeconds: data?.submissionSeconds,
        votingSeconds: data?.votingSeconds,
        promptWriteSeconds: data?.promptWriteSeconds,
      });
    }),
  );
  socket.on('writePrompt', (data: Payload, ack) => run(ack, () => { const m = me(); m.room.writePrompt(m.id, data?.text); }));
  socket.on('declineWrite', (_d: Payload, ack) => run(ack, () => { const m = me(); m.room.declineToWrite(m.id); }));
  socket.on('setPrompts', (data: Payload, ack) => run(ack, () => { const m = me(); m.room.setPrompts(m.id, data?.prompts, { includeWild: data?.includeWild }); }));
  socket.on('react', (data: Payload, ack) => run(ack, () => { const m = me(); m.room.react(m.id, data?.cardId, data?.emoji); }));
  socket.on('pause', (_d: Payload, ack) => run(ack, () => { const m = me(); m.room.togglePause(m.id); }));
  socket.on('endGame', (_d: Payload, ack) => run(ack, () => { const m = me(); m.room.endGame(m.id); }));
  socket.on('restart', (_d: Payload, ack) => run(ack, () => { const m = me(); m.room.restart(m.id); }));
  socket.on('kick', (data: Payload, ack) =>
    run(ack, () => {
      const m = me();
      const kickedSocket = m.room.kick(m.id, data?.playerId); // the Room checks that the caller is the host
      if (kickedSocket) io.to(kickedSocket).emit('kicked');
    }),
  );
  socket.on('submit', (data: Payload, ack) => run(ack, () => { const m = me(); m.room.submit(m.id, data?.media); }));
  socket.on('vote', (data: Payload, ack) => run(ack, () => { const m = me(); m.room.vote(m.id, data?.cardId); }));
  socket.on('skip', (_d: Payload, ack) => run(ack, () => { const m = me(); m.room.skip(m.id); }));
  socket.on('playAgain', (_d: Payload, ack) => run(ack, () => { const m = me(); m.room.playAgain(m.id); }));

  socket.on('disconnect', leave);
});

// ---------- image upload ----------

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: CONFIG.maxUploadBytes, files: 1 } });
const MB = CONFIG.maxUploadBytes / 1024 / 1024;

app.post('/api/upload', (req, res) => {
  let room: Room;
  let player;
  try {
    room = rooms.get(req.header('x-room-code'));
    player = room.findByToken(req.header('x-player-token'));
    if (!player) throw new GameError('Your session has expired. Please join again.');
    if (room.uploadCount(player.id) >= CONFIG.maxUploadsPerPlayer) throw new GameError('You uploaded too many images this game.');
  } catch (err) {
    return res.status(err instanceof GameError ? 400 : 500).json({ error: err instanceof GameError ? err.message : 'Something went wrong.' });
  }
  const playerId = player.id;

  upload.single('file')(req, res, (err) => {
    if (err) {
      const tooBig = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE';
      return res.status(tooBig ? 413 : 400).json({ error: tooBig ? `That image is too large. Maximum size is ${MB} MB.` : 'The upload failed. Please try again.' });
    }
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'Please choose an image or GIF first.' });

    // Three checks: filename extension, MIME type the browser claims, and the file's real first bytes.
    const ext = path.extname(file.originalname).toLowerCase();
    const real = sniffImageType(file.buffer);
    if (!real || !CONFIG.allowedExtensions.includes(ext) || !CONFIG.allowedMimeTypes.includes(file.mimetype)) {
      return res.status(415).json({ error: 'Only JPG, PNG, WebP and GIF images are allowed.' });
    }

    // Random name + extension chosen by US (from the real file type), never from the upload.
    const name = `${randomBytes(16).toString('hex')}.${real.ext}`;
    fs.writeFile(path.join(CONFIG.uploadDir, name), file.buffer, (writeErr) => {
      if (writeErr) {
        console.error(writeErr);
        return res.status(500).json({ error: 'Could not save that image. Please try again.' });
      }
      room.registerUpload(playerId, name);
      res.json({ url: `/uploads/${name}` });
    });
  });
});

// Uploaded files are served as plain images; `nosniff` stops browsers from guessing another type.
app.use('/uploads', express.static(CONFIG.uploadDir, { index: false, dotfiles: 'deny', setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff') }));

// ---------- the website itself (after `npm run build`) ----------

const clientDist = path.resolve(process.cwd(), 'client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.use((_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
} else {
  app.get('/', (_req, res) => res.type('text').send('The website is not built yet.\nFor development open http://localhost:5173 (npm run dev).\nFor production run: npm run build'));
}

setInterval(() => rooms.sweep(), 60_000).unref();

server.listen(CONFIG.port, () => console.log(`Meme Roast is running on http://localhost:${CONFIG.port}`));
