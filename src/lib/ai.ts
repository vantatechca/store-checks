import { STATUS, Status } from "./status";

const PROMPT = `You are analyzing a screenshot of an online store's homepage to determine its health.
Reply with ONLY one of these exact codes:
UP - the store looks like a normal, working storefront (products, branding, navigation visible)
STORE_UNAVAILABLE - a Shopify "This store is unavailable" / closed / suspended message is shown
PASSWORD_PROTECTED - a Shopify password / "Opening soon" page is shown
DNS_ERROR - a browser error page (site can't be reached, DNS error)
SITE_ERROR - an error page (404, 500, blank/broken page, hosting error page)
UNKNOWN - you cannot tell

Reply with only the code, nothing else.`;

export interface AiVerdict {
  status: Status;
  provider: string;
}

function parseVerdict(text: string): Status {
  const code = text.trim().toUpperCase().replace(/[^A-Z_]/g, "");
  const valid: string[] = Object.values(STATUS);
  return (valid.includes(code) ? code : STATUS.UNKNOWN) as Status;
}

async function analyzeWithGemini(png: Buffer): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");
  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: PROMPT },
              { inline_data: { mime_type: "image/png", data: png.toString("base64") } },
            ],
          },
        ],
        generationConfig: { maxOutputTokens: 20, temperature: 0 },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

async function analyzeWithOpenAI(png: Buffer): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set");
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      max_tokens: 20,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: PROMPT },
            {
              type: "image_url",
              image_url: { url: `data:image/png;base64,${png.toString("base64")}` },
            },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

/**
 * Analyze a screenshot with the configured AI provider (AI_PROVIDER=gemini|openai).
 * Falls back to the other provider if the primary fails and a key is available.
 */
export async function analyzeScreenshot(png: Buffer): Promise<AiVerdict> {
  const primary = (process.env.AI_PROVIDER || "gemini").toLowerCase();
  const order =
    primary === "openai" ? (["openai", "gemini"] as const) : (["gemini", "openai"] as const);

  let lastError: unknown;
  for (const provider of order) {
    const hasKey = provider === "gemini" ? !!process.env.GEMINI_API_KEY : !!process.env.OPENAI_API_KEY;
    if (!hasKey) continue;
    try {
      const text = provider === "gemini" ? await analyzeWithGemini(png) : await analyzeWithOpenAI(png);
      return { status: parseVerdict(text), provider };
    } catch (err) {
      lastError = err;
      console.error(`[ai] ${provider} failed:`, err);
    }
  }
  console.error("[ai] all providers failed or no API key configured", lastError);
  return { status: STATUS.UNKNOWN, provider: "none" };
}
