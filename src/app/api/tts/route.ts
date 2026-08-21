import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const text = req.nextUrl.searchParams.get("text")?.trim();

  if (!text) {
    return new Response("Missing text", {
      status: 400,
    });
  }

  if (text.length > 300) {
    return new Response("Text too long", {
      status: 400,
    });
  }

  const url =
    `https://translate.google.com/translate_tts` +
    `?ie=UTF-8` +
    `&q=${encodeURIComponent(text)}` +
    `&tl=vi` +
    `&client=tw-ob`;

  try {
    const response = await fetch(url, {
      method: "GET",

      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
          "AppleWebKit/537.36 (KHTML, like Gecko) " +
          "Chrome/151.0.0.0 Safari/537.36",

        Accept:
          "audio/mpeg,audio/*;q=0.9,*/*;q=0.8",

        Referer:
          "https://translate.google.com/",
      },

      cache: "no-store",
    });

    if (!response.ok) {
      console.error(
        "[TTS] Google HTTP error:",
        response.status
      );

      return new Response(
        "Google TTS unavailable",
        {
          status: 502,
        }
      );
    }

    const contentType =
      response.headers.get("content-type") ?? "";

    if (
      !contentType.includes("audio") &&
      !contentType.includes("mpeg")
    ) {
      console.error(
        "[TTS] Invalid content type:",
        contentType
      );

      return new Response(
        "Google TTS returned non-audio",
        {
          status: 502,
        }
      );
    }

    const audioBuffer =
      await response.arrayBuffer();

    if (audioBuffer.byteLength === 0) {
      return new Response(
        "Google TTS returned empty audio",
        {
          status: 502,
        }
      );
    }

    return new Response(audioBuffer, {
      status: 200,

      headers: {
        "Content-Type": "audio/mpeg",

        "Content-Length":
          String(audioBuffer.byteLength),

        /*
         * Không cache tại browser trong lúc test.
         * Khi ổn định rồi mới cache.
         */
        "Cache-Control":
          "no-store, no-cache, must-revalidate",

        "Accept-Ranges": "bytes",
      },
    });
  } catch (error) {
    console.error(
      "[TTS] Google TTS fetch failed:",
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
