(() => {
  "use strict";

  const repository = {
    owner: "jeronimonaranjo-star",
    name: "funciones-EJI",
    branch: "main"
  };

  const imageUploadConfig = {
    directory: "img/cartelera",
    allowedTypes: new Set(["image/jpeg", "image/png", "image/webp"]),
    maxFileSize: 15 * 1024 * 1024,
    maxPixels: 40_000_000,
    maxWidth: 1200,
    webpQuality: 0.84,
    maxNameAttempts: 100
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
    entradas: { sha: "", records: [], dirty: false, pendingImages: new Map() }
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
  let editorRecordSequence = 0;

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
    elements.list.querySelectorAll("input, textarea, button").forEach((control) => {
      control.disabled = value;
    });
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

  const blobToBase64 = async (blob) => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    const chunkSize = 32_768;

    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }

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

  const createEditorRecordId = () => `cartelera-${++editorRecordSequence}`;

  const ensureEditorRecordId = (record) => {
    if (!record._editorId) record._editorId = createEditorRecordId();
    return record._editorId;
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const validateImageFile = (file) => {
    if (!(file instanceof File)) throw new Error("No se pudo leer el archivo seleccionado.");
    if (!file.size) throw new Error("La imagen seleccionada está vacía.");
    if (file.size > imageUploadConfig.maxFileSize) {
      throw new Error(`La imagen supera el máximo permitido de ${formatFileSize(imageUploadConfig.maxFileSize)}.`);
    }

    const extensionAllowed = /\.(?:jpe?g|png|webp)$/i.test(file.name);
    const typeAllowed = imageUploadConfig.allowedTypes.has(file.type.toLowerCase());
    if (!typeAllowed && !(extensionAllowed && !file.type)) {
      throw new Error("Formato no permitido. Seleccioná una imagen JPEG, PNG o WebP.");
    }
  };

  const revokePreviewUrl = (pendingImage) => {
    if (pendingImage?.previewUrl) URL.revokeObjectURL(pendingImage.previewUrl);
  };

  const clearPendingImage = (editorId) => {
    const pendingImage = states.entradas.pendingImages.get(editorId);
    revokePreviewUrl(pendingImage);
    states.entradas.pendingImages.delete(editorId);
  };

  const clearAllPendingImages = () => {
    states.entradas.pendingImages.forEach(revokePreviewUrl);
    states.entradas.pendingImages.clear();
  };

  const decodeImage = async (file) => {
    if ("createImageBitmap" in window) {
      try {
        const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
        return {
          source: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          cleanup: () => bitmap.close()
        };
      } catch {
        try {
          const bitmap = await createImageBitmap(file);
          return {
            source: bitmap,
            width: bitmap.width,
            height: bitmap.height,
            cleanup: () => bitmap.close()
          };
        } catch {
          // Continúa con el método compatible basado en Image.
        }
      }
    }

    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.decoding = "async";

    try {
      await new Promise((resolve, reject) => {
        image.addEventListener("load", resolve, { once: true });
        image.addEventListener("error", () => reject(new Error("El archivo no contiene una imagen válida.")), { once: true });
        image.src = objectUrl;
      });

      return {
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        cleanup: () => URL.revokeObjectURL(objectUrl)
      };
    } catch (error) {
      URL.revokeObjectURL(objectUrl);
      throw error;
    }
  };

  const canvasToBlob = (canvas, type, quality) => new Promise((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });

  const optimizeImage = async (file) => {
    validateImageFile(file);
    const decoded = await decodeImage(file);

    try {
      if (!decoded.width || !decoded.height) throw new Error("No se pudieron leer las dimensiones de la imagen.");
      if (decoded.width * decoded.height > imageUploadConfig.maxPixels) {
        throw new Error("La imagen tiene demasiados píxeles para procesarla de forma segura. Usá una imagen de hasta 40 megapíxeles.");
      }

      const width = Math.min(decoded.width, imageUploadConfig.maxWidth);
      const height = Math.max(1, Math.round(decoded.height * (width / decoded.width)));

      if (file.type === "image/webp" && width === decoded.width) {
        return { blob: file, extension: "webp", width, height };
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) throw new Error("El navegador no pudo preparar la imagen.");

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(decoded.source, 0, 0, width, height);

      const webp = await canvasToBlob(canvas, "image/webp", imageUploadConfig.webpQuality);
      if (webp?.type === "image/webp") {
        return { blob: webp, extension: "webp", width, height };
      }

      const fallbackType = file.type === "image/png" ? "image/png" : "image/jpeg";
      const fallback = await canvasToBlob(canvas, fallbackType, fallbackType === "image/jpeg" ? 0.88 : undefined);
      if (!fallback) throw new Error("El navegador no pudo convertir la imagen.");
      return {
        blob: fallback,
        extension: fallbackType === "image/png" ? "png" : "jpg",
        width,
        height
      };
    } finally {
      decoded.cleanup();
    }
  };

  const slugify = (value) => value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "funcion";

  const encodeRepositoryPath = (path) => path.split("/").map(encodeURIComponent).join("/");

  const remoteFileExists = async (path) => {
    const encodedPath = encodeRepositoryPath(path);
    try {
      await apiRequest(`/repos/${repository.owner}/${repository.name}/contents/${encodedPath}?ref=${repository.branch}`);
      return true;
    } catch (error) {
      if (error.status === 404) return false;
      throw error;
    }
  };

  const findAvailableImagePath = async (record, extension) => {
    const baseName = `${slugify(record.titulo)}-${record.fecha}`;

    for (let attempt = 1; attempt <= imageUploadConfig.maxNameAttempts; attempt += 1) {
      const suffix = attempt === 1 ? "" : `-${attempt}`;
      const path = `${imageUploadConfig.directory}/${baseName}${suffix}.${extension}`;
      if (!(await remoteFileExists(path))) return path;
    }

    throw new Error("No se encontró un nombre libre para la imagen. Cambiá el título o la fecha e intentá nuevamente.");
  };

  const uploadImage = async (path, blob) => {
    const encodedPath = encodeRepositoryPath(path);
    const fileName = path.split("/").pop();
    const result = await apiRequest(`/repos/${repository.owner}/${repository.name}/contents/${encodedPath}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `Agrega imagen de cartelera: ${fileName}`,
        content: await blobToBase64(blob),
        branch: repository.branch
      })
    });

    if (!result.content?.sha) {
      throw new Error("GitHub no confirmó la subida de la imagen. No se guardó la cartelera.");
    }

    return result;
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

  const currentImagePreviewUrl = (path) => {
    if (!path) return "";
    try {
      if (/^https?:\/\//i.test(path)) return new URL(path).href;
      return new URL(`../${path.replace(/^\/+/, "")}`, window.location.href).href;
    } catch {
      return "";
    }
  };

  const createImagePreview = (labelText, source, altText, emptyText) => {
    const preview = document.createElement("div");
    preview.className = "image-preview-block";

    const label = document.createElement("span");
    label.className = "image-preview-label";
    label.textContent = labelText;
    preview.append(label);

    if (!source) {
      const empty = document.createElement("span");
      empty.className = "image-preview-empty";
      empty.textContent = emptyText;
      preview.append(empty);
      return preview;
    }

    const frame = document.createElement("div");
    frame.className = "image-preview-frame";
    const image = document.createElement("img");
    image.src = source;
    image.alt = altText;
    image.addEventListener("error", () => {
      frame.classList.add("image-preview-error");
      frame.textContent = "No se pudo mostrar la vista previa.";
    }, { once: true });
    frame.append(image);
    preview.append(frame);
    return preview;
  };

  const createImageUploadField = (item, index) => {
    const key = "entradas";
    const editorId = ensureEditorRecordId(item);
    const pendingImage = states.entradas.pendingImages.get(editorId);
    const currentPath = pendingImage ? pendingImage.previousPath : item.imagen;
    const wrapper = document.createElement("div");
    wrapper.className = "admin-field image-upload-field span-full";

    const previews = document.createElement("div");
    previews.className = "image-preview-grid";
    previews.append(createImagePreview(
      "Imagen actual",
      currentImagePreviewUrl(currentPath),
      item.imagenAlt || "Imagen actual de la función",
      "Esta función todavía no tiene imagen."
    ));

    if (pendingImage) {
      const newLabel = pendingImage.uploadedPath ? "Imagen subida; falta guardar la cartelera" : "Nueva imagen";
      previews.append(createImagePreview(
        newLabel,
        pendingImage.previewUrl,
        `Vista previa de ${pendingImage.file.name}`,
        ""
      ));
    }

    const controls = document.createElement("div");
    controls.className = "image-upload-controls";
    const inputId = `entradas-imagen-archivo-${index}`;
    const fileInput = document.createElement("input");
    fileInput.id = inputId;
    fileInput.className = "visually-hidden-file";
    fileInput.type = "file";
    fileInput.tabIndex = -1;
    fileInput.accept = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

    const selectButton = document.createElement("button");
    selectButton.className = "admin-button secondary file-select-button";
    selectButton.type = "button";
    selectButton.textContent = pendingImage ? "Elegir otra imagen" : "Seleccionar imagen";
    selectButton.addEventListener("click", () => fileInput.click());

    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (!file) return;

      try {
        validateImageFile(file);
        const previousPending = states.entradas.pendingImages.get(editorId);
        const previewUrl = URL.createObjectURL(file);
        const previousPath = previousPending ? previousPending.previousPath : item.imagen;
        const previouslyUploadedPath = previousPending?.uploadedPath || "";
        revokePreviewUrl(previousPending);
        states.entradas.pendingImages.set(editorId, {
          file,
          previewUrl,
          previousPath,
          uploadedPath: ""
        });
        setDirty(key, true);
        renderSection(key);

        const orphanNotice = previouslyUploadedPath
          ? ` La imagen ${previouslyUploadedPath} ya había sido subida y no se borrará automáticamente.`
          : "";
        setSectionMessage(key, `Imagen seleccionada: ${file.name} (${formatFileSize(file.size)}). Se optimizará al guardar.${orphanNotice}`);
      } catch (error) {
        fileInput.value = "";
        setSectionMessage(key, error.message, "error");
      }
    });

    controls.append(fileInput, selectButton);

    if (pendingImage) {
      const discardButton = document.createElement("button");
      discardButton.className = "admin-button secondary";
      discardButton.type = "button";
      discardButton.textContent = "Descartar imagen nueva";
      discardButton.addEventListener("click", () => {
        const uploadedPath = pendingImage.uploadedPath;
        item.imagen = pendingImage.previousPath;
        clearPendingImage(editorId);
        setDirty(key, true);
        renderSection(key);
        setSectionMessage(
          key,
          uploadedPath
            ? `Se descartó el cambio de imagen. El archivo ${uploadedPath} seguirá en el repositorio y no se borró automáticamente.`
            : "Se descartó la imagen nueva; se mantendrá la imagen actual."
        );
      });
      controls.append(discardButton);
    }

    const help = document.createElement("p");
    help.className = "field-help image-upload-help";
    help.textContent = "JPEG, PNG o WebP · máximo 15 MB · se ajusta a 1200 px de ancho y se convierte preferentemente a WebP.";
    controls.append(help);

    if (currentPath) {
      const path = document.createElement("p");
      path.className = "image-path";
      path.append("Ruta actual: ");
      const code = document.createElement("code");
      code.textContent = currentPath;
      path.append(code);
      controls.append(path);
    }

    if (pendingImage?.uploadedPath) {
      const uploadedPath = document.createElement("p");
      uploadedPath.className = "image-path uploaded";
      uploadedPath.append("Archivo ya subido: ");
      const code = document.createElement("code");
      code.textContent = pendingImage.uploadedPath;
      uploadedPath.append(code);
      controls.append(uploadedPath);
    }

    wrapper.append(previews, controls);
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
      if (key === "entradas") clearPendingImage(states[key].records[index]._editorId);
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
        createImageUploadField(item, index),
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
      const hasPendingImage = states.entradas.pendingImages.has(ensureEditorRecordId(record));
      if ((record.imagen.trim() || hasPendingImage) && !record.imagenAlt.trim()) {
        validationError(key, index, "imagenAlt", "describí la imagen para quienes usan lectores de pantalla.");
      }
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

    if (key === "entradas") clearAllPendingImages();
    states[key].records = data.funciones.map((record) => {
      const normalized = normalizeRecord(key, record);
      if (key === "entradas") ensureEditorRecordId(normalized);
      return normalized;
    });
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

    const config = sectionConfigs[key];
    const path = `/repos/${repository.owner}/${repository.name}/contents/${config.file}`;
    const saveButton = sectionElements[key].save;
    const originalLabel = saveButton.textContent;
    const pendingRecords = key === "entradas"
      ? states.entradas.records
          .map((record) => ({
            record,
            pendingImage: states.entradas.pendingImages.get(ensureEditorRecordId(record))
          }))
          .filter(({ pendingImage }) => pendingImage)
      : [];

    setBusy(key, true);
    saveButton.textContent = "Guardando…";
    setSectionMessage(key, pendingRecords.length ? "Procesando imagen…" : "Guardando función…");

    try {
      for (let index = 0; index < pendingRecords.length; index += 1) {
        const { record, pendingImage } = pendingRecords[index];
        if (pendingImage.uploadedPath) {
          record.imagen = pendingImage.uploadedPath;
          continue;
        }

        setSectionMessage(key, `Procesando imagen ${index + 1} de ${pendingRecords.length}…`);
        const optimized = await optimizeImage(pendingImage.file);
        const imagePath = await findAvailableImagePath(record, optimized.extension);
        setSectionMessage(key, `Subiendo imagen ${index + 1} de ${pendingRecords.length}…`);
        await uploadImage(imagePath, optimized.blob);
        pendingImage.uploadedPath = imagePath;
        record.imagen = imagePath;
      }

      const recordsToSave = sanitizeRecords(key);
      const direction = key === "trayectoria" ? -1 : 1;
      recordsToSave.sort((a, b) => (
        direction * a.fecha.localeCompare(b.fecha) ||
        (a.hora || "").localeCompare(b.hora || "")
      ));
      const content = `${JSON.stringify({ funciones: recordsToSave }, null, 2)}\n`;
      setSectionMessage(key, "Guardando función…");

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

      if (key === "entradas") clearAllPendingImages();
      states[key].records = recordsToSave.map((record) => {
        if (key === "entradas") ensureEditorRecordId(record);
        return record;
      });
      states[key].sha = result.content.sha;
      setDirty(key, false);
      renderSection(key);
      setSectionMessage(key, key === "entradas" ? "Guardado correctamente." : config.savedMessage, "success");
    } catch (error) {
      const uploadedPaths = pendingRecords
        .map(({ pendingImage }) => pendingImage.uploadedPath)
        .filter(Boolean);

      if (uploadedPaths.length) {
        renderSection(key);
        const files = uploadedPaths.map((uploadedPath) => `“${uploadedPath}”`).join(", ");
        const uploadedSubject = uploadedPaths.length === 1
          ? "La imagen ya quedó subida"
          : "Las imágenes ya quedaron subidas";
        const recovery = error.status === 409
          ? "Para proteger los cambios remotos, recargá la sección y aplicá nuevamente tus cambios. Los archivos subidos no se borrarán automáticamente."
          : "Podés volver a intentar: las imágenes ya subidas no se cargarán otra vez.";
        setSectionMessage(
          key,
          `${explainError(error)} ${uploadedSubject} como ${files}, pero la cartelera no se guardó. ${recovery}`,
          "error"
        );
      } else {
        setSectionMessage(key, explainError(error), "error");
      }
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
      clearAllPendingImages();
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

      if (key === "entradas") ensureEditorRecordId(emptyRecord);

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
    clearAllPendingImages();
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
