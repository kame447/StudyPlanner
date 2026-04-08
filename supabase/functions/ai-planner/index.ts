import "@supabase/functions-js/edge-runtime.d.ts";
import { createRemoteJWKSet, jwtVerify } from "jose";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface JsonSchemaResponseFormat {
  type: "json_schema";
  json_schema: {
    name: string;
    schema: Record<string, unknown>;
    strict?: boolean;
  };
}

interface ChatCompletionRequest {
  model: string;
  temperature?: number;
  messages: ChatMessage[];
  response_format?: JsonSchemaResponseFormat;
}

interface ChatCompletionChoice {
  message?: {
    content?: string | null;
  };
}

interface ChatCompletionResponse {
  choices?: ChatCompletionChoice[];
  error?: {
    message?: string;
  };
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

let jwks:
  | ReturnType<typeof createRemoteJWKSet>
  | null = null;

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  });
}

function isChatMessageArray(value: unknown): value is ChatMessage[] {
  if (!Array.isArray(value) || value.length === 0) {
    return false;
  }

  return value.every((item) => {
    if (typeof item !== "object" || item === null) {
      return false;
    }

    const candidate = item as Record<string, unknown>;
    return (
      (candidate.role === "system" ||
        candidate.role === "user" ||
        candidate.role === "assistant") &&
      typeof candidate.content === "string" &&
      candidate.content.trim().length > 0
    );
  });
}

function getBearerToken(req: Request): string | null {
  const authorization = req.headers.get("Authorization")?.trim();

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  const token = authorization.slice("Bearer ".length).trim();
  return token || null;
}

async function verifyRequestJwt(req: Request): Promise<Response | null> {
  const token = getBearerToken(req);

  if (!token) {
    return jsonResponse({ error: "Authorization header is required." }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  const configuredIssuer = Deno.env.get("SUPABASE_JWT_ISSUER")?.trim();
  const jwtIssuer = configuredIssuer || (supabaseUrl ? `${supabaseUrl}/auth/v1` : undefined);

  if (!supabaseUrl || !jwtIssuer) {
    return jsonResponse(
      { error: "Supabase runtime environment is not configured." },
      500,
    );
  }

  try {
    jwks ??= createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`));
    await jwtVerify(token, jwks, { issuer: jwtIssuer });
    return null;
  } catch (error) {
    console.error("[ai-planner] JWT verification failed", error);
    return jsonResponse({ error: "Invalid JWT" }, 401);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const authErrorResponse = await verifyRequestJwt(req);

  if (authErrorResponse) {
    return authErrorResponse;
  }

  const openAiApiKey = Deno.env.get("OPENAI_API_KEY")?.trim();

  if (!openAiApiKey) {
    return jsonResponse(
      { error: "OPENAI_API_KEY is not configured in Edge Function Secrets." },
      500,
    );
  }

  let payload: ChatCompletionRequest;

  try {
    payload = await req.json() as ChatCompletionRequest;
  } catch {
    return jsonResponse({ error: "Request body must be valid JSON." }, 400);
  }

  if (
    typeof payload.model !== "string" ||
    payload.model.trim().length === 0 ||
    !isChatMessageArray(payload.messages)
  ) {
    return jsonResponse(
      { error: "model and messages are required." },
      400,
    );
  }

  const requestPayload: ChatCompletionRequest = {
    model: payload.model.trim(),
    temperature: typeof payload.temperature === "number" ? payload.temperature : 0,
    messages: payload.messages,
    response_format: payload.response_format,
  };

  const openAiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openAiApiKey}`,
    },
    body: JSON.stringify(requestPayload),
  });

  const openAiData = await openAiResponse.json() as ChatCompletionResponse;

  if (!openAiResponse.ok) {
    return jsonResponse(
      {
        error:
          openAiData.error?.message ??
          `OpenAI request failed with status ${openAiResponse.status}.`,
      },
      openAiResponse.status,
    );
  }

  const content = openAiData.choices?.[0]?.message?.content?.trim();

  if (!content) {
    return jsonResponse({ error: "OpenAI response was empty." }, 502);
  }

  return jsonResponse({ content });
});
