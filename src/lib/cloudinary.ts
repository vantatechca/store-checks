import { v2 as cloudinary } from "cloudinary";

let configured = false;

function ensureConfigured(): boolean {
  if (configured) return true;
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, CLOUDINARY_URL } = process.env;
  if (CLOUDINARY_URL) {
    configured = true; // SDK reads CLOUDINARY_URL automatically
    return true;
  }
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) return false;
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });
  configured = true;
  return true;
}

/** Upload an error screenshot to Cloudinary. Returns the public https URL, or null on failure. */
export async function uploadScreenshot(png: Buffer, domain: string): Promise<string | null> {
  if (!ensureConfigured()) {
    console.warn("[cloudinary] not configured — skipping screenshot upload");
    return null;
  }
  try {
    const publicId = `${domain.replace(/[^a-z0-9.-]/gi, "_")}-${Date.now()}`;
    const result = await new Promise<{ secure_url: string }>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: "store-checks", public_id: publicId, resource_type: "image", overwrite: true },
        (err, res) => (err || !res ? reject(err) : resolve(res))
      );
      stream.end(png);
    });
    return result.secure_url;
  } catch (err) {
    console.error(`[cloudinary] upload failed for ${domain}:`, err);
    return null;
  }
}
