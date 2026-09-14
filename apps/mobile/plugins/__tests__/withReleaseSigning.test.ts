/**
 * Guarda la propiedad que hace confiable a `withReleaseSigning`: **es
 * idempotente**. `expo prebuild` puede correrse cualquier cantidad de veces,
 * en cualquier máquina, y el `build.gradle` resultante debe ser el mismo —
 * sin bloques `@generated` duplicados ni `signingConfigs.release` repetidos.
 *
 * Por qué existe este test y no alcanza "corrí prebuild dos veces": esa
 * verificación manual prueba la propiedad UNA vez, en UNA máquina, contra UNA
 * versión de la plantilla de RN/Expo. Duplicar nodos es el modo de fallo
 * clásico de los config plugins propios y aparece justo cuando nadie está
 * mirando (un bump de SDK que cambia el texto de la plantilla, otro plugin
 * que corre antes). El plugin factorizó `applyReleaseSigningToGradle` como
 * transformación de texto pura precisamente para poder fijar esto acá, gratis
 * y offline.
 *
 * Deuda de configuración nativa: ver DEVLOG 2026-07-25 y el docblock del
 * plugin.
 */
import { describe, expect, it } from "vitest";
import { applyReleaseSigningToGradle, setReleaseSigningConfigReference } from "../withReleaseSigning";

/**
 * Fixture mínimo con la forma que produce la plantilla de RN/Expo ANTES de
 * pasar por el plugin: firma de release apuntando a la clave de debug.
 */
const TEMPLATE_GRADLE = `apply plugin: "com.android.application"
apply plugin: "org.jetbrains.kotlin.android"
apply plugin: "com.facebook.react"

def projectRoot = rootDir.getAbsoluteFile().getParentFile().getAbsolutePath()

android {
    namespace 'com.socrates.tutor'

    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
            minifyEnabled enableProguardInReleaseBuilds
        }
    }
}
`;

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("withReleaseSigning", () => {
  it("inyecta el cargador del keystore y la config de firma release", () => {
    const patched = applyReleaseSigningToGradle(TEMPLATE_GRADLE);

    expect(patched).toContain('def keystorePropertiesFile = rootProject.file("keystore.properties")');
    expect(patched).toContain("storeFile file(keystoreProperties['storeFile'])");
    // El fallback a la clave de debug debe sobrevivir: sin él, un checkout
    // limpio sin `keystore.properties` no podría correr `assembleRelease`.
    expect(patched).toContain("// Fallback to debug keystore");
  });

  it("apunta buildTypes.release a signingConfigs.release, no a la de debug", () => {
    const patched = applyReleaseSigningToGradle(TEMPLATE_GRADLE);
    const releaseBlock = patched.slice(patched.indexOf("buildTypes {"));

    expect(releaseBlock).toContain("signingConfig signingConfigs.release");
    // La firma de `debug` sigue siendo la de debug — el plugin solo toca release.
    expect(countOccurrences(releaseBlock, "signingConfig signingConfigs.debug")).toBe(1);
  });

  it("ES IDEMPOTENTE: reaplicarlo sobre su propia salida no cambia nada", () => {
    const once = applyReleaseSigningToGradle(TEMPLATE_GRADLE);
    const twice = applyReleaseSigningToGradle(once);
    const thrice = applyReleaseSigningToGradle(twice);

    expect(twice).toBe(once);
    expect(thrice).toBe(once);
  });

  it("no duplica los bloques @generated al reaplicarse", () => {
    const twice = applyReleaseSigningToGradle(applyReleaseSigningToGradle(TEMPLATE_GRADLE));

    expect(countOccurrences(twice, "@generated begin buxo-release-signing-keystore-loader")).toBe(1);
    expect(countOccurrences(twice, "@generated begin buxo-release-signing-config")).toBe(1);
    expect(countOccurrences(twice, "def keystorePropertiesFile")).toBe(1);
    expect(countOccurrences(twice, "signingConfig signingConfigs.release")).toBe(1);
  });

  it("reescribir la referencia es no-op cuando ya apunta a release", () => {
    const patched = applyReleaseSigningToGradle(TEMPLATE_GRADLE);
    const { contents, changed } = setReleaseSigningConfigReference(patched);

    expect(contents).toBe(patched);
    expect(changed).toBe(false);
  });

  it("no toca signingConfig fuera del bloque buildTypes.release", () => {
    // Un `signingConfig signingConfigs.debug` en `flavorDimensions`/`productFlavors`
    // (fuera de buildTypes) no debe reescribirse: el conteo de llaves del plugin
    // existe justamente para eso.
    const withFlavor = TEMPLATE_GRADLE.replace(
      "android {",
      `android {
    productFlavors {
        internal {
            signingConfig signingConfigs.debug
        }
    }
`,
    );

    const patched = applyReleaseSigningToGradle(withFlavor);
    const flavorBlock = patched.slice(patched.indexOf("productFlavors {"), patched.indexOf("signingConfigs {"));

    expect(flavorBlock).toContain("signingConfig signingConfigs.debug");
  });
});
