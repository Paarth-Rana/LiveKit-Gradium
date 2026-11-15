import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { AccessToken } from 'livekit-server-sdk';
import { AudioFrame, AudioSource, LocalAudioTrack, Room, TrackPublishOptions } from '@livekit/rtc-node';

const env = process.env;
for (const key of ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'GRADIUM_API_KEY']) {
  if (!env[key]) throw new Error(`Set ${key} in .env`);
}

const sessions = new Map();
const activeRooms = new Set();
const roomPattern = /^[a-zA-Z0-9_-]{1,64}$/;
const sampleRate = 24000;
const frameBytes = sampleRate / 50 * 2;
const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'] };

async function token(room, name, canSubscribe = true) {
  const access = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity: randomUUID(), name, ttl: '10m',
  });
  access.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe });
  return access.toJwt();
}

async function speak(roomName, name, text) {
  const room = new Room();
  let track;
  try {
    await room.connect(env.LIVEKIT_URL, await token(roomName, `${name} · Synthetic voice`, false), { autoSubscribe: false });
    const source = new AudioSource(sampleRate, 1, 200);
    track = LocalAudioTrack.createAudioTrack('synthesized-speech', source);
    const publication = await room.localParticipant.publishTrack(track, new TrackPublishOptions());
    const subscriptionTimeout = new AbortController();
    try {
      await Promise.race([
        publication.waitForSubscription(),
        delay(8000, undefined, { signal: subscriptionTimeout.signal }).then(() => {
          throw new Error('No caller subscribed to the speech track.');
        }),
      ]);
    } finally {
      subscriptionTimeout.abort();
    }

    const response = await fetch('https://api.gradium.ai/api/speech/tts', {
      method: 'POST',
      headers: { 'x-api-key': env.GRADIUM_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        text,
        voice_id: env.GRADIUM_VOICE_ID || 'Bla6SbVMczYnOhfK',
        output_format: 'pcm_24000',
        only_audio: true,
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Gradium returned HTTP ${response.status}. Check your API key, voice ID, and account credits.`);
    }
    const audioType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (audioType !== 'audio/pcm' && audioType !== 'application/octet-stream') {
      await response.body?.cancel();
      throw new Error('Gradium returned an unexpected audio format.');
    }

    async function publish(pcm) {
      const samples = new Int16Array(frameBytes / 2);
      for (let byte = 0; byte < pcm.length; byte += 2) samples[byte / 2] = pcm.readInt16LE(byte);
      await source.captureFrame(new AudioFrame(samples, sampleRate, 1, samples.length));
    }

    let pending = Buffer.alloc(0);
    let received = false;
    for await (const chunk of response.body) {
      received ||= chunk.length > 0;
      const pcm = Buffer.concat([pending, chunk]);
      let offset = 0;
      for (; offset + frameBytes <= pcm.length; offset += frameBytes) {
        await publish(pcm.subarray(offset, offset + frameBytes));
      }
      pending = pcm.subarray(offset);
    }
    if (!received || pending.length % 2) throw new Error('Gradium returned invalid PCM audio.');
    if (pending.length) await publish(pending);
    await source.waitForPlayout();
    // Allow the final packets to reach the remote jitter buffer before unpublishing.
    await delay(500);
  } finally {
    try {
      await room.disconnect();
    } finally {
      await track?.close();
    }
  }
}

function json(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 4096) throw new Error('Request too large.');
  }
  return JSON.parse(body);
}

const port = Number(env.PORT || 3000);
const allowedOrigins = new Set([
  `http://localhost:${port}`,
  `http://127.0.0.1:${port}`,
]);
if (env.SILENTOS_HTTPS_ORIGIN) {
  const shared = new URL(env.SILENTOS_HTTPS_ORIGIN);
  if (shared.protocol !== 'https:' || shared.href !== shared.origin + '/') {
    throw new Error('Set SILENTOS_HTTPS_ORIGIN to the HTTPS address without a path.');
  }
  allowedOrigins.add(shared.origin);
}
createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (req.method === 'GET' && Object.hasOwn(files, path)) {
      const [file, type] = files[path];
      const data = await readFile(new URL(`./public/${file}`, import.meta.url));
      res.writeHead(200, { 'content-type': type });
      return res.end(data);
    }
    if (req.method !== 'POST' || !['/join', '/speak', '/leave'].includes(path)) {
      return json(res, 404, { error: 'Not found.' });
    }
    if (req.headers['content-type'] !== 'application/json' ||
        !allowedOrigins.has(req.headers.origin)) {
      return json(res, 403, { error: 'Use the local call page.' });
    }
    const body = await readJson(req).catch(() => null);
    if (!body) return json(res, 400, { error: 'Invalid request.' });

    for (const [id, session] of sessions) {
      if (session.expires <= Date.now()) sessions.delete(id);
    }
    if (path === '/join') {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name || name.length > 40 || typeof body.room !== 'string' || !roomPattern.test(body.room)) {
        return json(res, 400, { error: 'Enter a name and a room using letters, numbers, dashes or underscores.' });
      }
      const jwt = await token(body.room, name);
      const session = randomUUID();
      sessions.set(session, { room: body.room, name, expires: Date.now() + 3600000 });
      return json(res, 200, { url: env.LIVEKIT_URL, token: jwt, session });
    }
    const session = sessions.get(body.session);
    if (!session) return json(res, 401, { error: 'Rejoin the room to continue.' });
    if (path === '/leave') {
      sessions.delete(body.session);
      return json(res, 200, {});
    }
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text || text.length > 500) return json(res, 400, { error: 'Enter 1–500 characters.' });
    if (activeRooms.has(session.room)) return json(res, 409, { error: 'Someone is already speaking. Try again shortly.' });
    activeRooms.add(session.room);
    try {
      await speak(session.room, session.name, text);
      return json(res, 200, {});
    } finally {
      activeRooms.delete(session.room);
    }
  } catch (error) {
    console.error(error);
    const message = error.message.startsWith('Gradium returned') ? error.message : 'Request failed. See the local server log.';
    json(res, 502, { error: message });
  }
}).listen(port, '127.0.0.1', () => console.log(`Open http://localhost:${port}`));
