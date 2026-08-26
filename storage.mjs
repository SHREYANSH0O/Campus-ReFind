import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = String(process.env.SUPABASE_URL || "").trim();
const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

if (!supabaseUrl) {
  throw new Error("SUPABASE_URL is required.");
}

if (!serviceRoleKey) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY is required.");
}

export const storageBucket = String(process.env.SUPABASE_STORAGE_BUCKET || "campus-refind-images").trim() || "campus-refind-images";
export const validImageTypes = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

let bucketReadyPromise;

function isMissingBucket(error) {
  return Boolean(
    error && (
      Number(error.statusCode || error.status || 0) === 404
      || /not found|does not exist/i.test(String(error.message || ""))
    ),
  );
}

export async function ensureStorageBucket() {
  if (bucketReadyPromise) return bucketReadyPromise;
  bucketReadyPromise = (async () => {
    const { data, error } = await supabase.storage.getBucket(storageBucket);
    if (error && !isMissingBucket(error)) {
      throw new Error(`Could not read Supabase storage bucket: ${error.message}`);
    }

    if (!data) {
      const { error: createError } = await supabase.storage.createBucket(storageBucket, {
        public: true,
        allowedMimeTypes: [...validImageTypes.keys()],
        fileSizeLimit: "5MB",
      });
      if (createError && !/already exists/i.test(String(createError.message || ""))) {
        throw new Error(`Could not create Supabase storage bucket: ${createError.message}`);
      }
      return;
    }

    if (!data.public) {
      const { error: updateError } = await supabase.storage.updateBucket(storageBucket, {
        public: true,
        allowedMimeTypes: [...validImageTypes.keys()],
        fileSizeLimit: "5MB",
      });
      if (updateError) {
        throw new Error(`Could not update Supabase storage bucket: ${updateError.message}`);
      }
    }
  })().catch((error) => {
    bucketReadyPromise = null;
    throw error;
  });
  return bucketReadyPromise;
}

export async function saveImage(file) {
  if (!file || typeof file.arrayBuffer !== "function" || !file.size) return null;
  if (file.size > 5 * 1024 * 1024) throw new Error("Images must be 5 MB or smaller.");
  const extension = validImageTypes.get(file.type);
  if (!extension) throw new Error("Upload a JPG, PNG, or WEBP image.");

  await ensureStorageBucket();

  const path = `reports/${Date.now()}-${randomBytes(9).toString("hex")}${extension}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error } = await supabase.storage.from(storageBucket).upload(path, buffer, {
    cacheControl: "3600",
    contentType: file.type,
    upsert: false,
  });
  if (error) {
    throw new Error(`Could not upload image: ${error.message}`);
  }
  return path;
}

export function imagePublicUrl(path) {
  if (!path) return null;
  const { data } = supabase.storage.from(storageBucket).getPublicUrl(path);
  return data.publicUrl;
}
