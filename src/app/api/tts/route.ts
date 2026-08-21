import { NextRequest } from "next/server";

export async function GET(
  req: NextRequest
) {
  const text =
    req.nextUrl.searchParams.get(
      "text"
    );

  if (
    !text ||
    text.trim().length === 0
  ) {
    return new Response(
      "Missing text",
      { status: 400 }
    );
  }

  if (text.length > 300) {
    return new Response(
      "Text too long",
      { status: 400 }
    );
  }

  const url =
    `https://translate.google.com/translate_tts` +
    `?ie=UTF-8` +
    `&q=${encodeURIComponent(text)}` +
    `&tl=vi` +
    `&client=tw-ob`;

  try {
    const response =
      await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
          Referer:
            "https://translate.google.com/",
          Accept:
            "audio/mpeg,audio/*,*/*;q=0.8",
        },
        cache: "no-store",
      });

    const contentType =
      response.headers.get(
        "content-type"
      ) ?? "";

    if (
      !response.ok ||
      !contentType.includes(
        "audio"
      )
    ) {
      console.error(
        "[TTS] Google response:",
        {
          status:
            response.status,
          contentType,
        }
      );

      return new Response(
        "Google TTS unavailable",
        { status: 502 }
      );
    }

    const audio =
      await response.arrayBuffer();

    if (
      audio.byteLength === 0
    ) {
      return new Response(
        "Google TTS returned empty audio",
        { status: 502 }
      );
    }

    return new Response(
      audio,
      {
        status: 200,
        headers: {
          "Content-Type":
            "audio/mpeg",
          "Content-Length":
            String(
              audio.byteLength
            ),
          "Cache-Control":
            "no-store, max-age=0",
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
      { status: 502 }
    );
  }
}
