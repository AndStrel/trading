import { renderCandidateCardPng } from './telegram/candidate-card.js';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350">
  <rect width="1080" height="1350" fill="#09111F"/>
  <text x="80" y="160" font-family="DejaVu Sans, sans-serif" font-size="64" fill="#F8FAFC">Проверка карточки</text>
</svg>`;

const png = await renderCandidateCardPng(svg);
const expectedSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

if (
  png.byteLength < expectedSignature.length ||
  !expectedSignature.every((byte, index) => png[index] === byte)
) {
  throw new Error('Candidate card renderer did not produce a valid PNG');
}

process.stdout.write(`Candidate card render smoke passed: ${png.byteLength} bytes\n`);
