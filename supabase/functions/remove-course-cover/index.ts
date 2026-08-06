const BUCKET = "course-covers";
const MAX_BODY_BYTES = 8 * 1024;
const MAX_CLEANUP_JOBS = 3;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MANAGED_PATH = /^sha256\/[0-9a-f]{64}\.(?:jpg|png|webp)$/;
const PRODUCTION_ORIGINS = new Set(["https://taudux.com"]);

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

function sameNullable(left, right) {
  return (left ?? null) === (right ?? null);
}

function validNullableString(value, maxLength) {
  return value === null || (typeof value === "string" && value.length <= maxLength);
}

async function readRequest(request) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_BODY_BYTES) return null;
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return null;
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const keys = Object.keys(body).sort();
  if (keys.join(",") !== "courseId,expected" || !UUID.test(body.courseId)) return null;
  const expected = body.expected;
  if (!expected || typeof expected !== "object" || Array.isArray(expected) ||
      Object.keys(expected).sort().join(",") !== "path,url" ||
      !validNullableString(expected.url, 2048) || !validNullableString(expected.path, 100)) {
    return null;
  }
  return { courseId: body.courseId, expected: { url: expected.url, path: expected.path } };
}

function missingObject(error) {
  const status = Number(error?.statusCode ?? error?.status);
  const code = String(error?.code || "").toLowerCase();
  return status === 404 || ["404", "not_found", "object_not_found", "nosuchkey"].includes(code);
}

function firstRow(data) {
  return Array.isArray(data) ? data[0] : data;
}

async function recordRetry(serviceClient, job, reason) {
  return serviceClient.rpc("retry_course_cover_cleanup", {
    cleanup_storage_path: job.storage_path,
    cleanup_claim_token: job.claim_token,
    cleanup_claim_generation: job.claim_generation,
    sanitized_error: reason.slice(0, 160),
  });
}

function emptyCounters() {
  return { claimed: 0, deleted: 0, queued: 0, failures: 0 };
}

async function cleanupStatus(serviceClient, path) {
  if (!MANAGED_PATH.test(path || "")) return "not_applicable";
  const state = await serviceClient.rpc("course_cover_cleanup_status", {
    cleanup_storage_path: path,
  });
  if (state.error) return "queued";
  const status = firstRow(state.data)?.status;
  return ["deleted", "queued", "retained_shared"].includes(status) ? status : "queued";
}

async function processClaimedCleanup(serviceClient, job) {
  const counters = emptyCounters();
  counters.claimed = 1;
  const path = job?.storage_path;
  if (!MANAGED_PATH.test(path || "") || !UUID.test(job?.claim_token || "") ||
      !Number.isSafeInteger(job?.claim_generation) || job.claim_generation < 1) {
    counters.queued = 1;
    counters.failures = 1;
    return { status: "queued", counters };
  }

  let removal;
  try {
    removal = await serviceClient.storage.from(BUCKET).remove([path]);
  } catch {
    const retry = await recordRetry(serviceClient, job, "storage_remove_exception");
    counters.queued = 1;
    counters.failures = 1;
    if (retry.error || retry.data !== true) counters.failures++;
    return { status: await cleanupStatus(serviceClient, path), counters };
  }
  if (removal.error && !missingObject(removal.error)) {
    const retry = await recordRetry(serviceClient, job, "storage_remove_failed");
    counters.queued = 1;
    counters.failures = 1;
    if (retry.error || retry.data !== true) counters.failures++;
    return { status: await cleanupStatus(serviceClient, path), counters };
  }

  const completion = await serviceClient.rpc("complete_course_cover_cleanup", {
    cleanup_storage_path: path,
    cleanup_claim_token: job.claim_token,
    cleanup_claim_generation: job.claim_generation,
  });
  if (completion.error || completion.data !== true) {
    const retry = await recordRetry(
      serviceClient,
      job,
      "completion_persistence_unknown_after_delete",
    );
    const status = await cleanupStatus(serviceClient, path);
    if (status === "deleted") {
      counters.deleted = 1;
    } else {
      counters.queued = 1;
    }
    counters.failures = 1;
    if (retry.error) counters.failures++;
    return { status, counters };
  }

  counters.deleted = 1;
  return { status: "deleted", counters };
}

async function claimCleanup(serviceClient, preferredPath) {
  return serviceClient.rpc("claim_course_cover_cleanup", {
    preferred_storage_path: preferredPath || null,
  });
}

async function processRequestedCleanup(serviceClient, path) {
  if (!path) return { status: "not_applicable", counters: emptyCounters() };
  const claim = await claimCleanup(serviceClient, path);
  if (claim.error) {
    const counters = emptyCounters();
    counters.queued = 1;
    counters.failures = 1;
    return { status: "queued", counters };
  }
  const job = firstRow(claim.data);
  if (!job) {
    const status = await cleanupStatus(serviceClient, path);
    const counters = emptyCounters();
    if (status === "queued") counters.queued = 1;
    return { status, counters };
  }
  return processClaimedCleanup(serviceClient, job);
}

async function processBacklog(serviceClient, limit) {
  const counters = emptyCounters();
  for (let index = 0; index < limit; index++) {
    const claim = await claimCleanup(serviceClient, null);
    if (claim.error) {
      counters.failures++;
      break;
    }
    const job = firstRow(claim.data);
    if (!job) break;
    const processed = await processClaimedCleanup(serviceClient, job);
    for (const key of Object.keys(counters)) counters[key] += processed.counters[key];
  }
  return counters;
}

