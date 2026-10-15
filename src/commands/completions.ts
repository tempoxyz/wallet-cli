import { supportedShells } from "../completions.js";

export function completionsHandler() {
  return {
    supported_shells: [...supportedShells],
  };
}
