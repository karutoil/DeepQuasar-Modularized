export function formatDuration(ms) {
  if (isNaN(ms) || ms < 0) return "0:00";
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return minutes + ":" + (seconds < 10 ? '0' : '') + seconds;
}

export function generateProgressBar(current, total, size = 20) {
  if (isNaN(current) || isNaN(total) || total === 0) return `[${'-'.repeat(size)}]`;
  const percentage = Math.min(current / total, 1); // Ensure percentage doesn't exceed 100%
  const progress = Math.round(size * percentage);
  const empty = size - progress;
  return "[" + "=".repeat(progress) + "-".repeat(empty) + "]";
}