export function createRemoveCourseCoverHandler(overrides = {}) {
  const dependencies = {
    getEnv: (name) => globalThis.Deno?.env?.get(name),
    fetchImpl: globalThis.fetch?.bind(globalThis),
    createCallerClient: createFetchCallerClient,
    createServiceClient: createSupabaseServiceClient,
    logger: globalThis.console,
    now: () => globalThis.performance?.now?.() ?? Date.now(),
    ...overrides,
  };

  return async function handleRemoveCourseCover(request) {
    const started = dependencies.now();
    let responseOrigin = null;
    const finish = (status, code, payload, origin) => {
      const cleanup = payload?.cleanup;
      const event = {
        event: "remove_course_cover",
        code,
        status,
        durationMs: Math.max(0, Math.round(dependencies.now() - started)),
        ...(cleanup ? {
          cleanupStatus: cleanup.status,
          requestedClaimed: cleanup.counters.requestedClaimed,
          requestedDeleted: cleanup.counters.requestedDeleted,
          requestedQueued: cleanup.counters.requestedQueued,
          backlogClaimed: cleanup.counters.backlogClaimed,
          backlogDeleted: cleanup.counters.backlogDeleted,
          backlogQueued: cleanup.counters.backlogQueued,
          cleanupFailures: cleanup.counters.failures,
        } : {}),
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
      if (!origin) return finish(403, "invalid_origin", { ok: false, code: "invalid_origin" }, null);
      responseOrigin = origin;
      if (request.method === "OPTIONS") return finish(204, "preflight_ok", null, origin);
      if (request.method !== "POST") {
        return finish(405, "method_not_allowed", { ok: false, code: "method_not_allowed" }, origin);
      }

      const authorization = request.headers.get("authorization");
      if (!authorization) return finish(401, "auth_required", { ok: false, code: "auth_required" }, origin);
      const projectUrl = dependencies.getEnv("SUPABASE_URL");
      const anonKey = dependencies.getEnv("SUPABASE_ANON_KEY");
      if (!projectUrl || !anonKey) return finish(500, "internal_error", { ok: false, code: "internal_error" }, origin);

      const caller = dependencies.createCallerClient({ projectUrl, anonKey, authorization, fetchImpl: dependencies.fetchImpl });
      const { data: userData, error: userError } = await caller.auth.getUser();
      if (userError || !userData?.user) return finish(401, "auth_required", { ok: false, code: "auth_required" }, origin);
      const { data: isAdmin, error: adminError } = await caller.rpc("es_admin");
      if (adminError) return finish(500, "internal_error", { ok: false, code: "internal_error" }, origin);
      if (isAdmin !== true) return finish(403, "forbidden", { ok: false, code: "forbidden" }, origin);

      const input = await readRequest(request);
      if (!input) return finish(400, "invalid_request", { ok: false, code: "invalid_request" }, origin);

      const serviceRole = dependencies.getEnv("SUPABASE_SERVICE_ROLE_KEY");
      if (!serviceRole) return finish(500, "internal_error", { ok: false, code: "internal_error" }, origin);
      const serviceClient = await dependencies.createServiceClient({ projectUrl, serviceRole });
      const current = await serviceClient.from("cursos")
        .select("id, imagen_url, imagen_storage_path")
        .eq("id", input.courseId)
        .maybeSingle();
      if (current.error) return finish(500, "internal_error", { ok: false, code: "internal_error" }, origin);
      if (!current.data) return finish(404, "course_not_found", { ok: false, code: "course_not_found" }, origin);

      if (!sameNullable(current.data.imagen_url, input.expected.url) ||
          !sameNullable(current.data.imagen_storage_path, input.expected.path)) {
        return finish(409, "cover_conflict", { ok: false, code: "cover_conflict" }, origin);
      }

      const dissociation = await serviceClient.rpc("remove_course_cover", {
        course_id: input.courseId,
        expected_url: input.expected.url,
        expected_storage_path: input.expected.path,
      });
      if (dissociation.error) return finish(500, "internal_error", { ok: false, code: "internal_error" }, origin);
      const dissociationResult = firstRow(dissociation.data);
      const result = dissociationResult?.result;
      if (result === "cover_conflict") return finish(409, "cover_conflict", { ok: false, code: "cover_conflict" }, origin);
      if (result === "not_found") return finish(404, "course_not_found", { ok: false, code: "course_not_found" }, origin);
      if (result !== "removed" && result !== "no_cover") {
        return finish(500, "internal_error", { ok: false, code: "internal_error" }, origin);
      }

      const requested = await processRequestedCleanup(
        serviceClient,
        dissociationResult?.cleanup_storage_path || null,
      );
      const backlog = await processBacklog(
        serviceClient,
        Math.max(0, MAX_CLEANUP_JOBS - requested.counters.claimed),
      );
      const counters = {
        requestedClaimed: requested.counters.claimed,
        requestedDeleted: requested.counters.deleted,
        requestedQueued: requested.counters.queued,
        backlogClaimed: backlog.claimed,
        backlogDeleted: backlog.deleted,
        backlogQueued: backlog.queued,
        failures: requested.counters.failures + backlog.failures,
      };
      const pending = requested.status === "queued" || counters.failures > 0 ||
        counters.requestedQueued > 0 || counters.backlogQueued > 0;
      return finish(pending ? 202 : 200, pending ? "remove_cleanup_pending" : result === "removed" ? "remove_ok" : "no_cover", {
        ok: true,
        removed: result === "removed",
        cleanup: { status: requested.status, pending, counters },
      }, origin);
    } catch {
      return finish(500, "internal_error", { ok: false, code: "internal_error" }, responseOrigin);
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
  globalThis.Deno.serve(createRemoveCourseCoverHandler());
}
