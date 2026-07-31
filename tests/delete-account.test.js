const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const FUNCTION_PATH = path.resolve("supabase/functions/delete-account/index.ts");
const endpoint = import(pathToFileURL(FUNCTION_PATH).href);
const ORIGIN = "https://taudux.com";
const PROJECT_URL = "https://yqkvgfqplmbbcebrivpt.supabase.co";
const USER_ID = "123e4567-e89b-42d3-a456-426614174000";
const OTHER_USER_ID = "99999999-e89b-42d3-a456-426614174999";

function deletionRequest(options = {}) {
  const { body, method = "POST" } = options;
  const origin = Object.hasOwn(options, "origin") ? options.origin : ORIGIN;
  const token = Object.hasOwn(options, "token") ? options.token : "Bearer user";
  const headers = {};
  if (origin !== undefined) headers.origin = origin;
  if (token !== undefined) headers.authorization = token;
  if (method === "OPTIONS" || method === "GET" || method === "HEAD") {
    return new Request("https://edge.test/delete", { method, headers });
  }
  headers["content-type"] = "application/json";
  return new Request("https://edge.test/delete", {
    method,
    headers,
    body: JSON.stringify(body ?? {}),
  });
}

async function payload(response) {
  return JSON.parse(await response.text());
}

async function createHarness(options = {}) {
  const { createDeleteAccountHandler } = await endpoint;
  const calls = { deleted: [], logs: [] };
  const user = Object.hasOwn(options, "user") ? options.user : { id: USER_ID };

  const env = {
    SUPABASE_URL: PROJECT_URL,
    SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    ...(options.env ?? {}),
  };

  const handler = createDeleteAccountHandler({
    getEnv: (name) => env[name],
    now: () => 0,
    logger: {
      info: (line) => calls.logs.push(JSON.parse(line)),
      error: (line) => calls.logs.push(JSON.parse(line)),
    },
    createCallerClient: () => ({
      auth: {
        async getUser() {
          if (options.userError) return { data: { user: null }, error: true };
          return { data: { user }, error: null };
        },
      },
    }),
    createServiceClient: async () => ({
      auth: {
        admin: {
          async deleteUser(...args) {
            calls.deleted.push(args);
            if (options.deleteError) return { data: null, error: { message: "boom" } };
            return { data: { user: null }, error: null };
          },
        },
      },
    }),
    ...(options.overrides ?? {}),
  });

  return { handler, calls };
}

test("a request from a foreign origin is rejected before any auth work", async () => {
  const { handler, calls } = await createHarness();
  const response = await handler(deletionRequest({ origin: "https://evil.test" }));
  assert.equal(response.status, 403);
  assert.equal((await payload(response)).code, "invalid_origin");
  assert.equal(calls.deleted.length, 0);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
});

test("preflight is answered without deleting anything", async () => {
  const { handler, calls } = await createHarness();
  const response = await handler(deletionRequest({ method: "OPTIONS" }));
  assert.equal(response.status, 204);
  assert.equal(calls.deleted.length, 0);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), ORIGIN);
});

test("a non-POST method is rejected", async () => {
  const { handler, calls } = await createHarness();
  const response = await handler(deletionRequest({ method: "GET" }));
  assert.equal(response.status, 405);
  assert.equal((await payload(response)).code, "method_not_allowed");
  assert.equal(calls.deleted.length, 0);
});

test("a request without an Authorization header never reaches the service role", async () => {
  const { handler, calls } = await createHarness();
  const response = await handler(deletionRequest({ token: undefined }));
  assert.equal(response.status, 401);
  assert.equal((await payload(response)).code, "auth_required");
  assert.equal(calls.deleted.length, 0);
});

test("an invalid JWT is rejected without deleting anything", async () => {
  const { handler, calls } = await createHarness({ userError: true });
  const response = await handler(deletionRequest());
  assert.equal(response.status, 401);
  assert.equal((await payload(response)).code, "auth_required");
  assert.equal(calls.deleted.length, 0);
});

test("a token whose user has no id is treated as unauthenticated", async () => {
  const { handler, calls } = await createHarness({ user: {} });
  const response = await handler(deletionRequest());
  assert.equal(response.status, 401);
  assert.equal(calls.deleted.length, 0);
});

test("a successful deletion targets the JWT's own user and reports ok", async () => {
  const { handler, calls } = await createHarness();
  const response = await handler(deletionRequest());
  assert.equal(response.status, 200);
  assert.deepEqual(await payload(response), { ok: true });
  assert.equal(calls.deleted.length, 1);
  assert.equal(calls.deleted[0][0], USER_ID);
});

test("deletion is a hard delete: no soft-delete flag is ever passed", async () => {
  /*
    Con soft delete la fila de auth.users sobrevive con deleted_at y el
    ON DELETE CASCADE de perfiles.id nunca corre: el perfil quedaría huérfano.
  */
  const { handler, calls } = await createHarness();
  await handler(deletionRequest());
  const [, shouldSoftDelete] = calls.deleted[0];
  assert.ok(
    shouldSoftDelete === undefined || shouldSoftDelete === false,
    "deleteUser must not request a soft delete"
  );
});

test("a user id supplied in the body is ignored: only the JWT decides who is deleted", async () => {
  const { handler, calls } = await createHarness();
  const response = await handler(deletionRequest({ body: { userId: OTHER_USER_ID, id: OTHER_USER_ID } }));
  assert.equal(response.status, 200);
  assert.equal(calls.deleted[0][0], USER_ID);
  assert.notEqual(calls.deleted[0][0], OTHER_USER_ID);
});

test("a failure from the admin API reports a generic error without leaking details", async () => {
  const { handler } = await createHarness({ deleteError: true });
  const response = await handler(deletionRequest());
  assert.equal(response.status, 500);
  const body = await payload(response);
  assert.deepEqual(body, { ok: false, code: "internal_error" });
  assert.doesNotMatch(JSON.stringify(body), /boom/);
});

test("a missing service role key fails closed instead of deleting", async () => {
  const { handler, calls } = await createHarness({ env: { SUPABASE_SERVICE_ROLE_KEY: undefined } });
  const response = await handler(deletionRequest());
  assert.equal(response.status, 500);
  assert.equal((await payload(response)).code, "internal_error");
  assert.equal(calls.deleted.length, 0);
});

test("every outcome is logged as one structured line", async () => {
  const { handler, calls } = await createHarness();
  await handler(deletionRequest());
  assert.equal(calls.logs.length, 1);
  assert.equal(calls.logs[0].event, "delete_account");
  assert.equal(calls.logs[0].code, "delete_ok");
  assert.equal(calls.logs[0].status, 200);
});
