document.addEventListener("DOMContentLoaded", async () => {
  const ticketList = document.querySelector("#ticket-list");
  if (!ticketList) return;

  const appendLine = (container, content) => {
    if (container.childNodes.length) container.append(document.createElement("br"));
    container.append(content);
  };

  const formatDate = (isoDate) => {
    const date = new Date(`${isoDate}T12:00:00`);
    if (Number.isNaN(date.getTime())) return isoDate;

    const formatted = new Intl.DateTimeFormat("es-AR", {
      weekday: "long",
      day: "numeric",
      month: "long"
    }).format(date);

    const withoutComma = formatted.replace(",", "");
    return withoutComma.charAt(0).toUpperCase() + withoutComma.slice(1);
  };

  const safeWebUrl = (value) => {
    if (!value) return "";
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
    } catch {
      return "";
    }
  };

  const createTicketCard = (item) => {
    const card = document.createElement("article");
    card.className = `ticket-card${item.imagen ? "" : " without-image"}`;

    const info = document.createElement("div");
    info.className = "ticket-info";

    if (item.etiqueta) {
      const kicker = document.createElement("div");
      kicker.className = "kicker";
      kicker.textContent = item.etiqueta;
      info.append(kicker);
    }

    const title = document.createElement("h2");
    title.textContent = item.titulo;
    info.append(title);

    const details = document.createElement("p");
    const address = [item.direccion, item.ciudad].filter(Boolean).join(", ");
    appendLine(details, [item.lugar, address].filter(Boolean).join(" · "));
    appendLine(details, [formatDate(item.fecha), item.hora].filter(Boolean).join(" · "));

    if (item.detalle) appendLine(details, item.detalle);

    const mapUrl = safeWebUrl(item.mapaUrl);
    if (mapUrl) {
      const mapLink = document.createElement("a");
      mapLink.href = mapUrl;
      mapLink.target = "_blank";
      mapLink.rel = "noopener";
      mapLink.textContent = "📍 Ver en Google Maps";
      appendLine(details, mapLink);
    }

    const ticketsUrl = safeWebUrl(item.entradasUrl);
    if (!ticketsUrl && item.entradasTexto) {
      appendLine(details, item.entradasTexto);
    }

    info.append(details);

    if (ticketsUrl) {
      const ticketsLink = document.createElement("a");
      ticketsLink.className = "button";
      ticketsLink.href = ticketsUrl;
      ticketsLink.target = "_blank";
      ticketsLink.rel = "noopener";
      ticketsLink.textContent = item.entradasTexto || "Comprar entradas";
      info.append(ticketsLink);
    }

    card.append(info);

    if (item.imagen) {
      const imageWrapper = document.createElement("div");
      imageWrapper.className = "ticket-image";
      const image = document.createElement("img");
      image.src = item.imagen;
      image.alt = item.imagenAlt || "";
      imageWrapper.append(image);
      card.append(imageWrapper);
    }

    return card;
  };

  ticketList.setAttribute("aria-busy", "true");

  try {
    const response = await fetch("data/entradas.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`No se pudo cargar la cartelera (${response.status})`);

    const data = await response.json();
    if (!Array.isArray(data.funciones)) throw new Error("El archivo de cartelera no es válido");

    const cards = [...data.funciones]
      .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.hora.localeCompare(b.hora))
      .map(createTicketCard);

    if (cards.length) {
      ticketList.replaceChildren(...cards);
    } else {
      const message = document.createElement("p");
      message.className = "ticket-message";
      message.textContent = "Pronto anunciaremos nuevas funciones.";
      ticketList.replaceChildren(message);
    }
  } catch (error) {
    console.error(error);
    const message = document.createElement("p");
    message.className = "ticket-message";
    message.textContent = "No pudimos cargar las próximas funciones. Probá nuevamente en unos minutos.";
    ticketList.replaceChildren(message);
  } finally {
    ticketList.removeAttribute("aria-busy");
  }
});
