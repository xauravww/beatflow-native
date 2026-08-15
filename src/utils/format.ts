/** Format seconds as m:ss (or h:mm:ss for long tracks). */
export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) {
    return '0:00';
  }
  const secs = Math.floor(seconds % 60);
  const mins = Math.floor(seconds / 60) % 60;
  const hrs = Math.floor(seconds / 3600);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return hrs > 0 ? `${hrs}:${pad(mins)}:${pad(secs)}` : `${mins}:${pad(secs)}`;
}

/** "Good morning / afternoon / evening" greeting. */
export function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
