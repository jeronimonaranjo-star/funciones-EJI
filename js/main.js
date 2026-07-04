
document.addEventListener("DOMContentLoaded", () => {
  const items = document.querySelectorAll("[data-lightbox]");
  const box = document.querySelector(".lightbox");
  const img = document.querySelector(".lightbox img");
  const close = document.querySelector(".lightbox-close");

  if (!box || !img || !close) return;

  items.forEach(item => {
    item.addEventListener("click", () => {
      const src = item.getAttribute("data-lightbox");
      const alt = item.querySelector("img")?.alt || "";
      img.src = src;
      img.alt = alt;
      box.classList.add("open");
    });
  });

  const closeBox = () => {
    box.classList.remove("open");
    img.src = "";
  };

  close.addEventListener("click", closeBox);
  box.addEventListener("click", (e) => {
    if (e.target === box) closeBox();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeBox();
  });
});
