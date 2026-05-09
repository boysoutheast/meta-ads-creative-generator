/**
 * ttsService.js
 *
 * Text-to-speech via apimart's OpenAI-compatible /audio/speech endpoint.
 * Used to auto-dub voScripts onto generated video clips.
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../config');

const VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
const DEFAULT_VOICE = 'nova';

/**
 * Generate a single TTS mp3 file.
 * @param {string} text - VO script text
 * @param {string} voice - one of VOICES
 * @param {string} outputPath - absolute output mp3 path
 */
async function generateTTSAudio(text, voice = DEFAULT_VOICE, outputPath) {
  if (!text || !text.trim()) throw new Error('text is required');
  if (!VOICES.includes(voice)) voice = DEFAULT_VOICE;

  const baseUrl = (config.apimart.baseUrl || '').replace(/\/$/, '');

  const response = await axios.post(
    `${baseUrl}/audio/speech`,
    { model: 'tts-1', input: text.slice(0, 4000), voice, response_format: 'mp3' },
    {
      headers: {
        Authorization: `Bearer ${config.apimart.apiKey}`,
        'Content-Type': 'application/json',
      },
      responseType: 'arraybuffer',
      timeout: 60000,
    }
  );

  fs.writeFileSync(outputPath, Buffer.from(response.data));
  return outputPath;
}

/**
 * Generate TTS audio for every clip's voScript, returning array aligned to clips.
 * Returns nulls for clips without VO text.
 *
 * @param {Array<{ voScript?: string, technicalConfig?: { voScript?: string } }>} clips
 * @param {string} voice
 * @param {string} tempDir - directory to write audio files into
 * @returns {Promise<Array<string|null>>}
 */
async function generateClipAudios(clips, voice = DEFAULT_VOICE, tempDir) {
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const audioPaths = [];
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i] || {};
    const voText = (c.voScript || c.technicalConfig?.voScript || '').trim();
    if (!voText) {
      audioPaths.push(null);
      continue;
    }
    const outPath = path.join(tempDir, `tts_clip_${i}.mp3`);
    try {
      await generateTTSAudio(voText, voice, outPath);
      audioPaths.push(outPath);
    } catch (e) {
      console.warn(`[TTS] clip ${i} failed: ${e.message}`);
      audioPaths.push(null);
    }
  }
  return audioPaths;
}

module.exports = { generateTTSAudio, generateClipAudios, VOICES, DEFAULT_VOICE };
