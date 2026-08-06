import { contentPath, inspectGeneratedCover, MAX_FILE_BYTES } from "./validation.mjs";

const BUCKET = "course-covers";
const MAX_BODY_BYTES = MAX_FILE_BYTES + 64 * 1024;
const PRODUCTION_ORIGINS = new Set(["https://taudux.com"]);

class ClientError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function allowedOrigin(origin) {
  if (!origin || origin === "null") return false;
  if (PRODUCTION_ORIGINS.has(origin)) return true;
  try {
    const url = new URL(origin);
    return url.origin === origin && url.protocol === "http:" && Boolean(url.port) &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

function corsHeaders(origin) {
  const result = { "Content-Type": "application/json; charset=utf-8", "Vary": "Origin" };
  if (origin) {
    result["Access-Control-Allow-Origin"] = origin;
    result["Access-Control-Allow-Headers"] = "authorization, x-client-info, apikey, content-type";
    result["Access-Control-Allow-Methods"] = "POST, OPTIONS";
  }
  return result;
}

async function boundedFormData(request) {
  const type = request.headers.get("content-type") || "";
  if (!/^multipart\/form-data(?:;|$)/i.test(type) || !request.body) {
    throw new ClientError(400, "invalid_request");
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > MAX_BODY_BYTES) {
    throw new ClientError(413, "payload_too_large");
  }
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      reader.cancel();
      throw new ClientError(413, "payload_too_large");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request(request.url, { method: "POST", headers: { "content-type": type }, body }).formData();
}

function onlyFile(form) {
  const files = [...form.values()].filter((value) => value instanceof Blob && typeof value.name === "string");
  const field = form.getAll("file");
  const file = field[0];
  if (files.length !== 1 || field.length !== 1 || !files.includes(file) || file.size === 0) {
    throw new ClientError(400, "invalid_request");
  }
  return file;
}

function duplicate(error) {
  return Number(error?.statusCode ?? error?.status) === 409 ||
    /duplicate|already exists/i.test(`${error?.code || ""} ${error?.message || ""}`);
}

function firstRow(data) {
  return Array.isArray(data) ? data[0] : data;
}

async function cancelUploadIntent(serviceClient, associationToken) {
  if (!associationToken) return;
  try {
    await serviceClient.rpc("cancel_course_cover_upload", {
      upload_association_token: associationToken,
    });
  } catch {
    // The expiring intent remains fail-closed if cancellation cannot be persisted.
  }
}

function safePublicUrl(value, projectUrl, path) {
  try {
    const candidate = new URL(value || "");
    const project = new URL(projectUrl);
    const expectedPath = `/storage/v1/object/public/${BUCKET}/${path}`;
    return candidate.origin === project.origin && candidate.pathname === expectedPath &&
      !candidate.search && !candidate.hash && !candidate.username && !candidate.password &&
      (candidate.protocol === "https:" || candidate.protocol === "http:") ? candidate.href : null;
  } catch {
    return null;
  }
}

export function createUploadCourseCoverHandler(overrides = {}) {
  const dependencies = {
    getEnv: (name) => globalThis.Deno?.env?.get(name),
    fetchImpl: globalThis.fetch?.bind(globalThis),
    createCallerClient: createFetchCallerClient,
    createServiceClient: createSupabaseServiceClient,
    logger: globalThis.console,
    now: () => globalThis.performance?.now?.() ?? Date.now(),
    ...overrides,
  };

  return async function handleUploadCourseCover(request) {
    const started = dependencies.now();
    let responseOrigin = null;
    const finish = (status, code, payload, origin) => {
      const event = {
        event: "upload_course_cover",
        code,
        status,
        durationMs: Math.max(0, Math.round(dependencies.now() - started)),
      };
      dependencies.logger[status >= 400 ? "error" : "info"](JSON.stringify(event));
      return new Response(payload === null ? null : JSON.stringify(payload), {
        status,
        headers: corsHeaders(origin),
      });
    };

    try {
      const requestOrigin = request.headers.get("origin");
      const origin = allowedOrigin(requestOrigin) ? requestOrigin : null;
      if (!origin) return finish(403, "invalid_origin", { ok: false, code: "invalid_origin", message: "Origin is not allowed." }, null);
      responseOrigin = origin;
      if (request.method === "OPTIONS") return finish(204, "preflight_ok", null, origin);
      if (request.method !== "POST") {
        return finish(405, "method_not_allowed", { ok: false, code: "method_not_allowed", message: "Only POST is allowed." }, origin);
      }

      const authorization = request.headers.get("authorization");
      if (!authorization) {
        return finish(401, "auth_required", { ok: false, code: "auth_required", message: "Authentication is required." }, origin);
      }
      const projectUrl = dependencies.getEnv("SUPABASE_URL");
      const anonKey = dependencies.getEnv("SUPABASE_ANON_KEY");
      if (!projectUrl || !anonKey) {
        return finish(500, "internal_error", { ok: false, code: "internal_error", message: "Upload is unavailable." }, origin);
      }

      const caller = dependencies.createCallerClient({
        projectUrl,
        anonKey,
        authorization,
        fetchImpl: dependencies.fetchImpl,
      });
      const { data: userData, error: userError } = await caller.auth.getUser();
      if (userError || !userData?.user) {
        return finish(401, "auth_required", { ok: false, code: "auth_required", message: "Authentication is required." }, origin);
      }
      const { data: isAdmin, error: adminError } = await caller.rpc("es_admin");
      if (adminError) {
        return finish(500, "internal_error", { ok: false, code: "internal_error", message: "Upload is unavailable." }, origin);
      }
      if (isAdmin !== true) {
        return finish(403, "forbidden", { ok: false, code: "forbidden", message: "Administrator access is required." }, origin);
      }

      let file;
      try {
        file = onlyFile(await boundedFormData(request));
      } catch (error) {
        const known = error instanceof ClientError ? error : new ClientError(400, "invalid_request");
        const message = known.code === "payload_too_large" ? "The file is too large." : "Invalid multipart request.";
        return finish(known.status, known.code, { ok: false, code: known.code, message }, origin);
      }

      // Structural inspection is the whole server-side defense: the edge runtime's
      // createImageBitmap cannot decode JPEG, so a decode step rejects valid covers.
      let bytes;
      let image;
      let path;
      try {
        bytes = new Uint8Array(await file.arrayBuffer());
        image = inspectGeneratedCover(bytes, file.type);
        path = await contentPath(bytes, image.extension);
      } catch {
        return finish(400, "invalid_image", { ok: false, code: "invalid_image", message: "The image is invalid." }, origin);
      }

      const serviceRole = dependencies.getEnv("SUPABASE_SERVICE_ROLE_KEY");
      if (!serviceRole) {
        return finish(500, "internal_error", { ok: false, code: "internal_error", message: "Upload is unavailable." }, origin);
      }
      const serviceClient = await dependencies.createServiceClient({ projectUrl, serviceRole });
      const bucket = serviceClient.storage.from(BUCKET);
      const intent = await serviceClient.rpc("begin_course_cover_upload", {
        upload_storage_path: path,
      });
      const associationToken = firstRow(intent.data)?.association_token;
      if (intent.error || typeof associationToken !== "string") {
        return finish(503, "upload_unavailable", { ok: false, code: "upload_unavailable", message: "Upload is temporarily unavailable." }, origin);
      }

      let uploadError;
      try {
        ({ error: uploadError } = await bucket.upload(path, bytes, {
          contentType: image.mime,
          cacheControl: "31536000",
          upsert: false,
        }));
      } catch {
        await cancelUploadIntent(serviceClient, associationToken);
        return finish(502, "upload_failed", { ok: false, code: "upload_failed", message: "The image could not be stored." }, origin);
      }
      if (uploadError && !duplicate(uploadError)) {
        await cancelUploadIntent(serviceClient, associationToken);
        return finish(502, "upload_failed", { ok: false, code: "upload_failed", message: "The image could not be stored." }, origin);
      }
      const url = safePublicUrl(bucket.getPublicUrl(path).data.publicUrl, projectUrl, path);
      if (!url) {
        await cancelUploadIntent(serviceClient, associationToken);
        return finish(500, "internal_error", { ok: false, code: "internal_error", message: "Upload is unavailable." }, origin);
      }
      const completion = await serviceClient.rpc("complete_course_cover_upload", {
        upload_association_token: associationToken,
      });
      if (completion.error || completion.data !== true) {
        return finish(503, "upload_confirmation_pending", {
          ok: false,
          code: "upload_confirmation_pending",
          message: "The upload could not be confirmed safely. Retry the same file.",
        }, origin);
      }
      return finish(200, "upload_ok", { ok: true, url, path, associationToken }, origin);
    } catch {
      return finish(500, "internal_error", { ok: false, code: "internal_error", message: "Upload is unavailable." }, responseOrigin);
    }
  };
}

function createFetchCallerClient({ projectUrl, anonKey, authorization, fetchImpl }) {
  const headers = { apikey: anonKey, Authorization: authorization };
  return {
    auth: {
      async getUser() {
        const response = await fetchImpl(`${projectUrl}/auth/v1/user`, { headers });
        if (!response.ok) return { data: { user: null }, error: true };
        const user = await response.json();
        return { data: { user }, error: user?.id ? null : true };
      },
    },
    async rpc(name) {
      if (name !== "es_admin") return { data: null, error: true };
      const response = await fetchImpl(`${projectUrl}/rest/v1/rpc/es_admin`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: "{}",
      });
      return response.ok ? { data: await response.json(), error: null } : { data: null, error: true };
    },
  };
}

async function createSupabaseServiceClient({ projectUrl, serviceRole }) {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(projectUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

// Keep platform JWT verification enabled when deploying this browser endpoint.
if (globalThis.Deno && typeof globalThis.Deno.serve === "function") {
  globalThis.Deno.serve(createUploadCourseCoverHandler());
}
