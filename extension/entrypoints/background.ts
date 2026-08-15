export default defineBackground(() => {
  // Capture runs on demand via scripting.executeScript from the popup, so
  // there's no persistent listener reading pages in the background. Keeping it
  // that way is a deliberate privacy choice, not an oversight — an extension
  // that can spend money should read as little as it can get away with.
  console.log("Auravis background ready");
});
