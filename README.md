# SilentOS LiveKit and Gradium demo

Join a video call, type a reply, and let Gradium speak it into the room through LiveKit. The microphone starts muted.

## Run locally

Use Node.js 22 or later. Copy the environment template and fill in your LiveKit project URL, key and secret, and Gradium API key. Set an optional Gradium voice ID to select a specific voice.

```sh
cp .env.example .env
npm ci
npm run build
npm start
```

Open http://localhost:3000 in two tabs and join the same room with different names. Turn **Call audio** on in the receiver tab. Leave the sender's microphone muted, type a message, and click **Speak**. The receiver should hear the generated speech.

For two devices, set `SILENTOS_HTTPS_ORIGIN` to the private HTTPS origin of a reverse proxy that forwards to the local server. Restart the app and open the shared address on both devices.
