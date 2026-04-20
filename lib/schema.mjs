// Payload + storage schema version management.
// Used by bin/design-md.mjs CLI and future service-worker writes to guarantee
// __schemaVersion parity across all persisted payloads (US-005a / US-008).

export const SCHEMA_VERSION = 1;

export function writeWithSchema(payload) {
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("writeWithSchema: payload must be a non-null object");
  }
  return { __schemaVersion: SCHEMA_VERSION, ...payload };
}

export function validateSchema(obj) {
  if (obj == null || typeof obj !== "object") {
    throw new Error("schema: not an object");
  }
  if (obj.__schemaVersion == null) {
    throw new Error("schema: missing __schemaVersion");
  }
  if (obj.__schemaVersion > SCHEMA_VERSION) {
    throw new Error(
      `schema: version ${obj.__schemaVersion} is newer than installed ${SCHEMA_VERSION} — downgrade required`
    );
  }
  return true;
}
