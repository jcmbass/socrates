/**
 * Smoke one-shot BE1: verifica el provider Ollama cloud con API key.
 * (Materializado por el orquestador desde guia-founder-be1.md §3 — tooling
 * desechable, vive en scratchpad, no en el repo.)
 * Costo: no medido (suscripcion Ollama).
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";

const apiKey = process.env.OLLAMA_API_KEY;
if (!apiKey) {
  console.error("Falta OLLAMA_API_KEY en el entorno");
  process.exit(1);
}

const baseURL = process.env.OLLAMA_BASE_URL || "https://ollama.com/v1";

const provider = createOpenAICompatible({ baseURL, name: "ollama", apiKey });
const model = provider("gemma4:31b-cloud");

async function main() {
  const result = streamText({
    model,
    messages: [{ role: "user", content: "Responde solo: OK. Cual es la capital de Francia?" }],
  });

  let text = "";
  for await (const chunk of result.textStream) {
    text += chunk;
  }

  const usage = await result.usage;
  console.log("tutor_provider_id == ollama");
  console.log("Respuesta:", text.trim());
  console.log("Usage:", JSON.stringify(usage));
}

main().catch((err) => {
  console.error("Smoke FAILED:", err);
  process.exit(1);
});
