import { configure } from "onedollarstats";
import { useEffect } from "react";

export function Analytics() {
  useEffect(() => {
    configure({
      autocollect: true,
      collectorUrl: "/api/e",
      devmode: import.meta.env.DEV,
      excludePages: ["/chat", "/chat/*"],
      hostname: "www.gitingest.com",
    });
  }, []);

  return null;
}
