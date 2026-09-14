/**
 * Textos legales PUBLICADOS de Socrates — fuente única de verdad.
 *
 * Viven acá, y no en `docs/legal/*.md`, por una razón operativa concreta: el
 * enlace que toca el estudiante junto a la casilla de términos apunta a este
 * servidor, así que corregir una cláusula debe poder hacerse con un deploy y
 * NO con un APK nuevo (recompilar y redistribuir el APK es justo el cuello de
 * botella que este proyecto ya sufre). Los `-DRAFT.md` que quedan en
 * `docs/legal/` son el archivo histórico de la versión que aceptaron los
 * estudiantes anteriores; no se editan.
 *
 * **Regla de versionado (la importante):** cada fila de `consents` guarda la
 * versión exacta que el usuario aceptó. Si cambiás el texto de forma
 * sustantiva, subí `CURRENT_TERMS_VERSION` / `CURRENT_PRIVACY_VERSION` en
 * `packages/domain/policy-versions.ts` y **dejá el texto viejo accesible**, o
 * las filas de consentimiento viejas apuntarán a un texto que ya nadie puede
 * leer — que es exactamente lo que hace inútil un registro de consentimiento.
 *
 * Alcance de lo que este archivo puede prometer: describe lo que el código
 * hace HOY, verificado contra `repositories/fuentes.ts` (invariante P0-6,
 * texto-solamente), `auth/session.ts` (hash SHA-256 de tokens),
 * `routes/account.ts` y `packages/models/registry.ts`. Los proveedores
 * efectivamente activos dependen de variables de entorno que viven en el
 * dashboard de Render; ver la nota de `PROVIDER_DISCLOSURE_NOTE` abajo.
 */
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from "@buxo/domain/policy-versions";

const TERMS_LAST_UPDATED = "3 de septiembre de 2026";
const PRIVACY_LAST_UPDATED = "3 de septiembre de 2026";
export const CONTACT_EMAIL = "hola@cubo.lat";

/**
 * Configuración viva de producción CONFIRMADA por el founder contra el
 * dashboard de Render el 2026-08-06 (el dashboard es la fuente de verdad;
 * `render.yaml` y `.env.example` son documentación commiteada y mienten):
 *
 *   JUDGE_SAMPLE_RATE  = 0.1   → el juez SÍ corre, sobre ~1 de cada 10
 *   BUXO_INGEST_CHAIN  = deepinfra:Qwen/Qwen3-VL-30B-A3B-Instruct
 *                              → transcripción SIN eslabón Anthropic
 *   EMAIL_SENDER       = resend
 *
 * Esto corrige un error de la política anterior, que afirmaba que el juez
 * estaba "apagado en producción (`JUDGE_SAMPLE_RATE=0`)" y que no recibía
 * "Nada actualmente". Era falso desde que se puso 0.1: los estudiantes ya
 * registrados aceptaron un texto que declaraba de MENOS a dónde iban sus
 * datos. Si estos valores cambian en Render, este archivo cambia con ellos.
 */
export const PROVIDER_DISCLOSURE_NOTE =
  "Verificado contra Render 2026-08-11 (diseño de dos modelos): DeepInfra es el ÚNICO proveedor de IA — tutor, temario, ingesta, assessor (banda DeepSeek + mastery Qwen) y judge. Anthropic fuera de la ruta del estudiante. Email Resend.";

