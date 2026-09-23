import packageJson from "../../../package.json";

export const check = async () => null;
export class Update {
  version = packageJson.version;
  date = new Date().toISOString();
  body = "Mock update";
  async downloadAndInstall() {
    console.log("Mock download and install");
  }
}
