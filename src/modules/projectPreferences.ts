import { config } from "../../package.json";
import { getInitializationState } from "./initialization";

export interface RecognitionProjects {
  includeCCF: boolean;
  includeCAS: boolean;
}

export const RECOGNITION_PROJECTS_KEY = `${config.prefsPrefix}.recognitionProjects`;
const projectListeners = new Set<(projects: RecognitionProjects) => void>();

export function observeRecognitionProjects(listener: (projects: RecognitionProjects) => void): () => void {
  projectListeners.add(listener);
  return () => { projectListeners.delete(listener); };
}

export function clearRecognitionProjectObservers(): void {
  projectListeners.clear();
}

/** 首次升级时沿用最近一次初始化选择，之后以用户的实时选择为准。 */
export function getRecognitionProjects(): RecognitionProjects {
  try {
    const raw = Zotero.Prefs.get(RECOGNITION_PROJECTS_KEY, true);
    if (typeof raw === "string" && raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.includeCCF === "boolean" && typeof parsed?.includeCAS === "boolean") {
        return { includeCCF: parsed.includeCCF, includeCAS: parsed.includeCAS };
      }
    }
  } catch {
    // 未设置、不可读取或无效时沿用历史选择。
  }
  const lastProjects = getInitializationState().lastProjects;
  if (Array.isArray(lastProjects) && lastProjects.length > 0) {
    return { includeCCF: lastProjects.includes("CCF"), includeCAS: lastProjects.includes("CAS") };
  }
  return { includeCCF: true, includeCAS: true };
}

export function setRecognitionProjects(projects: RecognitionProjects): void {
  Zotero.Prefs.set(RECOGNITION_PROJECTS_KEY, JSON.stringify(projects), true);
  for (const listener of projectListeners) {
    try {
      listener(projects);
    } catch (error) {
      if (typeof ztoolkit !== "undefined") ztoolkit.log("Could not update recognition project menu", error);
    }
  }
}
