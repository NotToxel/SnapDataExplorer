import packageJson from "../../../package.json";

export const getVersion = async () => packageJson.version;
export const getName = async () => "Snap Explorer Mock";
export const getTauriVersion = async () => "2.0.0-mock";

