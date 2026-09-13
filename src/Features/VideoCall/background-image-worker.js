/**
 * One-shot worker for uploaded background images, separate from segmentation.
 * Input: {file, maxDimension}. Output: transferable {image}, or {error}.
 * This resizes only the uploaded background, never the camera/person frame.
 * Caller terminates the worker after completion; receiver owns the bitmap.
 */
self.onmessage = async ({data: {file, maxDimension}}) => {
  let image;
  try {
    image = await createImageBitmap(file, {imageOrientation: "from-image"});
    const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
    if (scale < 1) {
      const resized = await createImageBitmap(image, {
        resizeWidth: Math.max(1, Math.round(image.width * scale)),
        resizeHeight: Math.max(1, Math.round(image.height * scale)),
        resizeQuality: "medium",
      });
      image.close();
      image = resized;
    }
    self.postMessage({image}, [image]);
    image = null; // Ownership transfers to the effect engine on the main thread.
  } catch (error) {
    self.postMessage({error: String(error.message ?? error)});
  } finally {
    image?.close();
  }
};
