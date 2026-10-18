import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { config } from "@socialpilot/core";

const FFMPEG = () => config.FFMPEG_PATH || "ffmpeg";
const FFPROBE = () => config.FFPROBE_PATH || "ffprobe";

function run(bin: string, args: string[], timeoutMs = 15 * 60_000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      p.kill("SIGKILL");
      reject(new Error(`${path.basename(bin)} timed out`));
    }, timeoutMs);
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr = (stderr + d).slice(-20000)));
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`Could not start ${bin}: ${e.message}. Install FFmpeg or set FFMPEG_PATH/FFPROBE_PATH.`));
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path.basename(bin)} exited with code ${code}: ${stderr.split("\n").slice(-6).join(" ").trim()}`));
    });
  });
}

export async function ffmpegAvailable(): Promise<{ ffmpeg: boolean; version?: string }> {
  try {
    const { stdout } = await run(FFMPEG(), ["-version"], 10000);
    return { ffmpeg: true, version: stdout.split("\n")[0] };
  } catch {
    return { ffmpeg: false };
  }
}

export interface ProbeInfo {
  durationSec: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

export async function probe(file: string): Promise<ProbeInfo> {
  const { stdout } = await run(FFPROBE(), ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], 60000);
  const j = JSON.parse(stdout);
  const v = (j.streams ?? []).find((s: any) => s.codec_type === "video");
  return {
    durationSec: Number(j.format?.duration ?? v?.duration ?? 0),
    width: Number(v?.width ?? 0),
    height: Number(v?.height ?? 0),
    hasAudio: (j.streams ?? []).some((s: any) => s.codec_type === "audio"),
  };
}

/** Runs fn inside a temp directory that is always removed. */
export async function withTemp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "socialpilot-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const ASPECTS: Record<string, [number, number]> = { "9:16": [1080, 1920], "1:1": [1080, 1080], "16:9": [1920, 1080], "4:5": [1080, 1350] };
const ENCODE = ["-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-movflags", "+faststart"];

/** Escapes a path for use inside an ffmpeg filter argument (subtitles=...). */
function filterPath(p: string) {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

export async function probeBuffer(data: Buffer, ext = "mp4"): Promise<ProbeInfo> {
  return withTemp(async (dir) => {
    const f = path.join(dir, `in.${ext}`);
    await writeFile(f, data);
    return probe(f);
  });
}

export async function trimVideo(data: Buffer, start: number, end: number): Promise<Buffer> {
  return withTemp(async (dir) => {
    const inp = path.join(dir, "in.mp4");
    const out = path.join(dir, "out.mp4");
    await writeFile(inp, data);
    await run(FFMPEG(), ["-y", "-ss", String(start), "-to", String(end), "-i", inp, ...ENCODE, "-c:a", "aac", out]);
    return readFile(out);
  });
}

export async function reframeVideo(data: Buffer, aspect: keyof typeof ASPECTS, mode: "crop" | "pad"): Promise<Buffer> {
  const [w, h] = ASPECTS[aspect];
  const vf =
    mode === "crop"
      ? `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1`
      : `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
  return withTemp(async (dir) => {
    const inp = path.join(dir, "in.mp4");
    const out = path.join(dir, "out.mp4");
    await writeFile(inp, data);
    await run(FFMPEG(), ["-y", "-i", inp, "-vf", vf, ...ENCODE, "-c:a", "aac", out]);
    return readFile(out);
  });
}

export async function burnSubtitles(data: Buffer, srt: string): Promise<Buffer> {
  return withTemp(async (dir) => {
    const inp = path.join(dir, "in.mp4");
    const sub = path.join(dir, "subs.srt");
    const out = path.join(dir, "out.mp4");
    await writeFile(inp, data);
    await writeFile(sub, srt, "utf8");
    const style = "FontName=Arial,FontSize=14,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=1,Outline=2,Shadow=0,MarginV=40";
    await run(FFMPEG(), ["-y", "-i", inp, "-vf", `subtitles='${filterPath(sub)}':force_style='${style}'`, ...ENCODE, "-c:a", "copy", out]);
    return readFile(out);
  });
}

