document.addEventListener("DOMContentLoaded", async () => {
  const timeline = document.querySelector(".timeline");
  if (!timeline) return;

  const createRow = ({ fecha, lugar, obra }) => {
    const row = document.createElement("div");
    row.className = "timeline-row";

    const date = document.createElement("div");
    date.className = "timeline-date";
    date.textContent = formatDate(fecha);

    const place = document.createElement("div");
    place.className = "timeline-place";
    place.textContent = lugar;

    const film = document.createElement("div");
    film.className = "timeline-film";
    film.textContent = obra;

    row.append(date, place, film);
    return row;
  };

  const formatDate = (isoDate) => {
    const [year, month, day] = isoDate.split("-");
    return `${day}/${month}/${year}`;
  };

  timeline.setAttribute("aria-busy", "true");

  try {
    const response = await fetch("data/trayectoria.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`No se pudo cargar la trayectoria (${response.status})`);

    const data = await response.json();
    if (!Array.isArray(data.funciones)) throw new Error("El archivo de trayectoria no es válido");

    const rows = [...data.funciones]
      .sort((a, b) => b.fecha.localeCompare(a.fecha))
      .map(createRow);

    timeline.replaceChildren(...rows);
  } catch (error) {
    console.error(error);
    const message = document.createElement("p");
    message.className = "timeline-message";
    message.textContent = "No pudimos cargar la trayectoria. Probá nuevamente en unos minutos.";
    timeline.replaceChildren(message);
  } finally {
    timeline.removeAttribute("aria-busy");
  }
});
