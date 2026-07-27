/* Envía portadas a la función autenticada; el navegador nunca accede a Storage. */
(() => {
  const MAX_BYTES = 10_000_000;
  const TIMEOUT_MS = 15_000;
  const MIME_GENERADO = "image/jpeg";
  const RUTA_GESTIONADA = /^sha256\/[0-9a-f]{64}\.(?:jpg|png|webp)$/;
  const TOKEN_ASOCIACION = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const URL_PORTADAS = "https://yqkvgfqplmbbcebrivpt.supabase.co/storage/v1/object/public/course-covers/";
  const MENSAJE_GENERICO = "No se pudo subir la portada. Revisa tu conexión e inténtalo de nuevo.";
  const MENSAJE_RETIRO_GENERICO = "No se pudo quitar la imagen actual. Inténtalo de nuevo.";
  const MENSAJES = {
    auth_required: "Tu sesión expiró. Inicia sesión nuevamente.",
    forbidden: "No tienes permisos para subir portadas.",
    invalid_image: "La portada generada no es un JPEG válido de 1200 × 900.",
    invalid_request: "No se pudo procesar la solicitud de portada. Inténtalo de nuevo.",
    payload_too_large: "La portada generada debe pesar más de 0 bytes y hasta 10 MB.",
    upload_unavailable: "La carga segura de portadas no está disponible temporalmente. Inténtalo de nuevo.",
    upload_confirmation_pending: "No se pudo confirmar la portada de forma segura. Reintenta el mismo archivo.",
    upload_timeout: "La carga tardó demasiado. Revisa tu conexión e inténtalo de nuevo.",
    removal_timeout: "La operación tardó demasiado. Revisa tu conexión e inténtalo de nuevo.",
    cover_conflict: "La portada cambió en otra sesión. Recarga la página antes de continuar.",
    course_not_found: "El curso ya no existe.",
  };
  const MENSAJES_RETIRO = {
    ...MENSAJES,
    forbidden: "No tienes permisos para quitar portadas.",
  };
  const ADVERTENCIA_HUERFANA = "La portada se conservó y puede requerir limpieza manual en Supabase.";

  function validarArchivo(archivo) {
    if (!archivo || typeof archivo.name !== "string") {
      throw new Error("Genera una portada JPEG antes de continuar.");
    }
    if (!Number.isFinite(archivo.size) || archivo.size <= 0 || archivo.size > MAX_BYTES) {
      throw new Error("La portada generada debe pesar más de 0 bytes y hasta 10 MB.");
    }
    if (String(archivo.type || "").toLowerCase() !== MIME_GENERADO) {
      throw new Error("La portada debe ser la imagen JPEG generada por el recortador.");
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

  function crearErrorPortada(mensaje, codigo) {
    const error = new Error(mensaje);
    error.code = codigo;
    return error;
  }

  function validarPortadaGestionada(data) {
    const ruta = typeof data?.path === "string" && RUTA_GESTIONADA.test(data.path)
      ? data.path
      : null;
    const url = validarUrlPublica(data?.url);
    const associationToken = typeof data?.associationToken === "string" &&
      TOKEN_ASOCIACION.test(data.associationToken) ? data.associationToken : null;
    return ruta && associationToken && url === `${URL_PORTADAS}${ruta}`
      ? { url, path: ruta, associationToken }
      : null;
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
            reject(crearErrorPortada(MENSAJES.upload_timeout, "upload_timeout"));
          }, timeoutMs);
        });
        respuesta = await Promise.race([
          client.functions.invoke("upload-course-cover", { body, signal: controller.signal }),
          limite,
        ]);
      } catch (error) {
        if (error?.code === "upload_timeout") throw error;
        throw crearErrorPortada(MENSAJE_GENERICO, "upload_failed");
      } finally {
        clearTimer(timer);
      }
      const { data, error } = respuesta;
      if (error || data?.ok !== true) {
        const codigo = await obtenerCodigo(error, data);
        throw crearErrorPortada(MENSAJES[codigo] || MENSAJE_GENERICO, codigo || "upload_failed");
      }
      const portada = validarPortadaGestionada(data);
      if (!portada) throw crearErrorPortada(MENSAJE_GENERICO, "upload_failed");
      return portada;
    }

    async function quitar(cursoId, portadaEsperada) {
      const controller = new AbortControllerImpl();
      let timer;
      let respuesta;
      try {
        const limite = new Promise((_, reject) => {
          timer = setTimer(() => {
            controller.abort();
            reject(crearErrorPortada(MENSAJES.removal_timeout, "removal_timeout"));
          }, timeoutMs);
        });
        respuesta = await Promise.race([
          client.functions.invoke("remove-course-cover", {
            body: {
              courseId: cursoId,
              expected: {
                url: portadaEsperada?.url || null,
                path: portadaEsperada?.path || null,
              },
            },
            signal: controller.signal,
          }),
          limite,
        ]);
      } catch (error) {
        if (error?.code === "removal_timeout") throw error;
        throw crearErrorPortada(MENSAJE_RETIRO_GENERICO, "removal_failed");
      } finally {
        clearTimer(timer);
      }
      const { data, error } = respuesta;
      if (error || data?.ok !== true) {
        const codigo = await obtenerCodigo(error, data);
        throw crearErrorPortada(
          MENSAJES_RETIRO[codigo] || MENSAJE_RETIRO_GENERICO,
          codigo || "removal_failed"
        );
      }
      return data;
    }
    return Object.freeze({ subir, quitar });
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

    async function ejecutar({ cursoId, datos, archivoPortada, portadaEsperada, firma, controles, alCambiarEtapa }) {
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
          const portada = await subirPortada(archivoPortada);
          campos.imagen_url = portada.url;
          campos.imagen_storage_path = portada.path;
          campos.imagen_upload_token = portada.associationToken;
          portadaSubida = true;
        }
        etapa = "save";
        alCambiarEtapa?.("save");
        const resultado = cursoId
          ? await actualizarCurso(cursoId, campos, portadaEsperada)
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
          codigo: etapa === "upload" ? error?.code || "upload_failed" : "save_exception",
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
  window.portadasCurso = Object.freeze({ ...api, subir: cliente.subir, quitar: cliente.quitar });
})();
