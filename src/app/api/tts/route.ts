import { NextRequest } from "next/server";

// Dùng endpoint TTS không chính thức của Google Translate — miễn phí, không
// cần API key, nhưng KHÔNG được Google hỗ trợ/tài liệu hoá chính thức nên có
// thể bị chặn/giới hạn bất kỳ lúc nào. Frontend (TV Display) sẽ tự chuyển
// sang giọng thu sẵn (espeak) nếu route này lỗi — xem buildAnnouncementClips
// trong src/app/tv/[branchCode]/page.tsx.
export async function GET(req: NextRequest) {
  const text = req.nextUrl.searchParams.get("text");
  if (!text || text.length > 200) {
    return new Response("Missing or too-long text", { status: 400 });
  }

  const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(
    text
  )}&tl=vi&client=tw-ob`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Referer: "https://translate.google.com/",
      },
    });

    const contentType = res.headers.get("content-type") ?? "";
    if (!res.ok || !contentType.includes("audio")) {
      return new Response("Google TTS unavailable", { status: 502 });
    }

    const audioBuffer = await res.arrayBuffer();
    return new Response(audioBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return new Response("Google TTS fetch failed", { status: 502 });
  }
}
