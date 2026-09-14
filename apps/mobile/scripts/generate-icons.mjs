/**
 * Generate Socrates icon assets — Σ (sigma) on #0d1117 background.
 *
 * Uses sharp (already available in node_modules) to render an SVG sigma
 * symbol at the required sizes for all icon slots in app.json.
 *
 * Run: node scripts/generate-icons.mjs
 * (from apps/mobile/)
 */
import sharp from "sharp";
import fs from "fs";
import path from "path";

const OUT = "assets/images";

// The sigma symbol as an SVG path — a clean, geometric capital Sigma.
// Designed as a single continuous path: top bar, diagonal, bottom bar.
// The viewBox is 0 0 100 100, with the sigma centered and sized to ~70%
// of the viewBox (leaving safe-zone padding for adaptive icons).
const SIGMA_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <path d="
    M 20 20
    L 80 20
    L 80 30
    L 45 30
    L 70 50
    L 45 70
    L 80 70
    L 80 80
    L 20 80
    L 20 70
    L 50 50
    L 20 30
    Z
  " fill="#58a6ff"/>
</svg>`;

const SIGMA_SVG_MONO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <path d="
    M 20 20
    L 80 20
    L 80 30
    L 45 30
    L 70 50
    L 45 70
    L 80 70
    L 80 80
    L 20 80
    L 20 70
    L 50 50
    L 20 30
    Z
  " fill="#ffffff"/>
</svg>`;

// Background: #0d1117 solid
const BG_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#0d1117"/>
</svg>`;

async function main() {
  // Ensure output directory exists
  fs.mkdirSync(OUT, { recursive: true });

  // Render the sigma SVG to a PNG buffer at a large size (we'll downscale)
  const sigmaBuffer = await sharp(Buffer.from(SIGMA_SVG)).resize(1024, 1024).png().toBuffer();
  const sigmaMonoBuffer = await sharp(Buffer.from(SIGMA_SVG_MONO)).resize(1024, 1024).png().toBuffer();
  const bgBuffer = await sharp(Buffer.from(BG_SVG)).resize(1024, 1024).png().toBuffer();

  // Helper: composite sigma onto background at a given size
  async function makeIcon(size, name, useMono = false) {
    const sigma = useMono ? sigmaMonoBuffer : sigmaBuffer;
    const bg = await sharp(Buffer.from(BG_SVG)).resize(size, size).png().toBuffer();
    const fg = await sharp(sigma).resize(size, size).png().toBuffer();
    await sharp(bg)
      .composite([{ input: fg, top: 0, left: 0 }])
      .png()
      .toFile(path.join(OUT, name));
    console.log(`  ${name}  ${size}x${size}`);
  }

  console.log("Generating icon assets...");

  // icon.png — 1024x1024 (app icon, iOS + Android non-adaptive fallback)
  await makeIcon(1024, "icon.png");

  // android-icon-foreground.png — 512x512 (adaptive icon foreground)
  await makeIcon(512, "android-icon-foreground.png");

  // android-icon-background.png — 512x512 (adaptive icon background, solid #0d1117)
  const bg512 = await sharp(Buffer.from(BG_SVG)).resize(512, 512).png().toFile(
    path.join(OUT, "android-icon-background.png"),
  );
  console.log(`  android-icon-background.png  512x512`);

  // android-icon-monochrome.png — 432x432 (monochrome adaptive icon, white sigma)
  await makeIcon(432, "android-icon-monochrome.png", true);

  // splash-icon.png — 228x213 (splash screen, centered sigma)
  const splashBg = await sharp({
    create: {
      width: 228,
      height: 213,
      channels: 4,
      background: { r: 13, g: 17, b: 23, alpha: 1 },
    },
  }).png().toBuffer();
  const splashSigma = await sharp(sigmaBuffer).resize(76, 76).png().toBuffer();
  await sharp(splashBg)
    .composite([{ input: splashSigma, top: Math.round((213 - 76) / 2), left: Math.round((228 - 76) / 2) }])
    .png()
    .toFile(path.join(OUT, "splash-icon.png"));
  console.log(`  splash-icon.png  228x213`);

  // favicon.png — 48x48
  await makeIcon(48, "favicon.png");

  console.log("\nDone. All icon assets generated.");
}

main().catch((err) => {
  console.error("Icon generation failed:", err);
  process.exit(1);
});