function pageShell(title: string, version: string, lastUpdated: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${title} — Socrates</title>
<style>
  :root{color-scheme:light dark}
  body{font-family:system-ui,-apple-system,sans-serif;margin:0 auto;padding:2rem 1.25rem 4rem;max-width:44rem;background:#f7f4ef;color:#1a1a1a;line-height:1.55;font-size:1rem}
  @media (prefers-color-scheme: dark){body{background:#0d1117;color:#c9d1d9}}
  h1{font-size:1.5rem;line-height:1.25;margin:0 0 .35rem}
  h2{font-size:1.15rem;margin:2.25rem 0 .6rem;line-height:1.3}
  h3{font-size:1rem;margin:1.5rem 0 .4rem}
  p,li{margin:0 0 .8rem}
  ul{padding-left:1.25rem}
  .meta{font-size:.85rem;opacity:.7;margin:0 0 2rem}
  .meta code{font-size:.85em}
  table{border-collapse:collapse;width:100%;margin:0 0 1.2rem;font-size:.9rem;display:block;overflow-x:auto}
  th,td{border:1px solid rgba(128,128,128,.35);padding:.5rem .6rem;text-align:left;vertical-align:top}
  th{font-weight:600}
  a{color:inherit}
  .callout{border-left:3px solid rgba(128,128,128,.5);padding:.1rem 0 .1rem .9rem;margin:0 0 1.2rem}
</style>
</head>
<body>
<h1>${title}</h1>
<p class="meta">Versión <code>${version}</code> · Última actualización: ${lastUpdated} · El Salvador · Edad mínima: 13 años</p>
${body}
<h2>Contacto</h2>
<p>Escribinos a <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a> por cualquier duda sobre este documento, tu privacidad, o para ejercer tus derechos sobre tus datos. Respondemos en un plazo estimado de 7 a 15 días hábiles.</p>
</body>
</html>`;
}

const TERMS_BODY = `
<h2>1. Qué es Socrates</h2>
<p>Socrates es un tutor de inteligencia artificial que <strong>no te da la respuesta</strong>. Sigue el método socrático: te hace preguntas, te guía, te señala contradicciones y te lleva a encontrar la respuesta por tu cuenta.</p>
<p>No es un chatbot de propósito general y no reemplaza a un profesor. Es una herramienta de estudio complementaria.</p>
<p>Socrates es operado por <strong>cubo.lat</strong>. Todavía no hay una figura jurídica constituida detrás; el contacto es <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>

<h2>2. Quién puede usarlo</h2>
<p>Para usar Socrates necesitás:</p>
<ul>
<li>Tener <strong>13 años o más</strong> al momento de registrarte.</li>
<li>Confirmar tu edad en la casilla correspondiente.</li>
<li>Aceptar estos términos y la política de privacidad.</li>
</ul>
<p>Si sos menor de 18 años, te recomendamos que tu madre, padre o tutor lea estos documentos con vos. Si sos madre, padre o tutor y quien usa Socrates es tu hijo o hija, aceptás estos términos en su representación.</p>

<h2>3. Tu cuenta</h2>
<ul>
<li>Te registrás con tu <strong>correo electrónico</strong> y un <strong>nombre para mostrar</strong>.</li>
<li><strong>No usamos contraseñas.</strong> Entrás con un enlace de acceso que te mandamos por correo.</li>
<li>Sos responsable de mantener el acceso a tu correo: quien pueda leerlo puede entrar a tu cuenta.</li>
<li>Tu cuenta es personal. No la compartas.</li>
</ul>

<h2>4. El tutor se puede equivocar</h2>
<div class="callout">
<p>Socrates funciona con modelos de inteligencia artificial. Como toda IA, <strong>puede afirmar cosas incorrectas con total seguridad</strong>, malinterpretar tu material de estudio, o equivocarse al transcribir un PDF o una foto.</p>
<p>No uses a Socrates como única fuente. Contrastá lo importante con tu libro, tu guía o tu profesor — sobre todo antes de un examen. Vos seguís siendo responsable de tu propio trabajo académico, y de cumplir las reglas de honestidad académica de tu institución.</p>
</div>

<h2>5. Uso aceptable</h2>
<p>Al usar Socrates aceptás:</p>
<ul>
<li><strong>No intentar romper al tutor:</strong> no trates de que genere texto libre, ignore sus instrucciones o revele su configuración interna.</li>
<li><strong>No abusar del servicio:</strong> no crees cuentas en masa, no automatices el uso, no lo uses como intermediario para acceder a modelos de IA.</li>
<li><strong>No subir material dañino:</strong> nada ilegal, violento, sexualmente explícito, ni que promueva autolesión o abuso.</li>
<li><strong>No subir material del que no tengas derecho a disponer</strong>, ni datos personales de terceros.</li>
</ul>

<h2>6. Cuotas de uso y suspensión</h2>
<p>Socrates opera con <strong>cuotas</strong> (límites de mensajes y de páginas de material por día y por mes) para sostener el servicio gratuito durante la beta. Cuando llegás a un límite, la app te lo dice y te explica cuándo se renueva.</p>
<p>Podemos suspender una cuenta, temporal o permanentemente, por violar la sección 5, por intentos repetidos de abuso, por crear varias cuentas para eludir las cuotas, o por un uso que genere un costo desproporcionado. Si te suspendemos y creés que fue un error, escribinos.</p>

<h2>7. Disponibilidad y garantías (beta)</h2>
<p>Socrates está en <strong>fase beta</strong>. Eso significa, con todas las letras:</p>
<ul>
<li>El servicio se ofrece <strong>"tal cual" y "según disponibilidad"</strong>.</li>
<li><strong>No garantizamos</strong> que esté siempre disponible, que no tenga errores, ni que funcione sin interrupciones.</li>
<li>El servidor puede tardar hasta un par de minutos en despertar si no recibió solicitudes recientes.</li>
<li><strong>No garantizamos</strong> que el método socrático te funcione para toda materia o todo tema.</li>
<li>Podemos modificar, suspender o discontinuar el servicio o cualquiera de sus funciones, en cualquier momento.</li>
</ul>

<h2>8. Limitación de responsabilidad</h2>
<p>Hasta el máximo que permita la ley aplicable de la República de El Salvador, Socrates y quienes lo operan no responden por daños indirectos, incidentales, especiales o consecuentes, incluyendo pérdida de datos, resultados académicos, o el costo de una tutoría alternativa.</p>
<p>Nada en estos términos excluye responsabilidades que la ley no permita excluir.</p>

<h2>9. Terminación</h2>
<p>Podés eliminar tu cuenta cuando quieras desde la app (botón <strong>Eliminar mi cuenta</strong>, junto a Salir) o escribiendo a <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>. No hace falta reinstalar la app. Al eliminarla:</p>
<ul>
<li>Se borran tus datos personales, tus sesiones de estudio y tu material, según la política de privacidad.</li>
<li>El <strong>registro de consentimiento se conserva de forma seudonimizada</strong>: es la evidencia de que cumplimos el requisito de edad mínima, y una vez eliminada la cuenta ya no puede asociarse con vos.</li>
</ul>
<p>Si alguna vez discontinuamos Socrates, te avisaremos al correo con el que te registraste con al menos 30 días de anticipación, para que puedas pedir una copia de tus datos antes del cierre.</p>

<h2>10. Cambios a estos términos</h2>
<p>Si estos términos cambian de forma sustantiva, te lo diremos en la aplicación y te pediremos que aceptes la versión nueva antes de seguir usando Socrates. Cada versión tiene un identificador propio (el que ves arriba) y queda registrada la versión exacta que aceptaste.</p>

<h2>11. Ley aplicable</h2>
<p>Estos términos se rigen por las leyes de la República de El Salvador. Cualquier disputa se resolverá ante los tribunales competentes de San Salvador.</p>
`;

const PRIVACY_BODY = `
<div class="callout">
<p><strong>Lo corto:</strong> guardamos tu correo, tu nombre para mostrar y lo que escribís estudiando. <strong>Del material que subís guardamos únicamente el texto — el archivo original no se guarda.</strong> Para que el tutor funcione, tus mensajes y ese texto pasan por empresas de inteligencia artificial en el exterior, listadas abajo con nombre y rol. No vendemos nada a nadie.</p>
</div>
<p><strong>Responsable:</strong> Socrates es operado por <strong>cubo.lat</strong>, que decide para qué y cómo se tratan tus datos. Todavía no hay una figura jurídica constituida; el contacto para ejercer tus derechos es <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>

<h2>1. Qué información recolectamos</h2>

<h3>1.1 Tu cuenta</h3>
<table>
<tr><th>Dato</th><th>Para qué</th></tr>
<tr><td>Correo electrónico</td><td>Identificarte y mandarte el enlace de acceso</td></tr>
<tr><td>Nombre para mostrar</td><td>Saludarte por tu nombre en la app</td></tr>
<tr><td>Confirmación de edad (13+)</td><td>Cumplir el requisito de edad mínima</td></tr>
<tr><td>País e idioma</td><td>Configuración regional</td></tr>
</table>
<p>No guardamos contraseñas, porque no usamos contraseñas.</p>

<h3>1.2 Tu material de estudio</h3>
<p>Cuando subís un PDF o una foto, o pegás texto:</p>
<ul>
<li>El archivo se procesa para extraer su texto.</li>
<li><strong>Guardamos únicamente el texto extraído. El archivo original no se almacena</strong> — ni en el servidor ni en la nube. Por eso la app te deja agregar y borrar fuentes, pero no descargarlas: no hay archivo que descargar.</li>
<li>Ese texto es privado de tu materia y se usa para que el tutor pueda explicarte con tu propio material.</li>
</ul>

<h3>1.3 Tus sesiones de estudio</h3>
<p>De cada sesión guardamos tus mensajes, las respuestas del tutor, y metadatos técnicos (qué modelo respondió, qué versión del prompt se usó).</p>

<h3>1.4 Evaluaciones de comprensión</h3>
<p>Un evaluador automático analiza tus respuestas para estimar cuánto entendiste de cada tema y ajustar cómo te guía el tutor. Hoy ese resultado <strong>no se te muestra directamente</strong> mientras calibramos el sistema; si eso cambia, lo verás en la app.</p>

<h3>1.5 Uso y costo</h3>
<p>Llevamos la cuenta de cuántos mensajes y páginas de material usás por día y por mes, y el costo estimado del procesamiento de IA. Sirve para sostener las cuotas y detectar abuso.</p>

<h3>1.6 Registro de consentimiento</h3>
<p>Cuando aceptás los términos y esta política guardamos tu identificador, qué aceptaste, <strong>qué versión exacta del documento</strong> y cuándo. Este registro <strong>es permanente</strong>, incluso si borrás tu cuenta: es la evidencia de que cumplimos el requisito de edad mínima. Al borrar la cuenta, tu identificador se reemplaza por un código anónimo.</p>

<h2>2. Para qué la usamos</h2>
<ul>
<li><strong>Operar el servicio:</strong> responder tus mensajes, evaluar tu comprensión, sostener tus sesiones.</li>
<li><strong>Mejorar el producto:</strong> métricas agregadas para calibrar al tutor y controlar costos.</li>
<li><strong>Cumplir la ley:</strong> conservar el registro de consentimiento.</li>
<li><strong>Prevenir abuso.</strong></li>
</ul>
<p><strong>No la usamos para</strong> publicidad, ni para venderla a terceros, ni para entrenar modelos de IA propios, ni para perfilamiento comercial o crediticio.</p>

<h2>3. Con quién la compartimos</h2>
<p>Para que Socrates funcione, tus datos pasan por estas empresas. Es la lista completa, verificada contra la configuración de producción el 11 de agosto de 2026:</p>
<table>
<tr><th>Empresa</th><th>Rol</th><th>Qué recibe</th></tr>
<tr><td><strong>DeepInfra</strong> (tutor: gemma-4-31B-it de Google; transcripción: Qwen3-VL de Alibaba; banda: DeepSeek-V4-Flash-0731 de DeepSeek; mastery y juez: Qwen3.6-35B-A3B de Alibaba)</td><td>El tutor: genera las respuestas que leés en el chat; armar el temario de tu materia; transcribir el material que subís (PDF o foto → texto); evaluar tu comprensión y ajustar el andamiaje de cada turno; y revisar la calidad del tutor sobre <strong>aproximadamente 1 de cada 10</strong> intercambios</td><td>Cada mensaje que escribís, el contexto de la sesión, el texto de tu programa, las páginas de tu archivo y tus respuestas</td></tr>
<tr><td><strong>Resend</strong></td><td>Enviar el correo con tu enlace de acceso</td><td>Tu dirección de correo</td></tr>
<tr><td><strong>Render</strong></td><td>Servidor donde corre Socrates</td><td>Todo dato en tránsito</td></tr>
<tr><td><strong>Neon</strong></td><td>Base de datos</td><td>Todo dato almacenado</td></tr>
</table>
<p>El material que subís lo transcribe <strong>únicamente DeepInfra</strong>: no hay un proveedor de respaldo que reciba tu archivo si ese falla. Si falla, la transcripción falla y te lo decimos.</p>
<p>Lo que declara su política pública, verificado el 2 de agosto de 2026:</p>
<ul>
<li><strong>DeepInfra</strong> (<a href="https://docs.deepinfra.com/account/data-privacy">política</a>): declara que no usa lo que se le envía para entrenar, con una excepción que puede aplicar a modelos de Google o Anthropic. El tutor corre en gemma (Google), así que esa excepción puede aplicarle. La evaluación de banda corre en DeepSeek (DeepSeek) y la de mastery en Qwen (Alibaba). Todos vía DeepInfra, que es el único proveedor de IA. Es lo que DeepInfra declara públicamente; no tenemos un contrato que nos permita auditarlo. Declara además que los datos de entrada no se escriben a disco.</li>
</ul>
<p><strong>Somos honestos sobre el límite de esto:</strong> es lo que esas empresas declaran públicamente. No tenemos un contrato que nos permita auditarlas, y sus políticas pueden cambiar. Si cambian, actualizamos esta página.</p>
<p>Fuera de esa lista, solo compartimos información si la ley nos obliga, si es necesario para proteger derechos o seguridad, o si vos nos lo pedís. <strong>No vendemos tu información. Nunca.</strong></p>

<h2>4. Dónde se procesan tus datos</h2>
<p>Todos los proveedores de arriba operan <strong>fuera de El Salvador</strong>, principalmente en Estados Unidos. Al usar Socrates, tus datos se transfieren y procesan en el exterior, bajo la legislación de esos países.</p>

<h2>5. Cuánto tiempo la guardamos</h2>
<table>
<tr><th>Dato</th><th>Retención</th></tr>
<tr><td>Sesiones de estudio, material, evaluaciones, métricas, datos de cuenta</td><td>Mientras tu cuenta esté activa. Se eliminan al eliminar la cuenta.</td></tr>
<tr><td>Registro de consentimiento</td><td><strong>Permanente</strong>, seudonimizado al eliminar la cuenta.</td></tr>
</table>

<h2>6. Tus derechos</h2>
<p>Podés:</p>
<ul>
<li><strong>Eliminar tu cuenta</strong> desde la app (botón Eliminar mi cuenta, junto a Salir) o escribiendo a <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a> desde el correo con el que te registraste. No hace falta reinstalar la app. Lo procesamos de inmediato en la app, o dentro de 30 días si lo pedís por correo. Se eliminan tu cuenta, tu progreso y tus fuentes; el registro de consentimiento se seudonimiza, no se borra.</li>
<li><strong>Pedir una copia de tus datos</strong> en formato legible por máquina, escribiendo al mismo correo.</li>
<li><strong>Corregir</strong> tu nombre para mostrar o tu correo.</li>
<li><strong>Retirar tu consentimiento</strong>, lo que implica desactivar tu cuenta.</li>
</ul>

<h2>7. Seguridad</h2>
<ul>
<li><strong>En tránsito:</strong> todo viaja por HTTPS (TLS).</li>
<li><strong>En reposo:</strong> la base de datos está cifrada a nivel de disco.</li>
<li><strong>Enlaces de acceso:</strong> se guardan como hash SHA-256 — el enlace original nunca queda almacenado — y vencen.</li>
<li><strong>Acceso:</strong> solo quien opera Socrates tiene acceso a la base de datos de producción.</li>
</ul>

<h2>8. Menores de edad</h2>
<p>Socrates es para estudiantes de <strong>13 años o más</strong>. No recolectamos a sabiendas información de menores de 13. Si detectamos una cuenta de alguien menor de 13, la eliminamos. Si sos madre, padre o tutor y creés que tu hijo o hija menor de 13 se registró, escribinos y lo resolvemos.</p>

<h2>9. Cambios a esta política</h2>
<p>Si esta política cambia de forma sustantiva, te lo diremos en la aplicación y te pediremos que aceptes la versión nueva. Queda registrada la versión exacta que aceptaste.</p>
`;

export const TERMS_HTML = pageShell("Términos de Servicio", CURRENT_TERMS_VERSION, TERMS_LAST_UPDATED, TERMS_BODY);
export const PRIVACY_HTML = pageShell("Política de Privacidad", CURRENT_PRIVACY_VERSION, PRIVACY_LAST_UPDATED, PRIVACY_BODY);

const DELETE_ACCOUNT_LAST_UPDATED = "3 de septiembre de 2026";
// Exportado para que el test del espejo editorial
// (__tests__/legal/documentos-espejo.test.ts) ate esta versión con la que
// declara docs/legal/eliminar-cuenta-socrates.md. No es un consentimiento
// (no vive en policy-versions.ts): es la página de instrucciones de borrado.
export const DELETE_ACCOUNT_VERSION = "eliminar-cuenta-2026-09";

const DELETE_ACCOUNT_BODY = `
<p>Esta página explica cómo pedir que borremos tu cuenta de Socrates <strong>sin reinstalar la app</strong>. Es el mismo resultado que el botón <strong>Eliminar mi cuenta</strong> dentro de la aplicación.</p>

<h2>Qué se elimina</h2>
<ul>
<li>Tu cuenta (correo y nombre para mostrar).</li>
<li>Tu progreso de estudio (sesiones, mensajes, evaluaciones).</li>
<li>Tus fuentes de estudio (el texto extraído; el archivo original nunca se guardó).</li>
</ul>
<p>El <strong>registro de consentimiento se seudonimiza, no se borra</strong>: se reemplaza tu identificador por un código anónimo. Es la evidencia de que cumplimos el requisito de edad mínima, y ya no puede asociarse con vos. Eso es exactamente lo que hace <code>DELETE /v1/account</code>.</p>

<h2>Cómo pedirlo</h2>
<ul>
<li><strong>Desde la app:</strong> en Inicio, junto a Salir, tocá <strong>Eliminar mi cuenta</strong> y confirmá. No hace falta reinstalar.</li>
<li><strong>Por correo:</strong> escribí a <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a> desde el correo con el que te registraste y pedí el borrado. Lo procesamos dentro de 30 días.</li>
</ul>
<p>Si no tenés la app instalada, el correo alcanza. Si la tenés, el botón in-app es el camino más directo.</p>
`;

export const DELETE_ACCOUNT_HTML = pageShell(
  "Eliminar tu cuenta",
  DELETE_ACCOUNT_VERSION,
  DELETE_ACCOUNT_LAST_UPDATED,
  DELETE_ACCOUNT_BODY,
);

