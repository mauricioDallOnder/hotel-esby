export async function compressPhoto(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choisissez une photo.");
  if (file.size > 20 * 1024 * 1024) throw new Error("La photo dépasse 20 Mo.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
    } catch {
      throw new Error(
        "Format non reconnu. Utilisez une photo JPEG, PNG ou WebP."
      );
    }
    const ratio = Math.min(1, 1600 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.width * ratio);
    canvas.height = Math.round(image.height * ratio);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Impossible de préparer la photo.");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let photo = canvas.toDataURL("image/jpeg", 0.8);
    if (photo.length > 2_800_000) photo = canvas.toDataURL("image/jpeg", 0.55);
    if (photo.length > 2_800_000)
      throw new Error(
        "Photo trop volumineuse. Choisissez une image plus petite."
      );
    return photo;
  } finally {
    URL.revokeObjectURL(url);
  }
}
