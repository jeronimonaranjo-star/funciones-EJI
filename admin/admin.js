(() => {
  "use strict";

  const repository = {
    owner: "jeronimonaranjo-star",
    name: "funciones-EJI",
    branch: "main"
  };

  const sectionConfigs = {
    trayectoria: {
      file: "data/trayectoria.json",
      commitMessage: "Actualiza trayectoria desde el editor web",
      savedMessage: "Trayectoria guardada. La página pública puede tardar uno o dos minutos en actualizarse."
    },
    entradas: {
      file: "data/entradas.json",
      commitMessage: "Actualiza cartelera desde el editor web",
      savedMessage: "Cartelera guardada. La página pública puede tardar uno o dos minutos en actualizarse."
    }
  };

  const states = {
    trayectoria: { sha: "", records: [], dirty: false },
    entradas: { sha: "", records: [], dirty: false }
  };

  const loginPanel = document.querySelector("#login-panel");
  const loginForm = document.querySelector("#login-form");
  const loginStatus = document.querySelector("#login-status");
  const tokenInput = document.querySelector("#access-token");
  const editorPanel = document.querySelector("#editor-panel");
  const connectionState = document.querySelector("#connection-state");
  const logoutButton = document.querySelector("#logout-button");
  const tabs = [...document.querySelectorAll("[data-section]")];
  const panels = [...document.querySelectorAll("[data-section-panel]")];

  const sectionElements = Object.fromEntries(Object.keys(sectionConfigs).map((key) => [key, {
    list: document.querySelector(`#${key}-list`),
    count: document.querySelector(`#${key}-count`),
    dirty: document.querySelector(`#${key}-dirty`),
    status: document.querySelector(`#${key}-status`),
    add: document.querySelector(`#${key}-add`),
    reload: document.querySelector(`#${key}-reload`),
    save: document.querySelector(`#${key}-save`)
  }]));

  let accessToken = "";
  let activeSection = "trayectoria";

  const setMessage = (element, message = "", type = "") => {
    element.textContent = message;
    element.className = `status-message${element === loginStatus ? " login-status" : ""}${type ? ` ${type}` : ""}`;
  };

  const setSectionMessage = (key, message = "", type = "") => {
    setMessage(sectionElements[key].status, message, type);
  };

  const setDirty = (key, value) => {
    states[key].dirty = value;
    sectionElements[key].dirty.hidden = !value;
  };

  const setBusy = (key, value) => {
    const elements = sectionElements[key];
    elements.save.disabled = value;
    elements.reload.disabled = value;
    elements.add.disabled = value;
  };

  const apiRequest = async (path, options = {}) => {
    let response;

    try {
      response = await fetch(`https://api.github.com${path}`, {
        ...options,
        cache: "no-store",
        headers: {
          "Accept": "application/vnd.github+json",
          "Authorization": `Bearer ${accessToken}`,
          "X-GitHub-Api-Version": "2022-11-28",
          ...(options.headers || {})
        }
      });
    } catch (error) {
      throw new Error("No se pudo conectar con GitHub. Revisá tu conexión e intentá nuevamente.", { cause: error });
    }

    if (!response.ok) {
      const details = await response.json().catch(() => ({}));
      const error = new Error(details.message || `Error ${response.status}`);
      error.status = response.status;
      throw error;
    }

    return response.json();
  };

  const decodeContent = (encoded) => {
    const binary = atob(encoded.replace(/\s/g, ""));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  };

  const encodeContent = (content) => {
    const bytes = new TextEncoder().encode(content);
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  };

  const localDate = () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const isValidDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T12:00:00`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };

  const isValidWebUrl = (value) => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  };

  const explainError = (error) => {
    if (error.status === 401) return "La clave no es válida o venció. Volvé a ingresar con una clave vigente.";
    if (error.status === 403) return "La clave no tiene permiso para editar este sitio. Revisá que tenga Contents: Read and write.";
    if (error.status === 404) return "No se encontró el archivo. Revisá que la clave tenga acceso al repositorio funciones-EJI y que los archivos editables ya estén publicados.";
    if (error.status === 409) return "Hay una versión más reciente de este archivo. No se guardó nada: volvé a cargar la sección y aplicá nuevamente tus cambios.";
    if (error.status === 422) return "GitHub rechazó el cambio. No se guardó nada; revisá los datos e intentá nuevamente.";
    return error.message || "Ocurrió un error inesperado. No se guardó ningún cambio.";
  };

  const sortRecords = (key) => {
    const direction = key === "trayectoria" ? -1 : 1;
    states[key].records.sort((a, b) => (
      direction * a.fecha.localeCompare(b.fecha) ||
      (a.hora || "").localeCompare(b.hora || "")
    ));
  };

  const normalizeRecord = (key, record = {}) => {
    if (key === "trayectoria") {
      return {
        fecha: String(record.fecha || ""),
        lugar: String(record.lugar || ""),
        obra: String(record.obra || "")
      };
    }

    return {
      fecha: String(record.fecha || ""),
      hora: String(record.hora || ""),
      titulo: String(record.titulo || ""),
      etiqueta: String(record.etiqueta || ""),
      lugar: String(record.lugar || ""),
      direccion: String(record.direccion || ""),
      ciudad: String(record.ciudad || ""),
      detalle: String(record.detalle || ""),
      mapaUrl: String(record.mapaUrl || ""),
      entradasUrl: String(record.entradasUrl || ""),
      entradasTexto: String(record.entradasTexto || ""),
      imagen: String(record.imagen || ""),
      imagenAlt: String(record.imagenAlt || "")
    };
  };

  const sanitizeRecords = (key) => states[key].records.map((record) => (
    Object.fromEntries(Object.entries(normalizeRecord(key, record)).map(([field, value]) => [field, value.trim()]))
  ));

  const updateCount = (key) => {
    const count = states[key].records.length;
    sectionElements[key].count.textContent = `${count} ${count === 1 ? "función" : "funciones"}`;
  };

  const createField = ({ key, index, labelText, name, value, type = "text", textarea = false, className = "" }) => {
    const wrapper = document.createElement("div");
    wrapper.className = `admin-field${className ? ` ${className}` : ""}`;

    const id = `${key}-${name}-${index}`;
    const label = document.createElement("label");
    label.htmlFor = id;
    label.textContent = labelText;

    const input = document.createElement(textarea ? "textarea" : "input");
    input.id = id;
    input.name = name;
    if (!textarea) input.type = type;
    input.value = value;
    input.autocomplete = "off";
    input.addEventListener("input", () => {
      states[key].records[index][name] = input.value;
      setDirty(key, true);
      setSectionMessage(key);
    });

    wrapper.append(label, input);
    return wrapper;
  };

  const createDeleteButton = (key, index, description) => {
    const button = document.createElement("button");
    button.className = "delete-button";
    button.type = "button";
    button.textContent = "Eliminar";
    button.setAttribute("aria-label", `Eliminar ${description}`);
    button.addEventListener("click", () => {
      if (!window.confirm(`¿Eliminar esta función?\n\n${description}`)) return;
      states[key].records.splice(index, 1);
      setDirty(key, true);
      setSectionMessage(key);
      renderSection(key);
    });
    return button;
  };

  const renderEmptyState = (key) => {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Todavía no hay funciones. Usá “Nueva función” para agregar la primera.";
    sectionElements[key].list.append(empty);
  };

  const renderTrayectoria = () => {
    const key = "trayectoria";
    const list = sectionElements[key].list;
    list.replaceChildren();

    states[key].records.forEach((item, index) => {
      const card = document.createElement("article");
      card.className = "trajectory-card";
      card.dataset.index = String(index);

      card.append(
        createField({ key, index, labelText: "Fecha", name: "fecha", value: item.fecha, type: "date" }),
        createField({ key, index, labelText: "Lugar", name: "lugar", value: item.lugar }),
        createField({ key, index, labelText: "Película / obra", name: "obra", value: item.obra, className: "wide" }),
        createDeleteButton(key, index, [item.fecha, item.lugar, item.obra].filter(Boolean).join(" · ") || `función ${index + 1}`)
      );

      list.append(card);
    });

    if (!states[key].records.length) renderEmptyState(key);
  };

  const renderEntradas = () => {
    const key = "entradas";
    const list = sectionElements[key].list;
    list.replaceChildren();

    states[key].records.forEach((item, index) => {
      const card = document.createElement("article");
      card.className = "ticket-editor-card";
      card.dataset.index = String(index);

      const heading = document.createElement("div");
      heading.className = "record-heading";
      const headingText = document.createElement("strong");
      headingText.textContent = `Función ${index + 1}${item.titulo ? ` · ${item.titulo}` : ""}`;
      heading.append(
        headingText,
        createDeleteButton(key, index, [item.fecha, item.titulo, item.lugar].filter(Boolean).join(" · ") || `función ${index + 1}`)
      );

      const fields = document.createElement("div");
      fields.className = "field-grid";
      fields.append(
        createField({ key, index, labelText: "Título principal", name: "titulo", value: item.titulo, className: "span-2" }),
        createField({ key, index, labelText: "Fecha", name: "fecha", value: item.fecha, type: "date" }),
        createField({ key, index, labelText: "Hora", name: "hora", value: item.hora }),
        createField({ key, index, labelText: "Lugar / sala", name: "lugar", value: item.lugar, className: "span-2" }),
        createField({ key, index, labelText: "Dirección", name: "direccion", value: item.direccion }),
        createField({ key, index, labelText: "Ciudad", name: "ciudad", value: item.ciudad }),
        createField({ key, index, labelText: "Etiqueta", name: "etiqueta", value: item.etiqueta }),
        createField({ key, index, labelText: "Texto de entradas", name: "entradasTexto", value: item.entradasTexto, className: "span-2" }),
        createField({ key, index, labelText: "Texto adicional", name: "detalle", value: item.detalle, textarea: true, className: "span-full" }),
        createField({ key, index, labelText: "Link de Google Maps", name: "mapaUrl", value: item.mapaUrl, type: "url", className: "span-2" }),
        createField({ key, index, labelText: "Link de compra de entradas", name: "entradasUrl", value: item.entradasUrl, type: "url", className: "span-2" }),
        createField({ key, index, labelText: "Ruta de la imagen", name: "imagen", value: item.imagen, className: "span-2" }),
        createField({ key, index, labelText: "Descripción de la imagen", name: "imagenAlt", value: item.imagenAlt, className: "span-2" })
      );

      card.append(heading, fields);
      list.append(card);
    });

    if (!states[key].records.length) renderEmptyState(key);
  };

  const renderSection = (key) => {
    updateCount(key);
    if (key === "trayectoria") renderTrayectoria();
    else renderEntradas();
  };

  const validationError = (key, index, field, message) => {
    const list = sectionElements[key].list;
    const card = list.querySelector(`[data-index="${index}"]`);
    const input = card?.querySelector(`[name="${field}"]`);
    card?.scrollIntoView({ behavior: "smooth", block: "center" });
    input?.focus();
    throw new Error(`Función ${index + 1}: ${message}`);
  };

  const validateSection = (key) => {
    states[key].records.forEach((record, index) => {
      if (!isValidDate(record.fecha)) validationError(key, index, "fecha", "ingresá una fecha válida.");

      if (key === "trayectoria") {
        if (!record.lugar.trim()) validationError(key, index, "lugar", "completá el lugar.");
        if (!record.obra.trim()) validationError(key, index, "obra", "completá la película u obra.");
        return;
      }

      if (!record.titulo.trim()) validationError(key, index, "titulo", "completá el título principal.");
      if (!record.hora.trim()) validationError(key, index, "hora", "completá la hora.");
      if (!record.lugar.trim()) validationError(key, index, "lugar", "completá el lugar o sala.");
      if (!record.entradasTexto.trim()) validationError(key, index, "entradasTexto", "completá el texto de entradas, por ejemplo “Comprar entradas” o “Entrada libre y gratuita”.");
      if (!isValidWebUrl(record.mapaUrl.trim())) validationError(key, index, "mapaUrl", "el link de Google Maps debe comenzar con http:// o https://.");
      if (!isValidWebUrl(record.entradasUrl.trim())) validationError(key, index, "entradasUrl", "el link de compra debe comenzar con http:// o https://.");
      if (record.imagen.trim() && !record.imagenAlt.trim()) validationError(key, index, "imagenAlt", "describí la imagen para quienes usan lectores de pantalla.");
    });
  };

  const loadSection = async (key) => {
    const config = sectionConfigs[key];
    const path = `/repos/${repository.owner}/${repository.name}/contents/${config.file}?ref=${repository.branch}`;
    const file = await apiRequest(path);
    const data = JSON.parse(decodeContent(file.content));

    if (!Array.isArray(data.funciones)) {
      throw new Error(`El archivo ${config.file} tiene un formato inesperado.`);
    }

    states[key].records = data.funciones.map((record) => normalizeRecord(key, record));
    states[key].sha = file.sha;
    sortRecords(key);
    setDirty(key, false);
    renderSection(key);
  };

  const reloadSection = async (key) => {
    if (states[key].dirty && !window.confirm("Hay cambios sin guardar en esta sección. ¿Querés descartarlos y volver a cargar la versión publicada?")) return;

    setBusy(key, true);
    setSectionMessage(key, "Volviendo a cargar…");
    try {
      await loadSection(key);
      setSectionMessage(key, "Contenido actualizado.", "success");
    } catch (error) {
      setSectionMessage(key, explainError(error), "error");
    } finally {
      setBusy(key, false);
    }
  };

  const saveSection = async (key) => {
    try {
      validateSection(key);
    } catch (error) {
      setSectionMessage(key, error.message, "error");
      return;
    }

    states[key].records = sanitizeRecords(key);
    sortRecords(key);

    const config = sectionConfigs[key];
    const content = `${JSON.stringify({ funciones: states[key].records }, null, 2)}\n`;
    const path = `/repos/${repository.owner}/${repository.name}/contents/${config.file}`;
    const saveButton = sectionElements[key].save;
    const originalLabel = saveButton.textContent;

    setBusy(key, true);
    saveButton.textContent = "Guardando…";
    setSectionMessage(key, "Guardando cambios…");

    try {
      const result = await apiRequest(path, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: config.commitMessage,
          content: encodeContent(content),
          sha: states[key].sha,
          branch: repository.branch
        })
      });

      if (!result.content?.sha) {
        throw new Error("GitHub guardó una respuesta incompleta. Volvé a cargar la sección antes de realizar otro cambio.");
      }

      states[key].sha = result.content.sha;
      setDirty(key, false);
      renderSection(key);
      setSectionMessage(key, config.savedMessage, "success");
    } catch (error) {
      setSectionMessage(key, explainError(error), "error");
    } finally {
      setBusy(key, false);
      saveButton.textContent = originalLabel;
    }
  };

  const switchSection = (key) => {
    if (!sectionConfigs[key]) return;
    activeSection = key;

    tabs.forEach((tab) => {
      const active = tab.dataset.section === key;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    });

    panels.forEach((panel) => {
      panel.hidden = panel.dataset.sectionPanel !== key;
    });
  };

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = loginForm.querySelector("button[type='submit']");
    accessToken = tokenInput.value.trim();
    tokenInput.value = "";
    submitButton.disabled = true;
    submitButton.textContent = "Ingresando…";
    setMessage(loginStatus, "Comprobando acceso y cargando contenido…");

    try {
      await Promise.all(Object.keys(sectionConfigs).map(loadSection));
      loginPanel.hidden = true;
      editorPanel.hidden = false;
      connectionState.hidden = false;
      switchSection(activeSection);
      setSectionMessage("trayectoria", "Trayectoria cargada.", "success");
      setSectionMessage("entradas", "Cartelera cargada.", "success");
      setMessage(loginStatus);
    } catch (error) {
      accessToken = "";
      Object.values(states).forEach((state) => {
        state.sha = "";
        state.records = [];
        state.dirty = false;
      });
      setMessage(loginStatus, explainError(error), "error");
      tokenInput.focus();
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Ingresar";
    }
  });

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => switchSection(tab.dataset.section));
    tab.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const nextTab = tabs[(index + direction + tabs.length) % tabs.length];
      switchSection(nextTab.dataset.section);
      nextTab.focus();
    });
  });

  Object.keys(sectionConfigs).forEach((key) => {
    const elements = sectionElements[key];

    elements.add.addEventListener("click", () => {
      const emptyRecord = key === "trayectoria"
        ? { fecha: localDate(), lugar: "", obra: "" }
        : {
            fecha: localDate(),
            hora: "",
            titulo: "",
            etiqueta: "Luego",
            lugar: "",
            direccion: "",
            ciudad: "",
            detalle: "",
            mapaUrl: "",
            entradasUrl: "",
            entradasTexto: "Comprar entradas",
            imagen: "",
            imagenAlt: ""
          };

      states[key].records.unshift(emptyRecord);
      setDirty(key, true);
      setSectionMessage(key, "Nueva función agregada. Completá sus datos y guardá los cambios.");
      renderSection(key);
      const focusField = key === "trayectoria" ? "lugar" : "titulo";
      elements.list.querySelector(`[data-index="0"] [name="${focusField}"]`)?.focus();
    });

    elements.reload.addEventListener("click", () => reloadSection(key));
    elements.save.addEventListener("click", () => saveSection(key));
  });

  logoutButton.addEventListener("click", () => {
    const hasUnsavedChanges = Object.values(states).some((state) => state.dirty);
    if (hasUnsavedChanges && !window.confirm("Hay cambios sin guardar. ¿Querés salir y descartarlos?")) return;

    accessToken = "";
    Object.values(states).forEach((state) => {
      state.sha = "";
      state.records = [];
      state.dirty = false;
    });
    Object.keys(sectionConfigs).forEach((key) => {
      setDirty(key, false);
      setSectionMessage(key);
      sectionElements[key].list.replaceChildren();
      updateCount(key);
    });
    editorPanel.hidden = true;
    connectionState.hidden = true;
    loginPanel.hidden = false;
    setMessage(loginStatus);
    tokenInput.focus();
  });

  window.addEventListener("beforeunload", (event) => {
    if (!Object.values(states).some((state) => state.dirty)) return;
    event.preventDefault();
    event.returnValue = "";
  });
})();
