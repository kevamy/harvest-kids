/**
 * Reduces a camera photo in the browser before it is sent: 1000 px at most, JPEG. A
 * tablet photo (several MB) then fits well within the Server Action limit (3 MB per
 * request); the server reduces it again to 600 px WebP.
 */
export async function reduirePhoto(fichier: File, coteMax = 1000): Promise<Blob> {
  const image = await createImageBitmap(fichier, { imageOrientation: "from-image" });
  const echelle = Math.min(1, coteMax / Math.max(image.width, image.height));
  const canevas = document.createElement("canvas");
  canevas.width = Math.round(image.width * echelle);
  canevas.height = Math.round(image.height * echelle);
  canevas.getContext("2d")!.drawImage(image, 0, 0, canevas.width, canevas.height);
  image.close();
  return new Promise((resoudre, rejeter) =>
    canevas.toBlob(
      (blob) => (blob ? resoudre(blob) : rejeter(new Error("Photo illisible."))),
      "image/jpeg",
      0.85,
    ),
  );
}
