# Socrates

**Un tutor que te pregunta en lugar de darte la respuesta. Para que cualquier estudiante, en cualquier lugar, tenga con quién pensar.**

*[English below](#in-english)*

## Cómo empezó

Todo empezó cuando conocimos [2 Hour Learning](https://2hourlearning.com/). Vimos a chicos aprender con un tutor de IA a su propio ritmo, sin quedarse con huecos, y a los adultos del salón dejar de calificar tareas para dedicarse a otra cosa: acompañar, motivar, sostener. Nos pareció una de las ideas más bonitas que habíamos visto sobre la escuela.

Y nos dejó una pregunta que no se nos fue: ¿y los que no pueden pagarlo? ¿Y la estudiante con un Android barato, datos contados y un colegio sin recursos?

Socrates es nuestra manera de responder esa pregunta. No queremos sustituir a 2 Hour Learning ni competir con ellos. Queremos que algo así pueda existir en cualquier parte, para cualquiera.

## Qué es

Socrates no te da la respuesta. Te pregunta, como lo hacía Sócrates, hasta que la encontrás vos. Si te trabás, te da una pista. Si vas bien, se hace a un lado. Estudia con tu propio material, tus guías y tus PDFs, o con temarios armados a partir de libros abiertos.

Corre en un teléfono Android barato y usa modelos de IA abiertos. La educación de calidad no debería depender del teléfono que puede pagar tu familia.

## Lo que soñamos

Imaginamos a Socrates alojado por miles, ojalá millones, de instituciones en todo el mundo: escuelas públicas, colegios rurales, universidades, fundaciones. Y por qué no, también por 2 Hour Learning.

Pero no lo imaginamos solo. Una IA puede tener paciencia infinita para repetir la misma pregunta a las once de la noche. Lo que no puede es darse cuenta de que un chico está triste, de que algo en casa no anda bien, o de que necesita que alguien crea en él. Eso lo hacen las personas.

Por eso pensamos Socrates para que cada institución lo adopte de la mano de sus profesionales: docentes, orientadores, psicólogas y psicólogos. El tutor se encarga de la práctica. Las personas, de lo que de verdad importa.

Y por eso el código es libre. Nadie tiene que pedirnos permiso para usarlo, cambiarlo o llevarlo a su comunidad.

## Dónde estamos hoy

Somos pequeños. Socrates nació en El Salvador y hoy está en una prueba cerrada en Android con un grupo chico de estudiantes. Cada versión nueva sale de lo que ellos nos piden.

Falta mucho. El filtro de seguridad actual es simple (lo contamos en [SECURITY.md](SECURITY.md)) y no reemplaza el criterio de un adulto. Si vas a ponerlo frente a estudiantes, hacelo con profesionales a tu lado.

Las notas de nuestros testers (`docs/plan-beta-real/`) son privadas y no forman parte de este repositorio.

## Sumate

Si sos docente, psicóloga, psicólogo, parte de una institución o alguien que programa, esta historia también es tuya. Leé [CONTRIBUTING.md](CONTRIBUTING.md) o escribinos a hola@cubo.lat.

---

## In English

**A tutor that asks instead of answering, so any student, anywhere, has someone to think with.**

It started when we found [2 Hour Learning](https://2hourlearning.com/). We saw kids learning with an AI tutor at their own pace, with no gaps left behind, and the adults in the room trading grading for guiding: motivating, supporting, believing in them. It was one of the most beautiful ideas about school we had ever seen. It also left us with a question: what about the kids who can't afford it? The student with a cheap Android phone, a prepaid data plan, and a school without resources?

Socrates is our answer. We don't want to replace 2 Hour Learning or compete with them. We want something like it to exist everywhere, for everyone.

Socrates never hands you the answer. It asks, the way Socrates did, until you find it yourself. It gives a hint when you're stuck and steps back when you're doing well. It runs on a cheap Android phone with open AI models, because quality education shouldn't depend on the phone your family can afford.

We dream of Socrates being hosted by thousands, hopefully millions, of institutions around the world, maybe even by 2 Hour Learning. Never on its own, though. An AI can be endlessly patient at eleven at night. It can't tell that a kid is sad, that something is wrong at home, or that they need someone to believe in them. People do that. So Socrates is meant to be adopted together with educators, counselors, and psychologists. The tutor handles practice. People handle what matters most. That's why the code is free.

Today we're small. Socrates was born in El Salvador and is in a closed Android beta with a small group of students. Every release comes from what they ask for. The current safety filter is simple (see [SECURITY.md](SECURITY.md)) and is no substitute for an adult's judgment. If you put Socrates in front of students, do it with professionals beside you.

---

## Licencia / License

El código es MIT ([LICENSE](LICENSE)). Los temarios en `packages/domain/data/seed/` vienen de libros abiertos de OpenStax y siguen bajo CC BY 4.0, no MIT ([NOTICE](NOTICE)).

The code is MIT ([LICENSE](LICENSE)). Topic lists under `packages/domain/data/seed/` come from open OpenStax textbooks and stay CC BY 4.0, not MIT ([NOTICE](NOTICE)).

Internally the packages are named `@buxo/*`, the project's working name.

## Run it yourself

### Android

Student app: Expo in `apps/mobile`, package `com.socrates.tutor`.

1. `npm install`
2. `cp apps/mobile/.env.example apps/mobile/.env`
3. Point `EXPO_PUBLIC_API_BASE_URL` at your local server (`http://localhost:3001` on an emulator; use your machine LAN IP on a device).
4. `npm run android -w @buxo/mobile`

You need Android Studio with an emulator, or a device with USB debugging.

### Server

API: Hono in `apps/server` on port 3001. Open models go through DeepInfra or any OpenAI-compatible endpoint (`OLLAMA_BASE_URL`). Fake models are enough to check that it boots.

1. `npm install`
2. `cp apps/server/.env.example apps/server/.env`
3. Set `BUXO_ENV=dev` and `BUXO_FAKE_MODELS=1` in that file.
4. `npm run dev -w apps/server`
5. `curl -sS http://localhost:3001/healthz` should return HTTP 200 and `"ok": true`.

Postgres (`DATABASE_URL`) is required before signup, sessions, or materials. A local instance is enough:

`docker run --rm -e POSTGRES_USER=buxo -e POSTGRES_PASSWORD=buxo -e POSTGRES_DB=buxo -p 5432:5432 postgres:16`

Then `npm run db:migrate -w apps/server`.

To call real models, unset `BUXO_FAKE_MODELS` and set `DEEPINFRA_API_KEY` (or point `OLLAMA_BASE_URL` at a local daemon). Staging and prod must set a random `JWT_SECRET`; the documented default is rejected outside `BUXO_ENV=dev`.

### Tests

From the repo root:

- `npm test -w apps/server`
- `npm test -w @buxo/domain`
- `npm test -w @buxo/mobile -- lib/`
