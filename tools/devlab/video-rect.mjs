// Visible image rectangle for object-fit:contain; touch and marker use the same mapping.
export function containedRect(box, width, height) {
  const scale = Math.min(box.width / width, box.height / height);
  const w = width * scale,
    h = height * scale;
  return {
    left: box.left + (box.width - w) / 2,
    top: box.top + (box.height - h) / 2,
    width: w,
    height: h,
  };
}
