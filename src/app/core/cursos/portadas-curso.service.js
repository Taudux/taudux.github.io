/* Envía portadas a la función autenticada; el navegador nunca accede a Storage. */
(() => {
  const MAX_BYTES = 5 * 1024 * 1024;
  const TIMEOUT_MS = 15_000;
  const MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
  const MENSAJE_GENERICO = "No se pudo subir la portada. Revisa tu conexión e inténtalo de nuevo.";
  const MENSAJES = {
    auth_required: "Tu sesión expiró. Inicia sesión nuevamente.",
    forbidden: "No tienes permisos para subir portadas.",
    invalid_image: "La portada no es una imagen JPG, PNG o WebP válida de hasta 5 MiB.",
    invalid_request: "La portada no es una imagen JPG, PNG o WebP válida de hasta 5 MiB.",
    payload_too_large: "La portada debe pesar más de 0 bytes y hasta 5 MiB.",
    decoder_unavailable: "El servicio de portadas no está disponible temporalmente. Inténtalo de nuevo.",
    upload_timeout: "La carga tardó demasiado. Revisa tu conexión e inténtalo de nuevo.",
  };
  const ADVERTENCIA_HUERFANA = "La portada se conservó y puede requerir limpieza manual en Supabase.";

  function validarArchivo(archivo) {
    if (!archivo || typeof archivo.name !== "string") {
      throw new Error("Selecciona una imagen JPG, PNG o WebP.");
    }
    if (!Number.isFinite(archivo.size) || archivo.size <= 0 || archivo.size > MAX_BYTES) {
      throw new Error("La portada debe pesar más de 0 bytes y hasta 5 MiB.");
    }
    if (!MIMES.has(String(archivo.type || "").toLowerCase())) {
      throw new Error("La portada debe ser un archivo JPG, PNG o WebP válido.");
    }
  }

  async function obtenerCodigo(error, data) {
    if (data && typeof data === "object" && typeof data.code === "string") return data.code;
    try {
      const payload = await error?.context?.json();
      return typeof payload?.code === "string" ? payload.code : null;
    } catch {
      return null;
    }
  }

  function validarUrlPublica(valor) {
    try {
      const url = new URL(valor);
      return url.protocol === "https:" ? url.href : null;
    } catch {
      return null;
    }
  }

  function crearClientePortadas({
    client,
    timeoutMs = TIMEOUT_MS,
    setTimer = globalThis.setTimeout,
    clearTimer = globalThis.clearTimeout,
    AbortControllerImpl = globalThis.AbortController,
  }) {
    async function subir(archivo) {
      validarArchivo(archivo);
      const body = new FormData();
      body.append("file", archivo);
      const controller = new AbortControllerImpl();
      let timer;
      let respuesta;
      try {
        const limite = new Promise((_, reject) => {
          timer = setTimer(() => {
            controller.abort();
            const error = new Error(MENSAJES.upload_timeout);
            error.code = "upload_timeout";
            reject(error);
          }, timeoutMs);
        });
        respuesta = await Promise.race([
          client.functions.invoke("upload-course-cover", { body, signal: controller.signal }),
          limite,
        ]);
      } catch (error) {
        if (error?.code === "upload_timeout") throw error;
        throw new Error(MENSAJE_GENERICO);
      } finally {
        clearTimer(timer);
      }
      const { data, error } = respuesta;
      if (error || data?.ok !== true) {
        const codigo = await obtenerCodigo(error, data);
        throw new Error(MENSAJES[codigo] || MENSAJE_GENERICO);
      }
      const url = validarUrlPublica(data.url);
      if (!url) throw new Error(MENSAJE_GENERICO);
      return url;
    }
    return Object.freeze({ subir });
  }

  function bloquearControles(controles) {
    const estados = Array.from(controles || [], (control) => [control, Boolean(control.disabled)]);
    estados.forEach(([control]) => { control.disabled = true; });
    let restaurados = false;
    return () => {
      if (restaurados) return;
      restaurados = true;
      estados.forEach(([control, disabled]) => { control.disabled = disabled; });
    };
  }

  function crearFlujoMutacionCurso({ subirPortada, crearCurso, actualizarCurso, generarOperacionId }) {
    let mutacionEnCurso = false;
    let operacionCreacion = null;

    function invalidarOperacion(firmaActual) {
      if (mutacionEnCurso || !operacionCreacion || firmaActual === operacionCreacion.firma) return false;
      operacionCreacion = null;
      return true;
    }

    async function ejecutar({ cursoId, datos, archivoPortada, firma, controles, alCambiarEtapa }) {
      if (mutacionEnCurso) {
        return { ok: false, codigo: "mutation_in_progress", mensajeUsuario: "Espera a que termine la operación actual." };
      }
      let operacionId = null;
      if (!cursoId) {
        if (!operacionCreacion) {
          const id = generarOperacionId();
          if (!id) {
            const mensaje = "Tu navegador no puede preparar una publicación segura. Actualízalo y vuelve a intentarlo.";
            return { ok: false, codigo: "operation_id_unavailable", mensaje, mensajeUsuario: mensaje };
          }
          operacionCreacion = { id, firma };
        }
        operacionId = operacionCreacion.id;
      }

      mutacionEnCurso = true;
      const restaurar = bloquearControles(controles);
      let etapa = archivoPortada ? "upload" : "save";
      let portadaSubida = false;
      try {
        const campos = { ...datos };
        if (archivoPortada) {
          alCambiarEtapa?.("upload");
          campos.imagen_url = await subirPortada(archivoPortada);
          portadaSubida = true;
        }
        etapa = "save";
        alCambiarEtapa?.("save");
        const resultado = cursoId
          ? await actualizarCurso(cursoId, campos)
          : await crearCurso(campos, operacionId);
        if (resultado?.ok) operacionCreacion = null;
        const mensaje = resultado?.mensaje || "No se pudo guardar el curso.";
        return {
          ...resultado,
          etapa,
          portadaSubida,
          mensajeUsuario: !resultado?.ok && portadaSubida ? `${mensaje} ${ADVERTENCIA_HUERFANA}` : mensaje,
        };
      } catch (error) {
        const mensaje = etapa === "upload"
          ? error?.message || "No se pudo subir la portada."
          : cursoId
            ? "No se pudo guardar el curso."
            : "No se pudo confirmar si el curso fue publicado. Reintenta sin cambiar los datos.";
        return {
          ok: false,
          ambigua: etapa === "save" && !cursoId,
          codigo: etapa === "upload" ? "upload_failed" : "save_exception",
          error,
          etapa,
          portadaSubida,
          mensaje,
          mensajeUsuario: portadaSubida ? `${mensaje} ${ADVERTENCIA_HUERFANA}` : mensaje,
        };
      } finally {
        restaurar();
        mutacionEnCurso = false;
      }
    }

    return Object.freeze({ ejecutar, invalidarOperacion, estaEnCurso: () => mutacionEnCurso });
  }

  const api = Object.freeze({ crearClientePortadas, crearFlujoMutacionCurso, bloquearControles });
  if (typeof module === "object" && module.exports) {
    module.exports = api;
    return;
  }
  const cliente = crearClientePortadas({ client: supabaseClient });
  window.portadasCurso = Object.freeze({ ...api, subir: cliente.subir });
})();
