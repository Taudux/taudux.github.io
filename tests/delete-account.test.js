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
  const calls = { deleted: [], logs: [], eventosInsertados: [], eventosCompensados: [], orden: [] };
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
            calls.orden.push("deleteUser");
            calls.deleted.push(args);
            if (options.deleteThrows) throw new Error("network timeout");
            if (options.deleteError) return { data: null, error: { message: "boom" } };
            return { data: { user: null }, error: null };
          },
        },
      },
      from(table) {
        return {
          insert(row) {
            calls.eventosInsertados.push({ table, row });
            return {
              select() {
                return {
                  async single() {
                    calls.orden.push("evento");
                    if (options.eventoError) return { data: null, error: { message: "evento boom" } };
                    return { data: { id: 99 }, error: null };
                  },
                };
              },
            };
          },
          delete() {
            return {
              eq: (column, value) => {
                calls.eventosCompensados.push({ table, column, value });
                return Promise.resolve({ data: null, error: null });
              },
            };
          },
        };
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

test("the baja_cuenta event is recorded in eventos_negocio before the account is deleted", async () => {
  const { handler, calls } = await createHarness();
  const response = await handler(deletionRequest());
  assert.equal(response.status, 200);
  assert.equal(calls.eventosInsertados.length, 1);
  assert.equal(calls.eventosInsertados[0].table, "eventos_negocio");
  assert.deepEqual(calls.eventosInsertados[0].row, {
    tipo: "baja_cuenta",
    usuario_ref: USER_ID,
    origen: "autoservicio",
  });
  assert.deepEqual(calls.orden, ["evento", "deleteUser"], "the event must be written before deleteUser runs");
});

test("if deleteUser fails, the just-recorded event is compensated (deleted) since the account survives", async () => {
  const { handler, calls } = await createHarness({ deleteError: true });
  const response = await handler(deletionRequest());
  assert.equal(response.status, 500);
  assert.equal(calls.eventosInsertados.length, 1);
  assert.deepEqual(calls.eventosCompensados, [{ table: "eventos_negocio", column: "id", value: 99 }]);
});

test("if deleteUser throws instead of resolving with an error, the event is still compensated", async () => {
  /*
    A rejected promise (network timeout, an unexpected SDK exception) is a
    different failure shape than deleteUser resolving with { error }, and it
    must be handled the same way: the account was NOT deleted, so the
    baja_cuenta event recorded above is no longer true and must be removed.
  */
  const { handler, calls } = await createHarness({ deleteThrows: true });
  const response = await handler(deletionRequest());
  assert.equal(response.status, 500);
  assert.deepEqual(await payload(response), { ok: false, code: "internal_error" });
  assert.equal(calls.eventosInsertados.length, 1);
  assert.deepEqual(calls.eventosCompensados, [{ table: "eventos_negocio", column: "id", value: 99 }]);
});

test("if recording the event fails, the account is still deleted: the right to leave never depends on analytics", async () => {
  const { handler, calls } = await createHarness({ eventoError: true });
  const response = await handler(deletionRequest());
  assert.equal(response.status, 200);
  assert.deepEqual(await payload(response), { ok: true });
  assert.equal(calls.deleted.length, 1, "deleteUser must still run");
  assert.equal(calls.eventosCompensados.length, 0, "nothing to compensate: the event was never recorded");
  assert.equal(calls.logs.length, 2, "the swallowed event failure gets its own diagnostic line");
  assert.equal(calls.logs[0].code, "evento_baja_failed");
  assert.equal(calls.logs[1].code, "delete_ok");
});
