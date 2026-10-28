'use strict';
const fs = require('node:fs');
const path = require('node:path');
const QRCode = require('qrcode');
const jsQR = require('jsqr');
const { PNG } = require('pngjs');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const rawUrl = process.argv[2] || process.env.PUBLIC_SITE_URL || '';
if (!rawUrl) {
  console.error('Χρήση: npm run qr -- https://your-site.vercel.app');
  process.exit(1);
}
let url;
try {
  url = new URL(rawUrl);
} catch {
  console.error('Μη έγκυρη διεύθυνση URL.');
  process.exit(1);
}
if (url.protocol !== 'https:' || /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/i.test(url.hostname)) {
  console.error('Το QR χρειάζεται δημόσια διεύθυνση HTTPS (όχι localhost).');
  process.exit(1);
}
const target = url.toString();
const outDir = process.env.QR_OUTPUT_DIR || path.join(ROOT, 'public', 'qr');
fs.mkdirSync(outDir, { recursive: true });
const pngPath = path.join(outDir, 'pes-to-qr.png');
const svgPath = path.join(outDir, 'pes-to-qr.svg');
const options = {
  errorCorrectionLevel: 'H',
  margin: 2,
  width: 1024,
  color: { dark: '#11386b', light: '#ffffff' }
};

function decodePng(buffer) {
  const png = PNG.sync.read(buffer);
  return jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
}

async function decodeSvg(buffer) {
  const image = await sharp(buffer, { density: 300 }).resize(1024, 1024).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return jsQR(new Uint8ClampedArray(image.data), image.info.width, image.info.height);
}

async function main() {
  await QRCode.toFile(pngPath, target, { ...options, type: 'png' });
  await QRCode.toFile(svgPath, target, { ...options, type: 'svg' });

  const pngCode = decodePng(fs.readFileSync(pngPath));
  const svgCode = await decodeSvg(fs.readFileSync(svgPath));
  if (!pngCode || pngCode.data !== target) throw new Error('Το PNG δεν επαληθεύτηκε.');
  if (!svgCode || svgCode.data !== target) throw new Error('Το SVG δεν επαληθεύτηκε.');

  console.log('Το QR δημιουργήθηκε και επαληθεύτηκε για: ' + target);
  console.log('  ' + pngPath);
  console.log('  ' + svgPath);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
