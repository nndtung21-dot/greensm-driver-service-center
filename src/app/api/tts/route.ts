import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest
) {
  const text =
    req.nextUrl.searchParams.get(
      "text"
    );

  if (!text) {
    return new Response(
      "Missing text",
      {
        status: 400,
      }
    );
  }

  if (text.length > 250) {
    return new Response(
      "Text too long",
      {
        status: 400,
      }
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
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36",
          Accept:
            "audio/mpeg,audio/*,*/*",
          Referer:
            "https://translate.google.com/",
        },
        cache: "no-store",
      });

    if (!response.ok) {
      console.error(
        "[TTS] Google HTTP",
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
      response.headers.get(
        "content-type"
      ) ?? "";

    if (
      !contentType.includes(
        "audio"
      )
    ) {
      console.error(
        "[TTS] Not audio:",
        contentType
      );

      return new Response(
        "Google did not return audio",
        {
          status: 502,
        }
      );
    }

    const buffer =
      await response.arrayBuffer();

    if (!buffer.byteLength) {
      return new Response(
        "Empty audio",
        {
          status: 502,
        }
      );
    }

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "audio/mpeg",
        "Content-Length":
          String(
            buffer.byteLength
          ),
        "Cache-Control":
          "no-store, no-cache, must-revalidate",
      },
    });
  } catch (error) {
    console.error(
      "[TTS] Fetch failed",
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