export async function extractAudio(data: Buffer): Promise<Buffer> {
  return withTemp(async (dir) => {
    const inp = path.join(dir, "in.mp4");
    const out = path.join(dir, "audio.mp3");
    await writeFile(inp, data);
    await run(FFMPEG(), ["-y", "-i", inp, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", out]);
    return readFile(out);
  });
}

/** Normalizes every clip to the first clip's frame size, adds silent audio where missing, then concatenates. */
export async function concatVideos(clips: Buffer[]): Promise<Buffer> {
  return withTemp(async (dir) => {
    const normalized: string[] = [];
    let target: [number, number] | null = null;
    for (let i = 0; i < clips.length; i++) {
      const inp = path.join(dir, `c${i}.mp4`);
      await writeFile(inp, clips[i]);
      const info = await probe(inp);
      if (!target) target = [info.width - (info.width % 2), info.height - (info.height % 2)];
      const [w, h] = target;
      const out = path.join(dir, `n${i}.mp4`);
      const vf = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1`;
      const args = info.hasAudio
        ? ["-y", "-i", inp, "-vf", vf, ...ENCODE, "-c:a", "aac", "-ar", "44100", "-ac", "2", out]
        : ["-y", "-i", inp, "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-vf", vf, "-shortest", ...ENCODE, "-c:a", "aac", "-ar", "44100", "-ac", "2", out];
      await run(FFMPEG(), args);
      normalized.push(out);
    }
    const list = path.join(dir, "list.txt");
    await writeFile(list, normalized.map((n) => `file '${n.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n"));
    const out = path.join(dir, "out.mp4");
    await run(FFMPEG(), ["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", out]);
    return readFile(out);
  });
}

export async function videoThumbnail(data: Buffer, at: number): Promise<Buffer> {
  return withTemp(async (dir) => {
    const inp = path.join(dir, "in.mp4");
    const out = path.join(dir, "thumb.jpg");
    await writeFile(inp, data);
    await run(FFMPEG(), ["-y", "-ss", String(at), "-i", inp, "-frames:v", "1", "-q:v", "2", out]);
    return readFile(out);
  });
}

export async function compressVideo(data: Buffer, crf: number): Promise<Buffer> {
  return withTemp(async (dir) => {
    const inp = path.join(dir, "in.mp4");
    const out = path.join(dir, "out.mp4");
    await writeFile(inp, data);
    await run(FFMPEG(), ["-y", "-i", inp, "-c:v", "libx264", "-preset", "medium", "-crf", String(crf), "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-c:a", "aac", "-b:a", "128k", out]);
    return readFile(out);
  });
}

/** Builds a slideshow video from still images (used for storyboards → animatic). */
export async function imagesToVideo(images: Buffer[], secondsPer: number, aspect: keyof typeof ASPECTS = "9:16"): Promise<Buffer> {
  const [w, h] = ASPECTS[aspect];
  return withTemp(async (dir) => {
    const parts: string[] = [];
    for (let i = 0; i < images.length; i++) {
      const img = path.join(dir, `i${i}.png`);
      await writeFile(img, images[i]);
      const out = path.join(dir, `p${i}.mp4`);
      await run(FFMPEG(), [
        "-y",
        "-loop",
        "1",
        "-t",
        String(secondsPer),
        "-i",
        img,
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=44100:cl=stereo",
        "-vf",
        `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1`,
        "-shortest",
        ...ENCODE,
        "-c:a",
        "aac",
        out,
      ]);
      parts.push(out);
    }
    const list = path.join(dir, "list.txt");
    await writeFile(list, parts.map((n) => `file '${n.replace(/\\/g, "/")}'`).join("\n"));
    const out = path.join(dir, "out.mp4");
    await run(FFMPEG(), ["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", out]);
    return readFile(out);
  });
}
