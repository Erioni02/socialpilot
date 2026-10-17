import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/**
 * File storage: Supabase Storage when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set, otherwise local disk
 * under STORAGE_DIR. Files are always served back through the API (auth-checked), never via public URLs.
 */
export type Storage = {
  kind: "supabase" | "local";
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
};

const SAFE_KEY = /^[a-zA-Z0-9/_.-]+$/;
function checkKey(key: string) {
  if (!SAFE_KEY.test(key) || key.includes("..")) throw new Error(`Unsafe storage key: ${key}`);
}

function localStorage(root: string): Storage {
  const pathFor = (key: string) => {
    checkKey(key);
    return resolve(root, key);
  };
  return {
    kind: "local",
    async put(key, data) {
      const path = pathFor(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data);
    },
    async get(key) {
      return readFile(pathFor(key)).catch(() => null);
    }
  };
}

function supabaseStorage(client: SupabaseClient, bucket: string): Storage {
  return {
    kind: "supabase",
    async put(key, data, contentType) {
      checkKey(key);
      const { error } = await client.storage.from(bucket).upload(key, data, { contentType, upsert: true });
      if (error) throw new Error(`Supabase Storage upload failed: ${error.message}`);
    },
    async get(key) {
      checkKey(key);
      const { data, error } = await client.storage.from(bucket).download(key);
      if (error || !data) return null;
      return Buffer.from(await data.arrayBuffer());
    }
  };
}

let storage: Storage | null = null;

export function getStorage(): Storage {
  if (storage) return storage;
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_STORAGE_BUCKET, STORAGE_DIR } = process.env;
  storage =
    SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
      ? supabaseStorage(createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }), SUPABASE_STORAGE_BUCKET || "socialpilot")
      : localStorage(resolve(process.cwd(), STORAGE_DIR || "storage"));
  return storage;
}

/** Test helper. */
export function setStorage(next: Storage | null) {
  storage = next;
}
