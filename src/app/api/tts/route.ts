import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const text =
    req.nextUrl.searchParams.get("text")?.trim();

  if (!text) {
    return new Response(
      "Missing text",
      {
        status: 400,
      }
    );
  }

  if (text.length > 300) {
    return new Response(
      "Text too long",
      {
        status: 400,
      }
    );
  }

  const googleUrl =
    "https://translate.google.com/translate_tts" +
    `?ie=UTF-8` +
    `&client=tw-ob` +
    `&tl=vi` +
    `&q=${encodeURIComponent(text)}`;

  try {
    console.log(
      "[TTS] Request:",
      text
    );

    const response =
      await fetch(
        googleUrl,
        {
          method: "GET",
          headers: {
            Accept:
              "audio/mpeg,audio/*,*/*;q=0.8",

            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36",

            Referer:
              "https://translate.google.com/",
          },

          cache: "no-store",
        }
      );

    if (!response.ok) {
      const body =
        await response.text().catch(
          () => ""
        );

      console.error(
        "[TTS] Google HTTP error:",
        response.status,
        body
      );

      return new Response(
        "Google TTS HTTP error",
        {
          status: 502,
        }
      );
    }

    const contentType =
      response.headers.get(
        "content-type"
      ) ?? "";

    console.log(
      "[TTS] Google content-type:",
      contentType
    );

    const buffer =
      await response.arrayBuffer();

    if (!buffer.byteLength) {
      return new Response(
        "Google returned empty audio",
        {
          status: 502,
        }
      );
    }

    return new Response(
      buffer,
      {
        status: 200,
        headers: {
          "Content-Type":
            "audio/mpeg",

          "Content-Length":
            String(buffer.byteLength),

          "Cache-Control":
            "no-store, no-cache, must-revalidate",

          Pragma: "no-cache",

          "X-TTS-Provider":
            "Google Translate",
        },
      }
    );
  } catch (error) {
    console.error(
      "[TTS] Fetch failed:",
      error
    );

    return new Response(
      "Google TTS fetch failed",
      {
        status: 502,
      }
    );
  }
}
