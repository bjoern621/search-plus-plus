import Mocha from "mocha";
import { join } from "node:path";

/** Entry point that VS Code calls once the window has loaded the extension under test. */
export function run(): Promise<void> {
  const mocha = new Mocha({ ui: "bdd", color: true, timeout: 30_000 });
  mocha.addFile(join(__dirname, "search.suite.js"));
  return new Promise((resolve, reject) => {
    mocha.run((failures) => (failures > 0 ? reject(new Error(`${failures} integration tests failed`)) : resolve()));
  });
}
