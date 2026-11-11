export type PhotoProgress = { completed: number; total: number };

/** A new URL avoids reusing images saved by the former public, immutable cache policy. */
export function photoSource(id: string, index = 0, collection: "issues" | "roomInspections" = "issues") {
  return `/api/photos/${encodeURIComponent(id)}?index=${index}&collection=${collection}&v=2`;
}

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Impossible de lire la photo. Réessayez avec une autre image."));
    reader.onabort = () => reject(new Error("La préparation de la photo a été interrompue."));
    reader.readAsDataURL(blob);
  });
}

function encodeJpeg(canvas: HTMLCanvasElement, quality: number): Promise<string> {
  return new Promise<Blob>((resolve, reject) => {
    // Encoding asynchronously avoids repeated blocking toDataURL calls on phones.
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Impossible de préparer la photo.")), "image/jpeg", quality);
  }).then(blobDataUrl);
}

export async function compressPhoto(file: File, compact = false): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choisissez une photo.");
  if (file.size > 20 * 1024 * 1024) throw new Error("La photo dépasse 20 Mo.");
  const url = URL.createObjectURL(file);
  const image = new Image();
  const canvas = document.createElement("canvas");
  try {
    image.src = url;
    try { await image.decode(); }
    catch { throw new Error("Format non reconnu. Utilisez une photo JPEG, PNG ou WebP."); }
    const width = image.naturalWidth, height = image.naturalHeight;
    if (!width || !height) throw new Error("Cette photo est vide ou illisible.");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Impossible de préparer la photo.");
    const maxLength = compact ? 500_000 : 2_800_000;
    let edge = compact ? 1280 : 1600;

    // Keep the highest useful quality, then reduce dimensions if a detailed
    // camera photo still exceeds the saved-entry limit. Never upscale an image.
    for (let resize = 0; resize < 4; resize++) {
      const ratio = Math.min(1, edge / Math.max(width, height));
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.82, 0.7, 0.55]) {
        const photo = await encodeJpeg(canvas, quality);
        if (photo.length <= maxLength) return photo;
      }
      edge = Math.round(edge * 0.8);
    }
    throw new Error("Photo trop volumineuse. Choisissez une image plus petite.");
  } finally {
    image.removeAttribute("src");
    canvas.width = canvas.height = 1;
    URL.revokeObjectURL(url);
  }
}

/** Only one full-resolution image is decoded at a time, especially on phones. */
export async function preparePhotos(files: File[], onProgress?: (progress: PhotoProgress) => void): Promise<string[]> {
  const photos: string[] = [];
  onProgress?.({ completed: 0, total: files.length });
  for (const file of files) {
    photos.push(await compressPhoto(file, true));
    onProgress?.({ completed: photos.length, total: files.length });
  }
  return photos;
}

/** Revalidate private cached bytes; never bypass authentication or cache publicly. */
export async function loadPhotoData(source: string): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(source, { cache: "no-cache", signal: controller.signal });
      if (response.ok) return await blobDataUrl(await response.blob());
      // Retrying a missing photo or an expired session only delays the export.
      if (response.status < 500 && response.status !== 408 && response.status !== 429) return null;
    } catch { /* A single short retry covers a transient connection failure. */ }
    finally { clearTimeout(timeout); }
    if (!attempt) await new Promise(resolve => setTimeout(resolve, 600));
  }
  return null;
}
