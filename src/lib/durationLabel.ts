/** "45分", "120分（2時間）", "395分（6時間35分）": minutes first, hours alongside once it is an hour or more. */
export function formatDurationLabel(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0分';
  const whole = Math.round(minutes);
  if (whole < 60) return `${whole}分`;
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${whole}分（${hours}時間${rest ? `${rest}分` : ''}）`;
}
