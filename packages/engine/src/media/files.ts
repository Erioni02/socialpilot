import path from "node:path/posix";
import { prisma, type Asset, type Project } from "@socialpilot/db";
import { badRequest, notFound } from "@socialpilot/core";
import { addVersion, createAsset, loadAsset } from "./service";

/**
 * The AI's own file space: plain-text files (notes, plans, copy, scripts, JSON, CSV, HTML drafts...) stored as
 * versioned document assets under /workspace. Humans see and edit the same files in the AI Workspace.
 */
export const WORKSPACE_ROOT = "/workspace";
const MAX_BYTES = 2 * 1024 * 1024;

const MIME: Record<string, string> = { ".md": "text/markdown", ".json": "application/json", ".srt": "application/x-subrip" };
// Everything else (txt, csv, html, css, js, yaml…) is stored and served as text/plain so it can never execute in the app.
const mimeFor = (name: string) => MIME[path.extname(name).toLowerCase()] ?? "text/plain";

export function normalizeFilePath(raw: string): { folder: string; name: string; full: string } {
  let p = raw.trim().replace(/\\/g, "/");
  if (p.split("/").includes("..")) throw badRequest(`Invalid path ${raw} (".." is not allowed)`);
  if (!p.startsWith("/")) p = `${WORKSPACE_ROOT}/${p}`;
  const full = path.normalize(p);
  if (full.includes("..") || !full.startsWith("/")) throw badRequest(`Invalid path ${raw}`);
  const name = path.basename(full);
  if (!name || name.length > 150 || !/^[\w.\- ()]+$/.test(name)) throw badRequest(`Invalid file name "${name}" (letters, numbers, . - _ space only)`);
  const folder = path.dirname(full);
  return { folder: folder === "." ? "/" : folder, name, full };
}

async function findFile(projectId: string, raw: string): Promise<Asset | null> {
  const { folder, name } = normalizeFilePath(raw);
  return prisma.asset.findFirst({ where: { projectId, folder, name, kind: "document" }, orderBy: { updatedAt: "desc" } });
}

export async function listFiles(projectId: string, prefix = WORKSPACE_ROOT) {
  const p = prefix.startsWith("/") ? prefix : `${WORKSPACE_ROOT}/${prefix}`;
  const files = await prisma.asset.findMany({
    where: { projectId, kind: "document", folder: { startsWith: p.replace(/\/$/, "") || "/" }, NOT: { folder: { startsWith: "/trash" } } },
    orderBy: [{ folder: "asc" }, { name: "asc" }],
    take: 500,
    include: { versions: { orderBy: { version: "desc" }, take: 1, select: { version: true, sizeBytes: true, createdBy: true, createdAt: true } } },
  });
  return files.map((f) => ({ assetId: f.id, path: `${f.folder === "/" ? "" : f.folder}/${f.name}`, size: f.versions[0]?.sizeBytes ?? 0, version: f.versions[0]?.version ?? 0, lastEditedBy: f.versions[0]?.createdBy, updatedAt: f.updatedAt }));
}

export async function readFile(projectId: string, raw: string) {
  const f = await findFile(projectId, raw);
  if (!f) throw notFound(`File ${raw}`);
  const { data, version } = await loadAsset(f.id);
  return { assetId: f.id, path: normalizeFilePath(raw).full, version: version.version, content: data.toString("utf8") };
}

export async function writeFile(project: Project, raw: string, content: string, createdBy: string, mode: "overwrite" | "append" = "overwrite") {
  const { folder, name, full } = normalizeFilePath(raw);
  const existing = await findFile(project.id, full);
  let text = content;
  if (mode === "append" && existing) text = (await loadAsset(existing.id)).data.toString("utf8") + content;
  const data = Buffer.from(text, "utf8");
  if (data.length > MAX_BYTES) throw badRequest("Files are limited to 2 MB");
  const meta = { operation: existing ? (mode === "append" ? "append" : "edit") : "create", params: { path: full }, createdBy };
  if (existing) {
    const v = await addVersion(existing, data, mimeFor(name), meta);
    return { assetId: existing.id, path: full, version: v.version, bytes: data.length };
  }
  const r = await createAsset(project.id, { name, kind: "document", folder, source: createdBy === "user" ? "upload" : "agent", createdBy }, data, mimeFor(name), meta);
  return { assetId: r.asset.id, path: full, version: r.version.version, bytes: data.length };
}

/** Edits a document asset by id (used by the human editor in the Workspace). */
export async function writeAssetText(project: Project, assetId: string, content: string, createdBy: string) {
  const a = await prisma.asset.findFirst({ where: { id: assetId, projectId: project.id } });
  if (!a) throw notFound("Asset");
  if (a.kind !== "document") throw badRequest("Only text documents can be edited as text");
  const data = Buffer.from(content, "utf8");
  if (data.length > MAX_BYTES) throw badRequest("Files are limited to 2 MB");
  const v = await addVersion(a, data, mimeFor(a.name), { operation: "edit", params: {}, createdBy });
  return { assetId, version: v.version };
}

/** Moves a file to /trash (recoverable; every version is kept). */
export async function moveFile(projectId: string, from: string, to: string) {
  const f = await findFile(projectId, from);
  if (!f) throw notFound(`File ${from}`);
  const dest = normalizeFilePath(to.startsWith("/trash") ? to : to);
  if (await findFile(projectId, dest.full)) throw badRequest(`${dest.full} already exists`);
  await prisma.asset.update({ where: { id: f.id }, data: { folder: dest.folder, name: dest.name } });
  return { assetId: f.id, path: dest.full };
}

export async function trashFile(projectId: string, raw: string) {
  const { name } = normalizeFilePath(raw);
  return moveFile(projectId, raw, `/trash/${Date.now().toString(36)}-${name}`);
}
