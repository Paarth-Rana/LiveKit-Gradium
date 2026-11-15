import { Room, RoomEvent } from 'livekit-client';

const byId = id => document.getElementById(id);
const joinForm = byId('join-form');
const speakForm = byId('speak-form');
const media = byId('media');
const status = message => { byId('status').textContent = message; };
let current;

async function post(path, data) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}

function attach(track, name) {
  if (track.kind === 'audio') {
    track.setVolume(current?.audioEnabled ? 1 : 0);
    media.append(track.attach(document.createElement('audio')));
    return;
  }
  const player = track.attach();
  const tile = document.createElement('figure');
  const label = document.createElement('figcaption');
  label.textContent = name;
  tile.append(player, label);
  media.append(tile);
}

function detach(track) {
  for (const element of track.detach()) {
    (element.closest('figure') || element).remove();
  }
}

function updateAudioControl(enabled) {
  const button = byId('audio');
  button.textContent = enabled ? 'Call audio on' : 'Call audio off';
  button.setAttribute('aria-pressed', String(enabled));
  for (const participant of current.room.remoteParticipants.values()) {
    for (const publication of participant.audioTrackPublications.values()) {
      publication.track?.setVolume(enabled ? 1 : 0);
    }
  }
}

function updateControls(room) {
  const { isCameraEnabled, isMicrophoneEnabled } = room.localParticipant;
  byId('camera').textContent = isCameraEnabled ? 'Camera on' : 'Camera off';
  byId('mic').textContent = isMicrophoneEnabled ? 'Mic on' : 'Mic muted';
  byId('camera').setAttribute('aria-pressed', isCameraEnabled);
  byId('mic').setAttribute('aria-pressed', isMicrophoneEnabled);
}

joinForm.addEventListener('submit', async event => {
  event.preventDefault();
  const submit = joinForm.querySelector('button');
  submit.disabled = true;
  const input = Object.fromEntries(new FormData(joinForm));
  const room = new Room({ webAudioMix: true });
  room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => attach(track, participant.name));
  room.on(RoomEvent.TrackUnsubscribed, detach);
  room.on(RoomEvent.LocalTrackPublished, publication => {
    if (publication.track?.kind === 'video') attach(publication.track, 'You');
  });
  room.on(RoomEvent.LocalTrackUnpublished, publication => {
    if (publication.track) detach(publication.track);
  });
  room.on(RoomEvent.Disconnected, () => {
    if (current?.room !== room) return;
    const { session } = current;
    current = undefined;
    void post('/leave', { session }).catch(() => {});
    media.replaceChildren();
    byId('call').hidden = true;
    joinForm.hidden = false;
    status('Left the call.');
  });

  let credentials;
  try {
    status('Joining room…');
    credentials = await post('/join', input);
    await room.connect(credentials.url, credentials.token);
    current = { room, session: credentials.session, audioEnabled: false };
    updateAudioControl(false);
    byId('room-title').textContent = input.room;
    joinForm.hidden = true;
    byId('call').hidden = false;
    updateControls(room);
    status('Connected. Your microphone is muted.');
  } catch (error) {
    if (credentials) void post('/leave', { session: credentials.session }).catch(() => {});
    await room.disconnect();
    status(error.message);
  } finally {
    submit.disabled = false;
  }
});

byId('audio').onclick = async () => {
  const call = current;
  if (!call) return;
  const button = byId('audio');
  call.audioEnabled = !call.audioEnabled;
  updateAudioControl(call.audioEnabled);
  if (!call.audioEnabled) return;
  button.disabled = true;
  try {
    await call.room.startAudio();
  } catch (error) {
    if (current !== call || !call.audioEnabled) return;
    call.audioEnabled = false;
    updateAudioControl(false);
    status('Browser blocked call audio. Click Call audio off to try again.');
  } finally {
    button.disabled = false;
  }
};
byId('leave').onclick = () => current.room.disconnect().catch(error => status(error.message));

for (const [id, property, setter] of [
  ['camera', 'isCameraEnabled', 'setCameraEnabled'],
  ['mic', 'isMicrophoneEnabled', 'setMicrophoneEnabled'],
]) {
  byId(id).onclick = async () => {
    const { room } = current;
    const button = byId(id);
    button.disabled = true;
    try {
      const participant = room.localParticipant;
      await participant[setter](!participant[property]);
    } catch (error) {
      if (current?.room === room) status(error.message);
    } finally {
      if (current?.room === room) updateControls(room);
      button.disabled = false;
    }
  };
}

speakForm.addEventListener('submit', async event => {
  event.preventDefault();
  const call = current;
  const submit = speakForm.querySelector('button');
  submit.disabled = true;
  status('Sending speech to the call…');
  try {
    await post('/speak', { session: call.session, text: speakForm.elements.text.value });
    if (current === call) status('Speech sent.');
  } catch (error) {
    if (current === call) status(error.message);
  } finally {
    submit.disabled = false;
  }
});
