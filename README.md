# SilentOS

This standalone LiveKit demo streams typed text through Gradium into a room. The sender’s microphone starts muted. Camera and microphone controls are available for ordinary conversation.

## Run locally

Use Node.js 22 or newer. Create a LiveKit project and a Gradium API key with text-to-speech access. Set `GRADIUM_VOICE_ID` if you want a specific voice. Otherwise SilentOS uses the Gradium quickstart voice.

```sh
cp .env.example .env
# Fill in .env with your LiveKit URL, key and secret, and Gradium key.
npm install
npm run build
npm start
```

The server binds to localhost for a two-browser demo. LiveKit and Gradium must be reachable from the machine running the app. The browser receives a room-scoped token. Provider credentials stay in the local server’s environment.

## Test with two browser windows

1. Open http://localhost:3000 in two windows. Join the same room with different names.
2. Click **Call audio off** in the receiving window to turn playback on. Click **Call audio on** to mute playback again. Use headphones if you enable both microphones.
3. Leave the sender’s mic muted. Optionally enable their camera and check that the receiver sees it.
4. Type a sentence on the sender side and click **Speak**. The receiver should hear the sentence through the call.
5. Turn on the receiver’s mic to test talking back to the sender.

Double-check your room names and enable playback if audio is silent. An Gradium HTTP error calls for checking the key, voice ID and account quota. Restart the server after changing its environment.

## Integration points

- `public/client.js` manages the room and sends text to `POST /speak`. FLARE fills the editable message box after a camera clip is transcribed.
- `server.mjs` mints room tokens and streams Gradium signed 16-bit mono PCM at 24 kHz through a backend LiveKit audio track. It uses 20 ms frames and allows one speech stream at a time in each room.
- [LiveKit publishing example](https://github.com/livekit/node-sdks/blob/main/examples/publish-wav/index.ts)
- [Gradium REST TTS](https://docs.gradium.ai/guides/text-to-speech-rest)

## Transcribe a silent clip with FLARE

Set `FLARE_API_URL` in your local `.env` to the current base URL from the teammate hosting FLARE. Restart SilentOS, join the room, and turn on the camera. Click **Record silent clip**, mouth a short phrase, then click **Stop and transcribe**. Recording stops automatically after eight seconds. The clip contains only camera video and goes to the hosted FLARE service. Review or edit the transcript in the message box before clicking **Speak**.

## Hosted model availability

The GPU allocation and temporary FLARE tunnel used during development have expired. Set `FLARE_API_URL` to a reachable service exposing `GET /ready` and `POST /transcribe` with multipart field `video`. The service must return nonempty `text` and `audio_used: false`. This repository includes the client integration. Model weights and GPU hosting are managed by the FLARE service. Typed messages can still be sent through Gradium when FLARE is offline.

For a private HTTPS reverse proxy, set `SILENTOS_HTTPS_ORIGIN` to its HTTPS origin and restart. Open that address on both devices and join the same room.
