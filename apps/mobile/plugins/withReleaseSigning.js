// @ts-check
/* eslint-disable @typescript-eslint/no-require-imports -- Expo config plugins are CommonJS by contract (run directly under Node during `expo prebuild`, no bundler) */
const { withAppBuildGradle, CodeGenerator } = require('@expo/config-plugins');

/**
 * Config plugin: makes `expo prebuild` regenerate `android/app/build.gradle`
 * with the beta release-signing setup, instead of the RN template's plain
 * `signingConfig signingConfigs.debug` for the `release` build type.
 *
 * WHY THIS EXISTS (deuda de configuración nativa — see DEVLOG entries around
 * "la configuración nativa vive solo en esta máquina" / M3 pendiente #8):
 *
 * `android/app/build.gradle` was the ONE file under `apps/mobile/android/`
 * that git actually tracked (everything else under `android/` is
 * gitignored — `/android` in `apps/mobile/.gitignore`, materialized fresh by
 * `expo prebuild`). It carried, by hand, the loading of `keystore.properties`
 * (itself gitignored — secrets) and a `signingConfigs.release` block that
 * signs release builds with the beta keystore (`buxo-beta.keystore`) instead
 * of the debug key, with a fallback to the debug keystore when
 * `keystore.properties` is absent (so `assembleRelease` never breaks on a
 * clean checkout that hasn't been handed the beta keystore yet).
 *
 * The problem: `expo prebuild` doesn't merge into `build.gradle`, it
 * OVERWRITES it from the RN/Expo template. That erased this hand-patched
 * signing setup at least once already this week (restored via `git
 * checkout`). Committing the file doesn't help if the next prebuild — by
 * anyone, on any machine — blows it away again. This plugin makes prebuild
 * regenerate the same setup every time, so it survives `expo prebuild
 * --clean` with zero manual intervention.
 *
 * Idempotent by construction:
 *  - The keystore-loader block and the `signingConfigs.release` block are
 *    injected via `@expo/config-plugins`' `CodeGenerator.mergeContents`,
 *    which wraps injected text in `@generated begin/end <tag> <hash>`
 *    markers and no-ops when a block with that exact tag+hash is already
 *    present — running prebuild twice in a row does NOT duplicate these
 *    blocks (this is the same mechanism `expo-font`'s Android plugin and
 *    others in the Expo ecosystem use for build.gradle patches).
 *  - Pointing `buildTypes.release.signingConfig` at `signingConfigs.release`
 *    is a plain in-place substitution (`setReleaseSigningConfigReference`
 *    below), not an insertion, so re-running it when the value is already
 *    `signingConfigs.release` is a textual no-op — nothing to duplicate.
 */

const KEYSTORE_LOADER_SRC = `// Load keystore properties for release signing (beta) — injected by
// apps/mobile/plugins/withReleaseSigning.js on every \`expo prebuild\`.
// keystore.properties is gitignored (secrets) and typically absent outside
// the founder's machine; when missing, the signingConfigs.release block
// below falls back to the debug keystore so \`assembleRelease\` still works.
def keystorePropertiesFile = rootProject.file("keystore.properties")
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}`;

const RELEASE_SIGNING_CONFIG_SRC = `        release {
            if (keystorePropertiesFile.exists()) {
                storeFile file(keystoreProperties['storeFile'])
                storePassword keystoreProperties['storePassword']
                keyAlias keystoreProperties['keyAlias']
                keyPassword keystoreProperties['keyPassword']
            } else {
                // Fallback to debug keystore (dev builds) — keeps a clean
                // checkout buildable before keystore.properties exists.
                storeFile file('debug.keystore')
                storePassword 'android'
                keyAlias 'androiddebugkey'
                keyPassword 'android'
            }
        }`;

/**
 * Rewrites `signingConfig signingConfigs.<x>` to
 * `signingConfig signingConfigs.release` inside (and only inside) the
 * top-level `buildTypes { release { ... } }` block, tracked via brace-depth
 * counting rather than an anchor comment — robust to the RN/Expo template
 * changing the wording of the surrounding comments.
 *
 * @param {string} contents
 * @returns {{ contents: string, changed: boolean }}
 */
function setReleaseSigningConfigReference(contents) {
  const lines = contents.split('\n');
  let inBuildTypes = false;
  let buildTypesDepth = 0;
  let inReleaseBlock = false;
  let releaseBlockDepth = 0;
  let changed = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inBuildTypes) {
      if (/^\s*buildTypes\s*\{/.test(line)) {
        inBuildTypes = true;
        buildTypesDepth = 1;
      }
      continue;
    }

    const opens = (line.match(/\{/g) || []).length;
    const closes = (line.match(/\}/g) || []).length;

    if (!inReleaseBlock && buildTypesDepth === 1 && /^\s*release\s*\{/.test(line)) {
      inReleaseBlock = true;
      releaseBlockDepth = 1;
      buildTypesDepth += opens - closes;
      continue;
    }

    if (inReleaseBlock) {
      const match = line.match(/^(\s*)signingConfig\s+signingConfigs\.\w+\s*$/);
      if (match) {
        const rewritten = `${match[1]}signingConfig signingConfigs.release`;
        if (rewritten !== line) {
          changed = true;
        }
        lines[i] = rewritten;
      }
      releaseBlockDepth += opens - closes;
      if (releaseBlockDepth <= 0) {
        inReleaseBlock = false;
      }
    }

    buildTypesDepth += opens - closes;
    if (buildTypesDepth <= 0) {
      inBuildTypes = false;
    }
  }

  return { contents: lines.join('\n'), changed };
}

/** @type {import('@expo/config-plugins').ConfigPlugin} */
const withReleaseSigning = (config) => {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language !== 'groovy') {
      throw new Error(
        `withReleaseSigning: expected a Groovy app/build.gradle, got "${config.modResults.language}". ` +
          'This plugin only knows how to patch Groovy build.gradle files.'
      );
    }

    config.modResults.contents = applyReleaseSigningToGradle(config.modResults.contents);
    return config;
  });
};

/**
 * Pure text transform, factored out of the withAppBuildGradle callback so it
 * can be unit-tested directly (incl. re-applying it to its own output, to
 * prove it's idempotent) without going through the full config-plugins mod
 * pipeline.
 *
 * @param {string} contents
 * @returns {string}
 */
function applyReleaseSigningToGradle(contents) {
  contents = CodeGenerator.mergeContents({
    src: contents,
    newSrc: KEYSTORE_LOADER_SRC,
    tag: 'buxo-release-signing-keystore-loader',
    anchor: /apply plugin: "com\.facebook\.react"/,
    offset: 1,
    comment: '//',
  }).contents;

  contents = CodeGenerator.mergeContents({
    src: contents,
    newSrc: RELEASE_SIGNING_CONFIG_SRC,
    tag: 'buxo-release-signing-config',
    anchor: /signingConfigs\s*\{/,
    offset: 1,
    comment: '        //',
  }).contents;

  contents = setReleaseSigningConfigReference(contents).contents;

  return contents;
}

module.exports = withReleaseSigning;
module.exports.setReleaseSigningConfigReference = setReleaseSigningConfigReference;
module.exports.applyReleaseSigningToGradle = applyReleaseSigningToGradle;
