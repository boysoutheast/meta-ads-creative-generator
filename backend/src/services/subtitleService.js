/**
 * subtitleService.js
 *
 * Generate SRT subtitle file content from a storyboard's voScripts.
 * Each clip's VO occupies its full clipDuration time slot.
 */

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s},000`;
}

/**
 * Build SRT content from clips array.
 * @param {Array<{ voScript: string, clipDuration: number }>} clips
 * @returns {string} SRT-formatted subtitle text
 */
function generateSRT(clips) {
  let srt = '';
  let currentTime = 0;
  let counter = 1;

  for (const clip of clips) {
    const duration = Number(clip.clipDuration) || 10;
    const text = (clip.voScript || '').trim();

    if (!text) {
      currentTime += duration;
      continue;
    }

    const start = currentTime;
    const end = currentTime + duration;
    const startStr = formatTime(start);
    const endStr = formatTime(end);

    // Split long VO into 2 lines for readability (max 2 lines per cue)
    const words = text.split(/\s+/);
    let line1 = text;
    let line2 = '';
    if (words.length > 8) {
      const mid = Math.ceil(words.length / 2);
      line1 = words.slice(0, mid).join(' ');
      line2 = words.slice(mid).join(' ');
    }
    const cueText = line2 ? `${line1}\n${line2}` : line1;

    srt += `${counter}\n${startStr} --> ${endStr}\n${cueText}\n\n`;
    counter++;
    currentTime = end;
  }

  return srt || '1\n00:00:00,000 --> 00:00:01,000\n(no voiceover)\n\n';
}

module.exports = { generateSRT, formatTime };
