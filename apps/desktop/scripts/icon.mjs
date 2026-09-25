import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { root } from './bundle.mjs';

// Hearth mark: an ember under two warm arcs on an ink tile, inside the macOS icon grid (824 of 1024).
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <radialGradient id="ink" cx="50%" cy="38%" r="75%">
      <stop offset="0" stop-color="#34271d"/>
      <stop offset="1" stop-color="#110d0a"/>
    </radialGradient>
    <radialGradient id="ember" cx="46%" cy="40%" r="62%">
      <stop offset="0" stop-color="#ffd08a"/>
      <stop offset="0.45" stop-color="#f5921a"/>
      <stop offset="1" stop-color="#b85a06"/>
    </radialGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#f5921a" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#f5921a" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect x="100" y="100" width="824" height="824" rx="186" fill="url(#ink)"/>
  <rect x="101.5" y="101.5" width="821" height="821" rx="184.5" fill="none" stroke="#f0e5d2" stroke-opacity="0.08" stroke-width="3"/>
  <circle cx="512" cy="600" r="250" fill="url(#glow)"/>
  <path d="M 262 600 A 250 250 0 0 1 762 600" fill="none" stroke="#f0e5d2" stroke-opacity="0.9" stroke-width="40" stroke-linecap="round"/>
  <path d="M 342 600 A 170 170 0 0 1 682 600" fill="none" stroke="#f0e5d2" stroke-opacity="0.55" stroke-width="34" stroke-linecap="round"/>
  <circle cx="512" cy="600" r="92" fill="url(#ember)"/>
  <rect x="232" y="720" width="560" height="34" rx="17" fill="#f0e5d2" fill-opacity="0.9"/>
</svg>`;

const out = join(root, 'build');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'icon.svg'), svg);
await sharp(Buffer.from(svg)).png().toFile(join(out, 'icon.png'));
console.log('Wrote build/icon.png');
