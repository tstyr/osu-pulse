import { expect, it } from "vitest";
import { assertKnownRegistration, registrationBody } from "./register-plan";
it("refuses to delete unknown registrations", () => {
  expect(() => assertKnownRegistration([{ name: "unrelated" }], new Set(["pulse"]))).toThrow("UNRECOGNIZED_COMMANDS");
  expect(() => assertKnownRegistration([{ name: "pulse" }], new Set(["pulse"]))).not.toThrow();
});
it("strips server-generated fields for rollback without losing command permissions", () => {
  expect(registrationBody([{ id: "123", application_id: "456", version: "789", name: "test", type: 1, description: "test", default_member_permissions: "32", options: [] }]))
    .toEqual([{ name: "test", type: 1, description: "test", default_member_permissions: "32", options: [] }]);
});
