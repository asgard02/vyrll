/** Off-screen chip used as the drag image. Removed by the caller on dragend. */
export function mountReuseDragPreview(title: string, thumb: string | null): HTMLDivElement {
  const preview = document.createElement("div");
  preview.setAttribute("aria-hidden", "true");
  preview.style.cssText = [
    "position:fixed",
    "left:-9999px",
    "top:0",
    "display:flex",
    "align-items:center",
    "gap:8px",
    "max-width:220px",
    "padding:6px 10px 6px 6px",
    "border-radius:12px",
    "border:1px solid var(--border)",
    "background:var(--card)",
    "color:var(--foreground)",
    "font:500 13px/1.2 system-ui,sans-serif",
    "box-shadow:0 8px 20px rgba(16,14,14,0.16)",
    "pointer-events:none",
  ].join(";");

  if (thumb) {
    const img = document.createElement("img");
    img.src = thumb;
    img.alt = "";
    img.draggable = false;
    img.style.cssText = "width:64px;height:36px;object-fit:cover;border-radius:8px;flex:none;";
    preview.appendChild(img);
  }

  const label = document.createElement("span");
  label.textContent = title;
  label.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
  preview.appendChild(label);
  document.body.appendChild(preview);
  return preview;
}
