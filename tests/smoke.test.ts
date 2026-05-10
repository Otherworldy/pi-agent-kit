import test from "node:test";
import assert from "node:assert/strict";
import footerFixedPlugin from "../src/index.ts";

test("plugin exports a default factory and registers lifecycle hooks plus commands", () => {
  const events: string[] = [];
  const commands: string[] = [];
  const api = {
    on(event: string) {
      events.push(event);
    },
    registerCommand(name: string) {
      commands.push(name);
    },
  };

  assert.equal(typeof footerFixedPlugin, "function");
  footerFixedPlugin(api as never);

  assert.deepEqual(events, ["session_start", "session_shutdown"]);
  assert.deepEqual(commands, ["footer-fixed"]);
});
