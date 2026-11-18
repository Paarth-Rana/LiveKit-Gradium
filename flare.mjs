// No agent execution here: review result.text before handing it downstream.
export const DEFAULT_URL = 'https://triple-card-ministers-outsourcing.trycloudflare.com';

async function request(baseUrl, path, options = {}) {
  const response = await fetch(baseUrl.replace(/\/$/, '') + path, {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(120000),
  });
  const body = await response.text();
  let result;
  try { result = JSON.parse(body); }
  catch { throw new Error(`FLARE returned non-JSON (HTTP ${response.status}). The tunnel may be unavailable.`); }
  if (!response.ok) throw new Error(`FLARE HTTP ${response.status}: ${JSON.stringify(result.detail ?? result)}`);
  return result;
}

export async function checkReady(baseUrl = DEFAULT_URL) {
  const result = await request(baseUrl, '/ready', { signal: AbortSignal.timeout(20000) });
  if (result.model_loaded !== true) throw new Error('FLARE model is not loaded.');
  return result;
}

export async function transcribeVideo(videoBlob, baseUrl = DEFAULT_URL) {
  if (!(videoBlob instanceof Blob) || videoBlob.size === 0) throw new Error('Provide a nonempty video Blob.');
  if (!/^video\/(webm|mp4)(;|$)/.test(videoBlob.type)) throw new Error('Use MP4 or WebM video.');
  const form = new FormData();
  form.append('video', videoBlob, videoBlob.type.includes('webm') ? 'recording.webm' : 'recording.mp4');
  const result = await request(baseUrl, '/transcribe', { method: 'POST', body: form });
  if (typeof result.text !== 'string' || !result.text.trim()) throw new Error('FLARE returned no usable transcript.');
  if (result.audio_used !== false) throw new Error('Server did not confirm visual-only inference.');
  return result;
}
