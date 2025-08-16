import { createCanvas, loadImage } from 'canvas';

export async function buildRankCard({ profile, userId, template, core }) {
  // Simple rank card: 600x180 with username, level, xp bar
  const width = 600; const height = 180;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#2b2d31';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#ffffff';
  ctx.font = '20px Sans';
  ctx.fillText(`User: ${userId}`, 20, 40);
  ctx.fillText(`Level: ${profile.level}`, 20, 70);
  const pct = profile.xp / (profile.xp + profile.nextLevelXP || 1);
  // progress bar
  ctx.fillStyle = '#444';
  ctx.fillRect(20, 100, 560, 30);
  ctx.fillStyle = '#00b4d8';
  ctx.fillRect(20, 100, Math.max(4, Math.floor(560 * Math.min(1, pct))), 30);
  return canvas.toBuffer('image/png');
}
